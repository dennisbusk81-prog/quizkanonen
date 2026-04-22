import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Ranking helpers (brukes av last_quiz-modus) ───────────────────────────────

type RawAttempt = {
  user_id: string
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
}

function pickBestAttempt(existing: RawAttempt, challenger: RawAttempt): RawAttempt {
  if (challenger.correct_answers > existing.correct_answers) return challenger
  if (challenger.correct_answers === existing.correct_answers && challenger.total_time_ms < existing.total_time_ms) return challenger
  if (
    challenger.correct_answers === existing.correct_answers &&
    challenger.total_time_ms === existing.total_time_ms &&
    (challenger.correct_streak ?? 0) > (existing.correct_streak ?? 0)
  ) return challenger
  return existing
}

function rankAttempts(attempts: RawAttempt[]): Array<RawAttempt & { rank: number }> {
  const sorted = [...attempts].sort((a, b) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
    return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  })
  const withRanks: Array<RawAttempt & { rank: number }> = []
  for (let i = 0; i < sorted.length; i++) {
    let rank = i + 1
    if (i > 0) {
      const prev = sorted[i - 1]
      if (sorted[i].correct_answers === prev.correct_answers && sorted[i].total_time_ms === prev.total_time_ms) {
        rank = withRanks[i - 1].rank
      }
    }
    withRanks.push({ ...sorted[i], rank })
  }
  return withRanks
}

// ── Period helpers ────────────────────────────────────────────────────────────

