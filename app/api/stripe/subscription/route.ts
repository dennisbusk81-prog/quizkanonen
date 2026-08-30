import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Én ekstern rundtur (Stripe/GoTrue/enkelt-e-post) — ekstern latens kan
// alene være sekunder. 30 s gir rom uten å arve plattformdefaulten på 300 s.
export const maxDuration = 30

export async function GET(request: NextRequest) {
  try {
    // Instansieres inne i try: en manglende/ugyldig STRIPE_SECRET_KEY får
    // Stripe-konstruktøren til å kaste. Utenfor try ga det en rå 500 (uhåndtert);
    // her fanges det av catch-en nedenfor og gir en pen, logget respons i stedet.
    // Gjelder også produksjon hvis nøkkelen noen gang skulle mangle.
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })

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

    // has_subscription finnes fordi current_period_end IKKE kan bære «har
    // abonnement»-spørsmålet: et trialing-abonnement har null der (dahlia-
    // APIet), og ville vært uskillbart fra «ingen abonnement». Feltet er
    // visningsgrunnlaget for /premium sin «Administrer abonnement»-flate, og
    // oppslaget under (active ?? trialing, limit 1) er NØYAKTIG det samme som
    // getStripeCoverage bak checkout-rutens 409 — klient og server skal tolke
    // samme kilde identisk (samme regel som admin-sesjonens readTokenExpiry).
    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ has_subscription: false, current_period_end: null, cancel_at_period_end: false })
    }

    // Fetch active and trialing separately — Stripe list() does not accept an array for status
    const [activeSubs, trialingSubs] = await Promise.all([
      stripe.subscriptions.list({ customer: profile.stripe_customer_id, limit: 1, status: 'active' }),
      stripe.subscriptions.list({ customer: profile.stripe_customer_id, limit: 1, status: 'trialing' }),
    ])
    const sub = activeSubs.data[0] ?? trialingSubs.data[0] ?? null
    if (!sub) {
      return NextResponse.json({ has_subscription: false, current_period_end: null, cancel_at_period_end: false })
    }

    return NextResponse.json({
      has_subscription: true,
      current_period_end: sub.items.data[0]?.current_period_end ?? null,
      cancel_at_period_end: sub.cancel_at_period_end,
    })
  } catch (err) {
    if (
      err instanceof Stripe.errors.StripeInvalidRequestError &&
      err.code === 'resource_missing'
    ) {
      console.warn('Stripe subscription: ukjent customer_id (mulig live/test-mismatch):', (err as Error).message)
      return NextResponse.json({ has_subscription: false, current_period_end: null, cancel_at_period_end: false })
    }
    console.error('Stripe subscription error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
