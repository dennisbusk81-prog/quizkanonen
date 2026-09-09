// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// PUNKT 7 (9. september 2026): fire .single()-steder i tre Stripe-ruter leste
// uten error-sjekk, så en DB-feil ble «kontakt support» (portal), «Ingen
// admin-tilgang» / «Ingen Stripe-kunde funnet» (org-portal) eller «ingen
// abonnement» (subscription) — til en betalende kunde, uten logglinje.
//
// FELLEN, og grunnen til at PGRST116-testene her er de viktigste: .single()
// gir error med kode PGRST116 OGSÅ når spørringen lyktes og ga null rader
// (verifisert mot prod, se lib/postgrest-errors.ts). Skilles det på OM error
// finnes, blir «ingen abonnement» til «kontakt support» for ALLE uten
// abonnement — den vanligste stien. Skillet skal gå på error.code.
//
// INGEN EKTE DB ELLER STRIPE: supabase-admin, rate-limit og stripe er mocket.
// De tre rutehandlerne kjører EKTE.
//
// MUTASJONSBEVIS (CRLF-filer — sjekk at mutasjonen faktisk landet):
//   • Fjernes en av de fire `if (xError && !isNoRowsError(xError))`-blokkene,
//     ryker «ekte DB-feil → 503»-testen for det stedet (ruten svarer da
//     dagens villedende melding).
//   • Endres en av dem til `if (xError)` (fellen), ryker «PGRST116 →
//     dagens melding»-testen for det stedet.
//   • Returnerer isNoRowsError alltid false, ryker alle fire PGRST116-testene.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { isNoRowsError, POSTGREST_NO_ROWS } from './postgrest-errors'

process.env.NEXT_PUBLIC_SITE_URL = 'https://quizkanonen.no'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const USER_ID = 'user-1'
const ORG_ID = 'org-1'

type Row = Record<string, unknown>
type SingleResult = { data: Row | null; error: { code: string; message: string } | null }

/** Nøyaktig formen PostgREST svarte med i prod 9. september 2026 (HTTP 406). */
const NO_ROWS = (): SingleResult => ({
  data: null,
  error: { code: POSTGREST_NO_ROWS, message: 'Cannot coerce the result to a single JSON object' },
})
const DB_DOWN = (): SingleResult => ({
  data: null,
  error: { code: '57P01', message: 'terminating connection due to administrator command' },
})
const HIT = (row: Row): SingleResult => ({ data: row, error: null })

const state: {
  /** Hva .single() svarer, per tabell. */
  results: Record<string, SingleResult>
  /** Antall lesinger per tabell — for å bevise at ruten stoppet der den skulle. */
  reads: Record<string, number>
  portalSessions: Array<Record<string, unknown>>
  subscriptionLists: number
  activeSub: Row | null
} = { results: {}, reads: {}, portalSessions: [], subscriptionLists: 0, activeSub: null }

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: (table: string) => {
        const b = {
          select() { return b },
          eq() { return b },
          async single() {
            state.reads[table] = (state.reads[table] ?? 0) + 1
            const r = state.results[table]
            if (!r) throw new Error(`testen satte ikke noe svar for ${table}`)
            return r
          },
        }
        return b
      },
    },
  },
})

mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

class FakeStripeInvalidRequestError extends Error {
  code: string
  constructor(code: string) { super(code); this.code = code }
}

mock.module('stripe', {
  defaultExport: class FakeStripe {
    static errors = { StripeInvalidRequestError: FakeStripeInvalidRequestError }
    billingPortal = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.portalSessions.push(params)
          return { url: 'https://billing.stripe.com/session/test' }
        },
      },
    }
    subscriptions = {
      list: async ({ status }: { status: string }) => {
        state.subscriptionLists++
        return { data: status === 'active' && state.activeSub ? [state.activeSub] : [] }
      },
    }
  },
})

const portal = await import('@/app/api/stripe/portal/route')
const orgPortal = await import('@/app/api/stripe/org-portal/route')
const subscription = await import('@/app/api/stripe/subscription/route')

const headers = { 'content-type': 'application/json', authorization: 'Bearer test-token' }
const postPortal = () => portal.POST(new Request('https://quizkanonen.no/api/stripe/portal', { method: 'POST', headers }) as never)
const postOrgPortal = () => orgPortal.POST(new Request('https://quizkanonen.no/api/stripe/org-portal', {
  method: 'POST', headers, body: JSON.stringify({ org_id: ORG_ID }),
}) as never)
const getSubscription = () => subscription.GET(new Request('https://quizkanonen.no/api/stripe/subscription', { headers }) as never)

/** Kjører ruten med console.error fanget; returnerer respons + loggede førsteargumenter. */
async function withErrorLog(run: () => Promise<Response>): Promise<{ res: Response; logged: string[] }> {
  const logged: string[] = []
  const restore = mock.method(console, 'error', (...args: unknown[]) => { logged.push(String(args[0])) })
  try {
    return { res: await run(), logged }
  } finally {
    restore.mock.restore()
  }
}

beforeEach(() => {
  state.results = {}
  state.reads = {}
  state.portalSessions = []
  state.subscriptionLists = 0
  state.activeSub = null
})

// ── isNoRowsError ───────────────────────────────────────────────────────────

