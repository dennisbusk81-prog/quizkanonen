// Backfill av profiles.has_used_trial — DEL 1 av trial-sperren.
//
// BAKGRUNN
// /api/stripe/founders-activate måler bare NÅ-tilstand (premium_status,
// personal_stripe_subscription_id). Etter at Founders-trialene stenges
// 15. august 2026 er begge tomme for hele kohorten, og samtlige vakter åpner
// seg igjen — de kunne da gi seg selv nye gratisperioder i løkke.
// profiles.has_used_trial er det varige merket. En stopgap-UPDATE satte 69
// rader; denne fila utleder den autoritative kohorten fra Stripe og fyller
// resten.
//
//   node scripts/backfill-has-used-trial.mjs           # DRY-RUN (leser bare)
//   node scripts/backfill-has-used-trial.mjs --apply   # skriver
//
// Dry-run er standard og skriver INGENTING, verken til Supabase eller Stripe.
// Alle Stripe-kall er lesende i begge modi.
//
// KREVER: SUPABASE_SERVICE_ROLE_KEY (se trigger-fella under) og en LIVE
// Stripe-nøkkel, i .env.local eller .env.prod.
//
// TRIGGER-FELLA — HVORFOR SCRIPTET LESER TILBAKE HVER RAD
// prevent_self_trial_unmark_trigger i prod tilbakestiller has_used_trial for
// alt som ikke kjører som service_role. Skriver man med anon- eller
// authenticated-nøkkel, returnerer PostgREST suksess mens verdien står
// uendret — en helt stille feil. Derfor: (a) nøkkelens rolle verifiseres før
// noe skrives, og (b) hver skrevet rad leses tilbake og bekreftes. Avvik
// mellom «skrevet» og «bekreftet» rapporteres som FEIL med exit-kode 1.
//
// REKKEFØLGE: denne må være ferdig kjørt FØR sperren i founders-activate
// deployes. Deployes sperren først, er den blind for alle som ikke ble fanget
// av stopgap-oppdateringen.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Live-prisen for Founders Access, HARDKODET med vilje — den leses bevisst IKKE
// fra STRIPE_PRICE_FOUNDERS.
//
// Grunnen: den env-variabelen er markert «sensitive» i Vercel, og `vercel env
// pull` kan ikke lese sensitive verdier tilbake — den skriver den BOKSTAVELIGE
// strengen «[SENSITIVE]» i stedet. Det er nøyaktig hva `.env.prod` inneholder,
// og et Stripe-oppslag på den strengen gir `resource_missing` (målt 12. aug
// 2026). En env-variabel som ikke kan leses lokalt er derfor ikke en gyldig
// kilde for et lokalt script. Prod leser den ekte verdien fra Vercel og er
// upåvirket.
//
// Id-en under er verifisert i live 12. aug 2026 og sjekkes uansett mot
// produktnavn + beløp + valuta + intervall under før den brukes — samme
// dobbeltnøkling som scripts/founders-shutdown-materialize.mjs.
const FOUNDERS_PRICE_ID = 'price_1ThaC3CuFvuZpvNY31Zfs6zr'

// PostgREST tåler ikke vilkårlig lange .in()-lister (~390 id-er er målt tak i
// dette prosjektet). Kohorten er ~75, men chunking koster ingenting og fjerner
// en fremtidig stille kutting.
const IN_CHUNK = 200

const APPLY = process.argv.includes('--apply')

// ── Miljø ────────────────────────────────────────────────────────────────────
// BOM-strippingen er ikke pynt: env-verdier skrevet via PowerShell-pipe har
// fått en BOM foran første nøkkel før i dette prosjektet.
const env = {}
for (const file of ['.env.local', '.env.prod']) {
  try {
    for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fila kan mangle — den andre kan ha verdiene */ }
}

const fail = (msg) => { console.error(`AVBRYTER: ${msg}`); process.exit(1) }

if (!env.NEXT_PUBLIC_SUPABASE_URL) fail('NEXT_PUBLIC_SUPABASE_URL mangler')
if (!env.SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY mangler')

// `vercel env pull` skriver den bokstavelige strengen «[SENSITIVE]» for hver
// variabel Vercel har markert som sensitive — 15 av dem i .env.prod per 12. aug
// 2026. Uten denne sjekken ville en slik placeholder blitt brukt som om den var
// en ekte verdi, og feilen dukket opp langt nede som en uforståelig 404 fra
// Stripe eller en auth-feil fra Supabase. Feil tidlig og tydelig i stedet.
for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY']) {
  if (env[name] === '[SENSITIVE]') {
    fail(`${name} er placeholderen «[SENSITIVE]» fra en Vercel-pull, ikke en verdi — hent den ekte verdien`)
  }
}

