import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { trialWelcomeEmail } from '@/lib/email-templates'

const FOUNDERS_PRICE_ID = process.env.STRIPE_PRICE_FOUNDERS!

// Prøveperiodens lengde bor i site_settings, under en EGEN nøkkel — bevisst ikke
// `founders_days_free` (= 30), som styrte det gamle, ubegrensede tilbudet.
// Gjenbruk av den ville koblet engangs-prøven til en verdi satt for en helt
// annen mekanikk.
//
// Det finnes med vilje INGEN innebygd fallback. En hardkodet «14» ville truffet
// hver gang nøkkelen manglet, og ruten ville da lovet en lengde ingen har
// bestemt — en gjettet verdi presentert som fakta, på flaten som starter
// abonnementet. Mangler tallet, aktiverer vi ikke.
const TRIAL_DAYS_SETTING_KEY = 'founders_new_trial_days'

/**
 * «Abonnementet finnes ikke lenger» — det ENESTE tilfellet der en feilet
 * Stripe-oppslag trygt kan tolkes som «ingen dekning». Alt annet (nedetid,
 * nettverksfeil, ugyldig nøkkel) betyr at vi ikke VET, og da kan sperren ikke
 * åpne seg.
 */
function isMissingSubscription(err: unknown): boolean {
  return (
    err instanceof Stripe.errors.StripeInvalidRequestError &&
    (err.code === 'resource_missing' || /no such subscription/i.test(err.message))
  )
}

// Én ekstern rundtur (Stripe/GoTrue/enkelt-e-post) — ekstern latens kan
// alene være sekunder. 30 s gir rom uten å arve plattformdefaulten på 300 s.
export const maxDuration = 30

