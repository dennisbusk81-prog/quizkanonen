import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { premiumWelcomeEmail, premiumRenewalEmail, premiumCancelledEmail, orgPurchaseEmail, orgCancelledEmail, orgTrialEndedEmail, orgAccessLockedEmail, orgRenewalEmail, paymentFailedEmail, orgPaymentFailedEmail, trialEndedNoCardEmail, subscriptionResumedEmail } from '@/lib/email-templates'
import { shouldNotifyMembersOfLock, shouldNotifyAdminsOfDunningLock, notifyMembersOfOrgLock } from '@/lib/org-lock-notify'
import { decideLockGrace, CLEARED_GRACE, type LockGraceDecision } from '@/lib/org-lock-grace'
import { getOrgAdminEmails, sendToOrgAdmins } from '@/lib/org-admin-emails'
import { hasActiveOrgPremium } from '@/lib/org-premium'
import { syncPremiumCache } from '@/lib/premium-state-io'
import { planFromPriceId } from '@/lib/org-plan-prices'
import {
  LIVE_SUBSCRIPTION_STATUSES,
  isStaleSubscriptionEvent,
  shouldSendCancellationEmail,
  needsLiveSubscriptionLookup,
  decideOrgSubscriptionEvent,
  type OrgSubEventVerdict,
} from '@/lib/subscription-lifecycle'

// ── Nedgradering skal ALLTID rekalkuleres, aldri antas ───────────────────────
// Fram til 26. juli satte hver av disse grenene `premium_status: false` direkte.
// Det var riktig så lenge en bruker bare kunne ha én kilde til Premium — men en
// bruker kan reelt ha flere samtidig. Konkret eksempel: en Founders-trial som
// utløper mens en stablet verdikode fortsatt gjelder. Stripe flipper
// abonnementet til past_due, og den gamle koden slo av Premium midt i en gyldig
// kode-periode.
//
// syncPremiumCache() utleder tilstanden fra ALLE kildene (kode, org, levende
// Stripe-abonnement) og skriver cache-feltene deretter. Den slår aldri av
// Premium for en bruker som fortsatt er dekket av noe annet.
async function recomputePremium(userIds: string[], context: string, stripe?: Stripe): Promise<void> {
  for (const id of userIds) {
    try {
      await syncPremiumCache(id, stripe)
    } catch (err) {
      console.error(`[webhook] premium-rekalkulering feilet (${context}) user=${id}:`, err)
    }
  }
}

// ── Grace-periode ved ufrivillig org-lås (29. juli 2026) ─────────────────────
// Stempler grace-kolonnene på org-raden FØR medlemmenes premium rekalkuleres.
// Rekkefølgen er hele mekanismen: `recomputePremium` under leser org-dekningen
// på nytt via getOrgCoverage(), som teller en låst org med levende grace som
// dekning — så medlemmene beholder Premium uten at én eneste profilrad røres her.
//
// EGEN SKRIVING, bevisst utenfor `assertCriticalWrite`: skrev vi grace i samme
// UPDATE som selve låsen, ville en manglende kolonne (migrasjon 20260737000000
// ikke kjørt ennå) gjort HVER lås til en kastet 500 og en evig Stripe-retry.
// Feiler den her i stedet, faller vi tilbake til oppførselen fra før grace
// fantes — de ansatte mister tilgangen med én gang, som i dag — og feilen
// logges høylytt. Det er riktig vei å feile.
async function applyLockGrace(
  organizationId: string,
  decision: LockGraceDecision,
  context: string,
): Promise<string | null> {
  if (!decision.grace) {
    console.log(
      `[webhook] INGEN grace — bevisst oppsigelse, ansatte mister tilgangen nå. ` +
      `org=${organizationId} (${context})`
    )
    return null
  }

  const { error } = await supabaseAdmin.from('organizations')
    .update({
      member_grace_until: decision.until,
      member_grace_reason: decision.reason,
      // Nullstilles eksplisitt: en org som låses på nytt etter en tidligere
      // grace skal få sin egen påminnelse, ikke arve et gammelt dedupe-stempel.
      member_grace_reminded_at: null,
    })
    .eq('id', organizationId)

  if (error) {
    console.error(
      `[webhook] kunne IKKE gi lås-grace — de ansatte mister tilgangen umiddelbart. ` +
      `org=${organizationId} (${context}) årsak=${decision.reason}:`,
      error.code, error.message,
    )
    return null
  }

  console.log(
    `[webhook] lås-grace til ${decision.until} (${decision.reason}) org=${organizationId} (${context})`
  )
  return decision.until
}

// Den lagrede lås-årsaken, lest i en EGEN spørring.
//
// Hvorfor ikke bare utvide SELECT-en i deleted-grenen: den er kritisk. Feiler
// den — typisk en manglende kolonne — blir `org` null, hendelsen behandles som
// B2C, og org-en blir aldri låst i det hele tatt. Her koster en feil kun at
// e-posten faller tilbake til den gamle teksten.
//
// Trengs fordi låse-sekvensen typisk er `updated (canceled)` FØRST og `deleted`
// etterpå: da er org-en allerede `locked` når deleted ankommer, klassifiseringen
// ble gjort av den forrige hendelsen, og en fersk `decideLockGrace` ville sett
// `previousOrgStatus = 'locked'` og svart «unknown».
async function readStoredGraceReason(organizationId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('member_grace_reason')
    .eq('id', organizationId)
    .maybeSingle()

  if (error) {
    console.error(
      `[webhook] kunne ikke lese lagret lås-årsak org=${organizationId} — ` +
      `e-posten faller tilbake til standardteksten:`, error.code, error.message,
    )
    return null
  }

  return (data?.member_grace_reason as string | null) ?? null
}

// Rydder grace når org-en blir frisk igjen. Samme ikke-kritiske mønster og
// samme begrunnelse som applyLockGrace.
//
// Coverage-siden tåler et etterlatt stempel i seg selv (getOrgCoverage teller
// kun grace på orger som FAKTISK står som 'locked'), og påminnelses-cronen
// filtrerer på det samme. Ryddingen finnes for at kolonnene ikke skal lyve om
// tilstanden til den som leser dem.
async function clearLockGrace(organizationId: string, context: string): Promise<void> {
  const { error } = await supabaseAdmin.from('organizations')
    .update(CLEARED_GRACE)
    .eq('id', organizationId)

  if (error) {
    console.error(
      `[webhook] kunne ikke rydde lås-grace org=${organizationId} (${context}):`,
      error.code, error.message,
    )
  }
}

// Kaster ved feil på en kritisk DB-skriving slik at den ytre try/catch-en sletter
// idempotens-stemplet og returnerer 500 → Stripe retry-er hele hendelsen. Bruk KUN
// på skrivinger der org og medlemmer må forbli konsistente. E-postkall er IKKE
// kritiske og skal aldri kaste. Alle skrivinger her er idempotente, så retry er trygt.
function assertCriticalWrite(error: { code?: string; message: string } | null, context: string): void {
  if (error) {
    console.error(`[webhook] KRITISK skrivefeil — ${context}:`, error.code, error.message)
    throw new Error(`Kritisk DB-skriving feilet (${context}): ${error.message}`)
  }
}

