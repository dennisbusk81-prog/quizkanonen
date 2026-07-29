// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte cleanup-orgs-cronen. `mock.module` bytter kun ut
// supabase-admin og Stripe-SDK-et, så ruten kjøres uendret — inkludert
// aldersfilteret, medlemstellingen, kryssjekken mot Stripe og selve slettingen.
//
// Mocken implementerer filtrene ekte (.is/.lt/.in), ikke bare signaturen. Uten
// det ville mutasjonsbeviset vært verdiløst: en mock som returnerer alt uansett
// ville gitt «bestått» også med vaktene fjernet.
//
// MUTASJONSBEVIS (a) — verifisert ved å fjerne vakten midlertidig:
//   Fjernes Stripe-kryssjekken i ruten (lookup settes til { ok: true,
//   subscriptions: [] }, altså «ingen abonnement funnet»), feiler testen
//   «betalende org med levende Stripe-abonnement slettes ALDRI»: org-en
//   forsvinner fra db.orgs og deleted blir 1 i stedet for 0.
//   Se rapporten for kjøringen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const BETALENDE = '26e5126f-4c40-4588-9646-aa81d0c6a082'
const FORLATT = '9f1c4b7a-3d21-4e88-b0a5-1c7de9f04b33'
const I_BRUK = '4a7b2c19-88de-4f30-9a61-2b3c4d5e6f70'

type OrgRow = {
  id: string
  name: string
  slug: string
  created_at: string
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
  subscription_status: string
}

type StripeSub = { id: string; status: string }

const db: {
  orgs: OrgRow[]
  memberCounts: Record<string, number>
  memberCountError: { message: string } | null
  deletedMembers: string[]
  deletedInvites: string[]
  // Abonnementer hos Stripe, nøklet på kunde-id og på metadata.organization_id
  subsByCustomer: Record<string, StripeSub[]>
  subsByOrgMetadata: Record<string, StripeSub[]>
  stripeThrows: string | null
  searchCalls: string[]
  listCalls: string[]
} = {
  orgs: [],
  memberCounts: {},
  memberCountError: null,
  deletedMembers: [],
  deletedInvites: [],
  subsByCustomer: {},
  subsByOrgMetadata: {},
  stripeThrows: null,
  searchCalls: [],
  listCalls: [],
}

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()

// ── Stripe-SDK ─────────────────────────────────────────────────────────────
class MockStripe {
  subscriptions = {
    list: async ({ customer }: { customer: string }) => {
      db.listCalls.push(customer)
      if (db.stripeThrows) throw new Error(db.stripeThrows)
      return { data: db.subsByCustomer[customer] ?? [] }
    },
    search: async ({ query }: { query: string }) => {
      db.searchCalls.push(query)
      if (db.stripeThrows) throw new Error(db.stripeThrows)
      // Trekk ut org-id-en fra søkestrengen, som ruten faktisk bygger den.
      const match = query.match(/metadata\['organization_id'\]:'([^']+)'/)
      const orgId = match?.[1] ?? ''
      return { data: db.subsByOrgMetadata[orgId] ?? [] }
    },
  }
}
mock.module('stripe', { defaultExport: MockStripe })

// ── Supabase ───────────────────────────────────────────────────────────────
function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let isNullCol: string | null = null
  let ltCol: string | null = null
  let ltVal: string | null = null
  let inCol: string | null = null
  let inVals: string[] = []
  let counting = false
  let deleting = false

  const rows = (): Record<string, unknown>[] => {
    const source: Record<string, unknown>[] =
      table === 'organizations' ? (db.orgs as unknown as Record<string, unknown>[]) : []

    return source.filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (isNullCol && r[isNullCol] !== null && r[isNullCol] !== undefined) return false
      if (ltCol && ltVal !== null) {
        const cell = r[ltCol]
        if (typeof cell !== 'string' || cell >= ltVal) return false
      }
      if (inCol && !inVals.includes(String(r[inCol]))) return false
      return true
    })
  }

  const b = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      counting = opts?.count === 'exact'
      return b
    },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    is(col: string) { isNullCol = col; return b },
    lt(col: string, val: string) { ltCol = col; ltVal = val; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals; return b },
    delete() { deleting = true; return b },
    then(resolve: (v: unknown) => void) {
      if (counting && table === 'organization_members') {
        if (db.memberCountError) return resolve({ count: null, error: db.memberCountError })
        const orgId = String(eqs['organization_id'])
        return resolve({ count: db.memberCounts[orgId] ?? 1, error: null })
      }

      if (deleting) {
        if (table === 'organization_invites') db.deletedInvites.push(...inVals)
        if (table === 'organization_members') db.deletedMembers.push(...inVals)
        if (table === 'organizations') {
          db.orgs = db.orgs.filter(o => !inVals.includes(o.id))
        }
        return resolve({ error: null })
      }

      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (table: string) => builder(table) } },
})

