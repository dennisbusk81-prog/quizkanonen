import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ current_period_end: null, cancel_at_period_end: false })
    }

    // Fetch active and trialing separately — Stripe list() does not accept an array for status
    const [activeSubs, trialingSubs] = await Promise.all([
      stripe.subscriptions.list({ customer: profile.stripe_customer_id, limit: 1, status: 'active' }),
      stripe.subscriptions.list({ customer: profile.stripe_customer_id, limit: 1, status: 'trialing' }),
    ])
    const sub = activeSubs.data[0] ?? trialingSubs.data[0] ?? null
    if (!sub) {
      return NextResponse.json({ current_period_end: null, cancel_at_period_end: false })
    }

    return NextResponse.json({
      current_period_end: sub.items.data[0]?.current_period_end ?? null,
      cancel_at_period_end: sub.cancel_at_period_end,
    })
  } catch (err) {
    if (
      err instanceof Stripe.errors.StripeInvalidRequestError &&
      err.code === 'resource_missing'
    ) {
      console.warn('Stripe subscription: ukjent customer_id (mulig live/test-mismatch):', (err as Error).message)
      return NextResponse.json({ current_period_end: null, cancel_at_period_end: false })
    }
    console.error('Stripe subscription error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
