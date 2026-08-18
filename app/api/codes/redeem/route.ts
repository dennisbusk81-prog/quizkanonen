import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { sendEmail } from '@/lib/email'
import { codeActivatedEmail, codeActivatedPausedEmail } from '@/lib/email-templates'
import { decideRedemption, type PremiumState } from '@/lib/premium-state'
import { reportMoneyPathFailure } from '@/lib/money-path-alert'
import { getPremiumState, syncPremiumCache } from '@/lib/premium-state-io'
import {
  REDEEM_MISS_ACTION,
  REDEEM_WINDOW_MS,
  decideRedeemThrottle,
  ipScopeId,
} from '@/lib/redeem-throttle'

// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'

  // Førstelag: billig burst-brems i minnet, før vi bruker et eneste DB-kall på
  // en forespørsel som kommer i rasende tempo. Denne ALENE er ikke grensen vi
  // lener oss på — Map-en lever per serverless-instans — men den holder
  // rå-flooding unna auth-oppslaget under. Den autoritative tellingen ligger i
  // admin_actions lenger nede.
  const rlKey = `codes-redeem:${ip}`
  const rl = rateLimit(rlKey, 5, 60_000)
  if (!rl.success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 5, windowMs: 60_000 })
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

  // ── Andrelag: vedvarende bom-telling (lib/redeem-throttle.ts) ───────────────
  // To uavhengige dimensjoner, begge lest fra admin_actions så de overlever
  // kalde starter: per konto (IP-er roteres billig) og per IP-bøtte (fanger
  // mange konti fra samme maskin). Kun forsøk mot koder som ikke finnes telles
  // — se lib/redeem-throttle.ts for hvorfor det er nettopp bom som er signalet.
  const ipScope = ipScopeId(ip)
  const since = new Date(Date.now() - REDEEM_WINDOW_MS).toISOString()

  const [userMissRes, ipMissRes] = await Promise.all([
    supabaseAdmin
      .from('admin_actions')
      .select('id', { count: 'exact', head: true })
      .eq('action_type', REDEEM_MISS_ACTION)
      .eq('user_id', user.id)
      .gte('created_at', since),
    supabaseAdmin
      .from('admin_actions')
      .select('id', { count: 'exact', head: true })
      .eq('action_type', REDEEM_MISS_ACTION)
      .eq('scope_id', ipScope)
      .gte('created_at', since),
  ])

  // Kan vi ikke lese forbruket, vet vi ikke om dette er forsøk nr. 2 eller
  // nr. 200. Da stopper vi. Ruten feiler allerede lukket når Stripe ikke kan
  // leses (se under) — en DB-feil skal ikke være omveien rundt grensen.
  if (userMissRes.error || ipMissRes.error) {
    console.error(
      '[codes/redeem] kunne ikke telle tidligere kodeforsøk:',
      userMissRes.error?.message ?? ipMissRes.error?.message,
    )
    return NextResponse.json(
      { error: 'Kunne ikke behandle kodeforsøket akkurat nå. Prøv igjen om litt.' },
      { status: 503 },
    )
  }

  const throttle = decideRedeemThrottle({
    userMisses: userMissRes.count ?? 0,
    ipMisses: ipMissRes.count ?? 0,
  })
  if (!throttle.allowed) {
    return NextResponse.json({ error: throttle.message }, { status: 429 })
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
    // Bokfør bommet. Én rad dekker begge tellingene over: user_id gir
    // konto-dimensjonen, scope_id gir IP-bøtta. Feiler skrivingen, er neste
    // forsøk sluppet gjennom på en for lav teller — riktig vei å feile, men
    // den må logges så den ikke blir usynlig.
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      action_type: REDEEM_MISS_ACTION,
      scope_type: 'ip',
      scope_id: ipScope,
      user_id: user.id,
    })
    if (logErr) console.error('[codes/redeem] kunne ikke bokføre kodeforsøk:', logErr.message)

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
  //
  // `pauseSucceeded` er BEKREFTELSE, ikke intensjon. Fram til 12. august svarte
  // ruten `pausedSubscription: !!decision.pause` — altså om vi SKULLE pause —
  // og profilsiden fortalte da en kunde som faktisk ble trukket at de ikke ble
  // det. Det som skal ut av denne blokken er hva vi rakk å gjøre.
  let pausedUntil: string | null = null
  let pauseSucceeded = false
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
      pauseSucceeded = true
    } catch (err) {
      console.error(
        `[codes/redeem] KRITISK: kunne ikke pause abonnement ${decision.pause.subscriptionId} ` +
        `for user=${user.id} — kunden risikerer å bli belastet i kode-perioden:`,
        err,
      )
      // Loggen alene når ikke fram: Sentry har ingen captureConsole-integrasjon,
      // og brukeren får 200 og merker ingenting. Uten dette varselet oppdages
      // trekket først på kundens kontoutskrift — hvis de sier fra.
      reportMoneyPathFailure({
        operation: 'codes/redeem:pause-subscription',
        consequence:
          'Kunden trekkes kr 49 for en periode de fikk gratis via verdikode. ' +
          'Sett pause_collection manuelt i Stripe, med resumes_at = kodens sluttdato.',
        err,
        context: {
          subscriptionId: decision.pause.subscriptionId,
          userId: user.id,
          resumesAt: decision.pause.resumesAt,
        },
      })
    }
  }

  // Cache-feltene på profiles settes i tråd med den utledede tilstanden.
  await syncPremiumCache(user.id, stripe)

  // Varsle kunden. Ved pause er dette ikke en høflighetsmelding, men selve
  // beskjeden om at de ikke blir trukket — den skal være tydelig.
  //
  // Gatet på `pauseSucceeded`, ikke `decision.pause`: pause-malen sier rett ut
  // «du blir ikke trukket». Feilet pausen, ville den setningen vært usann i en
  // e-post kunden har på skrift. Den vanlige aktiveringsmalen er derimot sann
  // uansett — Premium ER aktivert — så den er riktig fallback. Dennis får
  // Sentry-varselet og retter pausen manuelt; da stemmer teksten igjen.
  if (user.email) {
    const html = pauseSucceeded
      ? codeActivatedPausedEmail(decision.startsAt, expiresAt, pausedUntil)
      : codeActivatedEmail(decision.startsAt, expiresAt)
    sendEmail({
      to: user.email,
      subject: pauseSucceeded
        ? 'Koden er aktivert — abonnementet ditt er satt på pause'
        : 'Premium er aktivert — Quizkanonen',
      html,
    }).catch(err => console.error('[codes/redeem] aktiveringsvarsel feilet:', err))
  }

  return NextResponse.json({
    success: true,
    startsAt: decision.startsAt,
    expiresAt,
    pausedSubscription: pauseSucceeded,
    resumesAt: pausedUntil,
    // Eget felt, ikke bare fravær av `pausedSubscription`: uten det kan ikke
    // klienten skille «det fantes ingenting å pause» fra «vi prøvde og feilet»,
    // og ville gått fra å lyve til å tie. Se app/profil/page.tsx.
    pauseFailed: !!decision.pause && !pauseSucceeded,
  })
}