const { GET } = await import('@/app/api/cron/cleanup-orgs/route')

function call(secret = 'test-cron-secret') {
  const request = new Request('https://quizkanonen.no/api/cron/cleanup-orgs', {
    headers: { authorization: `Bearer ${secret}` },
  })
  return GET(request as never)
}

const org = (over: Partial<OrgRow> & { id: string }): OrgRow => ({
  name: 'Testbedrift',
  slug: 'a1b2c3d4',
  created_at: hoursAgo(100),
  stripe_subscription_id: null,
  stripe_customer_id: null,
  subscription_status: 'active',
  ...over,
})

beforeEach(() => {
  db.orgs = []
  db.memberCounts = {}
  db.memberCountError = null
  db.deletedMembers = []
  db.deletedInvites = []
  db.subsByCustomer = {}
  db.subsByOrgMetadata = {}
  db.stripeThrows = null
  db.searchCalls = []
  db.listCalls = []
})

// ── MUTASJONSBEVIS (a) ──────────────────────────────────────────────────────

test('betalende org med levende Stripe-abonnement slettes ALDRI, selv uten lokal kobling', async () => {
  // Nøyaktig den farlige tilstanden: webhooken landet aldri, så BÅDE
  // stripe_subscription_id og stripe_customer_id er NULL lokalt — mens
  // abonnementet er aktivt hos Stripe og faktureres.
  db.orgs = [org({ id: BETALENDE, name: 'Elkjøp Nordic', created_at: hoursAgo(200) })]
  db.memberCounts[BETALENDE] = 1
  db.subsByOrgMetadata[BETALENDE] = [{ id: 'sub_ekte', status: 'active' }]

  const res = await call()
  const json = await res.json()

  assert.equal(json.deleted, 0, 'ingen org skal ha blitt slettet')
  assert.equal(db.orgs.length, 1, 'org-raden skal fortsatt finnes')
  assert.equal(db.deletedMembers.length, 0, 'ingen medlemsrader skal ha blitt slettet')
  assert.equal(db.deletedInvites.length, 0, 'ingen invitasjoner skal ha blitt slettet')
  assert.equal(json.skippedDetails[0].reason, 'live_subscription')
  assert.match(json.skippedDetails[0].detail, /sub_ekte/)
})

test('org funnet via kunde-id beskyttes også (trialing — Elkjøp-tilfellet)', async () => {
  db.orgs = [org({ id: BETALENDE, stripe_customer_id: 'cus_elkjop' })]
  db.memberCounts[BETALENDE] = 1
  db.subsByCustomer['cus_elkjop'] = [{ id: 'sub_trial', status: 'trialing' }]

  const res = await call()
  assert.equal((await res.json()).deleted, 0)
  assert.equal(db.orgs.length, 1)
  assert.deepEqual(db.listCalls, ['cus_elkjop'], 'kunde-id skal brukes når den finnes')
  assert.equal(db.searchCalls.length, 0, 'ingen metadata-søk når kunden er kjent')
})

// ── Normalflyten skal fortsatt virke ────────────────────────────────────────

test('forlatt checkout-forsøk uten abonnement slettes fortsatt', async () => {
  db.orgs = [org({ id: FORLATT, name: 'Forlatt AS' })]
  db.memberCounts[FORLATT] = 1

  const res = await call()
  const json = await res.json()

  assert.equal(json.deleted, 1)
  assert.equal(db.orgs.length, 0, 'org-raden skal være borte')
  assert.deepEqual(db.deletedMembers, [FORLATT])
  assert.deepEqual(db.deletedInvites, [FORLATT])
})