// Kohorten finnes bare i live-Stripe. En testnøkkel mot prod-databasen ville
// gitt «0 abonnement funnet» og sett ut som «ingenting å gjøre» — nøyaktig den
// stille feilen dette scriptet finnes for å unngå.
if (!env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
  fail('STRIPE_SECRET_KEY må være en live-nøkkel (sk_live_…) — kohorten finnes kun i live')
}

// Verifiser at nøkkelen FAKTISK er service_role før vi stoler på en skriving.
// Supabase-nøkler er JWT-er med en role-claim; nye nøkler er sb_secret_-prefikset.
function assertServiceRole(key) {
  if (key.startsWith('sb_secret_')) return 'sb_secret_ (ny nøkkelform)'
  const parts = key.split('.')
  if (parts.length !== 3) fail('SUPABASE_SERVICE_ROLE_KEY har ukjent form — kan ikke bekrefte service_role')
  let role
  try {
    role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role
  } catch {
    fail('kunne ikke dekode SUPABASE_SERVICE_ROLE_KEY — kan ikke bekrefte service_role')
  }
  if (role !== 'service_role') {
    fail(`nøkkelen har role="${role}", ikke service_role — triggeren ville stilt tilbakestilt hver skriving`)
  }
  return `JWT role=service_role`
}
console.log(`Modus: ${APPLY ? 'APPLY (skriver)' : 'DRY-RUN (ingen skriv)'}`)
console.log(`Supabase-nøkkel: ${assertServiceRole(env.SUPABASE_SERVICE_ROLE_KEY)}\n`)

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ── Verifiser Founders-prisen ────────────────────────────────────────────────
// Advarselen er beholdt, men er nå ren informasjon: env-verdien STYRER ingenting.
if (env.STRIPE_PRICE_FOUNDERS && env.STRIPE_PRICE_FOUNDERS !== FOUNDERS_PRICE_ID) {
  console.warn(
    env.STRIPE_PRICE_FOUNDERS === '[SENSITIVE]'
      ? 'MERK: STRIPE_PRICE_FOUNDERS i env-filene er placeholderen «[SENSITIVE]» — en\n' +
        '      Vercel-pull av en variabel markert sensitive, ikke en pris-id. Ignoreres.\n'
      : `ADVARSEL: STRIPE_PRICE_FOUNDERS i env-filene er en ANNEN id enn den verifiserte\n` +
        `      live-prisen (${FOUNDERS_PRICE_ID}). Ignoreres av dette scriptet — men finn ut\n` +
        `      hvilken av dem prod faktisk bruker før du stoler på rapporten.\n`,
  )
}
{
  const price = await stripe.prices.retrieve(FOUNDERS_PRICE_ID, { expand: ['product'] })
  const productName = typeof price.product === 'object' && !price.product.deleted ? price.product.name : null
  const interval = price.recurring?.interval ?? null
  if (
    productName !== 'Founders Access' || price.unit_amount !== 4900 ||
    price.currency !== 'nok' || interval !== 'month' || price.livemode !== true
  ) {
    fail(
      `pris-verifisering feilet: ${FOUNDERS_PRICE_ID} er "${productName}" ` +
      `${price.unit_amount} ${price.currency} / ${interval} livemode=${price.livemode}`,
    )
  }
  console.log(`Pris verifisert: ${FOUNDERS_PRICE_ID} = "Founders Access" 49 NOK/${interval}, livemode\n`)
}

// Produktnavn-cache, kun til rapportlinjene for bortfiltrerte abonnement.
const priceLabels = new Map()
async function priceLabel(priceId) {
  if (!priceId) return 'ukjent pris'
  if (!priceLabels.has(priceId)) {
    try {
      const p = await stripe.prices.retrieve(priceId, { expand: ['product'] })
      const name = typeof p.product === 'object' && !p.product.deleted ? p.product.name : '?'
      priceLabels.set(priceId, `${name} ${(p.unit_amount ?? 0) / 100} ${String(p.currency).toUpperCase()}`)
    } catch {
      priceLabels.set(priceId, 'kunne ikke hentes')
    }
  }
  return priceLabels.get(priceId)
}

