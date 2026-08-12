import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { decidePlanChange, getPlan } from '@/lib/org-plan'
import { priceIdForPlan } from '@/lib/org-plan-prices'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'
import { reportMoneyPathFailure } from '@/lib/money-path-alert'

// POST /api/org/[slug]/change-plan — org-admin bytter plan opp eller ned.
//
// HVORFOR EGEN RUTE OG IKKE STRIPE CUSTOMER PORTAL (besluttet 29. juli 2026):
// portalen kan ikke stoppe en nedgradering FØR den skjer. Vi ville fått vite om
// den via webhooken, etter at kunden allerede sto på en plan som ikke rommer
// medlemmene deres. Portalen krever dessuten like mye kode uansett — uten en
// price_id → plan-mapping i webhooken blir `organizations.plan` stående feil.
// (Den mappingen finnes nå også, som sikkerhetsnett — se lib/org-plan-prices.)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-change-plan:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan, stripe_subscription_id, subscription_status')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })
  }

  // Låst org: planbytte forutsetter et levende abonnement å bytte på. Veien
  // tilbake går via lås-skjermen → /api/stripe/org-checkout (reactivateOrgId),
  // som lager en ny checkout — ikke gjennom denne ruten.
  const lock = await requireUnlockedOrg({ slug })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  let body: { plan?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  // Medlemstallet MÅ telles før beslutningen — det er hele grunnlaget for
  // nedgraderingssperren.
  const { count: memberCount, error: countErr } = await supabaseAdmin
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)

  if (countErr || memberCount == null) {
    // Feiler lukket: uten et bekreftet medlemstall kan vi ikke vite om en
    // nedgradering er forsvarlig, og å gjette feil vei koster kunden penger.
    console.error(`[change-plan] kunne ikke telle medlemmer — org=${org.id}:`, countErr?.message ?? 'count var null')
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte medlemstallet akkurat nå. Prøv igjen om litt.' },
      { status: 503 },
    )
  }

  const decision = decidePlanChange(org.plan, body.plan, memberCount)
  if (!decision.ok) {
    // 409 for nedgradering under grensen (samme stil som answer_key_locked:
    // maskinlesbar kode + tallene UI-et trenger), 400 for det som er ren
    // input-feil.
    const status = decision.code === 'limit_exceeded' ? 409 : 400
    return NextResponse.json({
      error: decision.error,
      code: decision.code,
      ...(decision.limit != null ? { limit: decision.limit } : {}),
      ...(decision.memberCount != null ? { memberCount: decision.memberCount } : {}),
    }, { status })
  }

  const newPriceId = priceIdForPlan(decision.to)
  if (!newPriceId) {
    console.error(`[change-plan] mangler pris-id for plan «${decision.to}» — org=${org.id}`)
    return NextResponse.json({ error: 'Planen er ikke tilgjengelig for selvbetjent bytte. Ta kontakt med support.' }, { status: 400 })
  }

  if (!org.stripe_subscription_id) {
    return NextResponse.json(
      { error: 'Bedriften har ikke et aktivt abonnement å bytte. Legg inn betaling først.' },
      { status: 400 },
    )
  }

  // ── Stripe først, database etterpå ────────────────────────────────────────
  // Rekkefølgen er bevisst. Feiler Stripe, har vi ikke endret noe og kan svare
  // ærlig. Feiler DB-skrivingen ETTER at Stripe er endret, er kunden allerede
  // på riktig pris, og webhookens price_id → plan-mapping retter kolonnen ved
  // neste subscription.updated. Motsatt rekkefølge ville gitt en kunde som står
  // oppført på en plan de ikke betaler for.
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })

  try {
    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    const itemId = subscription.items.data[0]?.id
    if (!itemId) {
      console.error(`[change-plan] abonnement uten linjer — org=${org.id} sub=${org.stripe_subscription_id}`)
      return NextResponse.json({ error: 'Abonnementet kunne ikke oppdateres. Ta kontakt med support.' }, { status: 500 })
    }

    await stripe.subscriptions.update(org.stripe_subscription_id, {
      items: [{ id: itemId, price: newPriceId }],
      // Kunden betaler differansen for resten av perioden ved oppgradering, og
      // får tilsvarende kreditt ved nedgradering. Standard Stripe-oppførsel, og
      // den minst overraskende for en kunde som bytter midt i en måned.
      proration_behavior: 'create_prorations',
      metadata: { organization_id: org.id, type: 'org' },
    })
  } catch (err) {
    console.error(`[change-plan] Stripe-oppdatering feilet — org=${org.id} sub=${org.stripe_subscription_id}:`, err)
    return NextResponse.json({ error: 'Kunne ikke endre abonnementet hos Stripe. Ingenting er endret. Prøv igjen.' }, { status: 502 })
  }

  const { error: planWriteErr } = await supabaseAdmin
    .from('organizations')
    .update({ plan: decision.to })
    .eq('id', org.id)

  if (planWriteErr) {
    // Betalingen ER endret. Å svare «feilet» ville fått admin til å prøve på
    // nytt mot et abonnement som allerede står riktig.
    console.error(
      `[change-plan] KRITISK: Stripe er byttet til «${decision.to}», men organizations.plan ble ikke skrevet — ` +
      `org=${org.id}. Webhookens price_id-mapping retter dette ved neste subscription.updated:`,
      planWriteErr.message,
    )
    // Selvhelingen over er en ANTAKELSE: den forutsetter at webhooken kommer
    // fram og at price_id-mappingen kjenner prisen. Holder den ikke, står
    // organizations.plan feil for alltid — feil MRR, feil medlemsgrense, feil
    // gating av ukesrapporten — og admin fikk `ok: true`, så ingen sier fra.
    reportMoneyPathFailure({
      operation: 'change-plan:persist-plan',
      consequence:
        'Kunden er fakturert for ny plan hos Stripe, men organizations.plan står ' +
        'på den gamle. Retter seg selv hvis subscription.updated kommer fram — ' +
        'bekreft at den gjorde det, ellers skriv kolonnen manuelt.',
      err: planWriteErr,
      context: { orgId: org.id, fra: decision.from, til: decision.to },
    })
    return NextResponse.json({
      ok: true,
      plan: decision.to,
      warning: 'Abonnementet er endret, men panelet kan vise gammel plan noen minutter.',
    })
  }

  try {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      user_id: user.id,
      action_type: 'org_plan_changed',
      scope_type: 'organization',
      scope_id: org.id,
      details: { fra: decision.from, til: decision.to, retning: decision.direction },
    })
    if (logErr) console.error('[change-plan] admin_actions-logging feilet', org.id, logErr.message)
  } catch (err) {
    console.error('[change-plan] admin_actions-logging kastet', org.id, err)
  }

  console.log(`[change-plan] org=${org.id} «${org.name}» byttet ${decision.from} → ${decision.to} av ${user.id}`)

  return NextResponse.json({
    ok: true,
    plan: decision.to,
    planLabel: getPlan(decision.to)?.label ?? decision.to,
    direction: decision.direction,
  })
}
