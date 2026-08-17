// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte Stripe-webhooken. `mock.module` bytter ut
// stripe-SDK-et, supabase-admin, e-postsending og premium-rekalkuleringen,
// slik at produksjonskoden kjøres uendret — ingen injiserte parametere, ingen
// egen testvei, og ingen ekte e-post ut fra Resend.
//
// Hovedscenarioet er Magnus-sekvensen (28. juli 2026): en kortløs
// Founders-trial som løper ut. Stripe lager faktura → invoice.payment_failed
// → past_due → customer.subscription.deleted med
// cancellation_details.reason = 'payment_failed'. Fram til denne fiksen fikk
// brukeren «Premium-abonnementet ditt er avsluttet» om et abonnement de aldri
// betalte en krone for.
//
// MUTASJONSBEVIS (verifisert manuelt): fjernes
// shouldSendCancellationEmail-vakten i subscription.deleted, feiler
// «Magnus-sekvensen …» med 1 sendt e-post i stedet for 0. Fjernes
// HULL 1-oppslaget (liveSubIds), feiler «stale deleted …».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy'

const CUSTOMER = 'cus_magnus'
const SUB_TRIAL = 'sub_founders_trial'
const SUB_NEW = 'sub_nyt_abonnement'
const PROFILE_ID = '11111111-2222-3333-4444-555555555555'

type SubRow = { id: string; status: string }

const state: {
  event: Record<string, unknown>
  /** profiles.personal_stripe_subscription_id slik den står i «databasen». */
  storedSubId: string | null
  /** Abonnement stripe.subscriptions.list skal returnere. */
  stripeSubs: SubRow[]
  /** Antall registrerte betalingsmetoder hos kunden. */
  paymentMethods: number
  sent: Array<{ to: string; subject: string }>
  profileUpdates: Array<Record<string, unknown>>
  recomputed: string[]
  listCalls: number
  /** profiles.personal_grace_until slik den står i «databasen». */
  existingGrace: string | null
} = {
  event: {},
  storedSubId: null,
  stripeSubs: [],
  paymentMethods: 0,
  sent: [],
  profileUpdates: [],
  recomputed: [],
  listCalls: 0,
  existingGrace: null,
}

// ── Stripe-SDK ─────────────────────────────────────────────────────────────
class MockStripe {
  webhooks = {
    constructEvent: () => state.event,
  }
  subscriptions = {
    list: async () => {
      state.listCalls++
      return { data: state.stripeSubs }
    },
    retrieve: async (id: string) => ({ id, status: 'past_due' }),
  }
  customers = {
    retrieve: async () => ({ deleted: false, email: 'magnus.rolstad@example.test' }),
    listPaymentMethods: async () => ({
      data: Array.from({ length: state.paymentMethods }, (_, i) => ({ id: `pm_${i}` })),
    }),
  }
}
mock.module('stripe', { defaultExport: MockStripe })

// ── Supabase ───────────────────────────────────────────────────────────────
function builder(table: string) {
  const b = {
    _update: null as Record<string, unknown> | null,
    select() { return b },
    eq() { return b },
    in() { return b },
    limit() { return b },
    insert() { return Promise.resolve({ error: null }) },
    delete() { return Promise.resolve({ error: null }) },
    update(values: Record<string, unknown>) {
      b._update = values
      if (table === 'profiles') state.profileUpdates.push(values)
      return b
    },
    maybeSingle() {
      // B2C-scenario: ingen org matcher kunden.
      if (table === 'organizations') return Promise.resolve({ data: null, error: null })
      if (table === 'profiles') {
        return Promise.resolve({
          data: { id: PROFILE_ID, personal_stripe_subscription_id: state.storedSubId },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
    // `.update(...).eq(...)` awaites uten terminalmetode.
    then(resolve: (v: unknown) => void) { return resolve({ data: null, error: null }) },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => builder(table),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'x@y.no' } } }) } },
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (opts: { to: string; subject: string }) => { state.sent.push(opts) },
  },
})

mock.module('@/lib/premium-state-io', {
  namedExports: {
    syncPremiumCache: async (id: string) => { state.recomputed.push(id) },
    // Karensperioden (17. august 2026). Webhooken leser den for å avgjøre om en
    // ny skal gis eller om en allerede løper.
    getPersonalGrace: async () => state.existingGrace,
  },
})

mock.module('@/lib/org-premium', {
  namedExports: { hasActiveOrgPremium: async () => false },
})

const { POST } = await import('@/app/api/stripe/webhook/route')

// E-postsendingen i webhooken er bevisst fire-and-forget (`.then(...)` uten
// await), så responsen returnerer FØR sendEmail rekker å kjøre. Uten denne
// flushen ville «ingen e-post sendt»-assertene bestått uansett — altså vært
// verdiløse. Ett makrotask-tick er nok: kjeden er getUserEmail →
// customers.retrieve (mocket, løser umiddelbart) → sendEmail.
function flush() {
  return new Promise(resolve => setTimeout(resolve, 10))
}

