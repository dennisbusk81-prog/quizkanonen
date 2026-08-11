// Founders-nedstengningen 15. august 2026 — DEL 2: materialiser listen.
//
// Etter at trialene kanselleres nulles personal_stripe_subscription_id og
// premium_source rekalkuleres — det finnes ingen enkel databasevei tilbake til
// hvem kohorten var. Denne fila fryser den FØR kanselleringen, i
// lib/founders-farewell-list.json (under versjonskontroll; leses også av
// utsendelsesruten /api/admin/founders-farewell).
//
//   node scripts/founders-shutdown-materialize.mjs
//
// KUN LESING mot Stripe og Supabase. Skriver bare listefila lokalt.
//
// Ekskludert fra listen, med egen rapportlinje:
//   a) Dennis' egen konto (collection paused til 14. sep — håndteres manuelt)
//   b) kunder som allerede har et ANNET levende abonnement (orphans/konverterte
//      — del 4 rydder trialene deres separat; de skal ikke ha utløps-e-post)
// Umatchede (sub uten identifiserbar bruker) listes for manuell gjennomgang.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Live-prisen for Founders Access, dobbeltnøklet: id-en er målt i live 11. aug
// 2026, og verifiseres under mot produktnavn + beløp før noe brukes.
const FOUNDERS_PRICE_ID = 'price_1ThaC3CuFvuZpvNY31Zfs6zr'
const DENNIS_EMAIL = 'dennisbusk81@gmail.com'
const EXPECTED_FOUNDERS_TRIALS = 75 // 76 trialing totalt minus Elkjøps B2B-abonnement

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

// ── Verifiser prisen før noe annet ───────────────────────────────────────────
const price = await stripe.prices.retrieve(FOUNDERS_PRICE_ID, { expand: ['product'] })
const productName = typeof price.product === 'object' && !price.product.deleted ? price.product.name : null
if (productName !== 'Founders Access' || price.unit_amount !== 4900 || price.currency !== 'nok') {
  console.error(`Pris-verifisering FEILET: ${FOUNDERS_PRICE_ID} er "${productName}" ${price.unit_amount} ${price.currency} — avbryter`)
  process.exit(1)
}
console.log(`Pris verifisert: ${FOUNDERS_PRICE_ID} = "Founders Access" 49 kr/mnd\n`)

// ── Alle trialing-abonnement, paginert ───────────────────────────────────────
const allTrialing = []
let startingAfter
while (true) {
  const page = await stripe.subscriptions.list({
    status: 'trialing', limit: 100,
    ...(startingAfter ? { starting_after: startingAfter } : {}),
  })
  allTrialing.push(...page.data)
  if (!page.has_more) break
  startingAfter = page.data[page.data.length - 1].id
}
const foundersTrials = allTrialing.filter(s => s.items.data[0]?.price?.id === FOUNDERS_PRICE_ID)
const otherTrials = allTrialing.filter(s => s.items.data[0]?.price?.id !== FOUNDERS_PRICE_ID)
console.log(`Trialing totalt: ${allTrialing.length} — på Founders-prisen: ${foundersTrials.length}`)
for (const s of otherTrials) {
  console.log(`  (utenfor: ${s.id} pris=${s.items.data[0]?.price?.id} — ikke Founders, røres ikke)`)
}
if (foundersTrials.length !== EXPECTED_FOUNDERS_TRIALS) {
  console.warn(`\nAVVIK: forventet ${EXPECTED_FOUNDERS_TRIALS} Founders-trialer, fant ${foundersTrials.length} — forklar før videre bruk!`)
}