export async function POST(request: NextRequest) {
  if (!FOUNDERS_PRICE_ID) {
    return NextResponse.json({ error: 'Founders price not configured' }, { status: 500 })
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = await rateLimitShared(`founders-activate:${ip}`, 5, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
    }

    // ── Profiloppslaget er FAIL-CLOSED ────────────────────────────────────────
    // Feilen ble tidligere ikke destrukturert i det hele tatt: ved en transient
    // DB-feil ble `profile` undefined, og hver vakt under hoppet stille over.
    //
    // Fail-closed er riktig NETTOPP her, i motsetning til rate-limiteringen
    // rundt (som faller åpent med vilje): en rate-limit er polstring rundt en
    // handling brukeren har RETT til, mens trial-sperren ER selve
    // rettighetssjekken. En feilaktig nekting koster én irritert bruker som
    // prøver igjen om et minutt. En feilaktig innvilgelse er nøyaktig hullet
    // denne sperren finnes for å lukke — en ny gratisperiode, i løkke.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id, premium_status, personal_stripe_subscription_id, has_used_trial')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !profile) {
      console.error(
        '[founders-activate] kunne ikke lese profilen — avbryter (fail-closed):',
        profileError ?? 'ingen profilrad for bruker ' + user.id,
      )
      return NextResponse.json(
        { error: 'Vi får ikke bekreftet kontoen din akkurat nå. Prøv igjen om et par minutter.' },
        { status: 503 },
      )
    }

    // ── VAKT 1: prøveperioden er én gang per konto, for alltid ────────────────
    // Ruten målte tidligere bare NÅ-tilstand (premium_status +
    // personal_stripe_subscription_id). Etter at Founders-trialene stenges er
    // begge tomme for hele kohorten, og alle vaktene åpner seg igjen.
    // `has_used_trial` er det varige merket, og databasetriggeren
    // prevent_self_trial_unmark hindrer at det kan nulles av andre enn
    // service_role. Lesevakten her er brukeropplevelse — den ærlige
    // forklaringen; selve SIKKERHETEN ligger i det atomiske claimet under.
    if (profile.has_used_trial === true) {
      return NextResponse.json(
        {
          error: 'Du har allerede hatt en gratis prøveperiode på denne kontoen. ' +
            'Prøveperioden kan brukes én gang per konto, men du kan starte et ' +
            'vanlig Premium-abonnement når du vil.',
        },
        { status: 409 },
      )
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })

    // ── VAKT 2 (sekundær): levende abonnement hos Stripe ─────────────────────
    // Beholdt som ekstra sperre. Catch-en fortsatte tidligere ved ENHVER feil,
    // så Stripe-nedetid åpnet sperren. Nå fortsetter vi kun når abonnementet
    // beviselig er borte.
    if (profile.personal_stripe_subscription_id) {
      let existing: Stripe.Subscription | null = null
      try {
        existing = await stripe.subscriptions.retrieve(profile.personal_stripe_subscription_id)
      } catch (err) {
        if (!isMissingSubscription(err)) {
          console.error('[founders-activate] Stripe-oppslag feilet — avbryter (fail-closed):', err)
          return NextResponse.json(
            { error: 'Vi får ikke kontakt med betalingsleverandøren akkurat nå. Prøv igjen om et par minutter.' },
            { status: 503 },
          )
        }
        console.warn('[founders-activate] abonnementet finnes ikke i Stripe lenger, fortsetter:', err)
      }

      // Et slettet objekt er også «borte» — men bare når flagget faktisk står.
      if ((existing as { deleted?: boolean } | null)?.deleted === true) {
        existing = null
      }

      if (existing && (existing.status === 'trialing' || existing.status === 'active')) {
        return NextResponse.json(
          { error: 'Du har allerede en aktiv Founders-prøveperiode.' },
          { status: 409 },
        )
      }
    }

    // ── Trial-lengde: fail-closed, ingen gjettet fallback ────────────────────
    // Plass-/isFull-logikken og 30/7-fallbackene er fjernet sammen med det gamle
    // tilbudet. Samme begrunnelse som profiloppslaget over: kan vi ikke lese hvor
    // lang prøveperioden skal være, må vi ikke opprette en. Å nekte koster én
    // irritert bruker som prøver igjen; å gjette gir et abonnement med en lengde
    // ingen har bestemt. Sjekken ligger FØR kunde-opprettelsen, så en avvist
    // forespørsel ikke etterlater spor hos Stripe.
    const { data: settingRow, error: settingError } = await supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', TRIAL_DAYS_SETTING_KEY)
      .maybeSingle()

    const trialLengthUnavailable = () => NextResponse.json(
      { error: 'Vi får ikke satt opp prøveperioden akkurat nå. Prøv igjen om et par minutter.' },
      { status: 503 },
    )

    if (settingError) {
      console.error(
        `[founders-activate] kunne ikke lese ${TRIAL_DAYS_SETTING_KEY} — avbryter (fail-closed):`,
        settingError,
      )
      return trialLengthUnavailable()
    }
    if (!settingRow) {
      console.error(
        `[founders-activate] ${TRIAL_DAYS_SETTING_KEY} mangler i site_settings — avbryter (fail-closed). ` +
        'Raden må legges inn før Founders-aktivering kan brukes.',
      )
      return trialLengthUnavailable()
    }

    const trialPeriodDays = Number(settingRow.value ?? NaN)
    if (!Number.isInteger(trialPeriodDays) || trialPeriodDays <= 0) {
      console.error(
        `[founders-activate] ${TRIAL_DAYS_SETTING_KEY} = ${JSON.stringify(settingRow.value)} ` +
        'er ikke et positivt heltall — avbryter (fail-closed).',
      )
      return trialLengthUnavailable()
    }

    let customerId = profile.stripe_customer_id ?? null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      }, {
        idempotencyKey: `founders-activate:customer:${user.id}`,
      })
      customerId = customer.id
      const { error: customerIdError } = await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id)
      if (customerIdError) {
        // Ikke blokkerende: id-en vi nettopp opprettet brukes videre i denne
        // forespørselen, og `idempotencyKey` gjør at et nytt forsøk får SAMME
        // kunde tilbake fra Stripe i stedet for en duplikat. Men den skal
        // logges som feil — går den tapt, mangler profilen kunde-koblingen.
        console.error('[founders-activate] kunne ikke lagre stripe_customer_id:', customerIdError)
      }
    }

    // ── Atomisk claim = den ekte sperren ─────────────────────────────────────
    // `.eq('has_used_trial', false)` gjør engangs-regelen race-sikker uavhengig
    // av lesevakten over: to samtidige kall kan aldri begge matche raden, så
    // bare én kan opprette et abonnement. Claimer FØR Stripe-kallet; rulles
    // tilbake under hvis Stripe feiler.
    const { data: claimedProfile, error: claimError } = await supabaseAdmin
      .from('profiles')
      .update({
        premium_status: true,
        premium_since: new Date().toISOString(),
        premium_source: 'founders',
        trial_reminder_sent_at: null,
        has_used_trial: true,
      })
      .eq('id', user.id)
      .not('premium_status', 'is', true)
      .eq('has_used_trial', false)
      .select('id')
      .maybeSingle()

    if (claimError) {
      console.error('[founders-activate] claim-update feilet:', claimError)
      return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
    }

    if (!claimedProfile) {
      // Enten har brukeren alt Premium, eller et samtidig kall vant claimet.
      return NextResponse.json({ error: 'Du har allerede Premium' }, { status: 400 })
    }

    // Rollback av claimet. `has_used_trial` MÅ med: merket betyr «har HATT en
    // prøveperiode», ikke «har trykket på knappen». Uten dette ville et
    // mislykket Stripe-kall låst brukeren ute fra prøveperioden for godt.
    const rollbackClaim = async (reason: string) => {
      const { error: rollbackError } = await supabaseAdmin
        .from('profiles')
        .update({
          premium_status: false,
          premium_source: null,
          premium_since: null,
          has_used_trial: false,
        })
        .eq('id', user.id)
      if (rollbackError) {
        console.error(
          `[founders-activate] ROLLBACK FEILET etter ${reason} for ${user.id} — ` +
          'profilen kan stå med premium_status=true og has_used_trial=true uten dekning:',
          rollbackError,
        )
      }
    }

    let subscription: Stripe.Subscription
    try {
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: FOUNDERS_PRICE_ID }],
        trial_period_days: trialPeriodDays,
        payment_settings: { save_default_payment_method: 'off' },
        // Uten denne kan trialen konvertere til automatisk trekk på et kort som
        // ligger igjen fra et TIDLIGERE kjøp på samme Stripe-kunde — uten at
        // brukeren aktivt har valgt betaling. Samme oppførsel som org-ruten.
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      }, {
        idempotencyKey: `founders-activate:${user.id}`,
      })
    } catch (stripeErr) {
      console.error('[founders-activate] Stripe-abonnement feilet, ruller tilbake claim:', stripeErr)
      await rollbackClaim('feilet subscriptions.create')
      return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
    }

    // Feilet denne skrivingen tidligere, ble den bare logget og svelget — og da
    // hadde VAKT 2 ingenting å slå opp ved neste kall. Behandles nå som en
    // feilet aktivering.
    const { error: subIdError } = await supabaseAdmin
      .from('profiles')
      .update({ personal_stripe_subscription_id: subscription.id })
      .eq('id', user.id)
    if (subIdError) {
      console.error(
        '[founders-activate] kunne ikke lagre personal_stripe_subscription_id — ' +
        `behandles som feilet aktivering. Abonnement ${subscription.id} (kunde ${customerId}) ` +
        'er opprettet hos Stripe og må ryddes manuelt:',
        subIdError,
      )
      await rollbackClaim('feilet lagring av personal_stripe_subscription_id')
      return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
    }

    // Send aktiveringsbekreftelse — fire-and-forget.
    //
    // Var foundersWelcomeEmail («Founders Access aktivert», «Du er blant de
    // første») fram til 12. august 2026. Founders ble avviklet som
    // brukersynlig inngang i 526b9dc, så den teksten viste til et program
    // mottakeren aldri hadde vært del av.
    //
    // `trialPeriodDays` sendes med i tillegg til `trial_end`: det er samme tall
    // ruten nettopp opprettet abonnementet med, lest fra site_settings — altså
    // samme kilde som knappeteksten brukeren klikket på. Malen hardkoder ingen
    // lengde.
    if (user.email) {
      sendEmail({
        to: user.email,
        subject: 'Prøveperioden din er i gang — Quizkanonen',
        html: trialWelcomeEmail(subscription.trial_end, trialPeriodDays),
      }).catch(err => console.error('[founders-activate] trialWelcomeEmail failed:', err))
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Founders activate error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
