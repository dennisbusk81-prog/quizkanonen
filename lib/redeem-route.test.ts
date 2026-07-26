// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte /api/codes/redeem-ruten.
//
// VIKTIG OM REKKEVIDDE: selve tellingen og per-konto-sperren håndheves i SQL
// (redeem_access_code + UNIQUE-indeksen i migrasjonen). Faken under SIMULERER
// den semantikken — den beviser at ruten oppfører seg riktig når databasen sier
// «brukt opp» eller «allerede innløst», ikke at Postgres gjør det. DB-nivået må
// verifiseres mot prod etter at migrasjonen er kjørt.
//
// MUTASJONSBEVIS: fjernes `used_count < max_uses`-vilkåret i faken (som speiler
// SQL-en), går bruker nr. 3 gjennom og «stopper etter grensen»-testen feiler.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidePremiumState,
  type CodeCoverage,
  type OrgCoverage,
  type StripeCoverage,
} from './premium-state'

type CodeRow = {
  id: string
  code: string
  is_active: boolean
  valid_until: string | null
  duration_days: number | null
  max_uses: number
  used_count: number
}

const state: {
  code: CodeRow | null
  redemptions: Set<string>
  premiumByUser: Map<string, boolean>
  currentUser: string
  /** Kildene getPremiumState skal rapportere for den innloggede brukeren. */
  premiumSources: { code: CodeCoverage | null; stripe: StripeCoverage | null; org: OrgCoverage | null }
  /** Alle kall ruten gjør mot Stripe — brukes til å bekrefte pause. */
  stripeCalls: Array<{ id: string; params: unknown }>
} = {
  code: null,
  redemptions: new Set(),
  premiumByUser: new Map(),
  currentUser: 'user-a',
  premiumSources: { code: null, stripe: null, org: null },
  stripeCalls: [],
}

const IN_FUTURE = new Date(Date.now() + 86_400_000).toISOString()
const IN_PAST = new Date(Date.now() - 86_400_000).toISOString()

function builder(table: string) {
  const b = {
    select() { return b },
    eq() { return b },
    single() {
      if (table === 'profiles') {
        return Promise.resolve({
          data: { premium_status: state.premiumByUser.get(state.currentUser) ?? false },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
    maybeSingle() {
      if (table === 'access_codes') return Promise.resolve({ data: state.code, error: null })
      return Promise.resolve({ data: null, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: state.currentUser } }, error: null }) },
      from: (table: string) => builder(table),
      // Speiler redeem_access_code i
      // supabase/migrations/20260732000000_access_code_types_and_redemptions.sql
      rpc: async (_fn: string, params: { p_code_id: string; p_user_id: string; p_expires_at: string | null }) => {
        const key = `${params.p_code_id}:${params.p_user_id}`
        if (state.redemptions.has(key)) {
          return { error: { message: 'already_redeemed' } }
        }
        if (!state.code || state.code.used_count >= state.code.max_uses) {
          // RAISE ruller tilbake hele funksjonen — innløsningsraden lagres ikke.
          return { error: { message: 'code_exhausted' } }
        }
        state.redemptions.add(key)
        state.code.used_count += 1
        state.premiumByUser.set(params.p_user_id, true)
        return { error: null }
      },
    },
  },
})

mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

mock.module('@/lib/email', {
  namedExports: { sendEmail: async () => {} },
})

// Premium-tilstanden styres per test. Selve reglene (decideRedemption) kjøres
// ekte — det er bare kildene som er kontrollerte her.
mock.module('@/lib/premium-state-io', {
  namedExports: {
    getPremiumState: async () => decidePremiumState({
      code: state.premiumSources.code,
      stripe: state.premiumSources.stripe,
      org: state.premiumSources.org,
    }),
    syncPremiumCache: async () => {},
    getCodeCoverage: async () => state.premiumSources.code,
  },
})

// Stripe-klienten ruten oppretter selv. Vi fanger pause-kallet for å bekrefte at
// abonnementet faktisk pauses — og at det ALDRI kanselleres.
mock.module('stripe', {
  defaultExport: class FakeStripe {
    subscriptions = {
      update: async (id: string, params: unknown) => {
        state.stripeCalls.push({ id, params })
        return {}
      },
      cancel: async () => {
        throw new Error('kansellering skal aldri skje ved kode-innløsning')
      },
    }
  },
})

const { POST } = await import('@/app/api/codes/redeem/route')

