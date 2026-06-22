import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: quizId } = await params

  let body: { attemptId?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 })
  }
  const attemptId = typeof body.attemptId === 'string' ? body.attemptId : null
  if (!attemptId) return NextResponse.json({ error: 'Mangler attemptId' }, { status: 400 })

  // Hent attempt og verifiser at den tilhører denne quizen
  const { data: attempt, error: fetchErr } = await supabaseAdmin
    .from('attempts')
    .select('id, quiz_id, user_id, is_team')
    .eq('id', attemptId)
    .maybeSingle()

  if (fetchErr || !attempt) {
    return NextResponse.json({ error: 'Forsøk ikke funnet' }, { status: 404 })
  }
  if (attempt.quiz_id !== quizId) {
    return NextResponse.json({ error: 'Forsøket tilhører ikke denne quizen' }, { status: 400 })
  }
  if (attempt.is_team) {
    return NextResponse.json({ error: 'Lag kan ikke fjernes via denne funksjonen.' }, { status: 400 })
  }

  // 1. Slett attempt_answers
  const { error: answersErr } = await supabaseAdmin
    .from('attempt_answers')
    .delete()
    .eq('attempt_id', attemptId)
  if (answersErr) return NextResponse.json({ error: 'Kunne ikke slette svar: ' + answersErr.message }, { status: 500 })

  // 2. Slett attempt
  const { error: attemptErr } = await supabaseAdmin
    .from('attempts')
    .delete()
    .eq('id', attemptId)
  if (attemptErr) return NextResponse.json({ error: 'Kunne ikke slette forsøk: ' + attemptErr.message }, { status: 500 })

  // 3. Slett season_scores (alle scopes for denne brukeren + quizen)
  if (attempt.user_id) {
    const { error: scoreErr } = await supabaseAdmin
      .from('season_scores')
      .delete()
      .eq('user_id', attempt.user_id)
      .eq('quiz_id', quizId)
    if (scoreErr) {
      console.error('[remove-attempt] season_scores delete feilet:', scoreErr.message)
    }
  }

  // 4. Logg handlingen
  try {
    await supabaseAdmin.from('admin_actions').insert({
      action_type: 'remove_attempt',
      scope_type: 'quiz',
      scope_id: quizId,
    })
  } catch { /* ikke kritisk */ }

  return NextResponse.json({ ok: true })
}