// ── Brukerkart fra Supabase ──────────────────────────────────────────────────
const { data: usersPage, error: usersErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (usersErr) { console.error('listUsers feilet:', usersErr.message); process.exit(1) }
if (usersPage.users.length >= 1000) {
  console.error('Over 1000 brukere — pagineringen i dette scriptet må utvides'); process.exit(1)
}
const emailByUserId = new Map(usersPage.users.map(u => [u.id, u.email ?? null]))

const customerIds = foundersTrials.map(s => typeof s.customer === 'string' ? s.customer : s.customer.id)
const { data: profileRows, error: profErr } = await supabase
  .from('profiles')
  .select('id, display_name, stripe_customer_id')
  .in('stripe_customer_id', customerIds)
if (profErr) { console.error('profiles-oppslag feilet:', profErr.message); process.exit(1) }
const profileByCustomer = new Map((profileRows ?? []).map(p => [p.stripe_customer_id, p]))

// ── Klassifiser hver trial ───────────────────────────────────────────────────
const LIVE = ['active', 'trialing', 'past_due', 'unpaid']
const entries = []
const converted = []
const unmatched = []
let dennis = null

for (const sub of foundersTrials) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

  // Primært: profiles.stripe_customer_id. Sekundært: customer.metadata.userId.
  let profile = profileByCustomer.get(customerId) ?? null
  const customer = await stripe.customers.retrieve(customerId)
  const customerEmail = customer.deleted ? null : customer.email ?? null
  if (!profile) {
    const metaUserId = customer.deleted ? null : customer.metadata?.userId ?? null
    if (metaUserId) {
      const { data: byId } = await supabase.from('profiles')
        .select('id, display_name, stripe_customer_id').eq('id', metaUserId).maybeSingle()
      if (byId) profile = byId
    }
  }

  const record = {
    userId: profile?.id ?? null,
    email: (profile ? emailByUserId.get(profile.id) : null) ?? customerEmail,
    displayName: profile?.display_name ?? null,
    customerId,
    subscriptionId: sub.id,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
  }

  // a) Dennis — pause_collection + kjent e-post. Egen rapportlinje, aldri i listen.
  if (record.email === DENNIS_EMAIL || sub.pause_collection) {
    if (record.email !== DENNIS_EMAIL) {
      console.error(`STOPP: ${sub.id} har pause_collection men er IKKE Dennis (${record.email}) — må vurderes manuelt`)
      process.exit(1)
    }
    dennis = { ...record, pauseResumesAt: sub.pause_collection?.resumes_at ? new Date(sub.pause_collection.resumes_at * 1000).toISOString() : null }
    continue
  }

  // b) Kunden har et ANNET levende abonnement → allerede konvertert/orphan.
  const allSubs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 })
  const otherLive = allSubs.data.filter(s => s.id !== sub.id && LIVE.includes(s.status))
  if (otherLive.length > 0) {
    converted.push({ ...record, otherSubscriptions: otherLive.map(s => ({ id: s.id, status: s.status, priceId: s.items.data[0]?.price?.id ?? null })) })
    continue
  }

  // Uten identifiserbar bruker OG uten e-post kan hverken e-post eller
  // verifisering gjøres — manuell gjennomgang, hoppes ALDRI stille over.
  if (!record.userId && !record.email) {
    unmatched.push(record)
    continue
  }
  if (!record.userId) {
    // E-post finnes fra Stripe-kunden, men ingen profil — fortsatt manuelt:
    // uten userId kan ikke utsendelsesruten gjøre fersk konverteringssjekk
    // mot vår egen database, og stemplingen mangler nøkkel.
    unmatched.push(record)
    continue
  }
  entries.push(record)
}

// ── Rapport ──────────────────────────────────────────────────────────────────
console.log(`\n=== RESULTAT ===`)
console.log(`Founders-trialer totalt:        ${foundersTrials.length}`)
console.log(`→ Hovedliste (end_behavior+e-post): ${entries.length}`)
console.log(`→ Ekskludert a) Dennis:          ${dennis ? 1 : 0}  ${dennis ? `(${dennis.subscriptionId}, pause til ${dennis.pauseResumesAt ?? '?'})` : 'IKKE FUNNET — avvik!'}`)
console.log(`→ Ekskludert b) konverterte:     ${converted.length}`)
for (const c of converted) {
  console.log(`     ${c.email}  trial=${c.subscriptionId}  andre=${c.otherSubscriptions.map(o => `${o.id}(${o.status})`).join(', ')}`)
}
console.log(`→ UMATCHEDE (manuell gjennomgang): ${unmatched.length}`)
for (const u of unmatched) {
  console.log(`     sub=${u.subscriptionId} cust=${u.customerId} email=${u.email ?? 'ukjent'}`)
}
const accounted = entries.length + (dennis ? 1 : 0) + converted.length + unmatched.length
console.log(`Kontrollsum: ${entries.length} + ${dennis ? 1 : 0} + ${converted.length} + ${unmatched.length} = ${accounted} (skal være ${foundersTrials.length})`)

const out = {
  generatedAt: new Date().toISOString(),
  foundersPriceId: FOUNDERS_PRICE_ID,
  counts: { foundersTrials: foundersTrials.length, mainList: entries.length, converted: converted.length, unmatched: unmatched.length, dennisExcluded: dennis ? 1 : 0 },
  entries,
  excluded: { dennis, converted },
  unmatched,
}
writeFileSync('lib/founders-farewell-list.json', JSON.stringify(out, null, 2) + '\n')
console.log('\nSkrevet til lib/founders-farewell-list.json — husk å committe fila.')
