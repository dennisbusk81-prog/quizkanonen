import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { getCodeCoverage, getStripeCoverage } from '@/lib/premium-state-io'
import { isStripeLive } from '@/lib/premium-state'

// Klienten sender et SYMBOLSK navn — aldri en ekte price-ID. Nøklene i denne
// mappen ER hvitelisten; verdien er env-variabelen som bærer den ekte
// price-ID-en i Vercel. En ekte price-ID i body er ikke en nøkkel her og
// avvises derfor med 400, akkurat som et ukjent navn.
const PRICE_ENV_BY_SYMBOL: Record<string, string> = {
  STRIPE_PRICE_PREMIUM_MONTHLY: 'STRIPE_PRICE_PREMIUM_MONTHLY',
  STRIPE_PRICE_PREMIUM_YEARLY: 'STRIPE_PRICE_PREMIUM_YEARLY',
}

/**
 * Kundens Stripe-kunde som checkouten skal bruke — den EKSISTERENDE når vi har
 * en, ellers null (da lar vi Stripe opprette en via customer_email, som før).
 *
 * HVORFOR DENNE FINNES (8. august 2026)
 * Ruten sendte tidligere kun `customer_email`. Stripe oppretter da en NY kunde
 * for hvert kjøp, også for en bruker som allerede hadde en — og alle
 * Founders-brukere har en, opprettet av founders-activate. Webhooken skrev
 * deretter den nye kunde-id-en over profilen, og det gamle Founders-
 * abonnementet ble hengende igjen på en kunde ingenting lenger peker på.
 *
 * Konsekvensen var ikke teoretisk: når det forlatte abonnementet nådde
 * trial_end, fant `invoice.payment_failed` ingen profil på kunde-id-en, alle
 * tre stale-vaktene i webhooken krever en profil for å undertrykke noe, og
 * kunden som nettopp HADDE betalt fikk «Prøveperioden din er over».
 *
 * Samme mønster som reaktiveringsgrenen i org-checkout allerede bruker
 * (`org.stripe_customer_id ? { customer } : { customer_email }`).
 */
async function resolveCustomerId(
  stripe: Stripe,
  userId: string,
  email: string | null,
): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle()

  const storedId = profile?.stripe_customer_id ?? null
  if (!storedId) return null

  // Er kunden fortsatt gyldig hos Stripe? En slettet kunde gir enten et objekt
  // med `deleted: true` eller en `resource_missing`-feil, og begge ville ellers
  // veltet checkouten med 500 på en bruker som bare ville betale.
  try {
    const customer = await stripe.customers.retrieve(storedId)
    if (!(customer as { deleted?: boolean }).deleted) return storedId
    console.warn(`[checkout] lagret Stripe-kunde ${storedId} er slettet — oppretter ny for ${userId}`)
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing')) {
      // Ukjent feil (Stripe nede, nettverk). Da VET vi ikke at id-en er ugyldig,
      // og å opprette en ny på det grunnlaget ville gjenskapt nøyaktig
      // duplikat-kunde-buggen denne funksjonen finnes for å fjerne. Stol på
      // databasen; er id-en likevel død, feiler sessions.create som før.
      console.error(`[checkout] kunne ikke verifisere Stripe-kunde ${storedId} — bruker den likevel:`, err)
      return storedId
    }
    console.warn(`[checkout] lagret Stripe-kunde ${storedId} finnes ikke i Stripe — oppretter ny for ${userId}`)
  }

  // Fail-safe: id-en er bekreftet ugyldig. Opprett en ny og pek profilen dit nå,
  // ikke først når webhooken kommer — portal, /api/stripe/subscription og
  // getStripeCoverage leser alle denne kolonnen imellom.
  const created = await stripe.customers.create(
    { email: email ?? undefined, metadata: { userId } },
    { idempotencyKey: `checkout:customer:${userId}:${storedId}` },
  )

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ stripe_customer_id: created.id })
    .eq('id', userId)
  if (error) {
    // Ikke avbryt: kjøpet kan fullføres, og webhooken skriver samme id etterpå.
    console.error(`[checkout] kunne ikke lagre ny stripe_customer_id for ${userId}:`, error.message)
  }

  return created.id
}

