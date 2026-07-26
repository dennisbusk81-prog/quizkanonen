// Engangsverktøy (IKKE produksjonskode): gir én bruker et ekte Founders-
// abonnement i LIVE Stripe, med samme oppsett som resten av kohorten, og retter
// profil-koblingen.
//
// Generalisert versjon av scripts/fix-martin-founders-subscription.mjs, som ble
// brukt for Martin Knudsen 26. juli 2026.
//
// BAKGRUNN
// Enkelte profiler står med premium_status=true uten noen reell kilde bak seg —
// enten fordi stripe_customer_id peker på en TEST-modus-kunde fra før 23. juni,
// eller fordi premium_source ble satt manuelt uten et tilhørende abonnement.
// lib/premium-state.ts utleder Premium fra faktiske kilder, og slike profiler
// framstår da som avvik.
//
//   node scripts/grant-founders-subscription.mjs --user=<uuid>
//   node scripts/grant-founders-subscription.mjs --user=<uuid> --set-source=founders --apply
//
// E-POST: opprettelsen sender ingenting. Empirisk verifisert mot Martins
// kjøring — den genererte 8 Stripe-hendelser, hvorav kun invoice.payment_succeeded
// treffer webhooken vår, og hele den handleren ligger inne i en
// `billing_reason === 'subscription_cycle'`-vakt. Denne er subscription_create.
// Alle fakturaer er 0 kr, så Stripe har ingen kvittering å sende.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const APPLY = process.argv.includes('--apply')
const USER_ID = process.argv.find(a => a.startsWith('--user='))?.split('=')[1]
const SET_SOURCE = process.argv.find(a => a.startsWith('--set-source='))?.split('=')[1] ?? null

if (!USER_ID) { console.error('Mangler --user=<uuid>. Avbryter.'); process.exit(1) }

// Lest av de eksisterende live-abonnementene, ikke gjettet.
const FOUNDERS_PRICE = 'price_1ThaC3CuFvuZpvNY31Zfs6zr' // produkt «Founders Access», 49 NOK
const TRIAL_END = Math.floor(new Date('2026-08-15T23:59:00+02:00').getTime() / 1000)

if (!env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
  console.error('Krever LIVE STRIPE_SECRET_KEY. Avbryter.')
  process.exit(1)
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })

const { data: profile, error: profErr } = await supabase
  .from('profiles')
  .select('id, display_name, premium_status, premium_source, stripe_customer_id, personal_stripe_subscription_id')
  .eq('id', USER_ID)
  .single()

if (profErr || !profile) { console.error('Fant ikke profilen:', profErr?.message); process.exit(1) }

const { data: authData } = await supabase.auth.admin.getUserById(USER_ID)
const email = authData?.user?.email
if (!email) { console.error('Fant ingen e-postadresse på auth-kontoen. Avbryter.'); process.exit(1) }

console.log(`Modus: ${APPLY ? 'APPLY (skriver til Stripe og databasen)' : 'DRY-RUN (ingen skriv)'}\n`)
console.log('FØR:')
console.log('  navn                   :', profile.display_name)
console.log('  e-post                 :', email)
console.log('  premium_status/source  :', profile.premium_status, '/', profile.premium_source)
console.log('  stripe_customer_id     :', profile.stripe_customer_id ?? '(ingen)')
console.log('  personal_sub_id        :', profile.personal_stripe_subscription_id ?? '(ingen)')

// Vakter: aldri lag et abonnement nummer to for samme bruker.
if (profile.personal_stripe_subscription_id) {
  console.error('\nProfilen har allerede en abonnements-id. Avbryter.')
  process.exit(1)
}
if (profile.stripe_customer_id) {
  try {
    await stripe.customers.retrieve(profile.stripe_customer_id)
    console.error('\nDen eksisterende kunde-id-en FINNES i live. Avbryter — premisset er da feil.')
    process.exit(1)
  } catch (err) {
    if (err.code !== 'resource_missing') throw err
    console.log('  → bekreftet: kunde-id-en finnes ikke i live (resource_missing)')
  }
}

console.log('\nVIL GJØRE:')
console.log('  1. customers.create      e-post =', email)
console.log('  2. subscriptions.create  pris =', FOUNDERS_PRICE)
console.log('                           trial_end =', new Date(TRIAL_END * 1000).toISOString(), '(15. aug 23:59 Oslo)')
console.log('                           save_default_payment_method = off')
console.log('                           missing_payment_method = create_invoice')
console.log('  3. profiles.update       stripe_customer_id + personal_stripe_subscription_id'
  + (SET_SOURCE ? ` + premium_source → '${SET_SOURCE}'` : ''))

if (!APPLY) {
  console.log('\nDRY-RUN — ingenting er skrevet. Kjør på nytt med --apply.')
  process.exit(0)
}

const customer = await stripe.customers.create({
  email,
  metadata: { userId: USER_ID, note: 'manuell opprydding — premium uten reell kilde' },
}, { idempotencyKey: `grant-founders:customer:${USER_ID}` })
console.log('\n1. kunde opprettet     :', customer.id)

const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: FOUNDERS_PRICE }],
  trial_end: TRIAL_END,
  payment_settings: { save_default_payment_method: 'off' },
  trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } },
  metadata: { userId: USER_ID },
}, { idempotencyKey: `grant-founders:subscription:${USER_ID}` })
console.log('2. abonnement opprettet:', subscription.id, '| status:', subscription.status)

const { error: updErr } = await supabase
  .from('profiles')
  .update({
    stripe_customer_id: customer.id,
    personal_stripe_subscription_id: subscription.id,
    ...(SET_SOURCE ? { premium_source: SET_SOURCE } : {}),
  })
  .eq('id', USER_ID)

if (updErr) {
  console.error('\nKRITISK: Stripe-objektene er opprettet, men profilen ble IKKE oppdatert:', updErr.message)
  console.error('Kunde:', customer.id, 'Abonnement:', subscription.id, '— må kobles manuelt.')
  process.exit(1)
}
console.log('3. profil oppdatert')

const { data: etter } = await supabase
  .from('profiles')
  .select('premium_status, premium_source, stripe_customer_id, personal_stripe_subscription_id')
  .eq('id', USER_ID)
  .single()
const ferskSub = await stripe.subscriptions.retrieve(subscription.id)
const fakturaer = await stripe.invoices.list({ customer: customer.id, limit: 10 })

console.log('\nETTER:')
console.log('  premium_status/source  :', etter.premium_status, '/', etter.premium_source)
console.log('  stripe_customer_id     :', etter.stripe_customer_id)
console.log('  personal_sub_id        :', etter.personal_stripe_subscription_id)
console.log('  Stripe-status          :', ferskSub.status)
console.log('  trial_end              :', new Date(ferskSub.trial_end * 1000).toISOString())
console.log('  fakturaer              :', fakturaer.data.map(i => `${i.status} total=${i.total}`).join(' | ') || 'ingen')
console.log('  SUM FAKTISK TRUKKET    :', fakturaer.data.reduce((s, i) => s + i.amount_paid, 0), 'øre')
