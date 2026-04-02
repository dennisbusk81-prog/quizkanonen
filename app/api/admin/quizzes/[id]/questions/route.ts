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
  ] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*').eq('id', id).single(),
    supabaseAdmin.from('questions').select('*').eq('quiz_id', id).order('order_index'),
  ])
  const err = e1 ?? e2
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })
  return NextResponse.json({ quiz, questions: questions ?? [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json()
  const { error } = await supabaseAdmin.from('questions').insert({ ...body, quiz_id: id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
