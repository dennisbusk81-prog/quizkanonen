// Founders-nedstengningen — DEL 4: kanseller de forlatte Founders-trialene
// til brukere som allerede har konvertert til betalt Premium (årsaken ble
// fikset i cbfe2e5; dette rydder de eksisterende tilfellene).
//
//   node scripts/founders-shutdown-cancel-orphans.mjs           # dry-run
//   node scripts/founders-shutdown-cancel-orphans.mjs --apply   # kansellerer (kun etter Dennis' «kjør»)
//
// Leser excluded.converted fra lib/founders-farewell-list.json. Vakter per
// abonnement, også i --apply:
//   * trialen må fortsatt være 'trialing' og på Founders-prisen
//   * kunden må FORTSATT ha et annet levende, betalende abonnement — uten det
//     ville kanselleringen fjernet brukerens eneste dekning, og da avbrytes
//   * det aktive abonnementet røres ALDRI — kun trial-id-en fra listen kanselleres
//
// Etter kansellering verifiseres (mot prod-DB) at premium_status forblir true
// og at personal_stripe_subscription_id fortsatt peker på det aktive
// abonnementet — 1B-testen 11. aug forutsier at webhookens stale-vakt
// ignorerer deleted-eventet; dette scriptet måler at det faktisk skjedde.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APPLY = process.argv.includes('--apply')
const list = JSON.parse(readFileSync('lib/founders-farewell-list.json', 'utf8'))
const orphans = list.excluded.converted

console.log(`Modus: ${APPLY ? 'APPLY (kansellerer i LIVE Stripe)' : 'DRY-RUN (ingen skriv)'}`)
console.log(`Orphans i listen: ${orphans.length}\n`)

const PAYING = ['active', 'past_due'] // levende betalt dekning; trialing på annen pris telles også under

for (const o of orphans) {
  console.log(`${o.email}  (bruker ${o.userId ?? 'ukjent'})`)
  console.log(`  kunde:        ${o.customerId}`)
  console.log(`  trial (skal kanselleres): ${o.subscriptionId}`)

  const trial = await stripe.subscriptions.retrieve(o.subscriptionId)
  const trialPrice = trial.items.data[0]?.price?.id
  if (trial.status !== 'trialing' || trialPrice !== list.foundersPriceId) {
    console.log(`  HOPPER: trialen er ${trial.status} på pris ${trialPrice} — matcher ikke forventningen\n`)
    continue
  }

  const allSubs = await stripe.subscriptions.list({ customer: o.customerId, status: 'all', limit: 10 })
  const paying = allSubs.data.filter(s =>
    s.id !== o.subscriptionId &&
    (PAYING.includes(s.status) || (s.status === 'trialing' && s.items.data[0]?.price?.id !== list.foundersPriceId))
  )
  if (paying.length === 0) {
    console.error(`  AVBRYTER DENNE: ingen annen levende dekning funnet — kansellering ville fjernet brukerens tilgang\n`)
    continue
  }
  console.log(`  aktiv dekning som beholdes: ${paying.map(s => `${s.id} (${s.status})`).join(', ')}`)

  if (!APPLY) {
    console.log(`  DRY-RUN: ville kansellert ${o.subscriptionId}\n`)
    continue
  }

  await stripe.subscriptions.cancel(o.subscriptionId)
  console.log(`  KANSELLERT ${o.subscriptionId}`)

  // Gi webhooken et øyeblikk, verifiser deretter DB-tilstanden.
  await new Promise(r => setTimeout(r, 8000))
  const { data: p } = await supabase.from('profiles')
    .select('premium_status, premium_source, personal_stripe_subscription_id')
    .eq('id', o.userId).single()
  const stillPointsToPaying = paying.some(s => s.id === p?.personal_stripe_subscription_id)
  console.log(`  Etterkontroll: premium_status=${p?.premium_status} source=${p?.premium_source} sub=${p?.personal_stripe_subscription_id}`)
  console.log(`  ${p?.premium_status === true && stillPointsToPaying ? 'OK — som 1B forutsa' : 'AVVIK — sjekk manuelt NÅ'}\n`)
}

if (!APPLY) console.log('DRY-RUN — ingenting er kansellert. Kjør med --apply KUN etter eksplisitt «kjør» fra Dennis.')
