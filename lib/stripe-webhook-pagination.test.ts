// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// PAGINERINGSTEST av den ekte Stripe-webhooken mot en fake som oppfører seg
// som PostgREST på begge de målte takene: 1000-radskuttet på lesinger og
// «Bad Request» for .in()-lister over ~390 nøkler (også på UPDATE — id-ene
// ligger i URL-en der òg).
//
// Feilbildet fram til 23. august 2026, med 1500 medlemmer i én org:
//   • LESINGENE var upaginerte → kun de første 1000 medlemmene ble synket,
//     STILLE (assertCriticalRead ser ikke et kutt som ikke gir error).
//   • SKRIVINGENE var uchunkede → 400 fra PostgREST → assertCriticalWrite
//     kaster → stempelet frigis → Stripe retryer identisk for alltid.
//     Bedriften har betalt; ingen ansatte får Premium.
//
// MUTASJONSBEVIS: byttes readAllMemberIds tilbake til ett rått kall, ryker
// «medlem 1200»-assertene (u-1200 er usynlig i de 1000 første radene). Byttes
// activateMemberPremiumChunked tilbake til ett .in(alle 1500), svarer faken
// Bad Request og statuskode-asserten ryker (500 i stedet for 200).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy'

const PG_ROW_CAP = 1000
const URL_CAP = 390
const MEMBER_COUNT = 1500
const ORG_ID = 'org-stor'
const CUSTOMER = 'cus_storbedrift'
const SUB = 'sub_storbedrift'

const state: {
  event: Record<string, unknown>
  orgRow: Record<string, unknown> | null
  premiumSet: Set<string>
  chunkSizes: number[]
  recomputed: string[]
  memberRangeWindows: Array<[number, number]>
} = { event: {}, orgRow: null, premiumSet: new Set(), chunkSizes: [], recomputed: [], memberRangeWindows: [] }

const memberIds = Array.from({ length: MEMBER_COUNT }, (_, i) => `u-${String(i).padStart(4, '0')}`)

// ── Stripe-SDK ─────────────────────────────────────────────────────────────
class MockStripe {
  webhooks = { constructEvent: () => state.event }
  subscriptions = {
    list: async () => ({ data: [] }),
    retrieve: async (id: string) => ({ id, status: 'active', current_period_end: 1_893_456_000 }),
  }
  customers = {
    retrieve: async () => ({ deleted: false, email: 'admin@storbedrift.no' }),
    listPaymentMethods: async () => ({ data: [{ id: 'pm_1' }] }),
  }
}
mock.module('stripe', { defaultExport: MockStripe })

