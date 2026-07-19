import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { premiumWelcomeEmail, premiumRenewalEmail, premiumCancelledEmail, orgPurchaseEmail, orgCancelledEmail, orgRenewalEmail, paymentFailedEmail, orgPaymentFailedEmail, trialEndedNoCardEmail } from '@/lib/email-templates'
import { hasActiveOrgPremium } from '@/lib/org-premium'

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

async function getUserEmail(stripe: Stripe, customerId: string): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (!customer.deleted && (customer as Stripe.Customer).email) {
      return (customer as Stripe.Customer).email
    }
  } catch {}
  return null
}

async function getOrgAdminEmail(organizationId: string): Promise<{ email: string | null; orgName: string | null; orgSlug: string | null }> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, slug')
    .eq('id', organizationId)
    .maybeSingle()

  const { data: adminMember } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()

  if (!adminMember) return { email: null, orgName: org?.name ?? null, orgSlug: org?.slug ?? null }

  const { data } = await supabaseAdmin.auth.admin.getUserById(adminMember.user_id)
  return { email: data.user?.email ?? null, orgName: org?.name ?? null, orgSlug: org?.slug ?? null }
}

// Sender kjøpsbekreftelse til org-admin. Tåler race condition der admin-medlemsraden
// ikke er ferdig committet når webhooket ankommer (Dennis sin Elkjøp-betaling 19.6):
// ett ekstra forsøk etter kort pause. Hopper aldri over stille — manglende felt logges
// eksplisitt med [webhook] orgPurchaseEmail SKIPPED slik at det er søkbart i Vercel.
async function sendOrgPurchaseConfirmation(organizationId: string): Promise<void> {
  let info = await getOrgAdminEmail(organizationId)

  if (!info.email) {
    // Mulig race: org-checkout-skrivingen er ikke committet ennå. Vent og prøv én gang til.
    await new Promise(r => setTimeout(r, 1500))
    info = await getOrgAdminEmail(organizationId)
  }

  const { email, orgName, orgSlug } = info
  if (!email || !orgName || !orgSlug) {
    const missing = [
      !email && 'email',
      !orgName && 'orgName',
      !orgSlug && 'orgSlug',
    ].filter(Boolean).join(', ')
    console.error(
      `[webhook] orgPurchaseEmail SKIPPED — manglende felt: ${missing}. ` +
      `organization_id=${organizationId}, orgName=${orgName ?? 'null'}, orgSlug=${orgSlug ?? 'null'}`
    )
    return
  }

  try {
    await sendEmail({
      to: email,
      subject: `Velkommen til Quizkanonen for bedrifter — ${orgName}`,
      html: orgPurchaseEmail(orgName, orgSlug),
    })
  } catch (err) {
    console.error('[webhook] orgPurchaseEmail failed:', err)
  }
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
      if (!organizationId) return NextResponse.json({ received: true })

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
      if (!userId) return NextResponse.json({ error: 'Mangler userId' }, { status: 400 })

      // Bruk upsert — oppretter profiles-rad hvis den mangler (f.eks. bruker betalte
      // før navn-modal ble fullført), ellers oppdaterer eksisterende rad som normalt.
      const { error: profileUpsertError } = await supabaseAdmin.from('profiles').upsert({
        id: userId,
        premium_status: true,
        premium_since: new Date().toISOString(),
        stripe_customer_id: session.customer as string ?? null,
        premium_source: 'personal',
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

        // send fornyelsesbekreftelse til org-admin
        getOrgAdminEmail(orgForInvoice.id)
          .then(({ email, orgName, orgSlug }) => {
            if (email && orgName && orgSlug) {
              return sendEmail({
                to: email,
                subject: `Bedriftsabonnementet er fornyet — Quizkanonen`,
                html: orgRenewalEmail(orgName, orgSlug),
              })
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
      .select('id, name, slug, stripe_subscription_id')
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

      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', org.id)

      const memberIds = (members ?? []).map(m => m.user_id)
      if (memberIds.length > 0) {
        const { error: memberLockError } = await supabaseAdmin.from('profiles').update({
          premium_status: false,
          premium_source: null,
        }).in('id', memberIds)
        assertCriticalWrite(memberLockError, `sub.deleted medlems-premium-fjerning org=${org.id}`)
      }

      // Send kanselleringsvarsel til org-admin — fire-and-forget
      getOrgAdminEmail(org.id)
        .then(({ email, orgName }) => {
          if (email && orgName) {
            return sendEmail({
              to: email,
              subject: `Bedriftsabonnementet er avsluttet — Quizkanonen`,
              html: orgCancelledEmail(orgName),
            })
          }
        })
        .catch(err => console.error('[webhook] orgCancelledEmail failed:', err))
    } else if (!org) {
      // B2C — kun når ingen org matcher kunden. (En org med stale sub faller
      // bevisst hverken hit eller i org-grenen — den ignoreres.)
      // Match primært på stripe_customer_id, sekundært på personal_stripe_subscription_id
      const subscriptionId = subscription.id
      let profileId: string | null = null

      const { data: profileByCustomer } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle()

      if (profileByCustomer) {
        profileId = profileByCustomer.id
      } else {
        const { data: profileBySub } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('personal_stripe_subscription_id', subscriptionId)
          .maybeSingle()
        if (profileBySub) profileId = profileBySub.id
      }

      if (profileId) {
        const { error: b2cDeleteError } = await supabaseAdmin.from('profiles')
          .update({ premium_status: false, premium_source: null, personal_stripe_subscription_id: null })
          .eq('id', profileId)
        assertCriticalWrite(b2cDeleteError, `sub.deleted B2C premium-fjerning profile=${profileId}`)
      } else {
        console.error(`[webhook] subscription.deleted: no profile found for customer=${customerId}, sub=${subscriptionId}`)
      }

      // Send kanselleringsbekreftelse — fire-and-forget
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
      // B2B — varsle org-admin
      getOrgAdminEmail(orgForFailed.id)
        .then(({ email, orgName, orgSlug }) => {
          if (email && orgName && orgSlug) {
            return sendEmail({
              to: email,
              subject: 'Betalingen feilet — Quizkanonen for bedrifter',
              html: orgPaymentFailedEmail(orgName, orgSlug),
            })
          }
        })
        .catch(err => console.error('[webhook] orgPaymentFailedEmail failed:', err))
    } else {
      // B2C — varsle bruker, men KUN hvis de ikke allerede har aktiv Premium via en
      // annen kilde (org-medlemskap). Har brukeren org-Premium, mister de ingenting
      // reelt om det personlige abonnementet feiler, og e-posten er bare forvirrende.
      const { data: profileForFailed } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle()

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

        // subscription-id ligger på ulike felt før/etter dahlia-API-endringen — prøv begge.
        const inv = invoice as unknown as {
          subscription?: string | null
          parent?: { subscription_details?: { subscription?: string | null } | null } | null
        }
        const subscriptionId = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null

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

        // Avgjørende signal: har kunden NOEN betalingsmetode registrert? Vi lister
        // faktisk vedheftede betalingsmetoder i stedet for å stole på default_payment_method
        // alene — et avvist kort forblir vedheftet (ekte feil ⇒ ≥1 metode), mens en
        // Founders-bruker aldri har lagt inn kort (0 metoder). default_payment_method kan
        // dessuten være null selv når et kort finnes, så den er mindre pålitelig her.
        let hasPaymentMethod = true // fail-safe: ved usikkerhet, behandle som ekte feil
        try {
          const pms = await stripe.customers.listPaymentMethods(customerId, { limit: 1 })
          hasPaymentMethod = pms.data.length > 0
        } catch (err) {
          console.error('[webhook] kunne ikke hente betalingsmetoder for', customerId, '— behandler som ekte feil:', err)
        }

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

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    if (org) {
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

      const { error: orgUpdError } = await supabaseAdmin.from('organizations')
        .update({ ...(periodEnd ? { stripe_period_end: periodEnd } : {}), ...(nextStatus ? { subscription_status: nextStatus } : {}) })
        .eq('id', org.id)
      assertCriticalWrite(orgUpdError, `sub.updated org-status org=${org.id}`)

      // Synk premium for alle medlemmer ved overgang til aktiv eller låst tilstand.
      if (nextStatus === 'active' || nextStatus === 'trialing' || nextStatus === 'locked') {
        const { data: members } = await supabaseAdmin
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', org.id)
        const memberIds = (members ?? []).map(m => m.user_id)
        if (memberIds.length > 0) {
          if (nextStatus === 'locked') {
            const { error: memberLockErr } = await supabaseAdmin.from('profiles')
              .update({ premium_status: false, premium_source: null })
              .in('id', memberIds)
            assertCriticalWrite(memberLockErr, `sub.updated medlems-premium-fjerning org=${org.id}`)
          } else {
            const { error: memberActivateErr } = await supabaseAdmin.from('profiles')
              .update({ premium_status: true, premium_source: 'org' })
              .in('id', memberIds)
            assertCriticalWrite(memberActivateErr, `sub.updated medlems-premium-aktivering org=${org.id}`)
          }
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

        const { data: profileByCustomer } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle()

        if (profileByCustomer) {
          profileId = profileByCustomer.id
        } else {
          const { data: profileBySub } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('personal_stripe_subscription_id', subscriptionId)
            .maybeSingle()
          if (profileBySub) profileId = profileBySub.id
        }

        if (profileId) {
          const { error: b2cCancelError } = await supabaseAdmin.from('profiles')
            .update({ premium_status: false, personal_stripe_subscription_id: null })
            .eq('id', profileId)
          assertCriticalWrite(b2cCancelError, `sub.updated B2C premium-fjerning profile=${profileId}`)
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
    if (charge.amount_refunded !== charge.amount) {
      return NextResponse.json({ received: true })
    }

    if (!customerId) {
      console.error('[webhook] charge.refunded: charge mangler customer', charge.id)
      return NextResponse.json({ received: true })
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    if (profile) {
      const { error: refundError } = await supabaseAdmin.from('profiles')
        .update({ premium_status: false, premium_since: null })
        .eq('id', profile.id)
      assertCriticalWrite(refundError, `charge.refunded premium-fjerning profile=${profile.id}`)
    } else {
      console.error(`[webhook] charge.refunded: no profile found for customer=${customerId}, charge=${charge.id}`)
    }
  }

  return NextResponse.json({ received: true })
  } catch (err) {
    // Rull tilbake idempotens-stemplet så Stripe sin neste retry kan prosessere
    // hendelsen på nytt i stedet for å bli avvist som duplikat (23505).
    console.error('[webhook] prosesseringsfeil — fjerner idempotens-stempel for', event.id, err)
    await supabaseAdmin.from('stripe_events').delete().eq('id', event.id)
    return NextResponse.json({ error: 'Webhook-prosessering feilet' }, { status: 500 })
  }
}
