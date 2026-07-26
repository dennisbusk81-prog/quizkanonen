import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { codeActivatedEmail, codeActivatedPausedEmail } from '@/lib/email-templates'
import { decideRedemption, type PremiumState } from '@/lib/premium-state'
import { getPremiumState, syncPremiumCache } from '@/lib/premium-state-io'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`codes-redeem:${ip}`, 5, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler. Vent litt og prøv igjen.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  const body = await request.json()
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  if (!code) {
    return NextResponse.json({ error: 'Kode mangler' }, { status: 400 })
  }

  const { data: accessCode } = await supabaseAdmin
    .from('access_codes')
    .select('id, is_active, valid_until, duration_days, max_uses, used_count')
    .eq('code', code)
    .maybeSingle()

  if (!accessCode) {
    return NextResponse.json({ error: 'Ugyldig kode' }, { status: 400 })
  }

  if (!accessCode.is_active) {
    return NextResponse.json({ error: 'Koden er ikke aktiv' }, { status: 400 })
  }

  if (accessCode.valid_until && new Date(accessCode.valid_until) < new Date()) {
    return NextResponse.json({ error: 'Koden er utløpt' }, { status: 400 })
  }

  // ── Beslutning mot full premium-tilstand ────────────────────────────────────
  // Ruten avviste tidligere på `premium_status === true` alene. Det flagget er
  // en cache: det kan være false i vinduer der abonnementet lever (refusjon,
  // tapt webhook), og true uten at det sier NOE om hvilken kilde som dekker.
  // Nå hentes den faktiske tilstanden — kode, org-medlemskap og levende
  // Stripe-abonnement — og decideRedemption avgjør rad A–D og F.
  //
  // Stripe instansieres INNE i try: en manglende/ugyldig STRIPE_SECRET_KEY får
  // konstruktøren til å kaste, og utenfor try ville det gitt en rå, ulogget 500.
  // Samme mønster som app/api/stripe/subscription/route.ts.
  let stripe: Stripe
  let state: PremiumState
  try {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
    state = await getPremiumState(user.id, stripe)
  } catch (err) {
    // Kunne ikke lese Stripe → vi VET ikke om det finnes et abonnement som må
    // pauses. Å løse inn koden nå kunne latt kunden bli belastet for en periode
    // de samtidig får gratis. Avbryt heller og la dem prøve igjen.
    //
    // Manglende nøkkel og et forbigående Stripe-problem gir samme svar til
    // brukeren, men skal være til å skille fra hverandre i loggen: det første
    // er en konfigurasjonsfeil som ikke går over av seg selv.
    const missingKey = !process.env.STRIPE_SECRET_KEY
    console.error(
      missingKey
        ? '[codes/redeem] KONFIGURASJONSFEIL: STRIPE_SECRET_KEY mangler — innløsning er blokkert til den er satt:'
        : '[codes/redeem] kunne ikke avgjøre premium-tilstand:',
      err,
    )
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte abonnementsstatusen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 },
    )
  }

  // duration_days styrer hvor lenge Premium varer ETTER innløsning.
  // NULL/0 = permanent. valid_until er en separat frist: siste dag koden kan
  // LØSES INN.
  const decision = decideRedemption(state, accessCode.duration_days)

  if (decision.action === 'reject') {
    return NextResponse.json({ error: decision.message, reason: decision.reason }, { status: 409 })
  }

  const expiresAt = decision.expiresAt

  // FIX 2 + FIX 3 — single atomic RPC: increments used_count only if capacity
  // remains, then grants premium — all in one DB transaction, no partial failure.
  // Requires supabase/migrations/20260720000001_access_code_duration.sql to be run first.
  const { error: rpcError } = await supabaseAdmin.rpc('redeem_access_code', {
    p_code_id:    accessCode.id,
    p_user_id:    user.id,
    p_expires_at: expiresAt,
  })

  if (rpcError) {
    if (rpcError.message.includes('code_exhausted')) {
      return NextResponse.json({ error: 'Koden er allerede brukt opp' }, { status: 409 })
    }
    // Per-konto-sperren (access_code_redemptions). Viktig for delte koder: uten
    // den kunne én bruker løse inn samme gruppekode på nytt hver gang
    // kode-premium utløp, og spise flere av de N plassene.
    if (rpcError.message.includes('already_redeemed')) {
      return NextResponse.json({ error: 'Du har allerede brukt denne koden' }, { status: 409 })
    }
    console.error('[codes/redeem] rpc error:', rpcError.message)
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // premium_source = 'code' settes nå inne i RPC-en, i samme transaksjon som
  // selve tildelingen. Tidligere ble den satt i et separat kall her — feilet det,
  // fikk brukeren Premium uten kilde, og cron-jobben som rydder utløpte
  // kode-tildelinger ville aldri funnet dem.

  // ── Pause abonnementet for kodens varighet (rad B og D) ─────────────────────
  // Kunden skal aldri belastes for en periode de samtidig får gratis. Vi bruker
  // Stripes pause_collection: abonnementet kanselleres ikke, statusen forblir
  // 'active', og `resumes_at` får Stripe til å gjenoppta fakturering av seg selv
  // — ingen cron, ingen manuell handling.
  //
  // Koden er allerede gitt på dette punktet. Feiler pausen, er riktig utfall at
  // brukeren beholder Premium og at VI får vite det — ikke at innløsningen
  // rulles tilbake. Derfor logges det høylytt i stedet for å kaste.
  let pausedUntil: string | null = null
  if (decision.pause) {
    try {
      await stripe.subscriptions.update(decision.pause.subscriptionId, {
        pause_collection: {
          behavior: 'void',
          ...(decision.pause.resumesAt
            ? { resumes_at: Math.floor(new Date(decision.pause.resumesAt).getTime() / 1000) }
            : {}),
        },
      })
      pausedUntil = decision.pause.resumesAt
    } catch (err) {
      console.error(
        `[codes/redeem] KRITISK: kunne ikke pause abonnement ${decision.pause.subscriptionId} ` +
        `for user=${user.id} — kunden risikerer å bli belastet i kode-perioden:`,
        err,
      )
    }
  }

  // Cache-feltene på profiles settes i tråd med den utledede tilstanden.
  await syncPremiumCache(user.id, stripe)

  // Varsle kunden. Ved pause er dette ikke en høflighetsmelding, men selve
  // beskjeden om at de ikke blir trukket — den skal være tydelig.
  if (user.email) {
    const html = decision.pause
      ? codeActivatedPausedEmail(decision.startsAt, expiresAt, pausedUntil)
      : codeActivatedEmail(decision.startsAt, expiresAt)
    sendEmail({
      to: user.email,
      subject: decision.pause
        ? 'Koden er aktivert — abonnementet ditt er satt på pause'
        : 'Premium er aktivert — Quizkanonen',
      html,
    }).catch(err => console.error('[codes/redeem] aktiveringsvarsel feilet:', err))
  }

  return NextResponse.json({
    success: true,
    startsAt: decision.startsAt,
    expiresAt,
    pausedSubscription: !!decision.pause,
    resumesAt: pausedUntil,
  })
}
