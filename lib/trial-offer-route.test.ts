// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/premium/trial-offer. Kun supabase-admin
// er mocket; ruten og lib/trial-offer kjøres uendret. Den rene logikken
// (isTrialEligible/parseTrialDays) er dekket i lib/trial-offer.test.ts — dette
// er testen på KOBLINGEN: at profilradens karensfelter faktisk når fram til
// `isPremium`-argumentet. Samme sak som lib/premium-status-route.test.ts
// (19. august 2026): org-karens-leddet fantes, det personlige manglet — en
// bruker i personlig dunning med stale cache (premium_status=false skrevet av
// syncPremiumCache under transient feil) ville fått prøveperiode-tilbudet
// oppå dekning som fortsatt gjelder.
//
// Ruten er VISNING, ikke gate (founders-activate er fail-closed på samme rad) —
// derfor er assertions på `eligible`, ikke på sideeffekter: ruten har ingen.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Fjernes `|| personalGraceActive` → PERSONLIG karens-testen ryker.
//   • Fjernes `|| graceActive` → ORG-karens-testen ryker.
//   • Kollapses OR-en til `premium_status === true` alene → begge karens-
//     testene ryker.
//
// rateLimit i ruten er EKTE (in-memory, 60/60s per IP) — hver forespørsel får
// derfor sin egen x-forwarded-for, ellers måler testene rate-limiteren.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ME = '11111111-1111-4111-8111-111111111111'

const OM_TRE_DAGER = () => new Date(Date.now() + 3 * 86_400_000).toISOString()
const FOR_EN_DAG_SIDEN = () => new Date(Date.now() - 86_400_000).toISOString()

type ProfileRow = {
  premium_status: boolean
  has_used_trial: boolean
  org_premium_grace_until: string | null
  personal_grace_until: string | null
}

const state: {
  profile: ProfileRow | null
  profileLookupFails: boolean
} = { profile: null, profileLookupFails: false }

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    premium_status: false,
    has_used_trial: false,
    org_premium_grace_until: null,
    personal_grace_until: null,
    ...overrides,
  }
}

function builder(table: string) {
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    maybeSingle: async () => {
      // Dagtallet leses først — hold det stabilt så testene måler eligibility.
      if (table === 'site_settings') return { data: { value: 14 }, error: null }
      return state.profileLookupFails
        ? { data: null, error: { message: 'simulert DB-feil' } }
        : { data: state.profile, error: null }
    },
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
      from: (table: string) => builder(table),
    },
  },
})

const { GET } = await import('@/app/api/premium/trial-offer/route')

// Egen IP per forespørsel — se rate-limit-merknaden øverst.
let ipTeller = 0

type Svar = { trialDays: number | null; eligible: boolean | null }

async function hent(token: string | null = 'gyldig-token'): Promise<Svar> {
  ipTeller++
  const headers: Record<string, string> = { 'x-forwarded-for': `10.2.0.${ipTeller}` }
  if (token) headers.authorization = `Bearer ${token}`
  const request = new Request('https://quizkanonen.no/api/premium/trial-offer', { headers })
  const res = await GET(request as never)
  assert.equal(res.status, 200)
  return await res.json() as Svar
}

beforeEach(() => {
  state.profile = profile()
  state.profileLookupFails = false
})

test('UTLOGGET: eligible null (UKJENT), dagtallet leveres likevel', async () => {
  const svar = await hent(null)
  assert.equal(svar.eligible, null)
  assert.equal(svar.trialDays, 14)
})

test('GRATIS uten brukt trial: eligible true — positiv kontroll', async () => {
  const svar = await hent()
  assert.equal(svar.eligible, true)
})

test('BRUKT trial: eligible false', async () => {
  state.profile = profile({ has_used_trial: true })
  assert.equal((await hent()).eligible, false)
})

test('PREMIUM: eligible false', async () => {
  state.profile = profile({ premium_status: true })
  assert.equal((await hent()).eligible, false)
})

test('ORG-karens: eligible false — dekning skal ikke få trial oppå seg', async () => {
  state.profile = profile({ org_premium_grace_until: OM_TRE_DAGER() })
  assert.equal((await hent()).eligible, false)
})

test('PERSONLIG karens (midt i dunning): eligible false', async () => {
  state.profile = profile({ personal_grace_until: OM_TRE_DAGER() })
  assert.equal((await hent()).eligible, false)
})

test('UTLØPT karens (begge): eligible true — karensen er tidsbegrenset', async () => {
  state.profile = profile({
    org_premium_grace_until: FOR_EN_DAG_SIDEN(),
    personal_grace_until: FOR_EN_DAG_SIDEN(),
  })
  assert.equal((await hent()).eligible, true)
})

test('FEILET profiloppslag: eligible null — «vet ikke», ikke «ikke kvalifisert»', async () => {
  state.profileLookupFails = true
  assert.equal((await hent()).eligible, null)
})
