import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { premiumWelcomeEmail, premiumRenewalEmail, premiumCancelledEmail, orgPurchaseEmail, orgCancelledEmail, orgRenewalEmail, paymentFailedEmail, orgPaymentFailedEmail } from '@/lib/email-templates'

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
    .maybeSingle()

  if (!adminMember) return { email: null, orgName: org?.name ?? null, orgSlug: org?.slug ?? null }

  const { data } = await supabaseAdmin.auth.admin.getUserById(adminMember.user_id)
  return { email: data.user?.email ?? null, orgName: org?.name ?? null, orgSlug: org?.slug ?? null }
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

      await supabaseAdmin.from('organizations').update({
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: subscriptionId,
        stripe_period_end: periodEnd,
      }).eq('id', organizationId)

      // Activate premium for all current members — single batch update
      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)

      const memberIds = (members ?? []).map(m => m.user_id)
      if (memberIds.length > 0) {
        await supabaseAdmin.from('profiles').update({
          premium_status: true,
          premium_source: 'org',
        }).in('id', memberIds)
      }

      // Send kjøpsbekreftelse til org-admin — fire-and-forget
      getOrgAdminEmail(organizationId)
        .then(({ email, orgName, orgSlug }) => {
          if (email && orgName && orgSlug) {
            return sendEmail({
              to: email,
              subject: `Velkommen til Quizkanonen for bedrifter — ${orgName}`,
              html: orgPurchaseEmail(orgName, orgSlug),
            })
          }
        })
        .catch(err => console.error('[webhook] orgPurchaseEmail failed:', err))
    } else {
      // B2C personal checkout
      const userId = session.metadata?.userId
      if (!userId) return NextResponse.json({ error: 'Mangler userId' }, { status: 400 })

      await supabaseAdmin.from('profiles').update({
        premium_status: true,
        premium_since: new Date().toISOString(),
        stripe_customer_id: session.customer as string ?? null,
        premium_source: 'personal',
      }).eq('id', userId)

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
        // B2B — send fornyelsesbekreftelse til org-admin
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
      .select('id, name, slug')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    if (org) {
      // B2B: revoke premium from all members — single batch update
      const { data: members } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', org.id)

      const memberIds = (members ?? []).map(m => m.user_id)
      if (memberIds.length > 0) {
        await supabaseAdmin.from('profiles').update({
          premium_status: false,
          premium_source: null,
        }).in('id', memberIds)
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
    } else {
      // B2C
      await supabaseAdmin.from('profiles')
        .update({ premium_status: false, premium_source: null })
        .eq('stripe_customer_id', customerId)

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
      // B2C — varsle bruker
      getUserEmail(stripe, customerId)
        .then(email => {
          if (email) {
            return sendEmail({
              to: email,
              subject: 'Betalingen feilet — Quizkanonen Premium',
              html: paymentFailedEmail(),
            })
          }
        })
        .catch(err => console.error('[webhook] paymentFailedEmail failed:', err))
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
      // B2B: update period end
      const periodEnd = new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000).toISOString()
      await supabaseAdmin.from('organizations')
        .update({ stripe_period_end: periodEnd })
        .eq('id', org.id)
    } else {
      // B2C — 'trialing' counts as active (Founders trial period)
      const isActive = ['active', 'trialing'].includes(subscription.status)
      await supabaseAdmin.from('profiles')
        .update({ premium_status: isActive })
        .eq('stripe_customer_id', customerId)
    }
  }

  return NextResponse.json({ received: true })
}
