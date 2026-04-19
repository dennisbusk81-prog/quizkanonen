import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type ProfileRow = { id: string; display_name: string | null; avatar_url: string | null }

function getGroupKey(closesAt: string, period: string): string {
  const d = new Date(closesAt)
  if (period === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  if (period === 'quarter') {
    const q = Math.floor(d.getUTCMonth() / 3) + 1
    return `${d.getUTCFullYear()}-Q${q}`
  }
  return String(d.getUTCFullYear())
}

function getCurrentPeriodKey(period: string): string {
  const now = new Date()
  if (period === 'month') {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  }
  if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3) + 1
    return `${now.getUTCFullYear()}-Q${q}`
  }
  return String(now.getUTCFullYear())
}

// GET /api/toppliste/history?period=month|quarter|year|last_quiz&scope=global&scope_id=<uuid>
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const period  = searchParams.get('period')   ?? 'month'
  const scope   = searchParams.get('scope')    ?? 'global'
  const scopeId = searchParams.get('scope_id') ?? null

  if (!['month', 'quarter', 'year', 'last_quiz'].includes(period)) {
    return NextResponse.json({ entries: [] })
  }

  // ── LAST QUIZ MODE ──────────────────────────────────────────────────────────
  if (period === 'last_quiz') {
    const now = new Date().toISOString()

    // Hent alle stengte quizer, skip den nyeste (vises i hovedfanen)
    const { data: allClosed } = await supabaseAdmin
      .from('quizzes')
      .select('id, title, closes_at')
      .lt('closes_at', now)
      .order('closes_at', { ascending: false })
      .limit(21)

    if (!allClosed || allClosed.length <= 1) {
      return NextResponse.json({ entries: [] }, { headers: { 'Cache-Control': 'public, s-maxage=300' } })
    }

    const quizzes = (allClosed as { id: string; title: string; closes_at: string }[]).slice(1)
    const quizIds = quizzes.map(q => q.id)

    // Finn rank=1 fra season_scores for disse quizene
    let winnersQuery = supabaseAdmin
      .from('season_scores')
      .select('quiz_id, user_id, points')
      .in('quiz_id', quizIds)
      .eq('scope_type', scope)
      .eq('rank', 1)
    if (scopeId) winnersQuery = winnersQuery.eq('scope_id', scopeId)
    else         winnersQuery = winnersQuery.is('scope_id', null)
    const { data: winners } = await winnersQuery

    const winnerByQuiz = new Map<string, { user_id: string; points: number }>()
    for (const w of (winners ?? []) as { quiz_id: string; user_id: string; points: number }[]) {
      if (!winnerByQuiz.has(w.quiz_id)) winnerByQuiz.set(w.quiz_id, w)
    }

    // Hent correct_answers for vinnerne fra attempts
    const winnerPairs = [...winnerByQuiz.entries()]
    const winnerUserIds = [...new Set(winnerPairs.map(([, w]) => w.user_id))]

    const correctAnswersMap = new Map<string, number>() // `${quiz_id}:${user_id}` → correct_answers
    if (winnerUserIds.length > 0) {
      const { data: winnerAttempts } = await supabaseAdmin
        .from('attempts')
        .select('user_id, quiz_id, correct_answers')
        .in('quiz_id', quizIds)
        .in('user_id', winnerUserIds)
        .eq('is_team', false)
        .not('user_id', 'is', null)

      for (const a of (winnerAttempts ?? []) as { user_id: string; quiz_id: string; correct_answers: number }[]) {
        const key = `${a.quiz_id}:${a.user_id}`
        const current = correctAnswersMap.get(key)
        if (current === undefined || a.correct_answers > current) {
          correctAnswersMap.set(key, a.correct_answers)
        }
      }
    }

    // Profiloppslag
    const { data: profiles } = winnerUserIds.length > 0
      ? await supabaseAdmin.from('profiles').select('id, display_name, avatar_url').in('id', winnerUserIds)
      : { data: [] }

    const profileMap = new Map<string, ProfileRow>()
    for (const p of (profiles ?? []) as ProfileRow[]) profileMap.set(p.id, p)

    const entries = quizzes.map(quiz => {
      const w = winnerByQuiz.get(quiz.id)
      const profile = w ? profileMap.get(w.user_id) : null
      const correctAnswers = w ? correctAnswersMap.get(`${quiz.id}:${w.user_id}`) ?? null : null
      return {
        key: quiz.id,
        label: quiz.title,
        closesAt: quiz.closes_at,
        quizId: quiz.id,
        winner: w && profile ? {
          displayName: profile.display_name ?? 'Spiller',
          avatarUrl: profile.avatar_url ?? null,
          score: correctAnswers ?? w.points,
          scoreLabel: correctAnswers !== null ? 'riktige' : 'poeng',
        } : null,
      }
    })

    return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'public, s-maxage=300' } })
  }

  // ── PERIODE MODE (month / quarter / year) ─────────────────────────────────
  const currentKey = getCurrentPeriodKey(period)

  // Hent alle rader FØR inneværende periode
  type ScoreRow = { user_id: string; points: number; closes_at: string }

  let scoresQuery = supabaseAdmin
    .from('season_scores')
    .select('user_id, points, closes_at')
    .eq('scope_type', scope)

  if (scopeId) scoresQuery = scoresQuery.eq('scope_id', scopeId)
  else         scoresQuery = scoresQuery.is('scope_id', null)

  // Øvre grense: closes_at < start of current period
  const now = new Date()
  let cutoff: string
  if (period === 'month') {
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  } else if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3)
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)).toISOString()
  } else {
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
  }

  scoresQuery = scoresQuery.lt('closes_at', cutoff)

  const { data: scores } = await scoresQuery

  if (!scores || scores.length === 0) {
    return NextResponse.json({ entries: [] }, { headers: { 'Cache-Control': 'public, s-maxage=300' } })
  }

  // Gruppér per periode-nøkkel
  type PeriodGroup = Map<string, { points: number; quizCount: number }>
  const byPeriod = new Map<string, PeriodGroup>()

  for (const row of scores as ScoreRow[]) {
    const key = getGroupKey(row.closes_at, period)
    if (key === currentKey) continue // ekstra sjekk
    if (!byPeriod.has(key)) byPeriod.set(key, new Map())
    const group = byPeriod.get(key)!
    const existing = group.get(row.user_id) ?? { points: 0, quizCount: 0 }
    group.set(row.user_id, { points: existing.points + row.points, quizCount: existing.quizCount + 1 })
  }

  if (byPeriod.size === 0) {
    return NextResponse.json({ entries: [] }, { headers: { 'Cache-Control': 'public, s-maxage=300' } })
  }

  // Finn vinner per periode
  const winnerByPeriod = new Map<string, { userId: string; points: number }>()
  const allWinnerIds: string[] = []

  for (const [key, group] of byPeriod) {
    let bestUserId = ''
    let bestPoints = -1
    let bestQuizCount = Infinity
    for (const [userId, stats] of group) {
      if (stats.points > bestPoints || (stats.points === bestPoints && stats.quizCount < bestQuizCount)) {
        bestUserId = userId
        bestPoints = stats.points
        bestQuizCount = stats.quizCount
      }
    }
    winnerByPeriod.set(key, { userId: bestUserId, points: bestPoints })
    if (bestUserId) allWinnerIds.push(bestUserId)
  }

  // Profiloppslag
  const uniqueIds = [...new Set(allWinnerIds)]
  const { data: profiles } = uniqueIds.length > 0
    ? await supabaseAdmin.from('profiles').select('id, display_name, avatar_url').in('id', uniqueIds)
    : { data: [] }

  const profileMap = new Map<string, ProfileRow>()
  for (const p of (profiles ?? []) as ProfileRow[]) profileMap.set(p.id, p)

  // Sorter perioder DESC (nyeste først), maks 12
  const sortedKeys = [...byPeriod.keys()].sort((a, b) => b.localeCompare(a)).slice(0, 12)

  const entries = sortedKeys.map(key => {
    const w = winnerByPeriod.get(key)
    const profile = w ? profileMap.get(w.userId) : null
    return {
      key,
      label: key, // formateres på frontend
      closesAt: key,
      winner: w && profile ? {
        displayName: profile.display_name ?? 'Spiller',
        avatarUrl: profile.avatar_url ?? null,
        score: w.points,
        scoreLabel: 'poeng',
      } : null,
    }
  })

  return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'public, s-maxage=300' } })
}
