import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Én ekstern rundtur (Stripe/GoTrue/enkelt-e-post) — ekstern latens kan
// alene være sekunder. 30 s gir rom uten å arve plattformdefaulten på 300 s.
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `stripe-portal:${ip}`
  const rl = rateLimit(rlKey, 10, 60_000)
  if (!rl.success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 10, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

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
      return NextResponse.json({
        error: 'Abonnementet er ikke koblet til Stripe ennå. Kontakt oss på support@quizkanonen.no.',
      }, { status: 400 })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/premium`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Stripe portal error:', err)
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      if (err.code === 'resource_missing') {
        return NextResponse.json({
          error: 'Kunde-ID er ikke gyldig i Stripe. Kontakt support@quizkanonen.no.',
        }, { status: 400 })
      }
    }
    return NextResponse.json({ error: 'Kunne ikke åpne abonnementssiden. Prøv igjen, eller kontakt support@quizkanonen.no.' }, { status: 500 })
  }
}
