import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('Webhook signatur-feil:', err)
    return NextResponse.json({ error: 'Ugyldig signatur' }, { status: 400 })
  }

  // ── checkout.session.completed ────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session

    if (session.metadata?.type === 'org') {
      // B2B org checkout
      const organizationId = session.metadata.organization_id
      if (!organizationId) return NextResponse.json({ received: true })

      const subscriptionId = session.subscription as string
      let periodEnd: string | null = null

      // 1. Try to fetch subscription details from Stripe
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId)
        periodEnd = new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000).toISOString()
      } catch (err) {
        console.error('[webhook] stripe.subscriptions.retrieve failed for', subscriptionId, err)
      }

      // 2. Fallback: check if session already has expanded subscription data
      if (!periodEnd) {
        const sessionSub = session.subscription as unknown as { current_period_end?: number } | null
        if (sessionSub && typeof sessionSub === 'object' && sessionSub.current_period_end) {
          periodEnd = new Date(sessionSub.current_period_end * 1000).toISOString()
          console.log('[webhook] used expanded session.subscription for period_end')
        }
      }

      // 3. Last resort: 30 days from now so the field is never null
      if (!periodEnd) {
        periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        console.warn('[webhook] could not determine period_end, using 30-day fallback for org', organizationId)
      }

      await supabaseAdmin.from('organizations').update({
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: subscriptionId,
        stripe_period_end: periodEnd,
      }).eq('id', organizationId)

      // Activate premium for all current members
      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)

      for (const m of (members ?? [])) {
        await supabaseAdmin.from('profiles').update({
          premium_status: true,
          premium_source: 'org',
        }).eq('id', m.user_id)
      }
    } else {
      // B2C personal checkout
      const userId = session.metadata?.userId
      if (!userId) return NextResponse.json({ error: 'Mangler userId' }, { status: 400 })

      await supabaseAdmin.from('profiles').update({
        premium_status: true,
        premium_since: new Date().toISOString(),
        stripe_customer_id: session.customer as string ?? null,
        premium_source: 'personal',
      }).eq('id', userId)
    }
  }

  // ── customer.subscription.deleted ─────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = subscription.customer as string

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    if (org) {
      // B2B: revoke premium from all members
      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', org.id)

      for (const m of (members ?? [])) {
        await supabaseAdmin.from('profiles').update({
          premium_status: false,
          premium_source: null,
        }).eq('id', m.user_id)
      }
    } else {
      // B2C
      await supabaseAdmin.from('profiles')
        .update({ premium_status: false })
        .eq('stripe_customer_id', customerId)
    }
  }

  // ── customer.subscription.updated ─────────────────────────────────────
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = subscription.customer as string

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    if (org) {
      // B2B: update period end
      const periodEnd = new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000).toISOString()
      await supabaseAdmin.from('organizations')
        .update({ stripe_period_end: periodEnd })
        .eq('id', org.id)
    } else {
      // B2C
      const inactive = ['canceled', 'unpaid', 'past_due'].includes(subscription.status)
      await supabaseAdmin.from('profiles')
        .update({ premium_status: !inactive && subscription.status === 'active' })
        .eq('stripe_customer_id', customerId)
    }
  }

  return NextResponse.json({ received: true })
}
