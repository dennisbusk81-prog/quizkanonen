import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-invite-deactivate:${ip}`, 20, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id } = await params

  // Get invite and verify admin
  const { data: invite } = await supabaseAdmin
    .from('organization_invites')
    .select('organization_id')
    .eq('id', id)
    .maybeSingle()

  if (!invite) return NextResponse.json({ error: 'Invitasjon ikke funnet' }, { status: 404 })

  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', invite.organization_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  await supabaseAdmin
    .from('organization_invites')
    .update({ is_active: false })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
