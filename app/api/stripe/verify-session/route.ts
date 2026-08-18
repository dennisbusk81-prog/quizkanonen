import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'

// Verifiserer en checkout-session direkte mot Stripe så success-siden ikke er
// avhengig av at webhooken har rukket å sette premium_status i DB.
// Én ekstern rundtur (Stripe/GoTrue/enkelt-e-post) — ekstern latens kan
// alene være sekunder. 30 s gir rom uten å arve plattformdefaulten på 300 s.
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `verify-session:${ip}`
  if (!rateLimit(rlKey, 10, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 10, windowMs: 60_000 })
    return NextResponse.json({ paid: false, error: 'For mange forespørsler' }, { status: 429 })
  }

  const sessionId = request.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ paid: false, error: 'Mangler session_id' }, { status: 400 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ paid: false }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ paid: false }, { status: 401 })
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    // Fail-closed: sesjonen MÅ ha userId i metadata, og den må matche innlogget
    // bruker. Mangler userId, avviser vi (ingen eierskap kan bekreftes).
    if (session.metadata?.userId !== user.id) {
      return NextResponse.json({ paid: false }, { status: 403 })
    }

    return NextResponse.json({ paid: session.payment_status === 'paid' })
  } catch (err) {
    console.error('[verify-session] retrieve failed:', err)
    return NextResponse.json({ paid: false, error: 'Noe gikk galt' }, { status: 500 })
  }
}
