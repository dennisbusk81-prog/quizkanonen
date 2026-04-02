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
    { data: attempts, error: e2 },
    { data: questions, error: e3 },
  ] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*').eq('id', id).single(),
    supabaseAdmin.from('attempts').select('id').eq('quiz_id', id),
    supabaseAdmin.from('questions').select('id').eq('quiz_id', id),
  ])
  const err = e1 ?? e2 ?? e3
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })
  return NextResponse.json({ quiz, plays: attempts?.length ?? 0, questions_count: questions?.length ?? 0 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json()
  const { error } = await supabaseAdmin.from('quizzes').update(body).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { error } = await supabaseAdmin.from('quizzes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
