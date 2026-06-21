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

  let body: { organizationName?: string; plan?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { organizationName, plan } = body
  if (!organizationName?.trim() || !plan) {
    return NextResponse.json({ error: 'Mangler organisasjonsnavn eller plan' }, { status: 400 })
  }

  const priceId = PLAN_PRICES[plan]
  if (!priceId) return NextResponse.json({ error: 'Ugyldig plan' }, { status: 400 })

  try {
    // Trial-lengde fra site_settings (key/value), samme mønster som founders_days_free.
    const { data: settingRow } = await supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', 'org_trial_days')
      .maybeSingle()
    const trialDays = settingRow?.value ? parseInt(settingRow.value as string) : 14

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

    const periodEnd = new Date(
      (subscription as unknown as { current_period_end: number }).current_period_end * 1000
    ).toISOString()

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
