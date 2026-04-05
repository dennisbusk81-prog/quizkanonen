import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { qid } = await params
  const body = await request.json()
  const { error } = await supabaseAdmin.from('questions').update(body).eq('id', qid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (body.correct_answer) {
    const newCorrect: string = body.correct_answer
    await Promise.all([
      supabaseAdmin.from('attempt_answers').update({ is_correct: true }).eq('question_id', qid).eq('selected_answer', newCorrect),
      supabaseAdmin.from('attempt_answers').update({ is_correct: false }).eq('question_id', qid).neq('selected_answer', newCorrect),
    ])
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { qid } = await params
  const { error } = await supabaseAdmin.from('questions').delete().eq('id', qid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
