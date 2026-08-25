import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { fetchAllRows } from '@/lib/paginate'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Hele quiz-lista, paginert. Én quiz i uka gir 1000 rader først om mange år,
  // men importen som kommer lager quizer i bulk — og radtaket kutter STILLE, så
  // admin ville sett en komplett liste som manglet de eldste.
  //
  // .order('id') er en tiebreaker; visningsrekkefølgen er fortsatt
  // created_at DESC.
  try {
    const data = await fetchAllRows<Record<string, unknown>>((from, to) =>
      supabaseAdmin
        .from('quizzes')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    )
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Kunne ikke hente quizer' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const { data, error } = await supabaseAdmin.from('quizzes').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
