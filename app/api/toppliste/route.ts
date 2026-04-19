import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const POINTS_TABLE = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]

function getPoints(rank: number): number {
  return rank <= 10 ? POINTS_TABLE[rank - 1] : 1
}

function getPeriodStart(period: string): string {
  const now = new Date()
  let d: Date
  if (period === 'month') {
    d = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    d = new Date(now.getFullYear(), q * 3, 1)
  } else if (period === 'year') {
    d = new Date(now.getFullYear(), 0, 1)
  } else {
    return new Date(0).toISOString()
  }
  return d.toISOString()
}

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
      if (
        sorted[i].correct_answers === prev.correct_answers &&
        sorted[i].total_time_ms === prev.total_time_ms
      ) {
        rank = withRanks[i - 1].rank
      }
    }
    withRanks.push({ ...sorted[i], rank })
  }
  return withRanks
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') ?? 'month'
  if (!['month', 'quarter', 'year', 'alltime', 'last_quiz'].includes(period)) {
    return NextResponse.json({ error: 'Ugyldig periode' }, { status: 400 })
  }

  // Identify user if token present
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

    // Best attempt per user
    const bestByUser = new Map<string, RawAttempt>()
    for (const a of rawAttempts as RawAttempt[]) {
      const existing = bestByUser.get(a.user_id)
      bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) : a)
    }

    const withRanks = rankAttempts([...bestByUser.values()])

    // Fetch profiles for top 10 (+ current user if outside top 10)
    const top10Ids = withRanks.slice(0, 10).map(a => a.user_id)
    const allRankedIds = withRanks.map(a => a.user_id)
    const profileIds =
      userId && !top10Ids.includes(userId) && allRankedIds.includes(userId)
        ? [...top10Ids, userId]
        : top10Ids

    const { data: profiles } = profileIds.length > 0
      ? await supabaseAdmin.from('profiles').select('id, display_name, avatar_url').in('id', profileIds)
      : { data: [] }

    const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>()
    for (const p of (profiles ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
      profileMap.set(p.id, p)
    }

    // For last_quiz: points = correctAnswers, fastestMs = totalTimeMs (for display)
    const entries = withRanks.slice(0, 10).map(a => {
      const profile = profileMap.get(a.user_id)
      return {
        rank: a.rank,
        userId: a.user_id,
        displayName: profile?.display_name ?? a.player_name,
        avatarUrl: profile?.avatar_url ?? null,
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
          avatarUrl: profile?.avatar_url ?? null,
          points: userInRanked.correct_answers,
          quizCount: 1,
        }
      }
    }

    return NextResponse.json({ entries, userEntry, userIsPremium, quizTitle: latestQuiz.title })
  }

  // ── PERIOD MODE ─────────────────────────────────────────────────────────────
  const periodStart = getPeriodStart(period)

  const { data: quizzes } = await supabaseAdmin
    .from('quizzes')
    .select('id, closes_at')
    .gte('closes_at', periodStart)
    .order('closes_at', { ascending: true })

  if (!quizzes || quizzes.length === 0) {
    return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: null })
  }

  const quizIds = quizzes.map((q: { id: string }) => q.id)

  const { data: attempts } = await supabaseAdmin
    .from('attempts')
    .select('quiz_id, user_id, player_name, correct_answers, total_time_ms, correct_streak')
    .in('quiz_id', quizIds)
    .not('user_id', 'is', null)
    .eq('is_team', false)

  if (!attempts || attempts.length === 0) {
    return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: null })
  }

  type RawAttemptWithQuiz = RawAttempt & { quiz_id: string }

  const byQuiz = new Map<string, RawAttemptWithQuiz[]>()
  for (const a of attempts as RawAttemptWithQuiz[]) {
    if (!byQuiz.has(a.quiz_id)) byQuiz.set(a.quiz_id, [])
    byQuiz.get(a.quiz_id)!.push(a)
  }

  type UserStats = {
    userId: string
    points: number
    quizCount: number
    fastestMs: number
    quizIndices: Set<number>
    topStreak: number
    playerName: string
  }

  const userStats = new Map<string, UserStats>()

  for (let qi = 0; qi < quizzes.length; qi++) {
    const quiz = quizzes[qi] as { id: string }
    const quizAttempts = byQuiz.get(quiz.id) ?? []
    if (quizAttempts.length === 0) continue

    const bestByUser = new Map<string, RawAttemptWithQuiz>()
    for (const a of quizAttempts) {
      const existing = bestByUser.get(a.user_id)
      bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) as RawAttemptWithQuiz : a)
    }

    const ranked = [...bestByUser.values()].sort((a, b) => {
      if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
      if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
      return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
    })

    for (let ri = 0; ri < ranked.length; ri++) {
      const a = ranked[ri]
      const pts = getPoints(ri + 1)
      if (!userStats.has(a.user_id)) {
        userStats.set(a.user_id, {
          userId: a.user_id,
          points: 0,
          quizCount: 0,
          fastestMs: Infinity,
          quizIndices: new Set(),
          topStreak: 0,
          playerName: a.player_name,
        })
      }
      const stats = userStats.get(a.user_id)!
      stats.points += pts
      stats.quizCount += 1
      if (a.total_time_ms < stats.fastestMs) stats.fastestMs = a.total_time_ms
      stats.quizIndices.add(qi)
    }
  }

  const totalQuizzes = quizzes.length
  for (const stats of userStats.values()) {
    let streak = 0
    for (let i = totalQuizzes - 1; i >= 0; i--) {
      if (stats.quizIndices.has(i)) streak++
      else break
    }
    stats.topStreak = streak
  }

  const sorted = [...userStats.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (a.quizCount !== b.quizCount) return a.quizCount - b.quizCount
    return a.fastestMs - b.fastestMs
  })

  const topIds = sorted.slice(0, 10).map(s => s.userId)
  const profileIds = userId && !topIds.includes(userId) ? [...topIds, userId] : topIds

  const { data: profiles } = profileIds.length > 0
    ? await supabaseAdmin.from('profiles').select('id, display_name, avatar_url').in('id', profileIds)
    : { data: [] }

  const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>()
  for (const p of (profiles ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
    profileMap.set(p.id, p)
  }

  const entries = sorted.slice(0, 10).map((stats, i) => {
    const profile = profileMap.get(stats.userId)
    return {
      rank: i + 1,
      userId: stats.userId,
      displayName: profile?.display_name ?? stats.playerName,
      avatarUrl: profile?.avatar_url ?? null,
      points: stats.points,
      quizCount: stats.quizCount,
      topStreak: stats.topStreak,
      fastestMs: stats.fastestMs === Infinity ? null : stats.fastestMs,
    }
  })

  let userEntry = null
  if (userId) {
    const userIdx = sorted.findIndex(s => s.userId === userId)
    if (userIdx >= 0) {
      const stats = sorted[userIdx]
      const profile = profileMap.get(userId)
      userEntry = {
        rank: userIdx + 1,
        displayName: profile?.display_name ?? stats.playerName,
        avatarUrl: profile?.avatar_url ?? null,
        points: stats.points,
        quizCount: stats.quizCount,
      }
    }
  }

  return NextResponse.json({ entries, userEntry, userIsPremium, quizTitle: null })
}
