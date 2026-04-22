import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-admin-data:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  // Get org
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan, stripe_subscription_id, stripe_period_end, allow_global_league, admin_can_see_answers')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  // Must be admin
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })
  }

  // Members with profile names
  const { data: membersRaw } = await supabaseAdmin
    .from('organization_members')
    .select('id, user_id, role, joined_at')
    .eq('organization_id', org.id)
    .order('joined_at', { ascending: true })

  const memberIds = (membersRaw ?? []).map(m => m.user_id)
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name')
    .in('id', memberIds)

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.display_name]))
  const members = (membersRaw ?? []).map(m => ({
    ...m,
    display_name: profileMap[m.user_id] ?? m.user_id.slice(0, 8),
  }))

  // If stripe_period_end is missing but we have a subscription ID, fetch it live from Stripe
  let stripePeriodEnd = org.stripe_period_end
  if (!stripePeriodEnd && org.stripe_subscription_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
      const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
      stripePeriodEnd = new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000).toISOString()
      // Persist so next load is instant
      await supabaseAdmin.from('organizations')
        .update({ stripe_period_end: stripePeriodEnd })
        .eq('id', org.id)
    } catch { /* not critical */ }
  }

  // Active invites
  const { data: invites } = await supabaseAdmin
    .from('organization_invites')
    .select('id, token, use_count, is_active, created_at, expires_at, max_uses')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: false })

  // Stats: active members this month
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
  const { data: activeRows } = await supabaseAdmin
    .from('season_scores')
    .select('user_id')
    .eq('scope_type', 'organization')
    .eq('scope_id', org.id)
    .gte('closes_at', monthStart)
    .lt('closes_at', monthEnd)
  const activeThisMonth = new Set((activeRows ?? []).map(r => r.user_id)).size

  return NextResponse.json({
    org: {
      id: org.id,
      name: org.name,
      plan: org.plan,
      stripe_period_end: stripePeriodEnd,
      allow_global_league: org.allow_global_league,
      admin_can_see_answers: org.admin_can_see_answers,
    },
    members,
    invites: invites ?? [],
    currentUserId: user.id,
    stats: {
      memberCount: members.length,
      activeThisMonth,
    },
  })
}