function redeem(code: string, userId: string) {
  state.currentUser = userId
  const request = new Request('https://quizkanonen.no/api/codes/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ code }),
  })
  return POST(request as never)
}

const sharedCode = (over: Partial<CodeRow> = {}): CodeRow => ({
  id: 'code-1',
  code: 'FREDAGSQUIZ',
  is_active: true,
  valid_until: IN_FUTURE,
  duration_days: 60,
  max_uses: 2,
  used_count: 0,
  ...over,
})

const paidSub = (over: Partial<StripeCoverage> = {}): StripeCoverage => ({
  subscriptionId: 'sub_paid',
  status: 'active',
  trialEnd: null,
  currentPeriodEnd: new Date(Date.now() + 12 * 86_400_000).toISOString(),
  pauseResumesAt: null,
  ...over,
})

beforeEach(() => {
  state.code = sharedCode()
  state.redemptions = new Set()
  state.premiumByUser = new Map()
  state.premiumSources = { code: null, stripe: null, org: null }
  state.stripeCalls = []
})

test('delt kode stopper når maks antall innløsninger er nådd', async () => {
  assert.equal((await redeem('FREDAGSQUIZ', 'user-a')).status, 200)
  assert.equal((await redeem('FREDAGSQUIZ', 'user-b')).status, 200)

  const third = await redeem('FREDAGSQUIZ', 'user-c')
  assert.equal(third.status, 409)
  assert.match((await third.json()).error, /brukt opp/i)

  assert.equal(state.code?.used_count, 2, 'et avvist forsøk skal ikke øke telleren')
  assert.equal(state.premiumByUser.get('user-c'), undefined, 'ingen Premium til den avviste')
})

test('samme konto kan ikke bruke en delt kode to ganger', async () => {
  assert.equal((await redeem('FREDAGSQUIZ', 'user-a')).status, 200)

  // Premium utløpt i mellomtiden — det var dette hullet som lot én bruker spise
  // flere plasser på en gruppekode.
  state.premiumByUser.set('user-a', false)

  const again = await redeem('FREDAGSQUIZ', 'user-a')
  assert.equal(again.status, 409)
  assert.match((await again.json()).error, /allerede brukt denne koden/i)
  assert.equal(state.code?.used_count, 1, 'plassen skal ikke være spist opp')
})

test('privat kode kan kun løses inn av én', async () => {
  state.code = sharedCode({ code: 'K7MPQR2XVJHN', max_uses: 1, duration_days: 365 })

  assert.equal((await redeem('K7MPQR2XVJHN', 'user-a')).status, 200)
  const second = await redeem('K7MPQR2XVJHN', 'user-b')
  assert.equal(second.status, 409)
})

test('utløpt kode avvises før innløsning', async () => {
  state.code = sharedCode({ valid_until: IN_PAST })
  const res = await redeem('FREDAGSQUIZ', 'user-a')
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /utløpt/i)
  assert.equal(state.code?.used_count, 0)
})

test('FREDAG2025 slik den står i prod i dag: deaktivert OG utløpt — uendret oppførsel', async () => {
  // Raden i prod: is_active=false, valid_until 27.05.2026, used_count 0/200.
  // Endringen skal ikke gjenopplive den, og ikke endre avvisningen.
  state.code = {
    id: '2e202ad9-4ea8-4486-8709-2108e49cabab',
    code: 'FREDAG2025',
    is_active: false,
    valid_until: '2026-05-27T10:30:35.178534+00:00',
    duration_days: null,
    max_uses: 200,
    used_count: 0,
  }

  const res = await redeem('FREDAG2025', 'user-a')
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /ikke aktiv/i)
  assert.equal(state.code.used_count, 0)
})

test('FREDAG2025 virker igjen uendret hvis Dennis aktiverer den og forlenger fristen', async () => {
  // Ingen ny regel gjelder bakover: en eksisterende delt kode med tak og frist
  // løses inn som før.
  state.code = {
    id: '2e202ad9-4ea8-4486-8709-2108e49cabab',
    code: 'FREDAG2025',
    is_active: true,
    valid_until: IN_FUTURE,
    duration_days: null,
    max_uses: 200,
    used_count: 0,
  }

  const res = await redeem('FREDAG2025', 'user-a')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).expiresAt, null, 'duration_days=null gir permanent Premium, som før')
  assert.equal(state.code.used_count, 1)
})

