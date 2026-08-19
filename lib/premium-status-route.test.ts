// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/profile/premium-status — ruta som
// mater ProfileProvider og dermed hele klient-UI-ets premium-tilstand. Kun
// supabase-admin er mocket; ruten kjøres uendret. Samme sak som resten av
// B-3-familien (lib/leagues-premium-gate-route.test.ts m.fl., 19. august
// 2026): ruta hadde org-karens-leddet, men manglet det personlige — en
// syncPremiumCache under transient feil kan skrive premium_status=false mens
// personal_grace_until fortsatt gjelder, og et definitivt `isPremium: false`
// herfra nedgraderer klienten for en betalende kunde midt i dunning.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Fjernes `|| personalGraceActive` → PERSONLIG karens-testen ryker.
//   • Fjernes `|| graceActive` → ORG-karens-testen ryker.
//   • Kollapses hele OR-en til `premium_status === true` alene → begge
//     karens-testene ryker.
//
// rateLimit i ruten er EKTE (in-memory, 120/60s per IP) — hver forespørsel får
// derfor sin egen x-forwarded-for, ellers måler testene rate-limiteren.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ME = '11111111-1111-4111-8111-111111111111'

const OM_TRE_DAGER = () => new Date(Date.now() + 3 * 86_400_000).toISOString()
const FOR_EN_DAG_SIDEN = () => new Date(Date.now() - 86_400_000).toISOString()

type ProfileRow = {
  premium_status: boolean
  premium_source: string | null
  stripe_customer_id: string | null
  org_premium_grace_until: string | null
  personal_grace_until: string | null
  has_used_trial: boolean
}

const state: {
  profile: ProfileRow | null
  lookupFails: boolean
} = { profile: null, lookupFails: false }

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    premium_status: false,
    premium_source: null,
    stripe_customer_id: null,
    org_premium_grace_until: null,
    personal_grace_until: null,
    has_used_trial: false,
    ...overrides,
  }
}

function builder() {
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    maybeSingle: async () =>
      state.lookupFails
        ? { data: null, error: { code: 'XX000', message: 'simulert DB-feil' } }
        : { data: state.profile, error: null },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async (token: string) =>
          token === 'gyldig-token'
            ? { data: { user: { id: ME } }, error: null }
            : { data: { user: null }, error: { message: 'invalid JWT' } },
      },
      from: () => builder(),
    },
  },
})

const { GET } = await import('@/app/api/profile/premium-status/route')

// Egen IP per forespørsel — se rate-limit-merknaden øverst.
let ipTeller = 0

type Svar = { isPremium: boolean; premiumSource?: string | null; hasStripeCustomer?: boolean; hasUsedTrial?: boolean }

async function hent(token: string | null = 'gyldig-token'): Promise<{ status: number; body: Svar }> {
  ipTeller++
  const headers: Record<string, string> = { 'x-forwarded-for': `10.1.0.${ipTeller}` }
  if (token) headers.authorization = `Bearer ${token}`
  const request = new Request('https://quizkanonen.no/api/profile/premium-status', { headers })
  const res = await GET(request as never)
  return { status: res.status, body: await res.json() as Svar }
}

beforeEach(() => {
  state.profile = profile()
  state.lookupFails = false
})

test('UTEN token: 401', async () => {
  const { status } = await hent(null)
  assert.equal(status, 401)
})

test('GRATIS: isPremium false, og sidefeltene er nøytrale', async () => {
  const { status, body } = await hent()

  assert.equal(status, 200)
  assert.equal(body.isPremium, false)
  assert.equal(body.premiumSource, null)
  assert.equal(body.hasStripeCustomer, false)
  assert.equal(body.hasUsedTrial, false)
})

test('UTLØPT KORTLØS TRIAL (de 72 eks-founders): hasUsedTrial true passeres gjennom', async () => {
  // Nøyaktig tilstanden profilsidens abonnement-kort skiller på: Stripe-kunde
  // finnes (founders-activate opprettet den kortløst), Premium er av, og
  // has_used_trial er det varige merket. hasUsedTrial=true her er det som lar
  // klienten si «prøveperioden er over» i stedet for den usanne kort-teksten.
  state.profile = profile({
    premium_status: false,
    stripe_customer_id: 'cus_founders',
    has_used_trial: true,
  })

  const { body } = await hent()
  assert.equal(body.isPremium, false)
  assert.equal(body.hasStripeCustomer, true)
  assert.equal(body.hasUsedTrial, true)
})

test('PREMIUM: isPremium true, sidefeltene passeres gjennom — positiv kontroll', async () => {
  state.profile = profile({
    premium_status: true,
    premium_source: 'personal',
    stripe_customer_id: 'cus_123',
  })

  const { status, body } = await hent()

  assert.equal(status, 200)
  assert.equal(body.isPremium, true)
  assert.equal(body.premiumSource, 'personal')
  assert.equal(body.hasStripeCustomer, true)
})

test('ORG-karens: isPremium true selv om cachen sier false', async () => {
  state.profile = profile({ org_premium_grace_until: OM_TRE_DAGER() })

  const { body } = await hent()
  assert.equal(body.isPremium, true)
})

test('PERSONLIG karens (midt i dunning): isPremium true selv om cachen sier false', async () => {
  state.profile = profile({ personal_grace_until: OM_TRE_DAGER() })

  const { body } = await hent()
  assert.equal(body.isPremium, true)
})

test('UTLØPT karens (begge): isPremium false — karensen er tidsbegrenset', async () => {
  state.profile = profile({
    org_premium_grace_until: FOR_EN_DAG_SIDEN(),
    personal_grace_until: FOR_EN_DAG_SIDEN(),
  })

  const { body } = await hent()
  assert.equal(body.isPremium, false)
})

test('FEILET oppslag: 500 — «vet ikke» skal ikke se ut som et definitivt false', async () => {
  state.lookupFails = true

  const { status } = await hent()
  assert.equal(status, 500, 'klienten (fetchPremiumStatusFull) behandler kun 200 som definitivt svar')
})
