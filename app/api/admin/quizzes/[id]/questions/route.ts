import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

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
    // .order('id') som sekundærsortering: ved duplikate order_index-verdier
    // (har forekommet — se scripts/inspect-order-index-9.mjs, og samme
    // tiebreaker i app/api/quiz/[id]/questions/route.ts) er radrekkefølgen fra
    // Postgres ikke garantert stabil mellom kall. Uten dette kunne editorens
    // questionDbIds-array (bygget posisjonelt fra denne responsen) bli feil
    // koblet til lokale spørsmål-indekser mellom to kall.
    supabaseAdmin.from('questions').select('*').eq('quiz_id', id).order('order_index').order('id'),
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
  // Ny rad = ny bruk av spørsmålet. usage_count/last_used_at settes alltid
  // server-side her (aldri klientstyrt) — PATCH (vanlig autolagring) rører
  // dem aldri, kun denne INSERT-veien.
  const { error } = await supabaseAdmin.from('questions').insert({
    ...body,
    quiz_id: id,
    usage_count: 1,
    last_used_at: new Date().toISOString(),
  })
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
