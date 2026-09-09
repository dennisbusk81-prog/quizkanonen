import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isNoRowsError } from '@/lib/postgrest-errors'

// Én ekstern rundtur (Stripe/GoTrue/enkelt-e-post) — ekstern latens kan
// alene være sekunder. 30 s gir rom uten å arve plattformdefaulten på 300 s.
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `stripe-org-portal:${ip}`
  if (!rateLimit(rlKey, 10, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 10, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  let body: { org_id?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { org_id } = body
  if (!org_id) return NextResponse.json({ error: 'Mangler org_id' }, { status: 400 })

  // Verify the user is an admin of this org.
  //
  // .single() svarer med error PGRST116 OGSÅ når spørringen lyktes og ga null
  // rader — det er «ikke medlem» og skal fortsatt gi 403. Alle andre koder er
  // en ekte DB-feil: da VET vi ikke, og «Ingen admin-tilgang» ville vært
  // usant overfor en betalende bedriftsadmin. Punkt 7, 9. september 2026 —
  // se lib/postgrest-errors.ts for den empiriske verifiseringen av koden.
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', org_id)
    .eq('user_id', user.id)
    .single()

  if (membershipError && !isNoRowsError(membershipError)) {
    console.error(
      `[org-portal] kunne ikke lese medlemskap for user=${user.id} org=${org_id}:`,
      membershipError.code, membershipError.message,
    )
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte kontoen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 },
    )
  }

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen admin-tilgang' }, { status: 403 })
  }

  // Fetch stripe_customer_id and slug from the org. Samme skille: PGRST116 er
  // «org-raden finnes ikke» og faller til 400 under, som før.
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('stripe_customer_id, slug')
    .eq('id', org_id)
    .single()

  if (orgError && !isNoRowsError(orgError)) {
    console.error(`[org-portal] kunne ikke lese organisasjon ${org_id}:`, orgError.code, orgError.message)
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte kontoen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 },
    )
  }

  if (!org?.stripe_customer_id) {
    return NextResponse.json({ error: 'Ingen Stripe-kunde funnet' }, { status: 400 })
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/org/${org.slug}/admin`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Org portal error:', err)
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 })
  }
}
