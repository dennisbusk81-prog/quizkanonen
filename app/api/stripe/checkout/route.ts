import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { rateLimit } from '@/lib/rate-limit'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`stripe-checkout:${ip}`, 10, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  try {
    const { priceId, userId, email } = await request.json()

    if (!priceId || !userId) {
      return NextResponse.json({ error: 'Mangler priceId eller userId' }, { status: 400 })
    }

    const resolvedPriceId = priceId === 'STRIPE_PRICE_UKESPASS'
      ? process.env.STRIPE_PRICE_UKESPASS!
      : process.env.STRIPE_PRICE_PREMIUM_MONTHLY!
    const mode = priceId === 'STRIPE_PRICE_UKESPASS' ? 'payment' : 'subscription'

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      customer_email: email ?? undefined,
      metadata: { userId },
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/premium`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
