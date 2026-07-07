import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type Params = { params: Promise<{ slug: string }> }

// ── Org quiz-leaderboard + ukestreaks for medlemmer ──────────────────────────
// Flyttet server-side fordi begge lesene trengte attempts.user_id, som nå er
// fjernet fra anon/authenticated SELECT (kolonne-lås). Krever org-admin.
// slug er org-ID (UUID) — kun param-navn er slug for Next.js routing-konsistens.

// Antall sammenhengende uker (mandag-basert, UTC) med minst ett forsøk.
function computeWeekStreak(timestamps: string[]): number {
  if (timestamps.length === 0) return 0
  const weeks = new Set<string>()
  for (const ts of timestamps) {
    const d = new Date(ts)
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    monday.setUTCHours(0, 0, 0, 0)
    weeks.add(monday.toISOString().slice(0, 10))
  }
  const sorted = [...weeks].sort().reverse()
  let streak = 1
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  for (let i = 0; i < sorted.length - 1; i++) {
    if (new Date(sorted[i]).getTime() - new Date(sorted[i + 1]).getTime() === WEEK_MS) streak++
    else break
  }
  return streak
}

export async function GET(request: NextRequest, { params }: Params) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug: orgId } = await params

  // ── Bølge 1: rolle-sjekk, org-medlemmer og siste quiz — innbyrdes uavhengige ─
  const [membershipRes, orgMembersRes, latestQuizRes] = await Promise.all([
    supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId),
    supabaseAdmin
      .from('quizzes')
      .select('id, title')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // 403-gate: MÅ sjekkes og returneres FØR bølge 2 kjøres eller data lekkes.
  // (Bølge 1 kjørte parallelt, men resultatene brukes/returneres ikke ved 403.)
  if (membershipRes.data?.role !== 'admin') {
    return NextResponse.json({ error: 'Kun admins kan se dette.' }, { status: 403 })
  }

  const memberIds = (orgMembersRes.data ?? []).map(m => m.user_id).filter(Boolean)
  if (memberIds.length === 0) {
    return NextResponse.json({ quizTitle: null, entries: [], streaks: {} })
  }
  const latestQuiz = latestQuizRes.data

  // ── Bølge 2: profiler, leaderboard-attempts og streaks-attempts — alle
  //    avhenger av memberIds/latestQuiz fra bølge 1, men er innbyrdes uavhengige.
  type LeaderRow = { user_id: string; player_name: string; correct_answers: number; total_time_ms: number }
  const oneYearAgo = new Date()
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1)

  const [profilesRes, leaderboardRes, streaksRes] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .in('id', memberIds),
    latestQuiz
      ? supabaseAdmin
          .from('attempts')
          .select('user_id, player_name, correct_answers, total_time_ms')
          .eq('quiz_id', latestQuiz.id)
          .eq('is_team', false)
          .in('user_id', memberIds)
          .not('user_id', 'is', null)
      : Promise.resolve({ data: [] as LeaderRow[] }),
    supabaseAdmin
      .from('attempts')
      .select('user_id, created_at')
      .in('user_id', memberIds)
      .gte('created_at', oneYearAgo.toISOString())
      .eq('is_team', false)
      .not('user_id', 'is', null),
  ])

  const nameMap = new Map((profilesRes.data ?? []).map(p => [p.id, p.display_name as string | null]))

  // ── Quiz-leaderboard: beste forsøk per medlem på siste quiz ──────────────────
  type Entry = { userId: string; displayName: string; correctAnswers: number; totalTimeMs: number }
  let entries: Entry[] = []
  if (latestQuiz) {
    const bestMap = new Map<string, Entry>()
    for (const a of (leaderboardRes.data ?? []) as LeaderRow[]) {
      if (!a.user_id) continue
      const displayName = nameMap.get(a.user_id) ?? a.player_name ?? '?'
      const existing = bestMap.get(a.user_id)
      if (
        !existing ||
        a.correct_answers > existing.correctAnswers ||
        (a.correct_answers === existing.correctAnswers && a.total_time_ms < existing.totalTimeMs)
      ) {
        bestMap.set(a.user_id, { userId: a.user_id, displayName, correctAnswers: a.correct_answers, totalTimeMs: a.total_time_ms })
      }
    }
    entries = [...bestMap.values()].sort((a, b) =>
      b.correctAnswers !== a.correctAnswers ? b.correctAnswers - a.correctAnswers : a.totalTimeMs - b.totalTimeMs,
    )
  }

  // ── Ukestreaks: siste 12 måneders forsøk per medlem ──────────────────────────
  const byUser = new Map<string, string[]>()
  for (const a of (streaksRes.data ?? []) as { user_id: string; created_at: string }[]) {
    if (!a.user_id) continue
    const arr = byUser.get(a.user_id) ?? []
    arr.push(a.created_at)
    byUser.set(a.user_id, arr)
  }
  const streaks: Record<string, number> = {}
  for (const [userId, timestamps] of byUser) {
    streaks[userId] = computeWeekStreak(timestamps)
  }

  return NextResponse.json({ quizTitle: latestQuiz?.title ?? null, entries, streaks })
}
