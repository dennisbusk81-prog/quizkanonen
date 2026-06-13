import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { rateLimit } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { foundersWelcomeEmail } from '@/lib/email-templates'

const FOUNDERS_PRICE_ID = process.env.STRIPE_PRICE_FOUNDERS!

export async function POST(request: NextRequest) {
  if (!FOUNDERS_PRICE_ID) {
    return NextResponse.json({ error: 'Founders price not configured' }, { status: 500 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`founders-activate:${ip}`, 5, 60_000)
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

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id, premium_status')
      .eq('id', user.id)
      .single()

    if (profile?.premium_status === true) {
      return NextResponse.json({ error: 'Du har allerede Premium' }, { status: 400 })
    }

    let customerId = profile?.stripe_customer_id ?? null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      })
      customerId = customer.id
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id)
    }

    // Hent dynamisk prøvetid fra site_settings (key/value-tabell)
    const { data: settingsRows } = await supabaseAdmin
      .from('site_settings')
      .select('key, value')
      .in('key', ['founders_max_slots', 'founders_days_free', 'founders_trial_days'])

    const settingsMap = Object.fromEntries(
      (settingsRows ?? []).map(r => [r.key, parseInt(r.value as string)])
    )
    const maxSlots  = settingsMap.founders_max_slots  ?? 250
    const daysFree  = settingsMap.founders_days_free  ?? 30
    const trialDays = settingsMap.founders_trial_days ?? 7

    const { count } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('premium_source', ['founders', 'code'])
      .eq('premium_status', true)

    const isFull = (count ?? 0) >= maxSlots
    const trialPeriodDays = isFull ? trialDays : daysFree

    await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: FOUNDERS_PRICE_ID }],
      trial_period_days: trialPeriodDays,
      payment_settings: { save_default_payment_method: 'off' },
    })

    await supabaseAdmin
      .from('profiles')
      .update({ premium_status: true, premium_since: new Date().toISOString(), premium_source: 'founders', trial_reminder_sent_at: null })
      .eq('id', user.id)

    // Send founders-aktiveringsbekreftelse — fire-and-forget
    if (user.email) {
      sendEmail({
        to: user.email,
        subject: 'Founders Access aktivert — Quizkanonen',
        html: foundersWelcomeEmail(),
      }).catch(err => console.error('[founders-activate] foundersWelcomeEmail failed:', err))
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Founders activate error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
