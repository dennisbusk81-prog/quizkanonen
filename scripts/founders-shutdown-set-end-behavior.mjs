// Founders-nedstengningen 15. august 2026 — DEL 3: sett
// trial_settings.end_behavior.missing_payment_method='cancel' på hovedlisten
// fra lib/founders-farewell-list.json (skrevet av founders-shutdown-materialize.mjs).
//
//   node scripts/founders-shutdown-set-end-behavior.mjs           # dry-run
//   node scripts/founders-shutdown-set-end-behavior.mjs --apply   # skriver (kun etter Dennis' «kjør»)
//
// Sikkerhetsvakter per abonnement, også i --apply:
//   * status må fortsatt være 'trialing' (en som konverterte etter
//     materialiseringen hoppes over med logg — aldri en skriving)
//   * prisen må fortsatt være Founders-prisen
//   * kunden må matche listens kunde
//   * allerede 'cancel' → hoppes over (idempotent)
import { readFileSync } from 'node:fs'
import Stripe from 'stripe'

const env = {}
for (const file of ['.env.local', '.env.prod']) {
  try {
    for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fila kan mangle */ }
}
if (!env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
  console.error('Forventet live-nøkkel i STRIPE_SECRET_KEY'); process.exit(1)
}
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })

const APPLY = process.argv.includes('--apply')
const list = JSON.parse(readFileSync('lib/founders-farewell-list.json', 'utf8'))

console.log(`Modus: ${APPLY ? 'APPLY (skriver til LIVE Stripe)' : 'DRY-RUN (ingen skriv)'}`)
console.log(`Liste generert: ${list.generatedAt} — hovedliste: ${list.entries.length} abonnement\n`)

let willChange = 0, alreadySet = 0, skipped = 0, changed = 0, failed = 0

for (const e of list.entries) {
  let sub
  try {
    sub = await stripe.subscriptions.retrieve(e.subscriptionId)
  } catch (err) {
    console.error(`  FEIL ${e.subscriptionId}: kunne ikke hentes (${err.message})`)
    failed++
    continue
  }

  const custId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const priceId = sub.items.data[0]?.price?.id
  if (sub.status !== 'trialing') {
    console.log(`  HOPPER ${e.subscriptionId}: status=${sub.status} (ikke lenger trialing — konvertert/kansellert etter materialisering)`)
    skipped++
    continue
  }
  if (priceId !== list.foundersPriceId || custId !== e.customerId) {
    console.error(`  HOPPER ${e.subscriptionId}: pris/kunde matcher ikke listen (pris=${priceId}, kunde=${custId}) — manuell sjekk`)
    skipped++
    continue
  }
  if (sub.trial_settings?.end_behavior?.missing_payment_method === 'cancel') {
    alreadySet++
    continue
  }

  if (!APPLY) {
    willChange++
    continue
  }

  try {
    await stripe.subscriptions.update(e.subscriptionId, {
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
    })
    changed++
  } catch (err) {
    console.error(`  FEIL ${e.subscriptionId}: oppdatering feilet (${err.message})`)
    failed++
  }
}

console.log(`\n=== ${APPLY ? 'RESULTAT' : 'DRY-RUN-RESULTAT'} ===`)
if (APPLY) console.log(`Endret:            ${changed}`)
else console.log(`Ville endret:      ${willChange}`)
console.log(`Allerede 'cancel': ${alreadySet}`)
console.log(`Hoppet over:       ${skipped}`)
console.log(`Feilet:            ${failed}`)

if (!APPLY) {
  console.log(`\nUtdrag av abonnement-ID-ene (første 10 av ${list.entries.length}):`)
  for (const e of list.entries.slice(0, 10)) {
    console.log(`  ${e.subscriptionId}  ${e.email}`)
  }
  console.log('\nDRY-RUN — ingenting er skrevet. Kjør med --apply KUN etter eksplisitt «kjør» fra Dennis.')
}