// Fjerner idempotens-stempelet som ble satt før prosessering, slik at hendelsen
// kan behandles på nytt ved en senere Stripe-retry eller en manuell replay fra
// dashbordet.
//
// MÅ kalles før HVER tidlig `return` inne i try-blokken. Stempelet settes først
// (INSERT i stripe_events) og fjernes ellers kun i catch. En tidlig return hopper
// forbi catch, så uten dette blir stempelet stående permanent — og neste levering
// av samme hendelse avvises som duplikat (23505) uten at den noen gang ble
// håndtert. Hendelsen ville da vært tapt for godt.
//
// Merk: dette er latent i dag fordi stripe_events-tabellen ikke finnes ennå og
// insert-en feiler stille. Det blir reelt i det migrasjonen
// 20260719000000_stripe_events.sql kjøres.
async function releaseIdempotencyStamp(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('stripe_events').delete().eq('id', eventId)
  if (error) {
    console.error(`[webhook] kunne ikke fjerne idempotens-stempel for ${eventId}:`, error.message)
  }
}

async function getUserEmail(stripe: Stripe, customerId: string): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (!customer.deleted && (customer as Stripe.Customer).email) {
      return (customer as Stripe.Customer).email
    }
  } catch (err) {
    // Fail-soft med vilje (kalleren faller tilbake til å ikke sende e-post) —
    // men et forbigående Stripe-API-problem skal ikke passere helt sporløst.
    console.error(`[webhook] getUserEmail feilet for customer ${customerId}:`, err)
  }
  return null
}

// Abonnement-id-ene som fortsatt lever hos Stripe for én kunde. Brukes til å
// løse opp tvetydigheten når profiles.personal_stripe_subscription_id er NULL
// (se lib/subscription-lifecycle.ts): finnes et ANNET levende abonnement, er
// den terminale hendelsen vi behandler for et forbigått abonnement.
//
// Returnerer null ved feil — kalleren faller da tilbake til oppførselen fra
// før 28. juli (behandle hendelsen). Å tie om en ekte kansellering fordi et
// Stripe-oppslag glapp ville vært verre enn en sjelden overflødig e-post.
async function getLiveSubscriptionIds(stripe: Stripe, customerId: string): Promise<string[] | null> {
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    return subs.data
      .filter(s => (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(s.status))
      .map(s => s.id)
  } catch (err) {
    console.error(`[webhook] kunne ikke liste abonnement for customer ${customerId}:`, err)
    return null
  }
}

// Har kunden NOEN betalingsmetode registrert? Vi lister faktisk vedheftede
// metoder framfor å stole på default_payment_method alene — et avvist kort
// forblir vedheftet (ekte feil ⇒ ≥1 metode), mens en Founders-bruker aldri
// har lagt inn kort (0 metoder). default_payment_method kan dessuten være
// null selv når et kort finnes.
//
// null = oppslaget feilet. Kallerne behandler det som «har kort» (fail-safe).
async function customerHasPaymentMethod(stripe: Stripe, customerId: string): Promise<boolean | null> {
  try {
    const pms = await stripe.customers.listPaymentMethods(customerId, { limit: 1 })
    return pms.data.length > 0
  } catch (err) {
    console.error('[webhook] kunne ikke hente betalingsmetoder for', customerId, '— behandler som ekte feil:', err)
    return null
  }
}