test('ukjent kode gir ugyldig, ikke 500', async () => {
  state.code = null
  const res = await redeem('FINNESIKKE', 'user-a')
  assert.equal(res.status, 400)
})

// ── Beslutningstabellen på rute-nivå ────────────────────────────────────────
// Reglene testes rent i lib/premium-state.test.ts. Her bekreftes at RUTEN
// faktisk følger dem: at den avviser uten å brenne en plass på koden, og at den
// virkelig kaller Stripe for å pause.
//
// Den gamle testen «bruker som allerede har Premium avvises» er borte med vilje:
// sjekken `premium_status === true` finnes ikke lenger. Den var årsaken til at
// en betalende kunde kunne løse inn en kode i et flagg-vindu og bli trukket for
// en gratis periode. Rad C, D og F har erstattet den.

test('RAD F — org-medlem avvises med sin EGEN org, og koden brennes ikke', async () => {
  state.premiumSources.org = { orgIds: ['org-1'], orgNames: ['Rørlegger Hansen AS'], graceUntil: null }

  const res = await redeem('FREDAGSQUIZ', 'user-a')
  assert.equal(res.status, 409)
  const json = await res.json()
  assert.equal(json.reason, 'org_covered')
  assert.match(json.error, /Rørlegger Hansen AS/)
  assert.equal(state.code?.used_count, 0, 'ingen plass spist')
  assert.equal(state.redemptions.size, 0, 'ingen innløsning registrert')
})

test('RAD C — aktiv kode blokkerer ny kode, med dato i meldingen', async () => {
  const until = new Date(Date.now() + 20 * 86_400_000).toISOString()
  state.premiumSources.code = { redemptionId: 'r-old', codeId: 'c-old', expiresAt: until }

  const res = await redeem('FREDAGSQUIZ', 'user-a')
  assert.equal(res.status, 409)
  const json = await res.json()
  assert.equal(json.reason, 'code_active')
  assert.match(json.error, /allerede en aktiv kode til/)
  assert.equal(state.code?.used_count, 0)
})

test('RAD D — betalt abonnement pauses, og koden stables etter betalt periode', async () => {
  // MUTASJONSBEVIS: fjernes pause-blokken i ruten, blir stripeCalls tom og
  // denne ryker — det er nøyaktig feilen som ville latt kunden bli trukket.
  state.premiumSources.stripe = paidSub()

  const res = await redeem('FREDAGSQUIZ', 'user-a')
  assert.equal(res.status, 200)

  const json = await res.json()
  assert.equal(json.pausedSubscription, true)
  assert.equal(json.startsAt, state.premiumSources.stripe!.currentPeriodEnd, 'ingen betalt tid går tapt')

  assert.equal(state.stripeCalls.length, 1, 'nøyaktig ett Stripe-kall')
  assert.equal(state.stripeCalls[0].id, 'sub_paid')
  const params = state.stripeCalls[0].params as { pause_collection?: { behavior?: string; resumes_at?: number } }
  assert.equal(params.pause_collection?.behavior, 'void')
  assert.equal(
    params.pause_collection?.resumes_at,
    Math.floor(new Date(json.expiresAt).getTime() / 1000),
    'gjenopptas nøyaktig når koden utløper',
  )
})

test('RAD B — Founders-trial: koden stables på trial-slutt, abonnementet pauses', async () => {
  const trialEnd = new Date(Date.now() + 20 * 86_400_000).toISOString()
  state.premiumSources.stripe = paidSub({
    subscriptionId: 'sub_founders', status: 'trialing', trialEnd, currentPeriodEnd: null,
  })

  const res = await redeem('FREDAGSQUIZ', 'user-a')
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.startsAt, trialEnd)
  assert.equal(state.stripeCalls[0]?.id, 'sub_founders')
})

test('permanent kode over et abonnement pauser uten gjenopptaksdato', async () => {
  state.code = sharedCode({ duration_days: null })
  state.premiumSources.stripe = paidSub()

  const res = await redeem('FREDAGSQUIZ', 'user-a')
  assert.equal(res.status, 200)
  const params = state.stripeCalls[0].params as { pause_collection?: { resumes_at?: number } }
  assert.equal(params.pause_collection?.resumes_at, undefined)
})

test('uten abonnement gjøres ingen Stripe-kall i det hele tatt', async () => {
  const res = await redeem('FREDAGSQUIZ', 'user-a')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).pausedSubscription, false)
  assert.equal(state.stripeCalls.length, 0)
})
