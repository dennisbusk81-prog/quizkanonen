import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { rateLimit } from '@/lib/rate-limit'

const FOUNDERS_PRICE_ID = 'price_1THoezCgGogWnHxZwrCGAtbb'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`stripe-checkout-founders:${ip}`, 10, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  try {
    const { userId, email } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'Mangler userId' }, { status: 400 })
    }

    if (!FOUNDERS_PRICE_ID) {
      return NextResponse.json({ error: 'Founders-produkt ikke konfigurert ennå' }, { status: 503 })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: FOUNDERS_PRICE_ID, quantity: 1 }],
      customer_email: email ?? undefined,
      metadata: { userId },
      payment_method_collection: 'if_required',
      subscription_data: { trial_period_days: 30 },
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/founders`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Stripe founders checkout error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
