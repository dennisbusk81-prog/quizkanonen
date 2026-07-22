import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankAttempts } from '@/lib/ranking'
import { resolveOrgMembership } from '@/lib/org-membership'
import type { Attempt } from '@/lib/supabase'

// ── Forrige quiz' rangering for «pil opp»-trendmerket ────────────────────────
// Flyttet server-side fordi klient-lesen trengte attempts.user_id, som nå er
// fjernet fra anon/authenticated SELECT (kolonne-lås). Returnerer en map
// (user_id ?? player_name) → rank, som klienten matcher mot dagens leaderboard.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ prevRanks: {} })

  // ── Org-scoping (valgfritt) ──────────────────────────────────────────────────
  // Når ?org=<slug> er satt: SAMME medlemskaps-gate som hovedruten (token +
  // organization_members). Uten dette kunne ?org brukes til å enumerere org-
  // medlemskap via rank-mappen uten gyldig medlemskap. Uten param: uendret.
  const orgSlug = new URL(request.url).searchParams.get('org')?.trim() || null
  let orgMemberIdSet: Set<string> | null = null
  if (orgSlug) {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const gate = await resolveOrgMembership(orgSlug, token)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
    orgMemberIdSet = new Set(gate.memberIds)
  }

  // Finn gjeldende quiz' closes_at for å lokalisere forrige quiz.
  const { data: current } = await supabaseAdmin
    .from('quizzes')
    .select('closes_at')
    .eq('id', quizId)
    .maybeSingle()

  if (!current?.closes_at) return NextResponse.json({ prevRanks: {} })

  const { data: prevQuiz } = await supabaseAdmin
    .from('quizzes')
    .select('id')
    .lt('closes_at', current.closes_at)
    .order('closes_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!prevQuiz) return NextResponse.json({ prevRanks: {} })

  const { data: prevAttempts } = await supabaseAdmin
    .from('attempts')
    .select('id, quiz_id, player_name, is_team, team_size, correct_answers, total_questions, total_time_ms, correct_streak, user_id, completed_at, leader_display_name')
    .eq('quiz_id', prevQuiz.id)
    .eq('is_team', false)
    .limit(500)

  if (!prevAttempts || prevAttempts.length === 0) {
    return NextResponse.json({ prevRanks: {} })
  }

  // I org-modus: rangér kun blant org-medlemmer så "største fremgang" er
  // relativt til org, i tråd med den org-filtrerte listen på klienten.
  const scopedPrev = orgMemberIdSet
    ? (prevAttempts as Attempt[]).filter(a => a.user_id != null && orgMemberIdSet.has(a.user_id))
    : (prevAttempts as Attempt[])

  const ranked = rankAttempts(scopedPrev)
  const prevRanks: Record<string, number> = {}
  for (const a of ranked) {
    const key = a.user_id ?? a.player_name
    if (!(key in prevRanks)) prevRanks[key] = a.rank
  }

  return NextResponse.json({ prevRanks })
}
