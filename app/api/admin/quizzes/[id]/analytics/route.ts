import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const [
    { data: quiz, error: e1 },
    { data: questions, error: e2 },
    { data: attempts, error: e3 },
  ] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*').eq('id', id).single(),
    supabaseAdmin.from('questions').select('*').eq('quiz_id', id).order('order_index'),
    supabaseAdmin.from('attempts').select('*').eq('quiz_id', id),
  ])
  const err = e1 ?? e2 ?? e3
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  let answers: unknown[] = []
  const ids = (attempts ?? []).map((a: { id: string }) => a.id)
  if (ids.length > 0) {
    const { data: answerData, error: e4 } = await supabaseAdmin
      .from('attempt_answers')
      .select('question_id, is_correct, selected_answer, time_ms')
      .in('attempt_id', ids)
    if (e4) return NextResponse.json({ error: e4.message }, { status: 500 })
    answers = answerData ?? []
  }

  return NextResponse.json({ quiz, questions: questions ?? [], attempts: attempts ?? [], answers })
}
