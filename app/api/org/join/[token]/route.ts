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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

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

  // One org per user
  const { data: existing } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Du er allerede medlem av en organisasjon.' }, { status: 409 })
  }

  // Get org slug for redirect
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('slug')
    .eq('id', invite.organization_id)
    .single()

  // Premium transition
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, premium_source, stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.premium_status === true && profile?.premium_source === 'personal' && profile?.stripe_customer_id) {
    try {
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

  // Add to org
  await supabaseAdmin.from('organization_members').insert({
    organization_id: invite.organization_id,
    user_id: user.id,
    role: 'member',
    invite_token_id: invite.id,
  })

  // Increment use_count
  await supabaseAdmin
    .from('organization_invites')
    .update({ use_count: invite.use_count + 1 })
    .eq('id', invite.id)

  // Activate premium via org
  await supabaseAdmin.from('profiles').update({
    premium_status: true,
    premium_source: 'org',
  }).eq('id', user.id)

  return NextResponse.json({ slug: org?.slug })
}
