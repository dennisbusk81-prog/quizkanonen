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
    // subscription ekspanderes for å kunne oppgi trial_end på kvitteringen —
    // samme ene Stripe-kall som før, bare med mer i svaret.
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] })

    // Fail-closed: sesjonen MÅ ha userId i metadata, og den må matche innlogget
    // bruker. Mangler userId, avviser vi (ingen eierskap kan bekreftes).
    if (session.metadata?.userId !== user.id) {
      return NextResponse.json({ paid: false }, { status: 403 })
    }

    // ── B-14 (30. august 2026): trial-checkout er også et fullført kjøp ──────
    // payment_status har tre verdier: 'paid', 'unpaid' og 'no_payment_required'.
    // En rad E-checkout (aktiv verdikode → subscription_data.trial_end) ender i
    // 'no_payment_required' — abonnementet ER opprettet, kunden HAR kjøpt, men
    // `paid === 'paid'` sa nei, og kvitteringssiden viste «ukjent» om et kjøp
    // som gikk bra.
    //
    // 'no_payment_required' alene er likevel IKKE bevis på et fullført kjøp:
    // verdien kan stå på sesjonen FØR kunden har fullført. Det autoritative
    // «checkouten er ferdig»-signalet er session.status === 'complete' — Stripe
    // redirecter riktignok først da, men denne ruten kan kalles med en hvilken
    // som helst sesjons-id kunden eier. Derfor begge betingelsene, ikke én.
    //
    // 'unpaid' på en complete sesjon (asynkrone betalingsmetoder vi ikke
    // tilbyr) forblir paid: false → «ukjent»-kortet, som aldri påstår at noe
    // feilet — «vet ikke» er ikke «nei».
    const complete = session.status === 'complete'
    const deferred = complete && session.payment_status === 'no_payment_required'
    const paid = complete && (session.payment_status === 'paid' || deferred)

    // trial_end fra det ekspanderte abonnementet — kvitteringen kan da si NÅR
    // første trekk skjer. Mangler det (ikke-subscription, race), sier siden det
    // samme uten dato.
    const sub = session.subscription
    const trialEnd = sub && typeof sub === 'object'
      ? (sub as unknown as { trial_end: number | null }).trial_end
      : null

    return NextResponse.json({ paid, deferred, trial_end: deferred ? trialEnd : null })
  } catch (err) {
    console.error('[verify-session] retrieve failed:', err)
    return NextResponse.json({ paid: false, error: 'Noe gikk galt' }, { status: 500 })
  }
}
