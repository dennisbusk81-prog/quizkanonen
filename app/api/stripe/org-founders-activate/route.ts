import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { orgTrialEmail } from '@/lib/email-templates'
import { randomBytes } from 'crypto'

// B2B-trial: oppretter en organisasjon med gratis prøveperiode uten kortkrav.
// Speiler founders-activate (B2C) for organisasjoner. Trial-lengden leses fra
// site_settings (org_trial_days). Stripe kansellerer abonnementet automatisk hvis
// kort ikke er lagt inn ved trial-slutt — da setter webhooket subscription_status
// til 'locked' og org-sidene sperres til betaling.

const PLAN_PRICES: Record<string, string | undefined> = {
  starter:  process.env.STRIPE_ORG_STARTER_PRICE_ID,
  standard: process.env.STRIPE_ORG_STANDARD_PRICE_ID,
  pro:      process.env.STRIPE_ORG_PRO_PRICE_ID,
}

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-trial:${ip}`, 5, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  let body: { organizationName?: string; plan?: string; trialCode?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { organizationName, trialCode } = body
  if (!organizationName?.trim()) {
    return NextResponse.json({ error: 'Mangler organisasjonsnavn' }, { status: 400 })
  }

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
      .insert({ name: organizationName.trim(), slug, plan, created_by: user.id, subscription_status: 'trialing' })
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
    })

    // Stripe trial-abonnementer: trial_end er den kanoniske slutt-epoken.
    // current_period_end er null i dahlia-APIet for trialing-abonnementer.
    // Fallback: nå + trial-dager × 86400 sek, slik at periodEnd aldri er ugyldig.
    const sub = subscription as unknown as { trial_end: number | null; current_period_end: number | null }
    const endEpoch = sub.trial_end ?? sub.current_period_end ?? (Math.floor(Date.now() / 1000) + (trialDays ?? 14) * 86400)
    const periodEnd = new Date(endEpoch * 1000).toISOString()

    // 6. Lagre Stripe-felt på org (subscription_status forblir 'trialing')
    await supabaseAdmin.from('organizations').update({
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription.id,
      stripe_period_end: periodEnd,
      subscription_status: 'trialing',
    }).eq('id', org.id)

    // 7. Aktiver premium for admin (eneste medlem så langt). Ansatte får premium
    //    når de blir med via invitasjonslenken (join-ruten setter premium_status).
    await supabaseAdmin.from('profiles').update({
      premium_status: true,
      premium_source: 'org',
    }).eq('id', user.id)

    // 8. Send trial-bekreftelse til admin — fire-and-forget
    if (user.email) {
      sendEmail({
        to: user.email,
        subject: `Prøveperioden er i gang — ${organizationName.trim()}`,
        html: orgTrialEmail(organizationName.trim(), org.slug, periodEnd),
      }).catch(err => console.error('[org-trial] orgTrialEmail failed:', err))
    }

    return NextResponse.json({ success: true, slug: org.slug })
  } catch (err) {
    console.error('[org-trial] error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