async function listAllSubscriptions(params) {
  const out = []
  let startingAfter
  while (true) {
    const page = await stripe.subscriptions.list({
      limit: 100, ...params,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    out.push(...page.data)
    if (!page.has_more) break
    startingAfter = page.data[page.data.length - 1].id
  }
  return out
}

// ── PASS A (autoritativ): abonnement på Founders-prisen ──────────────────────
// status:'all' er poenget — Stripe beholder kansellerte abonnement, så scriptet
// finner kohorten også etter 15. august.
const foundersSubs = await listAllSubscriptions({ price: FOUNDERS_PRICE_ID, status: 'all' })
const withTrial = foundersSubs.filter(s => s.trial_start != null)
const withoutTrial = foundersSubs.filter(s => s.trial_start == null)

console.log(`Abonnement på Founders-prisen:   ${foundersSubs.length}`)
console.log(`→ med trial_start != null:       ${withTrial.length}`)
console.log(`→ uten trial_start (ingen prøve): ${withoutTrial.length}`)
for (const s of withoutTrial) {
  console.log(`     ${s.id}  status=${s.status}  — aldri hatt prøveperiode, merkes ikke`)
}

// ── PASS B (revisjon): hva pris-filteret holdt ute, og hvorfor ───────────────
// Kravet er å KUNNE vise at Elkjøps B2B-abonnement og Rad E (kode + kjøp, som
// har trial_end i Stripe men er BETALT kodeperiode) faller utenfor av seg selv.
// Den påstanden må måles, ikke antas — derfor denne rene lese-passeringen.
const allSubs = await listAllSubscriptions({ status: 'all' })
const trialsOutsideFounders = allSubs.filter(
  s => s.trial_start != null && s.items.data[0]?.price?.id !== FOUNDERS_PRICE_ID,
)
console.log(`\nAbonnement totalt i Stripe:       ${allSubs.length}`)
console.log(`Med prøveperiode UTENFOR Founders-prisen (filtrert bort, røres ikke): ${trialsOutsideFounders.length}`)
for (const s of trialsOutsideFounders) {
  const pid = s.items.data[0]?.price?.id ?? null
  console.log(`     ${s.id}  status=${s.status}  pris=${pid}  (${await priceLabel(pid)})`)
}

// Krysssjekk av selve pris-filteret: settene MÅ stemme. Gjør de ikke det, er
// det API-filteret som lyver, og resten av rapporten kan ikke stoles på.
const foundersFromBroad = allSubs.filter(s => s.items.data[0]?.price?.id === FOUNDERS_PRICE_ID)
if (foundersFromBroad.length !== foundersSubs.length) {
  console.warn(
    `\nAVVIK i pris-filteret: price-filtrert kall ga ${foundersSubs.length}, ` +
    `bred enumerering ga ${foundersFromBroad.length}. Forklar før --apply.`,
  )
}

// ── Kunde → bruker ───────────────────────────────────────────────────────────
const customerIdOf = (sub) => (typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null)

const customerIds = [...new Set(withTrial.map(customerIdOf).filter(Boolean))]

const profileByCustomer = new Map()
for (let i = 0; i < customerIds.length; i += IN_CHUNK) {
  const chunk = customerIds.slice(i, i + IN_CHUNK)
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, stripe_customer_id, has_used_trial')
    .in('stripe_customer_id', chunk)
  if (error) fail(`profiles-oppslag på stripe_customer_id feilet: ${error.message}`)
  for (const row of data ?? []) profileByCustomer.set(row.stripe_customer_id, row)
}

const matched = new Map()   // userId → { userId, displayName, customerId, subIds[], via, hadTrialAlready }
const unmatched = []        // { subscriptionId, customerId, email, status }

for (const sub of withTrial) {
  const customerId = customerIdOf(sub)
  let profile = customerId ? profileByCustomer.get(customerId) ?? null : null
  let via = 'profiles.stripe_customer_id'
  let customerEmail = null

  if (!profile && customerId) {
    // Sekundært: kundens metadata.userId. Mismatch mellom kunde og profil har
    // skjedd i dette prosjektet før, så begge veier prøves før vi gir opp.
    const customer = await stripe.customers.retrieve(customerId)
    customerEmail = customer.deleted ? null : customer.email ?? null
    const metaUserId = customer.deleted ? null : customer.metadata?.userId ?? null
    if (metaUserId) {
      const { data: byId, error: byIdErr } = await supabase
        .from('profiles')
        .select('id, display_name, stripe_customer_id, has_used_trial')
        .eq('id', metaUserId)
        .maybeSingle()
      if (byIdErr) fail(`profiles-oppslag på id=${metaUserId} feilet: ${byIdErr.message}`)
      if (byId) { profile = byId; via = 'customer.metadata.userId' }
    }
  }

  if (!profile) {
    // Hoppes ALDRI stille over — listes for manuell gjennomgang.
    unmatched.push({ subscriptionId: sub.id, customerId, email: customerEmail, status: sub.status })
    continue
  }

  const existing = matched.get(profile.id)
  if (existing) {
    existing.subIds.push(sub.id)
  } else {
    matched.set(profile.id, {
      userId: profile.id,
      displayName: profile.display_name ?? null,
      customerId,
      subIds: [sub.id],
      via,
      hadTrialAlready: profile.has_used_trial === true,
    })
  }
}

const plan = [...matched.values()]
const alreadyTrue = plan.filter(p => p.hadTrialAlready)
const toWrite = plan.filter(p => !p.hadTrialAlready)

console.log(`\n=== KOHORT ===`)
console.log(`Abonnement med prøveperiode:      ${withTrial.length}`)
console.log(`→ matchet til bruker (unike):     ${plan.length}`)
console.log(`→ allerede has_used_trial=true:   ${alreadyTrue.length}  (stopgap-oppdateringen)`)
console.log(`→ MANGLER merket, skal skrives:   ${toWrite.length}`)
console.log(`→ UMATCHEDE (manuell gjennomgang): ${unmatched.length}`)
for (const u of unmatched) {
  console.log(`     sub=${u.subscriptionId} (${u.status})  kunde=${u.customerId}  e-post=${u.email ?? 'ukjent'}`)
}
const dupes = plan.filter(p => p.subIds.length > 1)
for (const d of dupes) {
  console.log(`     MERK: ${d.userId} har ${d.subIds.length} Founders-abonnement med prøve: ${d.subIds.join(', ')}`)
}
console.log(`Kontrollsum: ${plan.reduce((n, p) => n + p.subIds.length, 0)} + ${unmatched.length} = ` +
  `${plan.reduce((n, p) => n + p.subIds.length, 0) + unmatched.length} (skal være ${withTrial.length})`)

if (toWrite.length === 0) {
  console.log('\nIngen rader mangler merket. 0 nye er mulig, men skal forklares — ' +
    'sjekk at tallene over stemmer med forventet kohortstørrelse (>= 72).')
}

console.log('\nRader som skal endres (false → true):')
for (const p of toWrite) {
  console.log(`  ${p.userId}  ${p.displayName ?? '(uten navn)'}  via ${p.via}`)
}

if (!APPLY) {
  console.log('\nDRY-RUN — ingenting er skrevet. Kjør på nytt med --apply for å lagre.')
  process.exit(0)
}

// ── Skriv (idempotent) ───────────────────────────────────────────────────────
// .eq('has_used_trial', false) gjør skrivingen idempotent OG gjør returnerte
// rader til et ærlig mål på «endret verdi»: en rad som alt var true matches ikke.
let changed = 0
let writeErrors = 0
for (const p of toWrite) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ has_used_trial: true })
    .eq('id', p.userId)
    .eq('has_used_trial', false)
    .select('id')
    .maybeSingle()
  if (error) {
    writeErrors++
    console.error(`  skriving feilet for ${p.userId}: ${error.message}`)
  } else if (data) {
    changed++
  } else {
    console.warn(`  ${p.userId}: ingen rad endret (satt av noe annet i mellomtiden?)`)
  }
}

