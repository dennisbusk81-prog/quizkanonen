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

  // FIX 2 + FIX 3 — single atomic RPC: increments used_count only if capacity
  // remains, then grants premium — all in one DB transaction, no partial failure.
  // Requires supabase/migrations/redeem_access_code_rpc.sql to be run first.
  const { error: rpcError } = await supabaseAdmin.rpc('redeem_access_code', {
    p_code_id:    accessCode.id,
    p_user_id:    user.id,
    p_expires_at: null, // access codes grant indefinite premium
  })

  if (rpcError) {
    if (rpcError.message.includes('code_exhausted')) {
      return NextResponse.json({ error: 'Koden er allerede brukt opp' }, { status: 409 })
    }
    console.error('[codes/redeem] rpc error:', rpcError.message)
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // The RPC grants premium_status = true but does not set premium_source.
  // Update it separately so the source is always tracked.
  await supabaseAdmin
    .from('profiles')
    .update({ premium_source: 'code' })
    .eq('id', user.id)

  return NextResponse.json({ success: true })
}
