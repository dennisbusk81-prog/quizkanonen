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

  const session = event.data.object as Stripe.Checkout.Session
  const userId = session.metadata?.userId

  if (!userId) {
    return NextResponse.json({ error: 'Mangler userId' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    await supabaseAdmin
      .from('profiles')
      .update({
        premium_status: true,
        premium_since: new Date().toISOString(),
        stripe_customer_id: session.customer as string ?? null,
      })
      .eq('id', userId)
  }

  if (event.type === 'customer.subscription.deleted') {
    await supabaseAdmin
      .from('profiles')
      .update({ premium_status: false })
      .eq('id', userId)
  }

  return NextResponse.json({ received: true })
}