// ── Les tilbake og BEKREFT ───────────────────────────────────────────────────
// Uten dette ville en skriving med feil nøkkel rapportert full suksess mens
// triggeren stilt tilbakestilte hver rad.
const allIds = plan.map(p => p.userId)
const verified = new Map()
for (let i = 0; i < allIds.length; i += IN_CHUNK) {
  const chunk = allIds.slice(i, i + IN_CHUNK)
  const { data, error } = await supabase
    .from('profiles')
    .select('id, has_used_trial')
    .in('id', chunk)
  if (error) fail(`tilbakelesing feilet: ${error.message} — skrivingen kan IKKE bekreftes`)
  for (const row of data ?? []) verified.set(row.id, row.has_used_trial === true)
}

const confirmed = allIds.filter(id => verified.get(id) === true)
const notConfirmed = allIds.filter(id => verified.get(id) !== true)

console.log(`\n=== RESULTAT ===`)
console.log(`Rader som endret verdi (false → true): ${changed} av ${toWrite.length}`)
console.log(`Skrivefeil:                            ${writeErrors}`)
console.log(`Bekreftet true ved tilbakelesing:      ${confirmed.length} av ${allIds.length}`)

if (notConfirmed.length > 0 || writeErrors > 0 || changed !== toWrite.length) {
  console.error('\nFEIL — skrivingen er IKKE fullt bekreftet.')
  for (const id of notConfirmed) {
    console.error(`  ${id}: has_used_trial = ${verified.has(id) ? verified.get(id) : 'raden ble ikke funnet'}`)
  }
  console.error(
    'Står radene uendret på false, er den mest sannsynlige årsaken at skrivingen ikke\n' +
    'kjørte som service_role, og at prevent_self_trial_unmark_trigger tilbakestilte dem.',
  )
  process.exit(1)
}

console.log('\nAlle planlagte rader er skrevet OG bekreftet. Sperren i founders-activate kan deployes.')
