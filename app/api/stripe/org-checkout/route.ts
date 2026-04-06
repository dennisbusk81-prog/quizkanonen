import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { randomBytes } from 'crypto'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

const PLAN_PRICES: Record<string, string | undefined> = {
  starter:  process.env.STRIPE_ORG_STARTER_PRICE_ID,
  standard: process.env.STRIPE_ORG_STANDARD_PRICE_ID,
  pro:      process.env.STRIPE_ORG_PRO_PRICE_ID,
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-checkout:${ip}`, 5, 60_000).success) {
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
    const slug = randomBytes(4).toString('hex')

    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .insert({ name: organizationName.trim(), slug, plan, created_by: user.id })
      .select('id, slug')
      .single()

    if (orgErr || !org) {
      console.error('Org insert error:', orgErr)
      return NextResponse.json({ error: 'Kunne ikke opprette organisasjon' }, { status: 500 })
    }

    await supabaseAdmin.from('organization_members').insert({
      organization_id: org.id,
      user_id: user.id,
      role: 'admin',
    })

    const inviteToken = randomBytes(16).toString('hex')
    await supabaseAdmin.from('organization_invites').insert({
      organization_id: org.id,
      token: inviteToken,
      created_by: user.id,
      is_active: true,
    })

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email ?? undefined,
      metadata: { organization_id: org.id, type: 'org', userId: user.id },
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/bedrift/success?org=${org.slug}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/bedrift/registrer?plan=${plan}`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Org checkout error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