function getPeriodStart(period: string): string {
  const now = new Date()
  let d: Date
  if (period === 'month') {
    d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  } else if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3)
    d = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1))
  } else if (period === 'year') {
    d = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  } else {
    return new Date(0).toISOString() // alltime
  }
  return d.toISOString()
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') ?? 'month'

  if (!['month', 'quarter', 'year', 'alltime', 'last_quiz'].includes(period)) {
    return NextResponse.json({ error: 'Ugyldig periode' }, { status: 400 })
  }

  // scope params — brukes av liga/org i Økt 4/5, global er default
  const scope   = searchParams.get('scope')    ?? 'global'
  const scopeId = searchParams.get('scope_id') ?? null

  // Eksplisitt datoperiode — brukes av historikk-accordion
  const periodStartParam = searchParams.get('period_start')
  const periodEndParam   = searchParams.get('period_end')

  // Identify user
  let userId: string | null = null
  let userIsPremium = false
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (token) {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token)
    if (user) {
      userId = user.id
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('premium_status')
        .eq('id', user.id)
        .maybeSingle()
      userIsPremium = profile?.premium_status === true
    }
  }

  // Hent ekskluderte brukere for dette scopet
  let excludedQuery = supabaseAdmin
    .from('excluded_members')
    .select('user_id')
    .eq('scope_type', scope)
  if (scopeId) excludedQuery = excludedQuery.eq('scope_id', scopeId)
  else         excludedQuery = excludedQuery.is('scope_id', null)
  const { data: excludedRows } = await excludedQuery
  const excludedSet = new Set((excludedRows ?? []).map((e: { user_id: string }) => e.user_id))

  // ── LAST QUIZ MODE ──────────────────────────────────────────────────────────
  if (period === 'last_quiz') {
    const now = new Date().toISOString()

    const { data: latestQuiz } = await supabaseAdmin
      .from('quizzes')
      .select('id, title, closes_at')
      .lt('closes_at', now)
      .order('closes_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestQuiz) {
      return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: null })
    }

    const { data: rawAttempts } = await supabaseAdmin
      .from('attempts')
      .select('user_id, player_name, correct_answers, total_time_ms, correct_streak')
      .eq('quiz_id', latestQuiz.id)
      .not('user_id', 'is', null)
      .eq('is_team', false)

    if (!rawAttempts || rawAttempts.length === 0) {
      return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: latestQuiz.title })
    }

    const bestByUser = new Map<string, RawAttempt>()
    for (const a of rawAttempts as RawAttempt[]) {
      if (excludedSet.has(a.user_id)) continue
      const existing = bestByUser.get(a.user_id)
      bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) : a)
    }

    const withRanks = rankAttempts([...bestByUser.values()])

    const top10Ids = withRanks.slice(0, 10).map(a => a.user_id)
    const allRankedIds = withRanks.map(a => a.user_id)
    const profileIds =
      userId && !top10Ids.includes(userId) && allRankedIds.includes(userId)
        ? [...top10Ids, userId]
        : top10Ids

    const { data: profiles } = profileIds.length > 0
      ? await supabaseAdmin.from('profiles').select('id, display_name').in('id', profileIds)
      : { data: [] }

    const profileMap = new Map<string, { display_name: string | null }>()
    for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
      profileMap.set(p.id, p)
    }

    const entries = withRanks.slice(0, 10).map(a => {
      const profile = profileMap.get(a.user_id)
      return {
        rank: a.rank,
        userId: a.user_id,
        displayName: profile?.display_name ?? a.player_name,
        avatarUrl: null,
        points: a.correct_answers,
        quizCount: 1,
        topStreak: a.correct_streak ?? 0,
        fastestMs: a.total_time_ms,
      }
    })

    let userEntry = null
    if (userId) {
      const userInRanked = withRanks.find(a => a.user_id === userId)
      if (userInRanked) {
        const profile = profileMap.get(userId)
        userEntry = {
          rank: userInRanked.rank,
          displayName: profile?.display_name ?? userInRanked.player_name,
          avatarUrl: null,
          points: userInRanked.correct_answers,
          quizCount: 1,
        }
      }
    }

    return NextResponse.json({ entries, userEntry, userIsPremium, quizTitle: latestQuiz.title })
  }

  // ── PERIOD MODE — leser fra season_scores ─────────────────────────────────
  const periodStart = periodStartParam ?? getPeriodStart(period)
  const periodEnd   = periodEndParam ?? null   // null = ingen øvre grense

  // 1. Hent alle season_scores-rader for scope + periode
  type ScoreRow = { user_id: string; points: number; quiz_id: string; closes_at: string }

  let scoresQuery = supabaseAdmin
    .from('season_scores')
    .select('user_id, points, quiz_id, closes_at')
    .eq('scope_type', scope)
    .gte('closes_at', periodStart)

  if (periodEnd) scoresQuery = scoresQuery.lt('closes_at', periodEnd)
  if (scopeId)   scoresQuery = scoresQuery.eq('scope_id', scopeId)
  else            scoresQuery = scoresQuery.is('scope_id', null)

  const { data: scores } = await scoresQuery

  if (!scores || scores.length === 0) {
    return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: null })
  }

  // 2. Aggregér per bruker
  type UserStats = {
    userId: string
    points: number
    quizCount: number
    quizIds: Set<string>
    topStreak: number
  }

  const userStats = new Map<string, UserStats>()
  const quizClosedAtMap = new Map<string, string>() // quiz_id → closes_at (for streakberegning)

  for (const row of scores as ScoreRow[]) {
    if (excludedSet.has(row.user_id)) continue
    if (!userStats.has(row.user_id)) {
      userStats.set(row.user_id, { userId: row.user_id, points: 0, quizCount: 0, quizIds: new Set(), topStreak: 0 })
    }
    const stats = userStats.get(row.user_id)!
    stats.points     += row.points
    stats.quizCount  += 1
    stats.quizIds.add(row.quiz_id)
    quizClosedAtMap.set(row.quiz_id, row.closes_at)
  }

  // 3. Sorter: poeng DESC, quizCount ASC
  const sorted = [...userStats.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    return a.quizCount - b.quizCount
  })

  // 4. Beregn topStreak for topp 10 (basert på quiz-deltagelse i perioden)
  const allQuizIds = [...quizClosedAtMap.keys()].sort(
    (a, b) => quizClosedAtMap.get(a)!.localeCompare(quizClosedAtMap.get(b)!)
  )
  const totalQuizCount = allQuizIds.length

  for (const stats of sorted.slice(0, 10)) {
    let streak = 0
    for (let i = totalQuizCount - 1; i >= 0; i--) {
      if (stats.quizIds.has(allQuizIds[i])) streak++
      else break
    }
    stats.topStreak = streak
  }

  // 5. Profiloppslag for topp 10 + innlogget bruker
  const top10 = sorted.slice(0, 10)
  const top10Ids = top10.map(s => s.userId)
  const profileIds =
    userId && !top10Ids.includes(userId) && userStats.has(userId)
      ? [...top10Ids, userId]
      : top10Ids

  const { data: profiles } = profileIds.length > 0
    ? await supabaseAdmin.from('profiles').select('id, display_name').in('id', profileIds)
    : { data: [] }

  const profileMap = new Map<string, { display_name: string | null }>()
  for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
    profileMap.set(p.id, p)
  }

  // 6. FastestMs — én query mot attempts for topp-10-brukere i perioden
  //    (brukes av lyn-badge og tiebreak-visning)
  const quizIdsInPeriod = [...quizClosedAtMap.keys()]
  const fastestMsMap = new Map<string, number>()

  if (profileIds.length > 0 && quizIdsInPeriod.length > 0) {
    const { data: fastAttempts } = await supabaseAdmin
      .from('attempts')
      .select('user_id, total_time_ms')
      .in('user_id', profileIds)
      .in('quiz_id', quizIdsInPeriod)
      .eq('is_team', false)
      .not('user_id', 'is', null)

    for (const a of (fastAttempts ?? []) as { user_id: string; total_time_ms: number }[]) {
      const current = fastestMsMap.get(a.user_id)
      if (current === undefined || a.total_time_ms < current) {
        fastestMsMap.set(a.user_id, a.total_time_ms)
      }
    }
  }

  // 7. Bygg entries
  const entries = top10.map((stats, i) => {
    const profile = profileMap.get(stats.userId)
    return {
      rank: i + 1,
      userId: stats.userId,
      displayName: profile?.display_name ?? 'Spiller',
      avatarUrl: null,
      points: stats.points,
      quizCount: stats.quizCount,
      topStreak: stats.topStreak,
      fastestMs: fastestMsMap.get(stats.userId) ?? null,
    }
  })

  // 8. Brukerens egen plassering
  let userEntry = null
  if (userId) {
    const userIdx = sorted.findIndex(s => s.userId === userId)
    if (userIdx >= 0) {
      const stats = sorted[userIdx]
      const profile = profileMap.get(userId)
      userEntry = {
        rank: userIdx + 1,
        displayName: profile?.display_name ?? 'Spiller',
        avatarUrl: null,
        points: stats.points,
        quizCount: stats.quizCount,
      }
    }
  }

  return NextResponse.json({ entries, userEntry, userIsPremium, quizTitle: null })
}
