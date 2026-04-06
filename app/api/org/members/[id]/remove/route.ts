import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-member-remove:${ip}`, 20, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id: membershipId } = await params

  // Get membership row
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, user_id, role')
    .eq('id', membershipId)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Medlem ikke funnet' }, { status: 404 })

  // Must not remove yourself
  if (membership.user_id === user.id) {
    return NextResponse.json({ error: 'Du kan ikke fjerne deg selv' }, { status: 400 })
  }

  // Must be admin of this org
  const { data: requesterMembership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', membership.organization_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (requesterMembership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  // Log personal subscription if exists (for reference)
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('personal_stripe_subscription_id')
    .eq('id', membership.user_id)
    .maybeSingle()

  if (profile?.personal_stripe_subscription_id) {
    console.log(`[remove-member] user ${membership.user_id} had personal_stripe_subscription_id: ${profile.personal_stripe_subscription_id}`)
  }

  // Remove from org
  await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('id', membershipId)

  // Revoke premium
  await supabaseAdmin.from('profiles').update({
    premium_status: false,
    premium_source: null,
  }).eq('id', membership.user_id)

  return NextResponse.json({ ok: true })
}
