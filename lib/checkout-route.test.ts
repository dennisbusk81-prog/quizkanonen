// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// RAD E i beslutningstabellen: brukeren har en aktiv verdikode og starter et
// B2C-abonnement.
//
// Pause duger ikke i denne retningen — første faktura trekkes ved selve
// checkout, altså før vi i det hele tatt får se abonnementet. Riktig mekanisme
// er subscription_data.trial_end på checkout-sesjonen, som utsetter første
// faktura til koden løper ut.
//
// MUTASJONSBEVIS: fjernes trial_end-blokken i ruten, forsvinner
// subscription_data fra sesjonen og første assert ryker — kunden ville da blitt
// belastet umiddelbart for en periode de allerede har gratis.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { CodeCoverage } from './premium-state'

process.env.NEXT_PUBLIC_SITE_URL = 'https://quizkanonen.no'
process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_live_monthly'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'

const state: {
  code: CodeCoverage | null
  sessions: Array<Record<string, unknown>>
} = { code: null, sessions: [] }

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    },
  },
})

// Checkout er migrert til den DELTE rate-limiteren (Upstash). Mocken må derfor
// treffe den nye modulen — mockes bare den gamle, kjører den ekte
// rateLimitShared med sin modul-lokale Map, og testene ville påvirket
// hverandre gjennom en teller som lever mellom dem.
mock.module('@/lib/rate-limit-shared', {
  namedExports: { rateLimitShared: async () => ({ success: true, remaining: 99 }) },
})

mock.module('@/lib/premium-state-io', {
  namedExports: { getCodeCoverage: async () => state.code },
})

mock.module('stripe', {
  defaultExport: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.sessions.push(params)
          return { url: 'https://checkout.stripe.com/test' }
        },
      },
    }
  },
})

const { POST } = await import('@/app/api/stripe/checkout/route')

function checkout() {
  const request = new Request('https://quizkanonen.no/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({
      priceId: 'STRIPE_PRICE_PREMIUM_MONTHLY',
      userId: USER_ID,
      email: 'kunde@example.no',
    }),
  })
  return POST(request as never)
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const activeCode = (expiresAt: string | null): CodeCoverage =>
  ({ redemptionId: 'r1', codeId: 'c1', expiresAt })

beforeEach(() => {
  state.code = null
  state.sessions = []
})

test('RAD E — aktiv kode utsetter første faktura til koden løper ut', async () => {
  const endsAt = inDays(30)
  state.code = activeCode(endsAt)

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.sessions.length, 1)

  const subData = state.sessions[0].subscription_data as { trial_end?: number } | undefined
  assert.ok(subData, 'subscription_data må settes når en kode er aktiv')
  assert.equal(
    subData!.trial_end,
    Math.floor(new Date(endsAt).getTime() / 1000),
    'trial_end skal treffe kodens sluttdato nøyaktig',
  )
})

test('uten aktiv kode opprettes sesjonen som før — ingen trial', async () => {
  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.sessions[0].subscription_data, undefined, 'ingen regresjon for vanlig kjøp')
})

test('utløpt kode teller ikke — getCodeCoverage returnerer null', async () => {
  state.code = null // speiler at I/O-laget filtrerer bort utløpte perioder
  await checkout()
  assert.equal(state.sessions[0].subscription_data, undefined)
})

test('kode med under 48 timer igjen: Stripes minstekrav gjør trial umulig', async () => {
  // Stripe krever at trial_end ligger minst 48 timer fram. Da starter
  // abonnementet normalt — differansen er under to døgn, og alternativet ville
  // vært å avvise et kjøp kunden faktisk vil gjennomføre.
  state.code = activeCode(inDays(1))

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.sessions[0].subscription_data, undefined)
})

test('kode med nøyaktig over 48 timer igjen får trial', async () => {
  state.code = activeCode(new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString())
  await checkout()
  assert.ok((state.sessions[0].subscription_data as { trial_end?: number })?.trial_end)
})

test('permanent kode: kjøp avvises i stedet for å ta betalt for noe de har', async () => {
  state.code = activeCode(null)

  const res = await checkout()
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /ubestemt tid/)
  assert.equal(state.sessions.length, 0, 'ingen checkout-sesjon skal opprettes')
})
