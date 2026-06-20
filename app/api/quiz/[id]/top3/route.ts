import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankQuizAttempts } from '@/lib/ranking'

// ── Topp 3 på resultatsiden — tilgjengelig for ALLE brukere ──────────────────
// Bruker den delte rangerings-helperen (lib/ranking) slik at #1 her er identisk
// med quiz-leaderboard og toppliste. Gjester inkluderes (alle som spilte quizen).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ top3: [] })

  // Hent alle solo-forsøk; helperen filtrerer (submitted), dedup'er og rangerer.
  const { data, error } = await supabaseAdmin
    .from('attempts')
    .select('id, user_id, player_name, correct_answers, total_time_ms, correct_streak, submitted_at')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .limit(5000)

  if (error) {
    console.error('[quiz/top3] feil:', { quizId, error: error.message })
    return NextResponse.json({ top3: [] })
  }

  const ranked = rankQuizAttempts(data ?? [], { includeGuests: true, requireSubmitted: true })
  const top3 = ranked.slice(0, 3)

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
