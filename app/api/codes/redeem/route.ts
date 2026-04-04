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
    .select('id, is_active, valid_until, max_uses, used_count')
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

  if (accessCode.used_count >= accessCode.max_uses) {
    return NextResponse.json({ error: 'Koden er allerede brukt opp' }, { status: 400 })
  }

  const { error: updateCodeError } = await supabaseAdmin
    .from('access_codes')
    .update({ used_count: accessCode.used_count + 1 })
    .eq('id', accessCode.id)

  if (updateCodeError) {
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  const { error: updateProfileError } = await supabaseAdmin
    .from('profiles')
    .update({ premium_status: true, premium_since: new Date().toISOString() })
    .eq('id', user.id)

  if (updateProfileError) {
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