// ── Supabase ───────────────────────────────────────────────────────────────
function builder(table: string) {
  let selected = ''
  let from = 0
  let to = PG_ROW_CAP - 1
  let inChunk: string[] | null = null
  let isUpdate = false
  let updateValues: Record<string, unknown> = {}
  const b = {
    select(cols?: string) { selected = cols ?? ''; return b },
    eq() { return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    in(_col: string, keys: string[]) { inChunk = keys; return b },
    limit() { return b },
    insert() { return Promise.resolve({ error: null }) },
    delete() {
      const d = {
        eq: () => Promise.resolve({ error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
      }
      return d
    },
    update(values: Record<string, unknown>) { isUpdate = true; updateValues = values; return b },
    upsert() { return Promise.resolve({ error: null }) },
    maybeSingle() {
      if (table === 'organizations') {
        if (selected.includes('member_grace_reason')) {
          return Promise.resolve({ data: { member_grace_reason: null }, error: null })
        }
        return Promise.resolve({ data: state.orgRow, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      // profiles-UPDATE med .in(): URL-taket gjelder — som i prod.
      if (table === 'profiles' && isUpdate) {
        const chunk = inChunk ?? []
        state.chunkSizes.push(chunk.length)
        if (chunk.length > URL_CAP) {
          return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
        }
        if (updateValues.premium_status === true) chunk.forEach(id => state.premiumSet.add(id))
        return Promise.resolve({ data: null, error: null }).then(res, rej)
      }
      if (table === 'organization_members') {
        state.memberRangeWindows.push([from, to])
        const rows = memberIds.map(id => ({ user_id: id }))
        const window = rows.slice(from, to + 1).slice(0, PG_ROW_CAP)
        return Promise.resolve({ data: window, error: null }).then(res, rej)
      }
      return Promise.resolve({ data: null, error: null }).then(res, rej)
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
  namedExports: { sendEmail: async () => {} },
})

mock.module('@/lib/org-admin-emails', {
  namedExports: {
    getOrgAdminEmails: async () => ({ emails: ['admin@storbedrift.no'], orgName: 'Storbedrift', orgSlug: 'storbedrift' }),
    sendToOrgAdmins: async () => {},
  },
})

mock.module('@/lib/org-lock-notify', {
  namedExports: {
    shouldNotifyMembersOfLock: () => false,
    shouldNotifyAdminsOfDunningLock: () => false,
    notifyMembersOfOrgLock: async () => {},
  },
})

mock.module('@/lib/premium-state-io', {
  namedExports: {
    syncPremiumCache: async (id: string) => { state.recomputed.push(id) },
    getPersonalGrace: async () => null,
  },
})

mock.module('@/lib/org-premium', {
  namedExports: { hasActiveOrgPremium: async () => false },
})

const { POST } = await import('@/app/api/stripe/webhook/route')

async function call() {
  const request = new Request('https://quizkanonen.no/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=dummy' },
    body: '{}',
  })
  return POST(request as never)
}

beforeEach(() => {
  state.orgRow = null
  state.premiumSet = new Set()
  state.chunkSizes = []
  state.recomputed = []
  state.memberRangeWindows = []
})

test('checkout (org, 1500 medlemmer): ALLE får premium, ingen .in()-liste over URL-taket', async () => {
  state.event = {
    id: 'evt_co_stor',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_stor',
        customer: CUSTOMER,
        subscription: SUB,
        metadata: { type: 'org', organization_id: ORG_ID },
      },
    },
  }

  const res = await call()

  assert.equal(res.status, 200,
    'et rått .in(alle 1500) hadde fått Bad Request → 500 → evig Stripe-retry')
  assert.equal(state.premiumSet.size, MEMBER_COUNT, 'alle 1500 medlemmer skal aktiveres')
  assert.ok(state.premiumSet.has('u-1200'),
    'u-1200 ligger forbi 1000-radstaket — en upaginert lesing hadde aldri sett henne')
  assert.ok(state.chunkSizes.every(n => n <= URL_CAP),
    `en .in()-liste oversteg URL-taket: ${JSON.stringify(state.chunkSizes)}`)
  assert.ok(state.memberRangeWindows.length >= 2,
    `medlemslesingen skal paginere (minst to vinduer), fikk ${JSON.stringify(state.memberRangeWindows)}`)
})

test('sub.deleted (org): premium rekalkuleres for ALLE 1500, også forbi radtaket', async () => {
  state.orgRow = { id: ORG_ID, name: 'Storbedrift', slug: 'storbedrift', stripe_subscription_id: SUB, subscription_status: 'active' }
  state.event = {
    id: 'evt_del_stor',
    type: 'customer.subscription.deleted',
    data: {
      object: { id: SUB, customer: CUSTOMER, status: 'canceled', cancellation_details: { reason: 'cancellation_requested' } },
    },
  }

  const res = await call()

  assert.equal(res.status, 200)
  assert.equal(state.recomputed.length, MEMBER_COUNT, 'alle medlemmene skal rekalkuleres')
  assert.ok(state.recomputed.includes('u-1200'),
    'u-1200 ligger forbi 1000-radstaket — en upaginert lesing hadde stille mistet henne')
})

test('sub.updated → active (org): aktiveringen når alle 1500, chunket', async () => {
  state.orgRow = { id: ORG_ID, name: 'Storbedrift', slug: 'storbedrift', stripe_subscription_id: SUB, subscription_status: 'locked' }
  state.event = {
    id: 'evt_upd_stor',
    type: 'customer.subscription.updated',
    data: { object: { id: SUB, customer: CUSTOMER, status: 'active' } },
  }

  const res = await call()

  assert.equal(res.status, 200)
  assert.equal(state.premiumSet.size, MEMBER_COUNT)
  assert.ok(state.premiumSet.has('u-1200'))
  assert.ok(state.chunkSizes.every(n => n <= URL_CAP),
    `en .in()-liste oversteg URL-taket: ${JSON.stringify(state.chunkSizes)}`)
})

test('kontroll: de 1000 første medlemsradene inneholder IKKE u-1200', () => {
  const kuttet = memberIds.slice(0, PG_ROW_CAP)
  assert.ok(!kuttet.includes('u-1200'),
    'datasettet må gjøre u-1200 usynlig for et kuttet kall — ellers beviser testene ingenting')
})
