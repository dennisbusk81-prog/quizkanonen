import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json()
  const { error } = await supabaseAdmin.from('questions').insert({ ...body, quiz_id: id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Bulk-oppdatering på quiz-nivå. "Bland svaralternativer" er en quiz-innstilling,
// men lagres per rad i questions — denne setter samme verdi på ALLE spørsmål i
// quizen i én operasjon, slik at radene ikke kan komme ut av sync.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json()
  if (typeof body.shuffle_options !== 'boolean') {
    return NextResponse.json({ error: 'shuffle_options (boolean) er påkrevd' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('questions')
    .update({ shuffle_options: body.shuffle_options })
    .eq('quiz_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
