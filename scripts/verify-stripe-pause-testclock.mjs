// Ekte verifisering av rad D og E mot Stripe, med Test Clocks.
//
// Kjører KUN mot test-modus (STRIPE_TEST_SECRET_KEY). Skriptet nekter å starte
// hvis nøkkelen ikke begynner med sk_test_ — live-nøkkelen skal aldri kunne
// havne her ved et uhell.
//
//   node scripts/verify-stripe-pause-testclock.mjs
//
// RAD D: kunde med betalt abonnement løser inn kode → abonnementet pauses fra
//        slutten av inneværende betalte periode, og GJENOPPTAS AUTOMATISK når
//        koden utløper. Det er «automatisk» som må bevises — resten er vår kode.
//
// RAD E: kunde med aktiv kode starter abonnement → første faktura utsettes til
//        koden utløper (subscription_data.trial_end), og trekkes deretter.
import { readFileSync } from 'node:fs'
import Stripe from 'stripe'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const KEY = env.STRIPE_TEST_SECRET_KEY
const PRICE = env.STRIPE_TEST_PRICE_MONTHLY
if (!KEY || !KEY.startsWith('sk_test_')) {
  console.error('STRIPE_TEST_SECRET_KEY mangler eller er ikke en test-nøkkel. Avbryter.')
  process.exit(1)
}
if (!PRICE) { console.error('STRIPE_TEST_PRICE_MONTHLY mangler. Avbryter.'); process.exit(1) }

const stripe = new Stripe(KEY, { apiVersion: '2026-03-25.dahlia' })
const DAY = 86_400

let failures = 0
const check = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`   ${ok ? 'OK  ' : 'FEIL'}  ${label}: ${actual}${ok ? '' : ` (forventet ${expected})`}`)
}

async function advanceTo(clockId, unixTime, label) {
  process.stdout.write(`   spoler klokka → ${new Date(unixTime * 1000).toISOString().slice(0, 10)} (${label}) `)
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: unixTime })
  for (let i = 0; i < 120; i++) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId)
    if (clock.status === 'ready') { console.log('✓'); return }
    if (clock.status === 'internal_failure') throw new Error('test clock internal_failure')
    process.stdout.write('.')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('test clock ble aldri ready')
}

async function newCustomerOnClock(clockId, label) {
  const customer = await stripe.customers.create({
    test_clock: clockId,
    email: `${label}@example.test`,
    payment_method: 'pm_card_visa',
    invoice_settings: { default_payment_method: 'pm_card_visa' },
  })
  return customer
}

// Måler PENGER, ikke antall fakturaer. Et abonnement som starter i trial får en
// faktura på 0 kr med status 'paid' (billing_reason=subscription_create) — den
// er ikke et trekk, og å telle fakturaer ville gitt falskt utslag.
const chargedOre = async customerId => {
  const invoices = await stripe.invoices.list({ customer: customerId, limit: 100 })
  return invoices.data.reduce((sum, i) => sum + i.amount_paid, 0)
}

const clocks = []

try {
  // ══ RAD D ═══════════════════════════════════════════════════════════════════
  console.log('\n── RAD D: betalt abonnement + kode → pause → automatisk gjenopptak ──')
  const t0 = Math.floor(Date.now() / 1000)
  const clockD = await stripe.testHelpers.testClocks.create({ frozen_time: t0, name: 'rad-D' })
  clocks.push(clockD.id)

  const custD = await newCustomerOnClock(clockD.id, 'rad-d')
  const subD = await stripe.subscriptions.create({
    customer: custD.id,
    items: [{ price: PRICE }],
  })
  check('abonnementet er aktivt etter opprettelse', subD.status, 'active')
  check('49 kr trukket ved oppstart', await chargedOre(custD.id), 4900)

  const periodEnd = subD.items.data[0].current_period_end
  console.log(`   inneværende betalte periode slutter ${new Date(periodEnd * 1000).toISOString().slice(0, 10)}`)

  // Dette er nøyaktig det decideRedemption beregner: koden starter ved
  // periodeslutt (ingen betalt tid går tapt) og varer 30 dager.
  const codeEnd = periodEnd + 30 * DAY
  await stripe.subscriptions.update(subD.id, {
    pause_collection: { behavior: 'void', resumes_at: codeEnd },
  })
  const paused = await stripe.subscriptions.retrieve(subD.id)
  check('pause registrert med behavior=void', paused.pause_collection?.behavior, 'void')
  check('abonnementet er FORTSATT active under pause', paused.status, 'active')

  // Inn i pause-vinduet, forbi den første fornyelsesgrensen.
  await advanceTo(clockD.id, periodEnd + 2 * DAY, 'forbi fornyelse, midt i kode-perioden')
  const during = await stripe.subscriptions.retrieve(subD.id)
  check('INGENTING trukket i pause-vinduet', await chargedOre(custD.id), 4900)
  check('pausen står fortsatt', during.pause_collection !== null, true)
  check('abonnementet er ikke kansellert', during.status, 'active')

  // Forbi resumes_at.
  await advanceTo(clockD.id, codeEnd + 3 * DAY, 'forbi kodens utløp')
  const after = await stripe.subscriptions.retrieve(subD.id)
  check('pausen er OPPHEVET automatisk', after.pause_collection, null)
  check('abonnementet lever fortsatt', after.status, 'active')
  const paidAfter = await chargedOre(custD.id)
  console.log(`   totalt trukket etter gjenopptak: ${paidAfter / 100} kr`)
  check('fakturering gjenopptatt — nytt trekk kom', paidAfter > 4900, true)

  // ══ RAD E ═══════════════════════════════════════════════════════════════════
  console.log('\n── RAD E: aktiv kode + nytt abonnement → første faktura utsatt ──')
  const e0 = Math.floor(Date.now() / 1000)
  const clockE = await stripe.testHelpers.testClocks.create({ frozen_time: e0, name: 'rad-E' })
  clocks.push(clockE.id)

  const custE = await newCustomerOnClock(clockE.id, 'rad-e')
  const codeEndE = e0 + 30 * DAY
  const subE = await stripe.subscriptions.create({
    customer: custE.id,
    items: [{ price: PRICE }],
    trial_end: codeEndE, // samme verdi checkout-ruten setter i subscription_data
  })
  check('abonnementet står i trial ut kode-perioden', subE.status, 'trialing')
  check('ingen kroner trukket ved oppstart', await chargedOre(custE.id), 0)
  check('trial slutter når koden slutter', subE.trial_end, codeEndE)

  await advanceTo(clockE.id, codeEndE - 2 * DAY, 'to dager før koden utløper')
  check('fortsatt ingen kroner trukket mens koden gjelder', await chargedOre(custE.id), 0)

  await advanceTo(clockE.id, codeEndE + 2 * DAY, 'forbi kodens utløp')
  const afterE = await stripe.subscriptions.retrieve(subE.id)
  check('abonnementet er aktivt etter trial', afterE.status, 'active')
  check('første trekk kommer først NÅ (49 kr)', await chargedOre(custE.id), 4900)

} finally {
  for (const id of clocks) {
    try {
      await stripe.testHelpers.testClocks.del(id)
      console.log(`\nRyddet test clock ${id} (sletter tilhørende testkunder)`)
    } catch (err) {
      console.error(`Kunne ikke slette test clock ${id}:`, err.message)
    }
  }
}

console.log(`\n${failures === 0 ? 'ALLE SJEKKER OK' : `${failures} SJEKKER FEILET`}`)
process.exit(failures === 0 ? 0 : 1)
