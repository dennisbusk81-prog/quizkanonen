// Fyller profiles.personal_stripe_subscription_id for eksisterende rader.
//
// BAKGRUNN
// Kolonnen ble kun satt av Founders-flyten, som oppretter abonnementet via
// API-et og har id-en i hånden. Vanlig B2C går via Stripe Checkout, og
// webhooken lagret den aldri. Fire kodesteder bruker kolonnen som «har ikke
// eget abonnement»-vakt, og tok derfor feil om enhver betalende B2C-kunde.
// Webhooken skriver den nå ved checkout.session.completed; denne fyller
// historikken.
//
//   node scripts/backfill-personal-subscription-id.mjs           # dry-run
//   node scripts/backfill-personal-subscription-id.mjs --apply   # skriver
//
// Dry-run er standard og gjør INGEN skriv — verken mot Supabase eller Stripe.
// Stripe-kallene er utelukkende lesende (subscriptions.list).
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const APPLY = process.argv.includes('--apply')
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ── Kandidater: har Stripe-kunde, mangler abonnements-id ─────────────────────
const { data: candidates, error } = await supabase
  .from('profiles')
  .select('id, premium_status, premium_source, stripe_customer_id, personal_stripe_subscription_id')
  .not('stripe_customer_id', 'is', null)
  .is('personal_stripe_subscription_id', null)

if (error) {
  console.error('SELECT feilet:', error.message)
  process.exit(1)
}

console.log(`Modus: ${APPLY ? 'APPLY (skriver)' : 'DRY-RUN (ingen skriv)'}`)
console.log(`Kandidater (har stripe_customer_id, mangler personal_stripe_subscription_id): ${candidates.length}\n`)

const bySource = {}
for (const p of candidates) {
  const k = `${p.premium_source ?? 'null'} / premium=${p.premium_status}`
  bySource[k] = (bySource[k] ?? 0) + 1
}
for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`)
}

if (!env.STRIPE_SECRET_KEY) {
  console.log(
    '\nSTRIPE_SECRET_KEY mangler i .env.local — kan ikke slå opp abonnementene.\n' +
    'Analysen over er DB-siden; selve oppslaget krever nøkkelen.'
  )
  process.exit(0)
}

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })

let found = 0
let none = 0
let failed = 0
const plan = []

for (const p of candidates) {
  try {
    const [active, trialing] = await Promise.all([
      stripe.subscriptions.list({ customer: p.stripe_customer_id, limit: 1, status: 'active' }),
      stripe.subscriptions.list({ customer: p.stripe_customer_id, limit: 1, status: 'trialing' }),
    ])
    const sub = active.data[0] ?? trialing.data[0] ?? null
    if (!sub) { none++; continue }
    found++
    plan.push({ id: p.id, subId: sub.id, status: sub.status, source: p.premium_source })
  } catch (err) {
    failed++
    console.error(`  oppslag feilet for ${p.id} (${p.stripe_customer_id}):`, err.message)
  }
}

console.log(`\nLevende abonnement funnet: ${found}`)
console.log(`Uten levende abonnement:   ${none}`)
console.log(`Oppslag feilet:            ${failed}\n`)

for (const row of plan) {
  console.log(`  ${row.id}  →  ${row.subId}  (${row.status}, source=${row.source})`)
}

if (!APPLY) {
  console.log('\nDRY-RUN — ingenting er skrevet. Kjør på nytt med --apply for å lagre.')
  process.exit(0)
}

let written = 0
for (const row of plan) {
  const { error: updErr } = await supabase
    .from('profiles')
    .update({ personal_stripe_subscription_id: row.subId })
    .eq('id', row.id)
    .is('personal_stripe_subscription_id', null) // idempotent: rører ikke rader som alt er fylt
  if (updErr) console.error(`  skriving feilet for ${row.id}:`, updErr.message)
  else written++
}

console.log(`\nSkrevet: ${written} av ${plan.length}`)
