import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { getCodeCoverage } from '@/lib/premium-state-io'

const ALLOWED_PRICE_IDS = ['STRIPE_PRICE_PREMIUM_MONTHLY']

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
