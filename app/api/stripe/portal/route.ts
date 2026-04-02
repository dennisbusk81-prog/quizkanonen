import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { rateLimit } from '@/lib/rate-limit'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`stripe-portal:${ip}`, 10, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  try {
    const { customerId } = await request.json()
    if (!customerId) {
      return NextResponse.json({ error: 'Mangler customerId' }, { status: 400 })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/premium`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Stripe portal error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
