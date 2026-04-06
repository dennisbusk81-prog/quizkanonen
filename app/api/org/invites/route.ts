import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { randomBytes } from 'crypto'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-invites:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  let body: { organization_id?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { organization_id } = body
  if (!organization_id) return NextResponse.json({ error: 'Mangler organization_id' }, { status: 400 })

  // Must be admin of this org
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organization_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const token = randomBytes(16).toString('hex')
  const { data: invite, error } = await supabaseAdmin
    .from('organization_invites')
    .insert({
      organization_id,
      token,
      created_by: user.id,
      is_active: true,
    })
    .select('id, token, use_count, created_at')
    .single()

  if (error) {
    console.error('Invite insert error:', error)
    return NextResponse.json({ error: 'Kunne ikke opprette invitasjon' }, { status: 500 })
  }

  return NextResponse.json({ invite })
}