async function call() {
  const request = new Request('https://quizkanonen.no/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=dummy' },
    body: '{}',
  })
  const res = await POST(request as never)
  await flush()
  return res
}

function deletedEvent(reason: string | null, subId = SUB_TRIAL) {
  return {
    id: `evt_del_${Math.random()}`,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: subId,
        customer: CUSTOMER,
        status: 'canceled',
        cancellation_details: reason ? { reason } : null,
      },
    },
  }
}

beforeEach(() => {
  state.storedSubId = SUB_TRIAL
  state.stripeSubs = []
  state.paymentMethods = 0
  state.sent = []
  state.profileUpdates = []
  state.recomputed = []
  state.listCalls = 0
  state.existingGrace = null
})

// ── Karensperiode ved ufrivillig betalingsfeil (17. august 2026) ───────────
//
// Beviser KOBLINGEN, ikke reglene: at webhooken faktisk skriver stempelet, at
// den slutter å behandle past_due som en kansellering, og at den rydder igjen.
// Reglene i seg selv ligger i lib/personal-grace.test.ts.

function updatedEvent(status: string, subId = SUB_TRIAL) {
  return {
    id: `evt_upd_${Math.random()}`,
    type: 'customer.subscription.updated',
    data: { object: { id: subId, customer: CUSTOMER, status } },
  }
}

const graceWrite = () =>
  state.profileUpdates.find(u => 'personal_grace_until' in u && u.personal_grace_until !== null)
const graceClear = () =>
  state.profileUpdates.find(u => 'personal_grace_until' in u && u.personal_grace_until === null)
const subIdNulled = () =>
  state.profileUpdates.find(u => u.personal_stripe_subscription_id === null)

test('past_due MED kort → karensperiode stemples, og abonnementet regnes IKKE som kansellert', async () => {
  state.paymentMethods = 1
  state.event = updatedEvent('past_due')
  await call()

  const written = graceWrite()
  assert.ok(written, 'past_due skal skrive en karensdato')
  assert.equal(written.personal_grace_reason, 'payment_failed')
  // 14 dager fram, med romslig slingringsmonn for kjøretid.
  const days = (new Date(written.personal_grace_until as string).getTime() - Date.now()) / 86_400_000
  assert.ok(days > 13.9 && days < 14.1, `forventet ~14 dager, fikk ${days}`)

  assert.equal(subIdNulled(), undefined, 'abonnementet lever — id-en skal IKKE nulles')
  assert.deepEqual(state.recomputed, [PROFILE_ID], 'premium skal rekalkuleres med karensen inne')
})

test('unpaid MED kort behandles likt past_due', async () => {
  state.paymentMethods = 1
  state.event = updatedEvent('unpaid')
  await call()
  assert.ok(graceWrite(), 'unpaid skal også gi karens')
  assert.equal(subIdNulled(), undefined)
})

test('purring nr. 2 forlenger ikke en løpende karensperiode', async () => {
  state.paymentMethods = 1
  state.existingGrace = new Date(Date.now() + 9 * 86_400_000).toISOString()
  state.event = updatedEvent('unpaid')
  await call()

  assert.equal(graceWrite(), undefined, 'ingen ny dato skal skrives')
  assert.deepEqual(state.recomputed, [PROFILE_ID], 'premium rekalkuleres likevel')
})

test('betalingen går gjennom i karensperioden → karensen ryddes (krav 2)', async () => {
  state.paymentMethods = 1
  state.existingGrace = new Date(Date.now() + 9 * 86_400_000).toISOString()
  state.event = updatedEvent('active')
  await call()

  const cleared = graceClear()
  assert.ok(cleared, 'reaktivering skal rydde karensen')
  assert.equal(cleared.personal_grace_reason, null)
})

test('Stripe kansellerer etter 14 dager → karensen ryddes FØR rekalkuleringen (krav 3)', async () => {
  // Rekkefølgen er hele poenget: rydder vi etter at premium er regnet ut, ville
  // den utgåtte karensen gitt Premium én runde til.
  state.paymentMethods = 1
  state.storedSubId = SUB_TRIAL
  state.existingGrace = new Date(Date.now() + 1 * 86_400_000).toISOString()
  state.event = deletedEvent('payment_failed')
  await call()

  const clearIdx = state.profileUpdates.findIndex(u => u.personal_grace_until === null)
  const nullIdx = state.profileUpdates.findIndex(u => u.personal_stripe_subscription_id === null)
  assert.ok(clearIdx >= 0, 'karensen skal ryddes ved kansellering')
  assert.ok(nullIdx >= 0, 'abonnements-id-en skal nulles ved kansellering')
  assert.ok(clearIdx < nullIdx, 'ryddingen skjer først')
  assert.deepEqual(state.recomputed, [PROFILE_ID])
})

test('frivillig oppsigelse gir ingen karens — den går rett til kansellering (krav 1)', async () => {
  state.paymentMethods = 1
  state.event = updatedEvent('canceled')
  await call()

  assert.equal(graceWrite(), undefined, 'en oppsigelse skal aldri gi karens')
  assert.ok(subIdNulled(), 'og skal fortsatt rydde abonnements-id-en')
})

