import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { buildAccessCode } from '@/lib/access-code'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('access_codes').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Oppretter en verdikode. Ruten satte tidligere inn hele request-bodyen rått
// (`insert(body)`), så verken kodetype eller bruksgrenser kunne håndheves —
// UI-et var eneste «validering». Nå går alt gjennom buildAccessCode, som er
// ren og testdekket: delte koder MÅ ha maks antall innløsninger og utløpsdato,
// og private koder får alltid en generert kode i stedet for fritekst.
export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const built = buildAccessCode(body as Record<string, unknown>)
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('access_codes')
    .insert(built.row)
    .select('id, code, code_type, description, max_uses, valid_until, duration_days')
    .single()

  if (error) {
    // access_codes.code er UNIQUE — gi admin en forståelig melding i stedet
    // for en rå Postgres-feil.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Denne koden finnes allerede. Velg et annet kodeord.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Koden returneres slik at admin-UI-et kan vise en generert privat kode —
  // den finnes ikke noe annet sted enn her før den er lest av.
  return NextResponse.json({ ok: true, code: data })
}
