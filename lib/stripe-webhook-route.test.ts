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
  /**
   * Lar en maybeSingle()-lesing feile per tabell (19. august 2026). PostgREST
   * gir da `{ data: null, error }` — og det er nettopp `data: null` som ikke
   * lar seg skille fra «raden finnes ikke», som er hele feilklassen
   * assertCriticalRead finnes for.
   */
  readError: Record<string, { code: string; message: string } | undefined>
  /**
   * Samme, men konsumert ÉN lesing om gangen. Nødvendig fordi to av grenene
   * slår opp profilen to ganger (primært på kunde-id, sekundært på
   * abonnements-id): lar man begge feile, fanger fallback-vakten alt, og
   * vakten på primæroppslaget kan fjernes uten at en eneste test blir rød.
   *
   * `'empty'` betyr «spørringen gikk bra, men fant ingen rad» — nødvendig for å
   * i det hele tatt NÅ fallback-oppslaget, og dermed for å kunne felle vakten
   * som står på det.
   */
  readErrorQueue: Record<string, Array<{ code: string; message: string } | 'empty' | null>>
  /** organizations.maybeSingle skal gi treff (B2B-scenario) i stedet for null. */
  orgRow: Record<string, unknown> | null
  /**
   * Rader en `.update(...).select('id')`-kjede på profiles skal returnere,
   * konsumert ÉN kjede om gangen (kilde-sync-testene, 19. august 2026).
   * Active-grenen har to slike kjeder (primær på kunde-id, fallback på
   * sub-id) — en kø, ikke én verdi, er det som lar testen skille dem.
   */
  profileUpdateRowsQueue: Array<Array<{ id: string }>>
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
  readError: {},
  readErrorQueue: {},
  orgRow: null,
  profileUpdateRowsQueue: [],
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
    // Satt når .select() kalles ETTER .update() — altså en skriving som ber om
    // radene tilbake (active-grenens kilde-sync). Rene lese-kjeder (select før
    // update) og skrivinger uten select rører ikke radkøen.
    _wantRows: false,
    select() { if (b._update) b._wantRows = true; return b },
    eq() { return b },
    in() { return b },
    limit() { return b },
    insert() { return Promise.resolve({ error: null }) },
    // Returnerer byggeren, ikke et ferdig promise: `releaseIdempotencyStamp`
    // kaller `.delete().eq(...)`. Så lenge INGEN test nådde catch-grenen var
    // forskjellen usynlig — det første kastet i ruten avslørte den.
    delete() { return b },
    update(values: Record<string, unknown>) {
      b._update = values
      if (table === 'profiles') state.profileUpdates.push(values)
      return b
    },
    // Checkout-grenen bruker upsert, ikke update. Manglet i mocken helt til en
    // test faktisk kjørte checkout.session.completed.
    upsert(values: Record<string, unknown>) {
      if (table === 'profiles') state.profileUpdates.push(values)
      return b
    },
    maybeSingle() {
      const queued = state.readErrorQueue[table]?.shift()
      if (queued === 'empty') return Promise.resolve({ data: null, error: null })
      if (queued) return Promise.resolve({ data: null, error: queued })
      const failure = state.readError[table]
      if (failure) return Promise.resolve({ data: null, error: failure })
      // B2C-scenario som standard: ingen org matcher kunden.
      if (table === 'organizations') return Promise.resolve({ data: state.orgRow, error: null })
      if (table === 'profiles') {
        return Promise.resolve({
          data: { id: PROFILE_ID, personal_stripe_subscription_id: state.storedSubId },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
    // `.update(...).eq(...)` awaites uten terminalmetode.
    then(resolve: (v: unknown) => void) {
      const rows = b._wantRows && table === 'profiles'
        ? state.profileUpdateRowsQueue.shift() ?? null
        : null
      return resolve({ data: rows, error: null })
    },
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
  state.readError = {}
  state.readErrorQueue = {}
  state.orgRow = null
  state.profileUpdateRowsQueue = []
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

// ── Kilde-sync i active/trialing-grenen (19. august 2026) ──────────────────
//
// Grenen skrev premium_status men aldri premium_source, så en kortløs
// Founders-trial som konverterte via Stripe-PORTALEN beholdt 'founders' for
// alltid (empirisk: invu99, betalende fra 15. august med stale etikett — og
// org/join kansellerer det private abonnementet kun for source='personal').
// Fiksen er recomputePremium på de oppdaterte profilene, IKKE en hardkodet
// 'personal' — en kode-stablet bruker (rad B/D) står fortsatt som 'active' i
// Stripe, og hardkoding ville overskrevet 'code'.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Fjernes recomputePremium-kallet i active-grenen → begge testene under
//     ryker (recomputed er tom).
//   • Ignoreres fallback-radene (coveredIds kun fra primæroppslaget) →
//     fallback-testen ryker.

test('sub.updated active → premium_source rekalkuleres for den oppdaterte profilen', async () => {
  state.profileUpdateRowsQueue = [[{ id: PROFILE_ID }]]
  state.event = updatedEvent('active')
  await call()

  assert.deepEqual(
    state.recomputed, [PROFILE_ID],
    'uten kilde-sync beholder en portal-konvertert trial premium_source=founders for alltid',
  )
})

test('kilde-sync bruker FALLBACK-radene når kunde-id-oppslaget ikke traff', async () => {
  // Primærkjeden (på stripe_customer_id) matcher ingen rad; fallbacken (på
  // personal_stripe_subscription_id) finner profilen. Kilden skal da synces
  // for DEN — ikke stille hoppes over fordi primærlisten var tom.
  state.profileUpdateRowsQueue = [[], [{ id: PROFILE_ID }]]
  state.event = updatedEvent('trialing')
  await call()

  assert.deepEqual(state.recomputed, [PROFILE_ID], 'fallback-profilen skal også kilde-synces')
})

test('kilde-sync: ingen matchende profil → ingen rekalkulering, og hendelsen svarer 200', async () => {
  state.profileUpdateRowsQueue = [[], []]
  state.event = updatedEvent('active')

  const res = await call()

  assert.equal(res.status, 200)
  assert.deepEqual(state.recomputed, [], 'ingen profiler å synce — kallet skal hoppes over, ikke krasje')
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

// ── assertCriticalRead på de stille oppslagene (19. august 2026) ───────────
//
// Feilklassen er ikke «spørringen feilet» — den er at PostgREST svarer
// `{ data: null, error }`, og at `data: null` er BOKSTAVELIG TALT den samme
// verdien som «raden finnes ikke». Grenene under leste kun `data`, så en nede
// database så ut som en kunde vi ikke kjenner: hendelsen ble stemplet som
// behandlet, Stripe leverte den aldri på nytt, og tilstanden ble stående.
//
// Testene feller derfor to ting samtidig — at ruten svarer 500 (stempelet
// fjernes, Stripe retry-er), OG at ingen sideeffekt rakk å skje først. Bare
// statuskoden ville bestått selv om e-posten var sendt.

const DB_DOWN = { code: '57P03', message: 'the database system is starting up' }

function refundedEvent() {
  return {
    id: `evt_ref_${Math.random()}`,
    type: 'charge.refunded',
    data: { object: { id: 'ch_1', customer: CUSTOMER, amount: 4900, amount_refunded: 4900 } },
  }
}

function paymentFailedEvent(attemptCount = 1) {
  return {
    id: `evt_inv_${Math.random()}`,
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_1',
        customer: CUSTOMER,
        subscription: SUB_TRIAL,
        attempt_count: attemptCount,
      },
    },
  }
}

test('charge.refunded — feilet profiloppslag gir 500, ikke en stille «ukjent kunde»', async () => {
  state.readError = { profiles: DB_DOWN }
  state.event = refundedEvent()

  const res = await call()

  assert.equal(res.status, 500, 'stempelet må fjernes så Stripe kan levere refusjonen på nytt')
  assert.deepEqual(state.recomputed, [], 'ingen rekalkulering på en profil vi ikke fikk lest')
  assert.deepEqual(state.profileUpdates, [], 'premium_since skal ikke røres')
})

test('charge.refunded — lykkes oppslaget, fjernes premium_since som før', async () => {
  state.event = refundedEvent()

  const res = await call()

  assert.equal(res.status, 200)
  assert.ok(
    state.profileUpdates.some(u => u.premium_since === null),
    'normalstien skal være uendret — testen over måler en feil, ikke en ny gate',
  )
  assert.deepEqual(state.recomputed, [PROFILE_ID])
})

test('sub.deleted — feilet org-oppslag behandles IKKE som «dette er en privatkunde»', async () => {
  state.readError = { organizations: DB_DOWN }
  state.paymentMethods = 1
  state.event = deletedEvent('cancellation_requested', SUB_TRIAL)

  const res = await call()

  assert.equal(res.status, 500)
  // Det farlige var ikke den manglende låsen alene, men at hendelsen falt hele
  // veien ned i B2C-grenen på en org-kunde.
  assert.deepEqual(state.profileUpdates, [], 'ingen B2C-rydding på en org vi ikke fikk lest')
  assert.deepEqual(state.recomputed, [])
  assert.equal(state.sent.length, 0, 'ingen kanselleringse-post — kastet ligger foran sendingen')
})

test('invoice.payment_failed — feilet profiloppslag gir 500 FØR e-posten er ute', async () => {
  state.readError = { profiles: DB_DOWN }
  state.paymentMethods = 1
  state.event = paymentFailedEvent()

  const res = await call()

  assert.equal(res.status, 500)
  // Hele poenget med retry-en: uten karensdato ville brukeren fått
  // «Betalingen feilet» uten den datoen e-posten er bygget for å oppgi.
  assert.equal(state.sent.length, 0, 'e-posten må ikke rekke ut — ellers dobles den ved retry')
  assert.deepEqual(state.profileUpdates, [], 'ingen karens stemplet på en profil vi ikke fikk lest')
})

// ── Primæroppslag vs. fallback: fellene som «begge feiler» ikke fanger ─────
//
// Begge grenene under har TO profiloppslag. Lar man begge feile, kaster
// fallback-vakten uansett, og vakten på primæroppslaget kan slettes uten at
// noen test blir rød. Disse to testene lar derfor kun det FØRSTE feile.

test('sub.deleted — primæroppslaget feiler mens fallbacken treffer: stale-sub-vakten skal ikke hoppes over', async () => {
  // Uten vakten på primæroppslaget: `profileByCustomer` blir null, fallbacken
  // finner profilen likevel — men `isCurrentPersonalSub` står da igjen på sin
  // default `true`. HELE stale-sub-vakten er dermed forbigått, og en hendelse
  // for et forbigått abonnement slår av Premium og sender kanselleringse-post
  // til en bruker hvis gjeldende abonnement er helt friskt.
  state.readErrorQueue = { profiles: [DB_DOWN] }
  state.storedSubId = null
  state.stripeSubs = [{ id: SUB_NEW, status: 'active' }]
  state.paymentMethods = 1
  state.event = deletedEvent('cancellation_requested', SUB_TRIAL)

  const res = await call()

  assert.equal(res.status, 500)
  assert.equal(state.sent.length, 0, 'ingen «abonnementet er avsluttet» på et levende abonnement')
  assert.deepEqual(state.recomputed, [], 'Premium skal ikke slås av')
})

test('invoice.payment_failed — primæroppslaget feiler og fakturaen har ingen sub-id: ingen vei til fallbacken', async () => {
  // Fallbacken krever en subscription-id fra fakturaen. Mangler den, finnes
  // ingen andre vei til brukeren: uten vakten blir `profileForFailed` null,
  // karensen stemples aldri, og e-posten går ut med `graceUntil = null` — uten
  // den datoen den er skrevet for å oppgi.
  state.readErrorQueue = { profiles: [DB_DOWN] }
  state.paymentMethods = 1
  state.event = {
    id: `evt_inv_${Math.random()}`,
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_2', customer: CUSTOMER, attempt_count: 1 } },
  }

  const res = await call()

  assert.equal(res.status, 500)
  assert.equal(state.sent.length, 0, 'e-post uten karensdato skal ikke rekke ut')
  assert.deepEqual(state.profileUpdates, [])
})

test('invoice.payment_succeeded — feilet org-oppslag låser ikke opp org-en, og skal derfor retry-es', async () => {
  // Dette er veien ut for en org som ble låst på past_due og NÅ BETALER.
  // Uten vakten klassifiseres bedriften som privatkunde: `subscription_status:
  // 'active'` skrives aldri (org-en blir stående låst selv om pengene kom inn),
  // og fakturaadressen får privat-teksten «Abonnementet ditt er fornyet».
  state.readError = { organizations: DB_DOWN }
  state.event = {
    id: `evt_paid_${Math.random()}`,
    type: 'invoice.payment_succeeded',
    data: { object: { id: 'in_ok', customer: CUSTOMER, billing_reason: 'subscription_cycle', period_end: 1789000000 } },
  }

  const res = await call()

  assert.equal(res.status, 500)
  assert.equal(state.sent.length, 0, 'ingen B2C-fornyelsesbekreftelse til en bedrift')
})

test('sub.deleted — fallback-oppslaget feiler: «no profile found» skal ikke dekke over en nede database', async () => {
  // Primæroppslaget finner ingen rad (profilen mangler stripe_customer_id),
  // fallbacken feiler. Uten vakten logges «no profile found» — ordrett det
  // samme som for en kunde vi aldri har sett — og abonnements-id-en blir aldri
  // nullet, Premium aldri rekalkulert etter kanselleringen.
  state.readErrorQueue = { profiles: ['empty', DB_DOWN] }
  state.paymentMethods = 1
  state.event = deletedEvent('cancellation_requested', SUB_TRIAL)

  const res = await call()

  assert.equal(res.status, 500)
  assert.deepEqual(state.profileUpdates, [])
  assert.deepEqual(state.recomputed, [])
})

test('invoice.payment_failed — fallback-oppslaget feiler: karensen går tapt i stillhet', async () => {
  // Fallbacken ble lagt inn 19. august nettopp fordi en profil uten
  // stripe_customer_id ellers mistet hele karensen ved første avviste trekk.
  // En stille lesefeil her gjenåpner det hullet.
  state.readErrorQueue = { profiles: ['empty', DB_DOWN] }
  state.paymentMethods = 1
  state.event = paymentFailedEvent()

  const res = await call()

  assert.equal(res.status, 500)
  assert.equal(state.sent.length, 0, 'ingen «Betalingen feilet» uten karensdato')
  assert.deepEqual(state.profileUpdates, [])
})

test('checkout — feilet kunde-id-oppslag skal LOGGES, ikke kaste (betalingen er i havn)', async () => {
  // Det motsatte valget, og med vilje: lesingen mater kun duplikat-kunde-
  // advarselen. Å gjøre en betalt checkout til en 500 — og dermed til en evig
  // Stripe-retry — over en diagnostisk logglinje er feil vei å feile. Men helt
  // stille kan den ikke være: da er «ingen lagret kunde-id» ikke til å skille
  // fra «oppslaget feilet».
  const errors: string[] = []
  const realError = console.error
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')) }
  try {
    state.readError = { profiles: DB_DOWN }
    state.event = {
      id: `evt_co_${Math.random()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          customer: CUSTOMER,
          subscription: SUB_TRIAL,
          metadata: { userId: PROFILE_ID },
        },
      },
    }

    const res = await call()

    assert.equal(res.status, 200, 'en betalt checkout skal ikke retry-es over en logglinje')
    assert.ok(
      state.profileUpdates.some(u => u.premium_status === true),
      'Premium skal tildeles som normalt — lesefeilen stopper ingenting',
    )
  } finally {
    console.error = realError
  }

  assert.ok(
    errors.some(e => e.includes('kunne ikke lese eksisterende stripe_customer_id')),
    'feilen må være synlig i loggen — ellers er den ikke til å skille fra «ingen lagret id»',
  )
})

test('invoice.payment_failed — org-oppslaget feiler: bedriften får ikke B2C-teksten', async () => {
  state.readError = { organizations: DB_DOWN }
  state.paymentMethods = 1
  state.event = paymentFailedEvent()

  const res = await call()

  assert.equal(res.status, 500)
  assert.equal(
    state.sent.length, 0,
    'uten vakten falt en org-kunde til B2C-grenen og fikk «Quizkanonen Premium»-teksten',
  )
})

// ── De tre siste lesevaktene i sub.updated (19. august 2026) ───────────────
//
// Org-diskriminatoren er FLYTTET over resume-blokken, så dens kast skjer før
// fire-and-forget-e-posten er satt i gang. De to profiloppslagene i
// kanselleringsgrenen står nedstrøms med vakt, samme avveining som de fire
// assertCriticalWrite i samme gren.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Fjernes vakten på org-diskriminatoren → resume-testen ryker (200 i
//     stedet for 500, org-kunden behandles som B2C).
//   • Flyttes oppslaget tilbake UNDER resume-blokken (vakten beholdt) →
//     resume-testen ryker på e-post-asserten: e-posten rekker ut før kastet,
//     og dobles dermed ved Stripe-retry.
//   • Fjernes vakten på primæroppslaget → «primæroppslaget feiler»-testen
//     ryker (fallbacken finner profilen og kansellerer uten stale-vern).
//   • Fjernes vakten på fallback-oppslaget → «fallback-oppslaget feiler»-
//     testen ryker («no profile found» dekker over en nede database, 200).

function resumeEvent() {
  return {
    id: `evt_resume_${Math.random()}`,
    type: 'customer.subscription.updated',
    data: {
      object: { id: SUB_TRIAL, customer: CUSTOMER, status: 'active' },
      previous_attributes: { pause_collection: { behavior: 'void' } },
    },
  }
}

test('sub.updated resume — positiv kontroll: gjenopptatt fakturering gir e-post', async () => {
  // Uten denne beviser «ingen e-post»-asserten i testen under ingenting —
  // den kunne bestått fordi resume-stien aldri fyrte i mocken i det hele tatt.
  state.event = resumeEvent()

  const res = await call()

  assert.equal(res.status, 200)
  assert.ok(
    state.sent.some(s => s.subject.includes('i gang igjen')),
    'kunden skal få beskjed når trekket starter igjen',
  )
})

test('sub.updated — org-diskriminatoren feiler: kast FØR resume-e-posten er satt i gang', async () => {
  // To feilklasser i én: uten vakten blir `org` null og en org-kunde behandles
  // i B2C-grenen mot feil tabeller. Og sto oppslaget fortsatt NEDENFOR
  // resume-blokken, ville e-posten rukket ut før kastet — og blitt sendt på
  // nytt ved hver Stripe-retry av den samme lesefeilen.
  state.readError = { organizations: DB_DOWN }
  state.event = resumeEvent()

  const res = await call()

  assert.equal(res.status, 500)
  assert.equal(state.sent.length, 0, 'e-posten må ikke rekke ut — ellers dobles den ved retry')
  assert.deepEqual(state.profileUpdates, [], 'ingen B2C-behandling av en kunde vi ikke fikk klassifisert')
})

test('sub.updated canceled — primæroppslaget feiler mens fallbacken treffer: ingen kansellering uten stale-vern', async () => {
  // Samme felle som sub.deleted-søsteren: uten vakten blir `profileByCustomer`
  // null, fallbacken finner profilen på sub-id — men `isCurrentPersonalSub`
  // står igjen på default true, så hele stale-sub-vurderingen er forbigått og
  // kanselleringen behandles på et grunnlag som aldri ble lest.
  state.readErrorQueue = { profiles: [DB_DOWN] }
  state.event = updatedEvent('canceled')

  const res = await call()

  assert.equal(res.status, 500)
  assert.deepEqual(state.profileUpdates, [], 'sub-id-en skal ikke nulles på uleste premisser')
  assert.deepEqual(state.recomputed, [], 'Premium skal ikke rekalkuleres')
})

test('sub.updated canceled — fallback-oppslaget feiler: «no profile found» skal ikke dekke over en nede database', async () => {
  // Primæroppslaget finner ingen rad, fallbacken feiler. Uten vakten logges
  // «no profile found» — ordrett det samme som for en kunde vi aldri har sett —
  // og kanselleringen er stille tapt: sub-id-en nulles aldri, Premium
  // rekalkuleres aldri.
  state.readErrorQueue = { profiles: ['empty', DB_DOWN] }
  state.event = updatedEvent('canceled')

  const res = await call()

  assert.equal(res.status, 500)
  assert.deepEqual(state.profileUpdates, [])
  assert.deepEqual(state.recomputed, [])
})