test('kansellert abonnement beskytter ikke — utløpt trial ryddes bort', async () => {
  db.orgs = [org({ id: FORLATT })]
  db.memberCounts[FORLATT] = 1
  db.subsByOrgMetadata[FORLATT] = [{ id: 'sub_død', status: 'canceled' }]

  assert.equal((await (await call()).json()).deleted, 1)
})

// ── Øvrige vakter ───────────────────────────────────────────────────────────

test('org i bruk (flere medlemmer) skjermes uten å spørre Stripe', async () => {
  db.orgs = [org({ id: I_BRUK })]
  db.memberCounts[I_BRUK] = 12

  const res = await call()
  const json = await res.json()

  assert.equal(json.deleted, 0)
  assert.equal(db.orgs.length, 1)
  assert.equal(json.skippedDetails[0].reason, 'has_members')
  assert.equal(db.searchCalls.length + db.listCalls.length, 0, 'Stripe skal ikke kontaktes')
})

test('Stripe-feil feiler LUKKET — ingenting slettes når tilstanden ikke kan bekreftes', async () => {
  db.orgs = [org({ id: FORLATT })]
  db.memberCounts[FORLATT] = 1
  db.stripeThrows = 'connection reset by peer'

  const res = await call()
  const json = await res.json()

  assert.equal(json.deleted, 0)
  assert.equal(db.orgs.length, 1)
  assert.equal(json.skippedDetails[0].reason, 'stripe_unverified')
})

test('feilet medlemstelling feiler LUKKET', async () => {
  db.orgs = [org({ id: FORLATT })]
  db.memberCountError = { message: 'statement timeout' }

  const res = await call()
  const json = await res.json()

  assert.equal(json.deleted, 0)
  assert.equal(db.orgs.length, 1)
  assert.equal(json.skippedDetails[0].reason, 'member_count_failed')
})

// ── Aldersvinduet ───────────────────────────────────────────────────────────

test('org yngre enn 72 timer røres ikke — Stripe retryer webhooks i inntil 3 døgn', async () => {
  db.orgs = [org({ id: FORLATT, created_at: hoursAgo(30) })]
  db.memberCounts[FORLATT] = 1

  const res = await call()
  assert.equal((await res.json()).deleted, 0)
  assert.equal(db.orgs.length, 1, 'en 30 timer gammel org skal ikke vurderes ennå')
})

test('org eldre enn 72 timer vurderes', async () => {
  db.orgs = [org({ id: FORLATT, created_at: hoursAgo(80) })]
  db.memberCounts[FORLATT] = 1

  assert.equal((await (await call()).json()).deleted, 1)
})

// ── Blandet kjøring ─────────────────────────────────────────────────────────

test('kun de godkjente slettes i en blandet kjøring', async () => {
  db.orgs = [
    org({ id: BETALENDE, name: 'Elkjøp Nordic' }),
    org({ id: FORLATT, name: 'Forlatt AS' }),
    org({ id: I_BRUK, name: 'I bruk AS' }),
  ]
  db.memberCounts[BETALENDE] = 1
  db.memberCounts[FORLATT] = 1
  db.memberCounts[I_BRUK] = 8
  db.subsByOrgMetadata[BETALENDE] = [{ id: 'sub_ekte', status: 'active' }]

  const res = await call()
  const json = await res.json()

  assert.equal(json.deleted, 1)
  assert.equal(json.skipped, 2)
  assert.deepEqual(db.orgs.map(o => o.id).sort(), [BETALENDE, I_BRUK].sort())
  assert.deepEqual(db.deletedMembers, [FORLATT], 'kun den forlatte org-ens medlemmer')
})

// ── Auth ────────────────────────────────────────────────────────────────────

test('feil CRON_SECRET gir 401 og rører ingenting', async () => {
  db.orgs = [org({ id: FORLATT })]

  const res = await call('feil-hemmelighet')
  assert.equal(res.status, 401)
  assert.equal(db.orgs.length, 1)
})
