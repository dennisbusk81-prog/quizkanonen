import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`codes-redeem:${ip}`, 5, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler. Vent litt og prøv igjen.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  const body = await request.json()
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  if (!code) {
    return NextResponse.json({ error: 'Kode mangler' }, { status: 400 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status')
    .eq('id', user.id)
    .single()

  if (profile?.premium_status === true) {
    return NextResponse.json({ error: 'Du har allerede Premium' }, { status: 400 })
  }

  const { data: accessCode } = await supabaseAdmin
    .from('access_codes')
    .select('id, is_active, valid_until, duration_days, max_uses, used_count')
    .eq('code', code)
    .maybeSingle()

  if (!accessCode) {
    return NextResponse.json({ error: 'Ugyldig kode' }, { status: 400 })
  }

  if (!accessCode.is_active) {
    return NextResponse.json({ error: 'Koden er ikke aktiv' }, { status: 400 })
  }

  if (accessCode.valid_until && new Date(accessCode.valid_until) < new Date()) {
    return NextResponse.json({ error: 'Koden er utløpt' }, { status: 400 })
  }

  // duration_days styrer hvor lenge Premium varer ETTER innløsning.
  // NULL/0 = permanent (koden gir Premium uten utløp), som er den eneste
  // oppførselen koder hadde før 20. juli 2026.
  // valid_until over er en helt separat frist: siste dag koden kan LØSES INN.
  const durationDays = accessCode.duration_days
  const expiresAt = durationDays && durationDays > 0
    ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
    : null

  // FIX 2 + FIX 3 — single atomic RPC: increments used_count only if capacity
  // remains, then grants premium — all in one DB transaction, no partial failure.
  // Requires supabase/migrations/20260720000001_access_code_duration.sql to be run first.
  const { error: rpcError } = await supabaseAdmin.rpc('redeem_access_code', {
    p_code_id:    accessCode.id,
    p_user_id:    user.id,
    p_expires_at: expiresAt,
  })

  if (rpcError) {
    if (rpcError.message.includes('code_exhausted')) {
      return NextResponse.json({ error: 'Koden er allerede brukt opp' }, { status: 409 })
    }
    console.error('[codes/redeem] rpc error:', rpcError.message)
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // premium_source = 'code' settes nå inne i RPC-en, i samme transaksjon som
  // selve tildelingen. Tidligere ble den satt i et separat kall her — feilet det,
  // fikk brukeren Premium uten kilde, og cron-jobben som rydder utløpte
  // kode-tildelinger ville aldri funnet dem.

  return NextResponse.json({ success: true, expiresAt })
}
