import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Topp 3 på resultatsiden — tilgjengelig for ALLE brukere ──────────────────
// Topp 3 er motivasjon (ikke en Premium-feature). Hentes server-side via
// supabaseAdmin. Returnerer player_name, correct_answers, total_time_ms og
// attempt-id (for å fremheve gjeldende brukers rad i topp 3).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ top3: [] })

  const { data, error } = await supabaseAdmin
    .from('attempts')
    .select('id, player_name, correct_answers, total_time_ms')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('submitted_at', 'is', null)
    .not('correct_streak', 'is', null)
    .order('correct_answers', { ascending: false })
    .order('total_time_ms', { ascending: true })
    .limit(3)

  if (error) {
    console.error('[quiz/top3] feil:', { quizId, error: error.message })
    return NextResponse.json({ top3: [] })
  }

  console.log('[quiz/top3]', { quizId, count: data?.length ?? 0 })
  return NextResponse.json({ top3: data ?? [] })
}
