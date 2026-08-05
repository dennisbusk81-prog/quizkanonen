import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { getCodeCoverage } from '@/lib/premium-state-io'

const ALLOWED_PRICE_IDS = ['STRIPE_PRICE_PREMIUM_MONTHLY']

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = await rateLimitShared(`stripe-checkout:${ip}`, 10, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  // FIX 4 — require auth; verify caller owns the userId being checked out
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  try {
    const { priceId, userId, email } = await request.json()

    if (!priceId || !userId) {
      return NextResponse.json({ error: 'Mangler priceId eller userId' }, { status: 400 })
    }

    // FIX 4 — ensure authenticated user matches the userId in the request
    if (user.id !== userId) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }

    if (!ALLOWED_PRICE_IDS.includes(priceId)) {
      return NextResponse.json({ error: 'Ugyldig priceId' }, { status: 400 })
    }
    const resolvedPriceId = process.env.STRIPE_PRICE_PREMIUM_MONTHLY!
    const mode = 'subscription'

    // ── Rad E: kunden har en aktiv verdikode og kjøper abonnement ──────────────
    // Kjøp er tillatt — men kunden skal ikke belastes for en periode de samtidig
    // får gratis. Pause duger ikke her: første faktura trekkes ved selve
    // checkout. Riktig mekanisme er trial_end på abonnementet, som utsetter
    // første faktura til koden løper ut.
    const codeCoverage = await getCodeCoverage(userId)
    let trialEnd: number | undefined

    if (codeCoverage) {
      if (!codeCoverage.expiresAt) {
        // Permanent kode: et abonnement ville aldri kunne faktureres uten å
        // kollidere med gratis-perioden. Å ta betalt her ville vært nøyaktig det
        // vi skal unngå.
        return NextResponse.json(
          { error: 'Du har allerede Premium på ubestemt tid via en verdikode. Du trenger ikke abonnement.' },
          { status: 409 },
        )
      }

      const endsAtMs = new Date(codeCoverage.expiresAt).getTime()
      // Stripe krever at trial_end ligger minst 48 timer fram i tid. Har koden
      // mindre enn det igjen, starter abonnementet normalt — differansen er
      // under to døgn, og alternativet ville vært å avvise kjøpet.
      if (endsAtMs - Date.now() >= 48 * 60 * 60 * 1000) {
        trialEnd = Math.floor(endsAtMs / 1000)
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      customer_email: email ?? undefined,
      metadata: { userId },
      ...(trialEnd ? { subscription_data: { trial_end: trialEnd } } : {}),
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/premium`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
