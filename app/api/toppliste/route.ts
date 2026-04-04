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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') ?? 'month'
  if (!['month', 'quarter', 'year', 'alltime'].includes(period)) {
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

  const periodStart = getPeriodStart(period)

  // Fetch all quizzes in period
  const { data: quizzes } = await supabaseAdmin
    .from('quizzes')
    .select('id, closes_at')
    .gte('closes_at', periodStart)
    .order('closes_at', { ascending: true })

  if (!quizzes || quizzes.length === 0) {
    return NextResponse.json({ entries: [], userEntry: null, userIsPremium })
  }

  const quizIds = quizzes.map((q: { id: string }) => q.id)

  // Fetch all solo logged-in attempts for these quizzes
  const { data: attempts } = await supabaseAdmin
    .from('attempts')
    .select('quiz_id, user_id, player_name, correct_answers, total_time_ms, correct_streak')
    .in('quiz_id', quizIds)
    .not('user_id', 'is', null)
    .eq('is_team', false)

  if (!attempts || attempts.length === 0) {
    return NextResponse.json({ entries: [], userEntry: null, userIsPremium })
  }

  type RawAttempt = {
    quiz_id: string
    user_id: string
    player_name: string
    correct_answers: number
    total_time_ms: number
    correct_streak: number | null
  }

  // Group by quiz_id
  const byQuiz = new Map<string, RawAttempt[]>()
  for (const a of attempts as RawAttempt[]) {
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

    // Best attempt per user
    const bestByUser = new Map<string, RawAttempt>()
    for (const a of quizAttempts) {
      const existing = bestByUser.get(a.user_id)
      if (!existing) {
        bestByUser.set(a.user_id, a)
      } else {
        const better =
          a.correct_answers > existing.correct_answers ||
          (a.correct_answers === existing.correct_answers && a.total_time_ms < existing.total_time_ms) ||
          (a.correct_answers === existing.correct_answers &&
            a.total_time_ms === existing.total_time_ms &&
            (a.correct_streak ?? 0) > (existing.correct_streak ?? 0))
        if (better) bestByUser.set(a.user_id, a)
      }
    }

    // Rank within quiz
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

  // Compute current streak per user
  const totalQuizzes = quizzes.length
  for (const stats of userStats.values()) {
    let streak = 0
    for (let i = totalQuizzes - 1; i >= 0; i--) {
      if (stats.quizIndices.has(i)) streak++
      else break
    }
    stats.topStreak = streak
  }

  // Sort: points DESC, quizCount ASC, fastestMs ASC
  const sorted = [...userStats.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (a.quizCount !== b.quizCount) return a.quizCount - b.quizCount
    return a.fastestMs - b.fastestMs
  })

  // Collect profile IDs to fetch
  const topIds = sorted.slice(0, 10).map(s => s.userId)
  const profileIds = userId && !topIds.includes(userId) ? [...topIds, userId] : topIds

  const { data: profiles } = profileIds.length > 0
    ? await supabaseAdmin
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', profileIds)
    : { data: [] }

  const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>()
  for (const p of (profiles ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
    profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url })
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

  return NextResponse.json({ entries, userEntry, userIsPremium })
}