// ── Magnus-sekvensen ───────────────────────────────────────────────────────

test('Magnus-sekvensen: kortløs Founders-trial løper ut → INGEN «Premium avsluttet»-e-post', async () => {
  // Steg 1: subscription.updated → past_due. Denne nuller feltet.
  state.event = {
    id: 'evt_upd_1',
    type: 'customer.subscription.updated',
    data: { object: { id: SUB_TRIAL, customer: CUSTOMER, status: 'past_due' } },
  }
  await call()

  assert.deepEqual(
    state.profileUpdates.at(-1),
    { personal_stripe_subscription_id: null },
    'past_due skal nulle abonnements-id-en',
  )
  assert.deepEqual(state.recomputed, [PROFILE_ID], 'premium skal rekalkuleres, ikke slås av blindt')
  assert.equal(state.sent.length, 0, 'subscription.updated sender ingen e-post')

  // Steg 2: feltet er nå NULL i databasen (hull 1-tilstanden), og
  // subscription.deleted ankommer for det SAMME abonnementet.
  state.storedSubId = null
  state.paymentMethods = 0          // aldri lagt inn kort
  state.stripeSubs = []             // ingen andre levende abonnement
  state.sent = []
  state.recomputed = []             // nullstilles så steg 2 måles for seg
  state.event = deletedEvent('payment_failed')
  await call()

  assert.equal(
    state.sent.length, 0,
    'kortløs trial som løp ut skal IKKE få «Premium-abonnementet ditt er avsluttet»',
  )
  // Hendelsen skal likevel BEHANDLES — det er kun e-posten som var feil.
  assert.deepEqual(state.recomputed, [PROFILE_ID], 'premium skal fortsatt rekalkuleres')
})

// ── Ingen regresjon på ekte kanselleringer ─────────────────────────────────

test('ekte kansellering med kort på fil → «Premium avsluttet» sendes som før', async () => {
  state.storedSubId = SUB_TRIAL
  state.paymentMethods = 1
  state.event = deletedEvent('cancellation_requested')
  await call()

  assert.equal(state.sent.length, 1)
  assert.match(state.sent[0].subject, /avsluttet/)
})

test('dunning-kansellering med kort (kortet ble avvist) → e-post sendes', async () => {
  state.storedSubId = SUB_TRIAL
  state.paymentMethods = 1
  state.event = deletedEvent('payment_failed')
  await call()

  assert.equal(state.sent.length, 1, 'en ekte betalende kunde skal fortsatt varsles')
})

test('bruker uten kort som SELV ba om å avslutte → e-post sendes likevel', async () => {
  state.storedSubId = SUB_TRIAL
  state.paymentMethods = 0
  state.event = deletedEvent('cancellation_requested')
  await call()

  assert.equal(state.sent.length, 1, 'selv-initiert avslutning skal alltid bekreftes')
})

// ── HULL 1: stale-hendelse mens feltet er NULL ─────────────────────────────

test('HULL 1 — stale deleted for gammelt abonnement mens et NYTT lever → ignoreres helt', async () => {
  // Feltet er nullet av en tidligere hendelse, brukeren har siden kjøpt på nytt.
  // Den sene deleted-en for det gamle abonnementet skal verken røre premium
  // eller sende e-post til en kunde som nettopp har betalt.
  state.storedSubId = null
  state.stripeSubs = [{ id: SUB_NEW, status: 'active' }]
  state.paymentMethods = 1
  state.event = deletedEvent('cancellation_requested', SUB_TRIAL)
  await call()

  assert.equal(state.listCalls, 1, 'NULL-feltet skal utløse et Stripe-oppslag')
  assert.equal(state.sent.length, 0, 'ingen «Premium avsluttet» til en kunde med ferskt abonnement')
  assert.deepEqual(state.recomputed, [], 'premium skal ikke rekalkuleres for en stale hendelse')
  assert.deepEqual(state.profileUpdates, [], 'abonnements-id-en skal ikke nulles på nytt')
})

test('HULL 1 — NULL felt uten andre levende abonnement → behandles normalt', async () => {
  state.storedSubId = null
  state.stripeSubs = []
  state.paymentMethods = 1
  state.event = deletedEvent('cancellation_requested', SUB_TRIAL)
  await call()

  assert.equal(state.sent.length, 1, 'ekte kansellering skal fortsatt varsles')
  assert.deepEqual(state.recomputed, [PROFILE_ID])
})

test('satt felt som matcher → ingen unødvendig Stripe-oppslag', async () => {
  state.storedSubId = SUB_TRIAL
  state.paymentMethods = 1
  state.event = deletedEvent('cancellation_requested', SUB_TRIAL)
  await call()

  assert.equal(state.listCalls, 0, 'et satt felt er autoritativt — ingen ekstra API-kall')
  assert.equal(state.sent.length, 1)
})
