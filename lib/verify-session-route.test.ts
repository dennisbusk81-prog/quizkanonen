// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// B-14 (30. august 2026): /api/stripe/verify-session svarte
// `paid: payment_status === 'paid'` — men en rad E-checkout (aktiv verdikode →
// subscription_data.trial_end) fullfører med payment_status
// 'no_payment_required'. Kunden HADDE kjøpt; kvitteringssiden viste «ukjent».
//
// Fiksen er TO betingelser, ikke én utvidet liste:
//   paid = status === 'complete' && (payment_status 'paid' ELLER
//          'no_payment_required')
// fordi 'no_payment_required' kan stå på en sesjon som IKKE er fullført —
// ruten kan kalles med en hvilken som helst sesjons-id kunden eier, ikke bare
// den Stripe redirectet med. 'complete' er det autoritative signalet.
//
// MUTASJONSBEVIS:
//   - fjernes status-vakten (complete → true), ryker «åpen sesjon med
//     no_payment_required er IKKE betalt» — en avbrutt checkout ville da vist
//     kvittering.
//   - fjernes 'no_payment_required' fra paid-utregningen, ryker begge
//     trial-testene — symptomet fra B-14 er da tilbake.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'

type FakeSession = {
  status: string
  payment_status: string
  metadata: Record<string, string> | null
  subscription: { trial_end: number | null } | string | null
}

const state: {
  session: FakeSession
  retrieveParams: Array<unknown>
} = {
  session: { status: 'complete', payment_status: 'paid', metadata: { userId: USER_ID }, subscription: null },
  retrieveParams: [],
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    },
  },
})

mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 9 }) },
})

mock.module('@/lib/rate-limit-log', {
  namedExports: { logRateLimitHit: () => {} },
})

mock.module('stripe', {
  defaultExport: class FakeStripe {
    static errors = { StripeInvalidRequestError: class extends Error {} }

    checkout = {
      sessions: {
        retrieve: async (_id: string, params?: unknown) => {
          state.retrieveParams.push(params)
          return state.session
        },
      },
    }
  },
})

const { GET } = await import('@/app/api/stripe/verify-session/route')

function verify() {
  const request = new NextRequest(
    'https://quizkanonen.no/api/stripe/verify-session?session_id=cs_test_123',
    { headers: { authorization: 'Bearer test-token' } },
  )
  return GET(request)
}

beforeEach(() => {
  state.session = { status: 'complete', payment_status: 'paid', metadata: { userId: USER_ID }, subscription: null }
  state.retrieveParams = []
})

test('fullført kortbetaling: paid=true, ikke deferred', async () => {
  const res = await verify()
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.paid, true)
  assert.equal(body.deferred, false)
  assert.equal(body.trial_end, null)
})

test('B-14: fullført trial-checkout (no_payment_required) er OGSÅ et kjøp', async () => {
  state.session.payment_status = 'no_payment_required'
  state.session.subscription = { trial_end: 1_790_000_000 }

  const body = await (await verify()).json()
  assert.equal(body.paid, true, 'rad E-kunden HAR kjøpt — paid=false var selve B-14')
  assert.equal(body.deferred, true, 'kvitteringen må kunne skille «betalt nå» fra «trekkes senere»')
  assert.equal(body.trial_end, 1_790_000_000, 'datoen for første trekk skal med til kvitteringen')
})

test('trial-checkout uten ekspandert abonnement: fortsatt kjøp, bare uten dato', async () => {
  state.session.payment_status = 'no_payment_required'
  state.session.subscription = null

  const body = await (await verify()).json()
  assert.equal(body.paid, true)
  assert.equal(body.deferred, true)
  assert.equal(body.trial_end, null)
})

test('åpen sesjon med no_payment_required er IKKE betalt — status-vakten', async () => {
  // Verdien kan stå på sesjonen FØR kunden fullfører. Uten complete-vakten
  // ville en avbrutt checkout gitt kvittering for et kjøp som aldri skjedde.
  state.session.status = 'open'
  state.session.payment_status = 'no_payment_required'

  const body = await (await verify()).json()
  assert.equal(body.paid, false)
  assert.equal(body.deferred, false)
})

test('complete + unpaid forblir paid=false — «vet ikke» er ikke «ja»', async () => {
  state.session.payment_status = 'unpaid'

  const body = await (await verify()).json()
  assert.equal(body.paid, false)
})

test('utløpt sesjon med paid-status slipper heller ikke gjennom', async () => {
  state.session.status = 'expired'

  const body = await (await verify()).json()
  assert.equal(body.paid, false)
})

test('feil eier: 403 uansett payment_status — fail-closed som før', async () => {
  state.session.metadata = { userId: 'noen-andre' }

  const res = await verify()
  assert.equal(res.status, 403)
  assert.equal((await res.json()).paid, false)
})

test('abonnementet ekspanderes i samme ene Stripe-kall', async () => {
  await verify()
  assert.equal(state.retrieveParams.length, 1)
  assert.deepEqual(state.retrieveParams[0], { expand: ['subscription'] })
})
