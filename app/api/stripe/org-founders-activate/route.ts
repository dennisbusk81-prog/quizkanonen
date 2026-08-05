import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { sendEmail } from '@/lib/email'
import { orgTrialEmail } from '@/lib/email-templates'
import { validateOrgName } from '@/lib/org-name'
import { randomBytes } from 'crypto'
import { PLAN_PRICES } from '@/lib/org-plan-prices'

// B2B-trial: oppretter en organisasjon med gratis prøveperiode uten kortkrav.
// Speiler founders-activate (B2C) for organisasjoner. Trial-lengden leses fra
// site_settings (org_trial_days). Stripe kansellerer abonnementet automatisk hvis
// kort ikke er lagt inn ved trial-slutt — da setter webhooket subscription_status
// til 'locked' og org-sidene sperres til betaling.

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!(await rateLimitShared(`org-trial:${ip}`, 5, 60_000)).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // Per-bruker-grense: hindrer at samme bruker oppretter vilkårlig mange gratis
  // trial-orger (rate-limit over er kun per-IP). Én aktiv/trialing org per bruker.
  const { count: existingOrgCount } = await supabaseAdmin
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .in('subscription_status', ['trialing', 'active'])

  if ((existingOrgCount ?? 0) > 0) {
    return NextResponse.json({ error: 'Du har allerede en aktiv organisasjon.' }, { status: 409 })
  }

  let body: { organizationName?: string; plan?: string; trialCode?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { organizationName, trialCode } = body
  const nameCheck = validateOrgName(organizationName)
  if (!nameCheck.ok) {
    return NextResponse.json({ error: nameCheck.error }, { status: 400 })
  }
  const orgName = nameCheck.value

  // Promo-kode (admin-initiert pilot) overstyrer plan og trial-lengde. Uten kode
  // brukes valgt plan fra body og trial-lengde fra site_settings.
  let plan = body.plan
  let codedTrialDays: number | null = null
  let trialCodeId: string | null = null

  const normalizedCode = trialCode?.trim().toUpperCase()
  if (normalizedCode) {
    const { data: codeRow } = await supabaseAdmin
      .from('org_trial_codes')
      .select('id, package, trial_days, used_at')
      .eq('code', normalizedCode)
      .maybeSingle()

    if (!codeRow) return NextResponse.json({ error: 'Ukjent promo-kode.' }, { status: 400 })
    if (codeRow.used_at) return NextResponse.json({ error: 'Promo-koden er allerede brukt.' }, { status: 409 })

    plan = codeRow.package
    codedTrialDays = codeRow.trial_days
    trialCodeId = codeRow.id
  }

  if (!plan) {
    return NextResponse.json({ error: 'Mangler plan' }, { status: 400 })
  }

  const priceId = PLAN_PRICES[plan]
  if (!priceId) return NextResponse.json({ error: 'Ugyldig plan' }, { status: 400 })

  try {
    // Trial-lengde: fra koden hvis innløst, ellers site_settings (samme mønster
    // som founders_days_free), med 14 dager som fallback.
    let trialDays = codedTrialDays
    if (trialDays == null) {
      const { data: settingRow } = await supabaseAdmin
        .from('site_settings')
        .select('value')
        .eq('key', 'org_trial_days')
        .maybeSingle()
      trialDays = settingRow?.value ? parseInt(settingRow.value as string) : 14
    }

    // 1. Opprett org med subscription_status='trialing'
    const slug = randomBytes(4).toString('hex')
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .insert({ name: orgName, slug, plan, created_by: user.id, subscription_status: 'trialing' })
      .select('id, slug')
      .single()

    if (orgErr || !org) {
      console.error('[org-trial] org insert failed:', orgErr)
      return NextResponse.json({ error: 'Kunne ikke opprette organisasjon' }, { status: 500 })
    }

    // 1b. Innløs promo-kode atomisk: marker brukt KUN hvis fortsatt ubrukt.
    //     Hindrer dobbel innløsning ved samtidige forsøk. Feiler claimet, ruller
    //     vi tilbake den nyopprettede org-en og avbryter.
    if (trialCodeId) {
      const { data: claimed } = await supabaseAdmin
        .from('org_trial_codes')
        .update({ used_at: new Date().toISOString(), used_by_org_id: org.id })
        .eq('id', trialCodeId)
        .is('used_at', null)
        .select('id')
        .maybeSingle()

      if (!claimed) {
        await supabaseAdmin.from('organizations').delete().eq('id', org.id)
        console.error('[org-trial] promo-kode allerede brukt ved claim, rullet tilbake org:', org.id)
        return NextResponse.json({ error: 'Promo-koden er allerede brukt.' }, { status: 409 })
      }
    }

    // 2. Admin-medlemsraden MÅ committes — samme robuste mønster som org-checkout.
    //    Uten den finner webhook/e-post-oppslag ingen admin. Feiler den, avbryt.
    const { error: memberErr } = await supabaseAdmin.from('organization_members').insert({
      organization_id: org.id,
      user_id: user.id,
      role: 'admin',
    })

    if (memberErr) {
      console.error('[org-trial] member insert failed:', memberErr, 'org:', org.id, 'user:', user.id)
      return NextResponse.json({ error: 'Kunne ikke opprette administrator-tilknytning. Prøv igjen.' }, { status: 500 })
    }

    // 3. Invite-rad — ikke kritisk, admin kan regenerere i panelet. Logg, ikke avbryt.
    const inviteToken = randomBytes(16).toString('hex')
    const { error: inviteErr } = await supabaseAdmin.from('organization_invites').insert({
      organization_id: org.id,
      token: inviteToken,
      created_by: user.id,
      is_active: true,
    })
    if (inviteErr) {
      console.error('[org-trial] invite insert failed:', inviteErr, 'org:', org.id)
    }

    // 4. Stripe-kunde for organisasjonen
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { organization_id: org.id, type: 'org' },
    }, {
      idempotencyKey: `org-trial:customer:${org.id}`,
    })

    // 5. Abonnement med trial, uten kortkrav. Avbryt automatisk ved trial-slutt
    //    hvis kort ikke er lagt inn — gir deterministisk subscription.deleted → 'locked'.
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: trialDays,
      payment_settings: { save_default_payment_method: 'off' },
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: { organization_id: org.id, type: 'org' },
    }, {
      idempotencyKey: `org-trial:subscription:${org.id}`,
    })

    // Stripe trial-abonnementer: trial_end er den kanoniske slutt-epoken.
    // current_period_end er null i dahlia-APIet for trialing-abonnementer.
    // Fallback: nå + trial-dager × 86400 sek, slik at periodEnd aldri er ugyldig.
    const sub = subscription as unknown as { trial_end: number | null; current_period_end: number | null }
    const endEpoch = sub.trial_end ?? sub.current_period_end ?? (Math.floor(Date.now() / 1000) + (trialDays ?? 14) * 86400)
    const periodEnd = new Date(endEpoch * 1000).toISOString()

    // 6. Lagre Stripe-felt på org (subscription_status forblir 'trialing')
    //
    //    KRITISK, og grunnen til retry + full tilbakerulling under: webhooken
    //    finner org-en via `.eq('stripe_customer_id', ...)`. Uten denne
    //    skrivingen er organisasjonen usynlig for ALLE framtidige Stripe-
    //    hendelser — den ville stått 'trialing' i det uendelige, aldri blitt
    //    låst ved trial-slutt og aldri konvertert til betalende. Stille tapt
    //    inntekt, uten noe spor av at det skjedde.
    const orgStripeLink = {
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription.id,
      stripe_period_end: periodEnd,
      subscription_status: 'trialing',
    }
    const writeOrgLink = () =>
      supabaseAdmin.from('organizations').update(orgStripeLink).eq('id', org.id)

    let linkErr = (await writeOrgLink()).error
    if (linkErr) {
      console.error(`[org-trial] Stripe-kobling feilet, prøver på nytt — org=${org.id}:`, linkErr.message)
      linkErr = (await writeOrgLink()).error
    }

    if (linkErr) {
      console.error(
        `[org-trial] KRITISK: kunne ikke koble Stripe til org — ruller tilbake. ` +
        `org=${org.id} customer=${customer.id} subscription=${subscription.id}:`,
        linkErr.message
      )

      // Tilbakerulling i motsatt rekkefølge av opprettelsen. Org-raden MÅ bort:
      // per-bruker-vakten øverst i ruten teller orger med status 'trialing'/
      // 'active', så en gjenglemt rad ville avvist brukerens neste forsøk med
      // 409 «Du har allerede en aktiv organisasjon» — permanent utestengt fra å
      // opprette sin egen org. Speiler promo-kode-tilbakerullingen i steg 1b.
      try {
        await stripe.subscriptions.cancel(subscription.id)
      } catch (cancelErr) {
        console.error(
          `[org-trial] kunne ikke kansellere abonnement ${subscription.id} under tilbakerulling ` +
          `(må ryddes manuelt i Stripe):`,
          cancelErr
        )
      }

      // Frigi promo-koden FØR org-raden slettes (used_by_org_id har
      // ON DELETE SET NULL, men used_at ville blitt stående og brent koden).
      if (trialCodeId) {
        const { error: releaseErr } = await supabaseAdmin
          .from('org_trial_codes')
          .update({ used_at: null, used_by_org_id: null })
          .eq('id', trialCodeId)
        if (releaseErr) {
          console.error(`[org-trial] kunne ikke frigi promo-kode ${trialCodeId}:`, releaseErr.message)
        }
      }

      // Eksplisitt opprydding i riktig rekkefølge. organization_invites ligger
      // ikke i migrasjonssporet, så cascade-oppførselen kan ikke verifiseres fra
      // kildekontroll — vi rydder derfor selv i stedet for å anta.
      await supabaseAdmin.from('organization_invites').delete().eq('organization_id', org.id)
      await supabaseAdmin.from('organization_members').delete().eq('organization_id', org.id)
      const { error: delErr } = await supabaseAdmin.from('organizations').delete().eq('id', org.id)
      if (delErr) {
        console.error(
          `[org-trial] KRITISK: kunne ikke slette org ${org.id} under tilbakerulling — ` +
          `brukeren er nå blokkert av 409-vakten til raden fjernes manuelt:`,
          delErr.message
        )
      }

      return NextResponse.json({ error: 'Kunne ikke fullføre opprettelsen. Prøv igjen.' }, { status: 500 })
    }

    // 7. Aktiver premium for admin (eneste medlem så langt). Ansatte får premium
    //    når de blir med via invitasjonslenken (join-ruten setter premium_status).
    //
    //    Ingen tilbakerulling her, i motsetning til steg 6: org-en er komplett og
    //    korrekt koblet til Stripe, og webhookens medlems-synk setter
    //    premium_status ved neste subscription.updated. Å slette en fungerende
    //    org for et flagg som selv-heler ville vært verre enn å logge det.
    const { error: premiumErr } = await supabaseAdmin.from('profiles').update({
      premium_status: true,
      premium_source: 'org',
    }).eq('id', user.id)

    if (premiumErr) {
      console.error(
        `[org-trial] premium-aktivering feilet for org-admin — user=${user.id} org=${org.id} ` +
        `(selv-heler ved neste subscription.updated fra webhooken):`,
        premiumErr.message
      )
    }

    // 8. Send trial-bekreftelse til admin — fire-and-forget
    if (user.email) {
      sendEmail({
        to: user.email,
        subject: `Prøveperioden er i gang — ${orgName}`,
        html: orgTrialEmail(orgName, org.slug, periodEnd),
      }).catch(err => console.error('[org-trial] orgTrialEmail failed:', err))
    }

    return NextResponse.json({ success: true, slug: org.slug })
  } catch (err) {
    console.error('[org-trial] error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