// Sender kjøpsbekreftelse til org-admin. Tåler race condition der admin-medlemsraden
// ikke er ferdig committet når webhooket ankommer (Dennis sin Elkjøp-betaling 19.6):
// ett ekstra forsøk etter kort pause. Hopper aldri over stille — manglende felt logges
// eksplisitt med [webhook] orgPurchaseEmail SKIPPED slik at det er søkbart i Vercel.
async function sendOrgPurchaseConfirmation(organizationId: string): Promise<void> {
  let info = await getOrgAdminEmails(organizationId)

  if (info.emails.length === 0) {
    // Mulig race: org-checkout-skrivingen er ikke committet ennå. Vent og prøv én gang til.
    await new Promise(r => setTimeout(r, 1500))
    info = await getOrgAdminEmails(organizationId)
  }

  const { emails, orgName, orgSlug } = info
  if (emails.length === 0 || !orgName || !orgSlug) {
    const missing = [
      emails.length === 0 && 'email',
      !orgName && 'orgName',
      !orgSlug && 'orgSlug',
    ].filter(Boolean).join(', ')
    console.error(
      `[webhook] orgPurchaseEmail SKIPPED — manglende felt: ${missing}. ` +
      `organization_id=${organizationId}, orgName=${orgName ?? 'null'}, orgSlug=${orgSlug ?? 'null'}`
    )
    return
  }

  await sendToOrgAdmins(
    emails,
    {
      subject: `Velkommen til Quizkanonen for bedrifter — ${orgName}`,
      html: orgPurchaseEmail(orgName, orgSlug),
    },
    `webhook orgPurchaseEmail org=${organizationId}`,
  )
}

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('Webhook signatur-feil:', err)
    return NextResponse.json({ error: 'Ugyldig signatur' }, { status: 400 })
  }

  // ── Idempotency — skip already-processed events (Stripe retries) ──────
  const { error: idempotencyError } = await supabaseAdmin
    .from('stripe_events')
    .insert({ id: event.id, created_at: new Date().toISOString() })

  if (idempotencyError) {
    if (idempotencyError.code === '23505') {
      // Unique violation — event already processed
      return NextResponse.json({ received: true })
    }
    // Table missing or other DB error — log and continue to avoid blocking Stripe
    console.error('[webhook] stripe_events insert failed:', idempotencyError.code, idempotencyError.message)
  }

  // Prosesseringen wrappes i try/catch: kaster noe underveis, fjernes idempotens-
  // stemplet over (i catch) slik at Stripe sin retry kan prosessere hendelsen på
  // nytt. Uten dette ville 23505 ved retry returnert { received: true } uten å
  // prosessere — og låst en halvskrevet tilstand permanent.
  try {

  // ── checkout.session.completed ────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session

    if (session.metadata?.type === 'org') {
      // B2B org checkout
      const organizationId = session.metadata.organization_id
      if (!organizationId) {
        // Betalt org-checkout uten organization_id i metadata: ingen org kan
        // aktiveres. Frigi stempelet slik at en replay er mulig når årsaken er kjent.
        console.error(
          `[webhook] checkout.session.completed (org) MANGLER metadata.organization_id — ` +
          `ingen organisasjon aktivert. session=${session.id} customer=${String(session.customer ?? 'ukjent')} ` +
          `amount_total=${session.amount_total ?? 'ukjent'}. Må følges opp manuelt.`
        )
        await releaseIdempotencyStamp(event.id)
        return NextResponse.json({ received: true })
      }

      const subscriptionId = session.subscription as string
      let periodEnd: string | null = null

      // 1. Try to fetch subscription details from Stripe
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId)
        periodEnd = new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000).toISOString()
      } catch (err) {
        console.error('[webhook] stripe.subscriptions.retrieve failed for', subscriptionId, err)
      }

      // 2. Fallback: check if session already has expanded subscription data
      if (!periodEnd) {
        const sessionSub = session.subscription as unknown as { current_period_end?: number } | null
        if (sessionSub && typeof sessionSub === 'object' && sessionSub.current_period_end) {
          periodEnd = new Date(sessionSub.current_period_end * 1000).toISOString()
          console.log('[webhook] used expanded session.subscription for period_end')
        }
      }

      // 3. Last resort: 30 days from now so the field is never null
      if (!periodEnd) {
        periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        console.warn('[webhook] could not determine period_end, using 30-day fallback for org', organizationId)
      }

      const { error: orgUpdateError } = await supabaseAdmin.from('organizations').update({
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: subscriptionId,
        stripe_period_end: periodEnd,
        // Betalt checkout (ny kjøp ELLER reaktivering av låst org) → full tilgang.
        subscription_status: 'active',
      }).eq('id', organizationId)
      assertCriticalWrite(orgUpdateError, `checkout org-update org=${organizationId}`)

      // Betalingen er i havn — en eventuell lås-grace er ikke lenger sann.
      // Ubetinget: en fullført org-checkout er en sjelden hendelse, og vi vet
      // ikke fra denne grenen hva statusen var før.
      await clearLockGrace(organizationId, 'checkout')

      // Activate premium for all current members — single batch update
      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)

      const memberIds = (members ?? []).map(m => m.user_id)
      if (memberIds.length > 0) {
        const { error: memberUpdateError } = await supabaseAdmin.from('profiles').update({
          premium_status: true,
          premium_source: 'org',
        }).in('id', memberIds)
        assertCriticalWrite(memberUpdateError, `checkout medlems-premium org=${organizationId}`)
      }

      // Send kjøpsbekreftelse til org-admin — awaites så funksjonen ikke fryses
      // av serverless-runtimen før e-posten faktisk er sendt. Egen retry + logging.
      await sendOrgPurchaseConfirmation(organizationId)
    } else {
      // B2C personal checkout
      const userId = session.metadata?.userId
      if (!userId) {
        // ALVORLIGST av de fire: kunden HAR betalt, men vi vet ikke hvem de er,
        // så Premium blir aldri tildelt. Logges på ERROR med alt som trengs for å
        // rette opp manuelt, og stempelet frigis slik at en replay fra Stripe-
        // dashbordet faktisk får prosessert hendelsen.
        console.error(
          `[webhook] KRITISK — BETALT CHECKOUT UTEN metadata.userId. Kunden har betalt, ` +
          `men får IKKE Premium automatisk og må tildeles manuelt. ` +
          `session=${session.id} ` +
          `customer=${String(session.customer ?? 'ukjent')} ` +
          `e-post=${session.customer_details?.email ?? 'ukjent'} ` +
          `amount_total=${session.amount_total ?? 'ukjent'} ` +
          `event=${event.id}`
        )
        await releaseIdempotencyStamp(event.id)
        return NextResponse.json({ error: 'Mangler userId' }, { status: 400 })
      }

      // Bruk upsert — oppretter profiles-rad hvis den mangler (f.eks. bruker betalte
      // før navn-modal ble fullført), ellers oppdaterer eksisterende rad som normalt.
      // personal_stripe_subscription_id lagres nå ALLTID, ikke bare av
      // Founders-flyten. Fire kodesteder bruker kolonnen som «har ikke eget
      // abonnement»-vakt (begge utløps-cron-ene og begge org-grace-stedene), og
      // for en vanlig betalende B2C-kunde var den NULL — så vakten beskyttet
      // Founders-brukere og tok feil om alle andre.
      const checkoutSubId = typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as Stripe.Subscription | null)?.id ?? null

      // ── stripe_customer_id: aldri null over en eksisterende verdi (8. aug 2026) ──
      // `session.customer as string ?? null` skrev NULL når feltet manglet — og en
      // profil uten kunde-id har verken portal, abonnementsvisning eller
      // premium-dekning, siden alle tre slår opp PÅ den kolonnen. I praksis setter
      // Stripe alltid customer i mode:'subscription', men å kunne nulle den var
      // aldri tilsiktet.
      //
      // En ENDRING logges høylytt. Etter at checkout begynte å gjenbruke kunden
      // (se resolveCustomerId der) skal id-en normalt være uendret; en avvikende
      // verdi betyr at det er opprettet en duplikat-kunde et sted, og det er
      // nettopp det sporet som manglet da problemet oppsto. Vi skriver likevel:
      // abonnementet kunden akkurat betalte for ligger på den NYE kunden, og
      // nekter vi å følge etter, blir kjøpet usynlig for getStripeCoverage.
      const checkoutCustomerId = typeof session.customer === 'string'
        ? session.customer
        : (session.customer as Stripe.Customer | null)?.id ?? null

      if (checkoutCustomerId) {
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('stripe_customer_id')
          .eq('id', userId)
          .maybeSingle()

        const storedCustomerId = existingProfile?.stripe_customer_id ?? null
        if (storedCustomerId && storedCustomerId !== checkoutCustomerId) {
          console.error(
            `[webhook] checkout.session.completed OVERSKRIVER stripe_customer_id for ` +
            `userId=${userId}: ${storedCustomerId} → ${checkoutCustomerId}. ` +
            `Den gamle kunden kan ha et forlatt abonnement som fortsatt fyrer ` +
            `hendelser. session=${session.id}`
          )
        }
      } else {
        console.error(
          `[webhook] checkout.session.completed UTEN customer for userId=${userId} — ` +
          `beholder eksisterende stripe_customer_id. session=${session.id}`
        )
      }

      const { error: profileUpsertError } = await supabaseAdmin.from('profiles').upsert({
        id: userId,
        premium_status: true,
        premium_since: new Date().toISOString(),
        premium_source: 'personal',
        ...(checkoutCustomerId ? { stripe_customer_id: checkoutCustomerId } : {}),
        ...(checkoutSubId ? { personal_stripe_subscription_id: checkoutSubId } : {}),
      }, { onConflict: 'id' })

      assertCriticalWrite(profileUpsertError, `checkout B2C premium-upsert userId=${userId}`)

      // Send kjøpsbekreftelse — fire-and-forget
      supabaseAdmin.auth.admin.getUserById(userId)
        .then(({ data }) => {
          const email = data.user?.email
          if (email) {
            return sendEmail({
              to: email,
              subject: 'Velkommen til Premium — Quizkanonen',
              html: premiumWelcomeEmail(),
            })
          }
        })
        .catch(err => console.error('[webhook] premiumWelcomeEmail failed:', err))
    }
  }

  // ── invoice.payment_succeeded ──────────────────────────────────────────
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice
    // Skip the first payment — that is handled by checkout.session.completed
    if ((invoice as unknown as { billing_reason: string }).billing_reason === 'subscription_cycle') {
      const customerId = invoice.customer as string

      const { data: orgForInvoice } = await supabaseAdmin
        .from('organizations')
        .select('id, name, slug')
        .eq('stripe_customer_id', customerId)
        .maybeSingle()

      if (orgForInvoice) {
        // B2B — vellykket fornyelsesbetaling: sikre at org er aktiv (idempotent).
        const { error: orgRenewError } = await supabaseAdmin.from('organizations')
          .update({ subscription_status: 'active' })
          .eq('id', orgForInvoice.id)
        assertCriticalWrite(orgRenewError, `invoice-fornyelse org-active org=${orgForInvoice.id}`)

        // Pengene kom inn — samme rydding som ved checkout. Dette er også veien
        // ut for en org som ble låst på past_due og deretter betalte.
        await clearLockGrace(orgForInvoice.id, 'invoice.payment_succeeded')

        // send fornyelsesbekreftelse til ALLE org-admins
        getOrgAdminEmails(orgForInvoice.id)
          .then(({ emails, orgName, orgSlug }) => {
            if (emails.length > 0 && orgName && orgSlug) {
              return sendToOrgAdmins(
                emails,
                {
                  subject: `Bedriftsabonnementet er fornyet — Quizkanonen`,
                  html: orgRenewalEmail(orgName, orgSlug),
                },
                `webhook orgRenewalEmail org=${orgForInvoice.id}`,
              )
            }
          })
          .catch(err => console.error('[webhook] orgRenewalEmail failed:', err))
      } else {
        // B2C — send fornyelsesbekreftelse til bruker
        const periodEnd = (invoice as unknown as { period_end?: number }).period_end
        const nextBillingDate = periodEnd
          ? new Date(periodEnd * 1000).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
          : undefined
        getUserEmail(stripe, customerId)
          .then(email => {
            if (email) {
              return sendEmail({
                to: email,
                subject: 'Abonnementet ditt er fornyet — Quizkanonen',
                html: premiumRenewalEmail(nextBillingDate),
              })
            }
          })
          .catch(err => console.error('[webhook] premiumRenewalEmail failed:', err))
      }
    }
  }

  // ── customer.subscription.deleted ─────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = subscription.customer as string

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, slug, stripe_subscription_id, subscription_status')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    // FIX 2 — robust mot stale subscription-id. En sen deleted-hendelse for et
    // gammelt, erstattet abonnement (f.eks. etter reaktivering med et nytt) skal
    // IKKE låse en org som nå kjører på et nyere abonnement. Lås kun hvis den
    // slettede subscription-en faktisk er den org-en peker på i dag.
    const isCurrentOrgSub = !!org && org.stripe_subscription_id === subscription.id

    if (org && !isCurrentOrgSub) {
      console.log(
        `[webhook] subscription.deleted ignorert for org ${org.id} — stale sub ` +
        `${subscription.id}, gjeldende er ${org.stripe_subscription_id ?? 'null'}`
      )
    }

    if (org && isCurrentOrgSub) {
      // B2B: lås org-sidene og trekk premium fra alle medlemmer.
      // Dekker både kansellert betalt abonnement OG utløpt trial uten kort
      // (Stripe kansellerer trial-en automatisk → denne hendelsen).
      const { error: orgLockError } = await supabaseAdmin.from('organizations')
        .update({ subscription_status: 'locked' })
        .eq('id', org.id)
      assertCriticalWrite(orgLockError, `sub.deleted org-lock org=${org.id}`)

      // ── Grace, differensiert etter årsak ────────────────────────────────
      // Samme overgangsvakt som varslingen under, og det er ikke tilfeldig:
      // én reell låsing kommer typisk som past_due → unpaid → canceled →
      // deleted. Uten vakten ville hver av dem forlenget grace med nye 7
      // dager, og perioden aldri tatt slutt.
      const isLockTransition = shouldNotifyMembersOfLock(org.subscription_status, 'locked')
      const graceDecision = decideLockGrace({
        previousOrgStatus: org.subscription_status,
        stripeStatus: subscription.status,
        cancellationReason: subscription.cancellation_details?.reason ?? null,
        // Auto-kanselleringsfakta — et trial-utløp merkes 'cancellation_requested'
        // av Stripe selv, og skal gi grace, ikke voluntary_cancel.
        canceledAt: subscription.canceled_at ?? null,
        trialEnd: subscription.trial_end ?? null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? null,
        cancelAt: subscription.cancel_at ?? null,
      })
      let graceUntil: string | null = null
      if (isLockTransition) {
        graceUntil = await applyLockGrace(org.id, graceDecision, `sub.deleted org=${org.id}`)
      }

      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', org.id)

      const memberIds = (members ?? []).map(m => m.user_id)
      if (memberIds.length > 0) {
        // Rekalkuler i stedet for å slå av blindt: et medlem kan ha egen
        // verdikode eller eget abonnement som fortsatt dekker dem — og etter
        // skrivingen over også en levende grace på selve org-en.
        await recomputePremium(memberIds, `sub.deleted org=${org.id}`, stripe)
      }

      // Varsle de ANSATTE (ikke admin — admin får orgCancelledEmail under).
      // Kun på selve overgangen inn i låst tilstand, se shouldNotifyMembersOfLock.
      // Awaitet, ikke fire-and-forget: sendingen er flere rundturer
      // (listUsers + e-postbatcher), og et serverless-miljø kan fryse
      // instansen straks responsen er sendt. Funksjonen kaster aldri, så den
      // kan ikke velte den betalingskritiske grenen.
      if (isLockTransition) {
        await notifyMembersOfOrgLock(org.id, org.name, 'sub.deleted', graceUntil)
      }

      // ── Riktig tekst til admin, etter hva som FAKTISK skjedde ────────────
      // En trial som bare rant ut fikk fram til nå «Bedriftsabonnementet er
      // avsluttet» — en oppsigelsesbekreftelse for noe de aldri kjøpte, uten
      // det ene som faktisk gjaldt: at kortet mangler.
      //
      // Klassifiseringen hentes fersk når VI nettopp gjorde den, ellers fra den
      // lagrede — låse-sekvensen er typisk `updated (canceled)` først og
      // `deleted` etterpå, og da eier den forrige hendelsen klassifiseringen.
      const lockReason = isLockTransition
        ? (graceDecision.grace ? graceDecision.reason : 'voluntary_cancel')
        : await readStoredGraceReason(org.id)
      const isTrialExpiry = lockReason === 'trial_expired'

      console.log(
        `[webhook] sub.deleted admin-varsel org=${org.id} — årsak=${lockReason ?? 'ukjent'} → ` +
        `${isTrialExpiry ? 'orgTrialEndedEmail' : 'orgCancelledEmail'}`
      )

      // Send varsel til ALLE org-admins — fire-and-forget
      getOrgAdminEmails(org.id)
        .then(({ emails, orgName, orgSlug }) => {
          if (emails.length > 0 && orgName && isTrialExpiry && orgSlug) {
            return sendToOrgAdmins(
              emails,
              {
                subject: `Prøveperioden for ${orgName} er over — Quizkanonen`,
                html: orgTrialEndedEmail(orgName, orgSlug),
              },
              `webhook orgTrialEndedEmail org=${org.id}`,
            )
          }
          if (emails.length > 0 && orgName) {
            // Reell kansellering, betalingsfeil — eller en trial-utløp der vi
            // manglet slug til CTA-en. Uendret tekst.
            return sendToOrgAdmins(
              emails,
              {
                subject: `Bedriftsabonnementet er avsluttet — Quizkanonen`,
                html: orgCancelledEmail(orgName),
              },
              `webhook orgCancelledEmail org=${org.id}`,
            )
          }
        })
        .catch(err => console.error('[webhook] orgCancelledEmail failed:', err))
    } else if (!org) {
      // B2C — kun når ingen org matcher kunden. (En org med stale sub faller
      // bevisst hverken hit eller i org-grenen — den ignoreres.)
      // Match primært på stripe_customer_id, sekundært på personal_stripe_subscription_id
      const subscriptionId = subscription.id
      let profileId: string | null = null
      let isCurrentPersonalSub = true

      const { data: profileByCustomer } = await supabaseAdmin
        .from('profiles')
        .select('id, personal_stripe_subscription_id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle()

      if (profileByCustomer) {
        profileId = profileByCustomer.id
        // FIX 3 — speiler isCurrentOrgSub over: en sen deleted-hendelse for et
        // gammelt abonnement (f.eks. erstattet etter en duplikat-opprydding) skal
        // ikke slå av Premium på en profil som nå kjører på et nyere abonnement.
        //
        // HULL 1 (28. juli 2026): vakten falt tidligere tilbake til «gjeldende»
        // når feltet var NULL. NULL er tvetydig — det settes også når en
        // TIDLIGERE terminal hendelse i samme kanselleringssekvens nullet det
        // (subscription.updated → canceled nuller feltet før deleted ankommer).
        // Er feltet NULL, spør vi derfor Stripe om kunden har et annet levende
        // abonnement; har de det, er denne hendelsen for et forbigått abonnement.
        const storedSubId = profileByCustomer.personal_stripe_subscription_id ?? null
        const liveSubIds = storedSubId ? null : await getLiveSubscriptionIds(stripe, customerId)
        isCurrentPersonalSub = !isStaleSubscriptionEvent({
          storedSubId,
          eventSubId: subscriptionId,
          liveSubIds,
        })
      } else {
        const { data: profileBySub } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('personal_stripe_subscription_id', subscriptionId)
          .maybeSingle()
        if (profileBySub) profileId = profileBySub.id
      }

      if (profileId && !isCurrentPersonalSub) {
        console.log(
          `[webhook] subscription.deleted ignorert for profile ${profileId} — stale sub ` +
          `${subscriptionId}, gjeldende er annerledes`
        )
      } else if (profileId) {
        // Abonnements-id-en ryddes, men Premium rekalkuleres — brukeren kan ha
        // en aktiv verdikode eller org-dekning som overlever kanselleringen.
        const { error: b2cDeleteError } = await supabaseAdmin.from('profiles')
          .update({ personal_stripe_subscription_id: null })
          .eq('id', profileId)
        assertCriticalWrite(b2cDeleteError, `sub.deleted B2C rydding profile=${profileId}`)
        await recomputePremium([profileId], `sub.deleted B2C profile=${profileId}`, stripe)
      } else {
        console.error(`[webhook] subscription.deleted: no profile found for customer=${customerId}, sub=${subscriptionId}`)
      }

      // Send kanselleringsbekreftelse — fire-and-forget. Kun ved faktisk
      // deaktivering: en stale sub skal ikke gi brukeren en feilaktig
      // "abonnementet er avsluttet"-e-post (dette er nøyaktig hendelsen som
      // skjedde 19. juli for en bruker med duplikat Founders-abonnement).
      //
      // HULL 2 (28. juli 2026): e-posten ble tidligere sendt uansett grunn.
      // En kortløs Founders-trial som bare løp ut fikk dermed «Premium-
      // abonnementet ditt er avsluttet» om et abonnement de aldri betalte for
      // — og de hadde allerede fått «Prøveperioden din er over» fra
      // invoice.payment_failed i samme sekvens. Samme skille som den grenen
      // allerede gjorde (listPaymentMethods) brukes nå her.
      if (profileId && isCurrentPersonalSub) {
        const cancellationReason = subscription.cancellation_details?.reason ?? null
        const hasPaymentMethod = await customerHasPaymentMethod(stripe, customerId)

        // Auto-kanselleringsfakta (11. august 2026): Stripe merker sitt eget
        // trial-utløp under end_behavior 'cancel' som 'cancellation_requested',
        // så reason alene kan ikke bære e-postbeslutningen. Se isTrialAutoCancel.
        if (!shouldSendCancellationEmail({
          cancellationReason,
          hasPaymentMethod,
          canceledAt: subscription.canceled_at ?? null,
          trialEnd: subscription.trial_end ?? null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end ?? null,
          cancelAt: subscription.cancel_at ?? null,
        })) {
          console.log(
            `[webhook] subscription.deleted → premiumCancelledEmail UNDERTRYKT for profile ` +
            `${profileId}: ingen betalingsmetode og grunn=${cancellationReason ?? 'ukjent'} ` +
            `(kortløs trial som løp ut — under end_behavior 'create_invoice' er brukeren ` +
            `allerede varslet av invoice.payment_failed; under 'cancel' finnes ingen faktura ` +
            `og trial-utløpet varsles separat). customer=${customerId} sub=${subscriptionId}`
          )
        } else {
          getUserEmail(stripe, customerId)
            .then(email => {
              if (email) {
                return sendEmail({
                  to: email,
                  subject: 'Premium-abonnementet ditt er avsluttet — Quizkanonen',
                  html: premiumCancelledEmail(),
                })
              }
            })
            .catch(err => console.error('[webhook] premiumCancelledEmail failed:', err))
        }
      }
    }
  }

  // ── invoice.payment_failed ────────────────────────────────────────────
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    const customerId = invoice.customer as string

    const { data: orgForFailed } = await supabaseAdmin
      .from('organizations')
      .select('id, name, slug')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    if (orgForFailed) {
      // B2B — varsle ALLE org-admins
      getOrgAdminEmails(orgForFailed.id)
        .then(({ emails, orgName, orgSlug }) => {
          if (emails.length > 0 && orgName && orgSlug) {
            return sendToOrgAdmins(
              emails,
              {
                subject: 'Betalingen feilet — Quizkanonen for bedrifter',
                html: orgPaymentFailedEmail(orgName, orgSlug),
              },
              `webhook orgPaymentFailedEmail org=${orgForFailed.id}`,
            )
          }
        })
        .catch(err => console.error('[webhook] orgPaymentFailedEmail failed:', err))
    } else {
      // B2C — varsle bruker, men KUN hvis de ikke allerede har aktiv Premium via en
      // annen kilde (org-medlemskap). Har brukeren org-Premium, mister de ingenting
      // reelt om det personlige abonnementet feiler, og e-posten er bare forvirrende.
      const { data: profileForFailed } = await supabaseAdmin
        .from('profiles')
        .select('id, personal_stripe_subscription_id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle()

      // subscription-id ligger på ulike felt før/etter dahlia-API-endringen — prøv begge.
      // Utledes FØR e-postbeslutningen fordi stale-sub-sjekken under trenger den.
      const inv = invoice as unknown as {
        subscription?: string | null
        parent?: { subscription_details?: { subscription?: string | null } | null } | null
      }
      const subscriptionId = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null

      // ── Stale-sub-vern (samme rotårsak som FIX 3 i subscription.deleted) ────
      // Ruten matchet tidligere KUN på stripe_customer_id. En sen purring på et
      // gammelt, erstattet abonnement ga da «Betalingen feilet»-e-post til en bruker
      // hvis gjeldende abonnement er helt friskt — nøyaktig samme misvisende e-post
      // som duplikat-Founders-saken 19. juli, bare via en annen hendelsestype.
      //
      // Klarte vi ikke å lese subscription-id fra fakturaen, undertrykker vi
      // heller ikke e-posten — da er det bedre å varsle enn å tie om en ekte
      // betalingsfeil.
      //
      // HULL 1 (28. juli 2026): samme NULL-tvetydighet som i
      // subscription.deleted. Er feltet nullet av en tidligere terminal
      // hendelse, sa vakten «gjeldende» og slapp gjennom en purring på et
      // forbigått abonnement. Stripe-oppslaget under skiller de to.
      const personalSubId = profileForFailed?.personal_stripe_subscription_id ?? null
      const liveSubIdsForFailed = (profileForFailed && !personalSubId && subscriptionId)
        ? await getLiveSubscriptionIds(stripe, customerId)
        : null
      const isCurrentPersonalSub = !isStaleSubscriptionEvent({
        storedSubId: personalSubId,
        eventSubId: subscriptionId,
        liveSubIds: liveSubIdsForFailed,
      })

      // ── Deduplisering av varsel-e-post ──────────────────────────────────────
      // Stripe purrer den samme fakturaen flere ganger (smart retries, typisk 3-4
      // forsøk over ~2 uker). HVER purring gir et nytt invoice.payment_failed-event
      // med samme faktura-id, og uten denne sperren sendte vi én e-post per purring
      // — Resend-loggen viste 2-4 identiske kopier per mottaker.
      //
      // attempt_count teller faktureringsforsøk på SAMME faktura og er 1 ved første
      // feil. Vi varsler derfor kun på første forsøk. Det dedupliserer per
      // faktureringssyklus uten lagring: en ny feil neste måned er en ny faktura med
      // attempt_count = 1 og varsles på nytt, som den skal.
      //
      // Sperren ligger FØR Stripe-oppslagene under, så en purring koster heller ingen
      // API-kall. Den gjelder begge e-postvariantene (kortløs og ekte betalingsfeil).
      const attemptCount = (invoice as unknown as { attempt_count?: number }).attempt_count ?? 1

      if (attemptCount > 1) {
        console.log(
          `[webhook] invoice.payment_failed — e-post hoppet over: purring #${attemptCount} ` +
          `på faktura ${invoice.id}, varsel allerede sendt ved første forsøk`
        )
      } else if (profileForFailed && !isCurrentPersonalSub) {
        console.log(
          `[webhook] invoice.payment_failed — e-post hoppet over for profile ` +
          `${profileForFailed.id}: stale sub ${subscriptionId}, gjeldende er ${personalSubId}`
        )
      } else if (profileForFailed && await hasActiveOrgPremium(profileForFailed.id)) {
        console.log(
          `[webhook] paymentFailedEmail hoppet over — bruker ${profileForFailed.id} ` +
          `har aktiv Premium via org`
        )
      } else {
        // Skill kortløse Founders-konverteringer fra ekte betalingsfeil.
        // Founders-trials opprettes uten betalingsmetode (save_default_payment_method:'off').
        // Når trialen konverterer til 'active', forsøker Stripe å fakturere uten kort →
        // invoice.payment_failed. Det er ikke en «ekte» betalingsfeil for en bruker som
        // aldri ble bedt om kort — da sender vi en vennlig «prøveperioden er over»-e-post.

        // Best-effort: hent subscription-objektet for kontekst/logging (status).
        let subStatus = 'ukjent'
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId)
            subStatus = sub.status
          } catch (err) {
            console.error('[webhook] kunne ikke hente subscription', subscriptionId, err)
          }
        }

        // Avgjørende signal: har kunden NOEN betalingsmetode registrert?
        // Delt helper med subscription.deleted-grenen (samme skille, samme
        // fail-safe: null ⇒ behandles som ekte feil).
        const hasPaymentMethod = (await customerHasPaymentMethod(stripe, customerId)) !== false

        const email = await getUserEmail(stripe, customerId)

        if (!hasPaymentMethod) {
          console.log(
            `[webhook] invoice.payment_failed → KORTLØS Founders-konvertering (ingen ` +
            `betalingsmetode) customer=${customerId} sub=${subscriptionId ?? 'ukjent'} ` +
            `status=${subStatus} → trialEndedNoCardEmail`
          )
          if (email) {
            sendEmail({
              to: email,
              subject: 'Prøveperioden din er over — vil du fortsette? — Quizkanonen',
              html: trialEndedNoCardEmail(),
            }).catch(err => console.error('[webhook] trialEndedNoCardEmail failed:', err))
          }
        } else {
          console.log(
            `[webhook] invoice.payment_failed → EKTE betalingsfeil (kort avvist) ` +
            `customer=${customerId} sub=${subscriptionId ?? 'ukjent'} status=${subStatus} → paymentFailedEmail`
          )
          if (email) {
            sendEmail({
              to: email,
              subject: 'Betalingen feilet — Quizkanonen Premium',
              html: paymentFailedEmail(),
            }).catch(err => console.error('[webhook] paymentFailedEmail failed:', err))
          }
        }
      }
    }
  }

  // ── customer.subscription.updated ─────────────────────────────────────
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = subscription.customer as string

    // ── Abonnementet har gjenopptatt fakturering etter en kode-pause ──────────
    // Stripe fjerner pause_collection av seg selv ved resumes_at. Vi kjenner
    // igjen nøyaktig det øyeblikket på previous_attributes: pause var satt, nå
    // er den borte. Kunden fikk beskjed da pausen ble satt, og skal få beskjed
    // når trekket starter igjen — ingen skal oppdage det først på kontoutskriften.
    const previous = event.data.previous_attributes as { pause_collection?: unknown } | undefined
    const wasPaused = previous !== undefined && 'pause_collection' in previous && !!previous.pause_collection
    if (wasPaused && !subscription.pause_collection) {
      getUserEmail(stripe, customerId)
        .then(email => {
          if (email) {
            return sendEmail({
              to: email,
              subject: 'Abonnementet ditt er i gang igjen — Quizkanonen',
              html: subscriptionResumedEmail(),
            })
          }
        })
        .catch(err => console.error('[webhook] subscriptionResumedEmail failed:', err))
    }

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, slug, stripe_subscription_id, subscription_status')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    // ── Stale-vakt for org-grenen (29. juli 2026) ────────────────────────
    // Speiler isCurrentOrgSub i subscription.deleted, men med et kryssjekk i
    // stedet for ren id-likhet — se decideOrgSubscriptionEvent for hvorfor.
    // Vakten dekker HELE org-grenen, ikke bare låsen: en stale hendelse med
    // status active/trialing ville ellers skrevet feil stripe_period_end og
    // feil plan (via price_id-mappingen) fra et forbigått abonnement.
    let orgVerdict: OrgSubEventVerdict = 'process'
    if (org) {
      const storedSubId = org.stripe_subscription_id ?? null
      const liveSubIds = needsLiveSubscriptionLookup(storedSubId, subscription.id)
        ? await getLiveSubscriptionIds(stripe, customerId)
        : null
      orgVerdict = decideOrgSubscriptionEvent({
        storedSubId,
        eventSubId: subscription.id,
        liveSubIds,
      })
    }

    if (org && orgVerdict === 'ignore') {
      console.log(
        `[webhook] subscription.updated ignorert for org ${org.id} — stale sub ${subscription.id}, ` +
        `gjeldende er ${org.stripe_subscription_id ?? 'null'} og lever fortsatt hos Stripe`
      )
    } else if (org) {
      // B2B: oppdater periode-slutt + speil betalingsstatus til subscription_status.
      // Speiler B2C Founders-håndteringen — vi stoler ikke på Stripe-tilstanden alene,
      // men setter eksplisitt 'active'/'trialing'/'locked' og synker premium for medlemmer.
      // current_period_end er null/undefined for trialing-abonnementer i dahlia-
      // APIet → undefined * 1000 = NaN → new Date(NaN).toISOString() kaster.
      // Bruk trial_end som fallback; finnes ingen gyldig epoch, hopp over
      // stripe_period_end (oppdater kun status) i stedet for å kaste.
      const subForPeriod = subscription as unknown as { current_period_end: number | null; trial_end: number | null }
      const endEpoch = typeof subForPeriod.current_period_end === 'number'
        ? subForPeriod.current_period_end
        : typeof subForPeriod.trial_end === 'number'
          ? subForPeriod.trial_end
          : null
      const periodEnd = endEpoch !== null ? new Date(endEpoch * 1000).toISOString() : null

      const status = subscription.status
      let nextStatus: 'trialing' | 'active' | 'locked' | null = null
      if (status === 'trialing') nextStatus = 'trialing'
      else if (status === 'active') nextStatus = 'active'
      else if (['past_due', 'unpaid', 'canceled', 'incomplete_expired'].includes(status)) nextStatus = 'locked'

      // ── Plan-synk (sikkerhetsnett, 29. juli 2026) ───────────────────────────
      // `organizations.plan` ble fram til nå KUN skrevet ved opprettelse.
      // Endret noen prisen på abonnementet et annet sted enn vår egen
      // change-plan-rute — typisk direkte i Stripe-dashbordet — ble kolonnen
      // stående feil for alltid. Det ga feil MRR i admin-dashbordet, feil
      // gating av ukesrapporten (plan === 'standard'), og feil medlemsgrense
      // for kunden. Ukjente priser gir null og rører ikke kolonnen, slik at en
      // pris vi ikke kjenner igjen aldri overskriver en plan vi vet er riktig.
      const subPriceId = subscription.items?.data?.[0]?.price?.id ?? null
      const mappedPlan = planFromPriceId(subPriceId)

      const { error: orgUpdError } = await supabaseAdmin.from('organizations')
        .update({
          ...(periodEnd ? { stripe_period_end: periodEnd } : {}),
          ...(nextStatus ? { subscription_status: nextStatus } : {}),
          ...(mappedPlan ? { plan: mappedPlan } : {}),
          // Adopsjon: det lagrede abonnementet er dødt, og dette er org-ens
          // reelle gjeldende. Uten denne skrivingen ville pekeren blitt
          // stående feil, og et framtidig `deleted` for det nye abonnementet
          // hadde blitt avvist av isCurrentOrgSub-vakten.
          ...(orgVerdict === 'adopt' ? { stripe_subscription_id: subscription.id } : {}),
        })
        .eq('id', org.id)
      assertCriticalWrite(orgUpdError, `sub.updated org-status org=${org.id}`)

      // Org-en er frisk igjen. Gatet på at den FAKTISK sto som låst: denne
      // hendelsestypen fyrer for alt mulig på et aktivt abonnement, og en
      // ubetinget rydding ville kostet en skriving hver gang uten å endre noe.
      if (org.subscription_status === 'locked' && (nextStatus === 'active' || nextStatus === 'trialing')) {
        await clearLockGrace(org.id, `sub.updated ${status}`)
      }

      // Synk premium for alle medlemmer ved overgang til aktiv eller låst tilstand.
      if (nextStatus === 'active' || nextStatus === 'trialing' || nextStatus === 'locked') {
        const { data: members } = await supabaseAdmin
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', org.id)
        const memberIds = (members ?? []).map(m => m.user_id)
        if (memberIds.length > 0) {
          if (nextStatus === 'locked') {
            // `org.subscription_status` er snapshotet fra SELECT-en over, altså
            // statusen FØR denne hendelsen skrev 'locked' — så past_due →
            // unpaid → canceled gir én e-post og ÉN grace-periode, ikke tre.
            const isLockTransition = shouldNotifyMembersOfLock(org.subscription_status, 'locked')
            let graceUntil: string | null = null
            if (isLockTransition) {
              graceUntil = await applyLockGrace(
                org.id,
                decideLockGrace({
                  previousOrgStatus: org.subscription_status,
                  stripeStatus: status,
                  cancellationReason: subscription.cancellation_details?.reason ?? null,
                  // Samme auto-kanselleringsfakta som i deleted-grenen.
                  canceledAt: subscription.canceled_at ?? null,
                  trialEnd: subscription.trial_end ?? null,
                  cancelAtPeriodEnd: subscription.cancel_at_period_end ?? null,
                  cancelAt: subscription.cancel_at ?? null,
                }),
                `sub.updated ${status} org=${org.id}`,
              )
            }

            // Rekalkuler per medlem: org-dekningen faller bort, men en egen
            // verdikode, et eget abonnement — eller grace-stempelet over —
            // skal ikke ryke med den.
            await recomputePremium(memberIds, `sub.updated locked org=${org.id}`, stripe)

            if (isLockTransition) {
              await notifyMembersOfOrgLock(org.id, org.name, `sub.updated ${status}`, graceUntil)
            }
          } else {
            const { error: memberActivateErr } = await supabaseAdmin.from('profiles')
              .update({ premium_status: true, premium_source: 'org' })
              .in('id', memberIds)
            assertCriticalWrite(memberActivateErr, `sub.updated medlems-premium-aktivering org=${org.id}`)
          }
        }
      }

      // Varsle org-admin(s) om en betalings-lås. Fram til nå fikk admin KUN
      // beskjed fra subscription.deleted-grenen — en org som ble låst på
      // past_due/unpaid mistet tilgangen for alle ansatte uten at noen som
      // kunne rette opp i det ble fortalt at det hadde skjedd.
      // Teksten er bevisst ikke orgCancelledEmail, se orgAccessLockedEmail.
      if (shouldNotifyAdminsOfDunningLock(org.subscription_status, status)) {
        const { emails, orgName, orgSlug } = await getOrgAdminEmails(org.id)
        if (emails.length > 0 && orgName && orgSlug) {
          await sendToOrgAdmins(
            emails,
            {
              subject: `Bedriftstilgangen er satt på pause — ${orgName}`,
              html: orgAccessLockedEmail(orgName, orgSlug),
            },
            `webhook orgAccessLockedEmail org=${org.id} status=${status}`,
          )
        } else {
          console.error(
            `[webhook] orgAccessLockedEmail SKIPPED — ingen admin-mottakere eller manglende org-felt. ` +
            `org=${org.id}, orgName=${orgName ?? 'null'}, orgSlug=${orgSlug ?? 'null'}`
          )
        }
      }
    } else {
      // B2C — 'trialing' counts as active (Founders trial period)
      const isActive = ['active', 'trialing'].includes(subscription.status)

      if (isActive) {
        // Active/trialing: skriv stripe_customer_id alltid, ikke bare premium_status
        const { data: updatedRows, error: b2cActivateError } = await supabaseAdmin.from('profiles')
          .update({ premium_status: true, stripe_customer_id: customerId })
          .eq('stripe_customer_id', customerId)
          .select('id')
        assertCriticalWrite(b2cActivateError, `sub.updated B2C premium-aktivering customer=${customerId}`)

        // Fallback: profilen mangler stripe_customer_id (f.eks. checkout-event sviktet)
        if (!updatedRows?.length) {
          const { error: b2cFallbackError } = await supabaseAdmin.from('profiles')
            .update({ premium_status: true, stripe_customer_id: customerId })
            .eq('personal_stripe_subscription_id', subscription.id)
          assertCriticalWrite(b2cFallbackError, `sub.updated B2C premium-aktivering (fallback) sub=${subscription.id}`)
        }
      } else {
        // Canceled: match primært på stripe_customer_id, sekundært på personal_stripe_subscription_id
        const subscriptionId = subscription.id
        let profileId: string | null = null
        let isCurrentPersonalSub = true

        const { data: profileByCustomer } = await supabaseAdmin
          .from('profiles')
          .select('id, personal_stripe_subscription_id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle()

        if (profileByCustomer) {
          profileId = profileByCustomer.id
          // FIX 3 — samme stale-sub-vern som subscription.deleted over, inkludert
          // HULL 1-fiksen for NULL-tvetydigheten (28. juli 2026). Denne grenen
          // sender ingen e-post, men nuller feltet og rekalkulerer premium — en
          // sen canceled-hendelse for et forbigått abonnement skulle ikke gjort
          // noen av delene.
          const storedSubId = profileByCustomer.personal_stripe_subscription_id ?? null
          const liveSubIds = storedSubId ? null : await getLiveSubscriptionIds(stripe, customerId)
          isCurrentPersonalSub = !isStaleSubscriptionEvent({
            storedSubId,
            eventSubId: subscriptionId,
            liveSubIds,
          })
        } else {
          const { data: profileBySub } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('personal_stripe_subscription_id', subscriptionId)
            .maybeSingle()
          if (profileBySub) profileId = profileBySub.id
        }

        if (profileId && !isCurrentPersonalSub) {
          console.log(
            `[webhook] subscription.updated (canceled) ignorert for profile ${profileId} — ` +
            `stale sub ${subscriptionId}, gjeldende er annerledes`
          )
        } else if (profileId) {
          const { error: b2cCancelError } = await supabaseAdmin.from('profiles')
            .update({ personal_stripe_subscription_id: null })
            .eq('id', profileId)
          assertCriticalWrite(b2cCancelError, `sub.updated B2C rydding profile=${profileId}`)
          await recomputePremium([profileId], `sub.updated canceled profile=${profileId}`, stripe)
        } else {
          console.error(`[webhook] subscription.updated canceled: no profile found for customer=${customerId}, sub=${subscriptionId}`)
        }
      }
    }
  }

  // ── charge.refunded ───────────────────────────────────────────────────
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge
    const customerId = charge.customer as string | null

    // Kun full refusjon fjerner premium — delvis refusjon endrer ingenting.
    // Dette er en legitim «ingenting å gjøre»-sti, ikke en feil, men stempelet
    // frigis likevel: en reprosessering er like harmløs, og da kan ingen fremtidig
    // logikk i denne grenen bli stille blokkert av et stempel fra i dag.
    if (charge.amount_refunded !== charge.amount) {
      await releaseIdempotencyStamp(event.id)
      return NextResponse.json({ received: true })
    }

    if (!customerId) {
      console.error(
        `[webhook] charge.refunded: full refusjon UTEN customer — premium ikke fjernet. ` +
        `charge=${charge.id} amount_refunded=${charge.amount_refunded}. Må sjekkes manuelt.`
      )
      await releaseIdempotencyStamp(event.id)
      return NextResponse.json({ received: true })
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    if (profile) {
      // premium_since nullstilles, men selve Premium-flagget rekalkuleres: en
      // refusjon av abonnementet fjerner ikke en aktiv verdikode eller
      // org-dekning. Dette var også vinduet der en refundert kunde med levende
      // abonnement kunne løse inn en kode og deretter miste alt.
      const { error: refundError } = await supabaseAdmin.from('profiles')
        .update({ premium_since: null })
        .eq('id', profile.id)
      assertCriticalWrite(refundError, `charge.refunded rydding profile=${profile.id}`)
      await recomputePremium([profile.id], `charge.refunded profile=${profile.id}`, stripe)
    } else {
      console.error(`[webhook] charge.refunded: no profile found for customer=${customerId}, charge=${charge.id}`)
    }
  }

  return NextResponse.json({ received: true })
  } catch (err) {
    // Rull tilbake idempotens-stemplet så Stripe sin neste retry kan prosessere
    // hendelsen på nytt i stedet for å bli avvist som duplikat (23505).
    console.error('[webhook] prosesseringsfeil — fjerner idempotens-stempel for', event.id, err)
    await releaseIdempotencyStamp(event.id)
    return NextResponse.json({ error: 'Webhook-prosessering feilet' }, { status: 500 })
  }
}
