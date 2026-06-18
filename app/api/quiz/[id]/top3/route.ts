import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Topp 3 på resultatsiden — tilgjengelig for ALLE brukere ──────────────────
// Henter beste attempt per unik player_name, deretter topp 3.
// Supabase JS støtter ikke DISTINCT ON — deduplisering skjer i JS.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ top3: [] })

  // Hent nok rader til å dekke alle unike spillere i toppen
  const { data, error } = await supabaseAdmin
    .from('attempts')
    .select('id, user_id, player_name, correct_answers, total_time_ms')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('submitted_at', 'is', null)
    .not('correct_streak', 'is', null)
    .order('correct_answers', { ascending: false })
    .order('total_time_ms', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[quiz/top3] feil:', { quizId, error: error.message })
    return NextResponse.json({ top3: [] })
  }

  // Beste attempt per unik player_name (allerede sortert: første treff per navn er best)
  const seen = new Set<string>()
  const top3: NonNullable<typeof data> = []
  for (const row of (data ?? [])) {
    if (!row.player_name || seen.has(row.player_name)) continue
    seen.add(row.player_name)
    top3.push(row)
    if (top3.length === 3) break
  }

  // Kallenavn for de innloggede topp-3-spillerne
  const userIds = top3.map(r => r.user_id).filter((id): id is string => !!id)
  const nickMap = new Map<string, string | null>()
  if (userIds.length > 0) {
    const { data: profs } = await supabaseAdmin
      .from('profiles')
      .select('id, nickname')
      .in('id', userIds)
    for (const p of (profs ?? []) as { id: string; nickname: string | null }[]) {
      nickMap.set(p.id, p.nickname ?? null)
    }
  }

  const top3WithNick = top3.map(r => ({
    id: r.id,
    player_name: r.player_name,
    correct_answers: r.correct_answers,
    total_time_ms: r.total_time_ms,
    nickname: r.user_id ? (nickMap.get(r.user_id) ?? null) : null,
  }))

  return NextResponse.json({ top3: top3WithNick })
}
