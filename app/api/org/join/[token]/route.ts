import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: inviteToken } = await params

  const { data: invite } = await supabaseAdmin
    .from('organization_invites')
    .select('id, organization_id, is_active, expires_at, max_uses, use_count')
    .eq('token', inviteToken)
    .maybeSingle()

  if (!invite || !invite.is_active) {
    return NextResponse.json({ valid: false, error: 'Ugyldig invitasjonslenke' }, { status: 404 })
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, error: 'Invitasjonslenken har utløpt' }, { status: 410 })
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return NextResponse.json({ valid: false, error: 'Invitasjonslenken er full' }, { status: 410 })
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, slug')
    .eq('id', invite.organization_id)
    .single()

  return NextResponse.json({ valid: true, orgName: org?.name, orgSlug: org?.slug })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-join:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { token: inviteToken } = await params

  // Validate invite
  const { data: invite } = await supabaseAdmin
    .from('organization_invites')
    .select('id, organization_id, is_active, expires_at, max_uses, use_count')
    .eq('token', inviteToken)
    .maybeSingle()

  if (!invite || !invite.is_active) {
    return NextResponse.json({ error: 'Ugyldig invitasjonslenke' }, { status: 404 })
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invitasjonslenken har utløpt' }, { status: 410 })
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return NextResponse.json({ error: 'Invitasjonslenken er full' }, { status: 410 })
  }

  // Get org slug for redirect
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('slug')
    .eq('id', invite.organization_id)
    .maybeSingle()

  // Guard: org deleted between invite creation and join attempt
  if (!org?.slug) {
    return NextResponse.json({ error: 'Organisasjonen finnes ikke lenger' }, { status: 404 })
  }

  // One org per user — but re-clicking an invite you already used for THIS
  // org should not dead-end. Only block when the user belongs to a
  // DIFFERENT org than the one this invite points to.
  const { data: existing } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (existing) {
    if (existing.organization_id === invite.organization_id) {
      return NextResponse.json({ slug: org.slug })
    }
    return NextResponse.json({ error: 'Du er allerede medlem av en organisasjon.' }, { status: 409 })
  }

  // Premium transition
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, premium_source, stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.premium_status === true && profile?.premium_source === 'personal' && profile?.stripe_customer_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
      const subs = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'active',
        limit: 1,
      })
      if (subs.data.length > 0) {
        const sub = subs.data[0]
        await supabaseAdmin.from('profiles').update({
          personal_stripe_subscription_id: sub.id,
        }).eq('id', user.id)
        await stripe.subscriptions.cancel(sub.id)
      }
    } catch (err) {
      console.error('Failed to cancel personal subscription:', err)
    }
  }

  // Atomically increment use_count only if it has not changed since we read it
  // (and is still under max_uses). If another concurrent request already used
  // the last slot, this update matches zero rows and we return 409.
  let countQuery = supabaseAdmin
    .from('organization_invites')
    .update({ use_count: invite.use_count + 1 })
    .eq('id', invite.id)
    .eq('use_count', invite.use_count) // CAS — reject if count changed
  if (invite.max_uses !== null) {
    countQuery = countQuery.lt('use_count', invite.max_uses)
  }
  const { data: updatedInvite } = await countQuery.select('id').maybeSingle()

  if (!updatedInvite) {
    return NextResponse.json({ error: 'Invitasjonslenken er full' }, { status: 409 })
  }

  // Add to org only after the atomic increment succeeded
  await supabaseAdmin.from('organization_members').insert({
    organization_id: invite.organization_id,
    user_id: user.id,
    role: 'member',
    invite_token_id: invite.id,
  })

  // Activate premium via org
  await supabaseAdmin.from('profiles').update({
    premium_status: true,
    premium_source: 'org',
  }).eq('id', user.id)

  return NextResponse.json({ slug: org.slug })
}
