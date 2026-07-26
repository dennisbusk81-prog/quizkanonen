import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

/**
 * Bytter order_index på to spørsmål i samme quiz, atomisk.
 *
 * Erstatter de to separate PATCH-kallene admin-UI-et sendte tidligere. De kunne
 * ikke lykkes etter at UNIQUE (quiz_id, order_index) kom på plass: hver satte
 * én rad til den andre radens nåværende verdi, så den første skrivingen traff
 * alltid en opptatt verdi. Hele byttet gjøres nå i én transaksjon inne i
 * public.swap_question_order — se
 * supabase/migrations/20260731000000_swap_question_order_rpc.sql.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: quizId } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { questionA, questionB } = body
  if (typeof questionA !== 'string' || typeof questionB !== 'string') {
    return NextResponse.json({ error: 'questionA og questionB (uuid) er påkrevd' }, { status: 400 })
  }
  if (questionA === questionB) {
    return NextResponse.json({ error: 'questionA og questionB må være ulike' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.rpc('swap_question_order', {
    p_quiz_id: quizId,
    p_question_a: questionA,
    p_question_b: questionB,
  })

  if (error) {
    console.error('[questions/reorder] swap_question_order feilet:', {
      quizId, questionA, questionB, code: error.code, message: error.message,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, questions: data ?? [] })
}