// Én ekstern rundtur (Stripe/GoTrue/enkelt-e-post) — ekstern latens kan
// alene være sekunder. 30 s gir rom uten å arve plattformdefaulten på 300 s.
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `stripe-checkout:${ip}`
  const rl = await rateLimitShared(rlKey, 10, 60_000)
  if (!rl.success) {
    logRateLimitHit(rlKey, { lag: 'delt', limit: 10, windowMs: 60_000 })
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

    // Object.hasOwn, ikke et rent oppslag: `priceId` er fri tekst fra body, og
    // arvede nøkler ('constructor', 'toString') skal være like ugyldige som
    // alt annet utenfor hvitelisten.
    if (typeof priceId !== 'string' || !Object.hasOwn(PRICE_ENV_BY_SYMBOL, priceId)) {
      return NextResponse.json({ error: 'Ugyldig priceId' }, { status: 400 })
    }
    const priceEnvName = PRICE_ENV_BY_SYMBOL[priceId]
    const resolvedPriceId = process.env[priceEnvName]
    if (!resolvedPriceId) {
      // Hvitelistet navn uten env-verdi er en KONFIGURASJONSFEIL, ikke en
      // brukerfeil. Uten denne sperren hadde undefined gått rett inn i
      // sessions.create og kunden fått en generisk 500 uten spor av årsaken.
      // Kunden kan ikke handle på dette — detaljene går til loggen, ikke UI-et.
      console.error(`[checkout] priceId ${priceId} er hvitelistet, men env-variabelen ${priceEnvName} mangler eller er tom`)
      return NextResponse.json(
        { error: 'Denne prisen er ikke tilgjengelig akkurat nå. Prøv igjen senere, eller kontakt oss.' },
        { status: 500 },
      )
    }
    const mode = 'subscription'

    // ── Vakt mot dobbelt abonnement (30. august 2026) ──────────────────────────
    // Checkout sjekket aldri om brukeren allerede HAR et levende abonnement, og
    // getStripeCoverage henter limit:1 — så et kjøp nummer to ga to samtidige
    // abonnementer der det andre var USYNLIG for all app-logikk. Stille
    // dobbelttrekk. Med en årspris ved siden av månedsprisen blir «kjøp igjen»
    // dessuten den naturlige bytte-handlingen, ikke en sjelden brukerfeil.
    //
    // «Levende» er isStripeLive — SAMME definisjon som resten av kodebasen
    // (active + trialing), og samme vakt som founders-activate allerede har.
    // Konsekvenser som er bevisste, ikke tilfeldige:
    //   - trialing (Founders uten kort) sperres: konverteringsveien deres er
    //     portalen (legg inn kort), empirisk bevist i drift. Et checkout-kjøp
    //     under trial ville gitt to abonnementer på samme kunde.
    //   - past_due/unpaid sperres IKKE: karens er ikke levende dekning
    //     (se lib/premium-state.ts), og et nytt kjøp er da et lovlig valg.
    //   - org-dekning og verdikoder ses ikke av denne vakten i det hele tatt —
    //     rad E-stien under er urørt, og org-medlemmer kan fortsatt kjøpe
    //     personlig Premium som overlever at de forlater org-en.
    //
    // Kaster getStripeCoverage (Stripe nede), fanger catch-en under og svarer
    // 500 — fail-closed. Riktig her: uten svar fra Stripe VET vi ikke at kjøpet
    // er trygt, og sessions.create ville uansett feilet mot samme nedetid.
    const { data: gateProfile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle()
    const existingSub = await getStripeCoverage(gateProfile?.stripe_customer_id ?? null, stripe)
    if (isStripeLive(existingSub)) {
      return NextResponse.json(
        {
          error:
            'Du har allerede et løpende abonnement eller en aktiv prøveperiode, så et ' +
            'nytt kjøp ville gitt doble trekk. Gå til profilsiden og velg ' +
            '«Administrer abonnement» for å endre, gjenoppta eller legge inn kort.',
        },
        { status: 409 },
      )
    }

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

    // Gjenbruk kundens eksisterende Stripe-kunde. Uten dette lager Stripe en ny
    // for hvert kjøp — se resolveCustomerId for hva det koster.
    const customerId = await resolveCustomerId(stripe, userId, email ?? null)

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      // customer_email er KUN for brukere uten kunde fra før. Stripe avviser at
      // begge sendes samtidig, og customer_email på en eksisterende kunde ville
      // uansett ikke bundet sesjonen til den.
      ...(customerId
        ? { customer: customerId }
        : { customer_email: email ?? undefined }),
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