test('isNoRowsError: kun PGRST116 er «null rader»', () => {
  assert.equal(isNoRowsError(NO_ROWS().error), true)
  assert.equal(isNoRowsError(DB_DOWN().error), false)
  assert.equal(isNoRowsError({ code: '42703', message: 'column does not exist' }), false)
  assert.equal(isNoRowsError({ message: 'uten kode' }), false)
  assert.equal(isNoRowsError(null), false)
  assert.equal(isNoRowsError(undefined), false)
})

// ── portal:32 ───────────────────────────────────────────────────────────────

test('portal — treff: portalsesjon på lagret kunde, som i dag', async () => {
  state.results.profiles = HIT({ stripe_customer_id: 'cus_1' })
  const res = await postPortal()
  assert.equal(res.status, 200)
  assert.equal((await res.json()).url, 'https://billing.stripe.com/session/test')
  assert.equal(state.portalSessions[0].customer, 'cus_1')
})

test('portal — PGRST116 (ingen profilrad): dagens «kontakt support», UENDRET', async () => {
  state.results.profiles = NO_ROWS()
  const res = await postPortal()
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /ikke koblet til Stripe/)
  assert.equal(state.portalSessions.length, 0)
})

test('portal — ekte DB-feil: 503 «prøv igjen», logget, ingen Stripe-kall', async () => {
  state.results.profiles = DB_DOWN()
  const { res, logged } = await withErrorLog(postPortal)
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /Prøv igjen/)
  assert.equal(state.portalSessions.length, 0)
  assert.ok(logged.some(l => l.startsWith('[portal] kunne ikke lese profil') && l.includes(USER_ID)), `logg: ${logged}`)
})

// ── org-portal:35 (medlemskap) ──────────────────────────────────────────────

test('org-portal — treff: admin får portalsesjon på org-kunden, som i dag', async () => {
  state.results.organization_members = HIT({ role: 'admin' })
  state.results.organizations = HIT({ stripe_customer_id: 'cus_org', slug: 'elkjop' })
  const res = await postOrgPortal()
  assert.equal(res.status, 200)
  assert.equal(state.portalSessions[0].customer, 'cus_org')
  assert.match(String(state.portalSessions[0].return_url), /\/org\/elkjop\/admin$/)
})

test('org-portal — medlemskap PGRST116 (ikke medlem): dagens 403, UENDRET', async () => {
  state.results.organization_members = NO_ROWS()
  const res = await postOrgPortal()
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, 'Ingen admin-tilgang')
  assert.equal(state.reads.organizations ?? 0, 0, 'org-raden leses ikke for en ikke-admin')
  assert.equal(state.portalSessions.length, 0)
})

test('org-portal — medlemskap ekte DB-feil: 503, logget, org-raden leses ikke, ingen Stripe-kall', async () => {
  state.results.organization_members = DB_DOWN()
  const { res, logged } = await withErrorLog(postOrgPortal)
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /Prøv igjen/)
  assert.equal(state.reads.organizations ?? 0, 0)
  assert.equal(state.portalSessions.length, 0)
  assert.ok(logged.some(l => l.startsWith('[org-portal] kunne ikke lese medlemskap') && l.includes(ORG_ID)), `logg: ${logged}`)
})

// ── org-portal:47 (org-raden) ───────────────────────────────────────────────

test('org-portal — org PGRST116 (raden finnes ikke): dagens 400, UENDRET', async () => {
  state.results.organization_members = HIT({ role: 'admin' })
  state.results.organizations = NO_ROWS()
  const res = await postOrgPortal()
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'Ingen Stripe-kunde funnet')
  assert.equal(state.portalSessions.length, 0)
})

test('org-portal — org ekte DB-feil: 503, logget, ingen Stripe-kall', async () => {
  state.results.organization_members = HIT({ role: 'admin' })
  state.results.organizations = DB_DOWN()
  const { res, logged } = await withErrorLog(postOrgPortal)
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /Prøv igjen/)
  assert.equal(state.portalSessions.length, 0)
  assert.ok(logged.some(l => l.startsWith('[org-portal] kunne ikke lese organisasjon') && l.includes(ORG_ID)), `logg: ${logged}`)
})

// ── subscription:27 ─────────────────────────────────────────────────────────

test('subscription — treff: has_subscription true fra Stripe, som i dag', async () => {
  state.results.profiles = HIT({ stripe_customer_id: 'cus_1' })
  state.activeSub = {
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1_800_000_000, price: { recurring: { interval: 'month' }, unit_amount: 4900 } }] },
  }
  const res = await getSubscription()
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.has_subscription, true)
  assert.equal(json.interval, 'month')
  assert.equal(json.amount_ore, 4900)
})

test('subscription — PGRST116 (ingen profilrad): has_subscription false, UENDRET, ingen Stripe-kall', async () => {
  state.results.profiles = NO_ROWS()
  const res = await getSubscription()
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    has_subscription: false, current_period_end: null, cancel_at_period_end: false, interval: null, amount_ore: null,
  })
  assert.equal(state.subscriptionLists, 0)
})

test('subscription — ekte DB-feil: 503, logget, ingen Stripe-kall — klientene tolker ikke-ok som UKJENT', async () => {
  state.results.profiles = DB_DOWN()
  const { res, logged } = await withErrorLog(getSubscription)
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /Prøv igjen/)
  assert.equal(state.subscriptionLists, 0)
  assert.ok(logged.some(l => l.startsWith('[subscription] kunne ikke lese profil') && l.includes(USER_ID)), `logg: ${logged}`)
})
