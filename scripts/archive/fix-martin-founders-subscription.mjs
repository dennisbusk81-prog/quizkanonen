// Engangsskript (IKKE produksjonskode): gir Martin Knudsen et ekte Founders-
// abonnement i LIVE Stripe, og retter opp profil-koblingen.
//
// BAKGRUNN
// Martin registrerte seg 12. juni — før Stripe ble satt i live-modus ~23. juni.
// Hans stripe_customer_id (cus_Ugw56BU4XMpoK5) peker på en TEST-modus-kunde som
// ikke finnes i live, og personal_stripe_subscription_id er null. Han har derfor
// aldri hatt et abonnement i live, og ble ikke truffet av
// scripts/founders-extend-trials.mjs — det skriptet enumererer fra Stripe, ikke
// fra databasen, så han var rett og slett ikke i lista.
//
// Resultatet er at premium_status=true står uten noen kilde bak seg. Dette
// skriptet gir flagget en reell kilde, med nøyaktig samme oppsett som de 65
// andre Founders-abonnementene.
//
//   node scripts/fix-martin-founders-subscription.mjs           # dry-run
//   node scripts/fix-martin-founders-subscription.mjs --apply   # skriver
//
// E-POST: opprettelsen trigger ingen utsendelse. Webhooken vår håndterer ikke
// customer.subscription.created, og 0-kroners-fakturaen (billing_reason
// subscription_create) hoppes over av invoice.payment_succeeded-handleren, som
// kun reagerer på subscription_cycle.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const APPLY = process.argv.includes('--apply')

// Verdiene er lest av de 65 eksisterende live-abonnementene, ikke gjettet.
const USER_ID = 'fd998f5f-fb5a-4eef-8e83-9c8b31acfabb'
const FOUNDERS_PRICE = 'price_1ThaC3CuFvuZpvNY31Zfs6zr' // produkt «Founders Access», 49 NOK
const TRIAL_END = Math.floor(new Date('2026-08-15T23:59:00+02:00').getTime() / 1000)

if (!env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
  console.error('Krever LIVE STRIPE_SECRET_KEY. Avbryter.')
  process.exit(1)
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })

// ── Kontroller før vi rører noe ──────────────────────────────────────────────
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
console.log('  stripe_customer_id     :', profile.stripe_customer_id)
console.log('  personal_sub_id        :', profile.personal_stripe_subscription_id)

// Sikkerhetsvakt: har han allerede et levende abonnement, skal vi ikke lage et til.
if (profile.personal_stripe_subscription_id) {
  console.error('\nprofilen har allerede en abonnements-id. Avbryter for å unngå dobbelt abonnement.')
  process.exit(1)
}
if (profile.stripe_customer_id) {
  try {
    await stripe.customers.retrieve(profile.stripe_customer_id)
    console.error('\nden eksisterende kunde-id-en FINNES i live. Avbryter — da er premisset feil.')
    process.exit(1)
  } catch (err) {
    if (err.code !== 'resource_missing') throw err
    console.log('  → bekreftet: kunde-id-en finnes ikke i live (resource_missing)')
  }
}

console.log('\nVIL GJØRE:')
console.log('  1. customers.create      e-post =', email, '| metadata.userId =', USER_ID)
console.log('  2. subscriptions.create  pris =', FOUNDERS_PRICE)
console.log('                           trial_end =', new Date(TRIAL_END * 1000).toISOString(), '(15. aug 23:59 Oslo)')
console.log('                           save_default_payment_method = off')
console.log('                           missing_payment_method = create_invoice')
console.log('  3. profiles.update       stripe_customer_id + personal_stripe_subscription_id')

if (!APPLY) {
  console.log('\nDRY-RUN — ingenting er skrevet. Kjør på nytt med --apply.')
  process.exit(0)
}

// ── Utfør ────────────────────────────────────────────────────────────────────
// Idempotensnøkler: en utilsiktet ny kjøring gir samme objekter, ikke duplikater.
const customer = await stripe.customers.create({
  email,
  metadata: { userId: USER_ID, note: 'manuell opprydding — test-modus-levning fra 12. juni' },
}, { idempotencyKey: `fix-martin-founders:customer:${USER_ID}` })
console.log('\n1. kunde opprettet :', customer.id)

const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: FOUNDERS_PRICE }],
  trial_end: TRIAL_END,
  payment_settings: { save_default_payment_method: 'off' },
  trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } },
  metadata: { userId: USER_ID },
}, { idempotencyKey: `fix-martin-founders:subscription:${USER_ID}` })
console.log('2. abonnement opprettet:', subscription.id, '| status:', subscription.status)

const { error: updErr } = await supabase
  .from('profiles')
  .update({
    stripe_customer_id: customer.id,
    personal_stripe_subscription_id: subscription.id,
  })
  .eq('id', USER_ID)

if (updErr) {
  console.error('\nKRITISK: Stripe-objektene er opprettet, men profilen ble IKKE oppdatert:', updErr.message)
  console.error('Kunde:', customer.id, 'Abonnement:', subscription.id, '— må kobles manuelt.')
  process.exit(1)
}
console.log('3. profil oppdatert')

// ── Verifiser mot ferske data ────────────────────────────────────────────────
const { data: etter } = await supabase
  .from('profiles')
  .select('premium_status, premium_source, stripe_customer_id, personal_stripe_subscription_id')
  .eq('id', USER_ID)
  .single()
const ferskSub = await stripe.subscriptions.retrieve(subscription.id)
const fakturaer = await stripe.invoices.list({ customer: customer.id, limit: 10 })

console.log('\nETTER:')
console.log('  stripe_customer_id     :', etter.stripe_customer_id)
console.log('  personal_sub_id        :', etter.personal_stripe_subscription_id)
console.log('  Stripe-status          :', ferskSub.status)
console.log('  trial_end              :', new Date(ferskSub.trial_end * 1000).toISOString())
console.log('  fakturaer              :', fakturaer.data.map(i => `${i.status} total=${i.total} betalt=${i.amount_paid}`).join(' | ') || 'ingen')
console.log('  SUM FAKTISK TRUKKET    :', fakturaer.data.reduce((s, i) => s + i.amount_paid, 0), 'øre')
