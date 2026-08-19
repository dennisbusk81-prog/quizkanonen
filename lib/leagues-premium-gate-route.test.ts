// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte POST /api/leagues (opprett liga — Premium-
// funksjon). Kun supabase-admin er mocket; ruten og lib/premium-check kjøres
// uendret. Samme sak og samme fiks som lib/historikk-premium-gate-route.test.ts
// (QK_0 [B-3]-søsken, 19. august 2026): gaten leste `premium_status` direkte —
// ingen karens, og `error` ble aldri lest.
//
// Assertions på SIDEEFFEKTER, ikke bare statuskode (jf. mutasjonstest-regelen):
// en avvist kaller skal ikke ha skrevet noe til leagues/league_members.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Byttes gaten tilbake til direkte `premium_status` → karens- og
//     503-testene ryker (4 tester).
//   • Fjernes `!premium.ok`-grenen → 503-testen ryker (feil ble til 403 + null insert).
//
// rateLimit i ruten er EKTE (in-memory, 5/60s per IP) — hver forespørsel får
// derfor sin egen x-forwarded-for, ellers måler testene rate-limiteren.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ME = '11111111-1111-4111-8111-111111111111'

const OM_TRE_DAGER = () => new Date(Date.now() + 3 * 86_400_000).toISOString()
const FOR_EN_DAG_SIDEN = () => new Date(Date.now() - 86_400_000).toISOString()

type ProfileRow = {
  premium_status: boolean
  org_premium_grace_until: string | null
  personal_grace_until: string | null
}

const state: {
  profile: ProfileRow | null
  premiumLookupFails: boolean
  /** Hver insert ruten gjør, per tabell — sideeffekt-sporet. */
  inserts: Array<{ table: string; row: unknown }>
} = { profile: null, premiumLookupFails: false, inserts: [] }

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    premium_status: false,
    org_premium_grace_until: null,
    personal_grace_until: null,
    ...overrides,
  }
}

function builder(table: string) {
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    delete() { return b },
    insert(row: unknown) { state.inserts.push({ table, row }); return b },
    // profiles → premium-sjekkens oppslag
    maybeSingle: async () =>
      state.premiumLookupFails
        ? { data: null, error: { message: 'simulert DB-feil' } }
        : { data: state.profile, error: null },
    // leagues → insert(...).select(...).single()
    single: async () => ({
      data: {
        id: 'liga-1', name: 'Testliga', slug: 'testliga-1234', owner_id: ME,
        invite_token: 'tok', reset_at: null, created_at: '2026-08-19T00:00:00.000Z',
      },
      error: null,
    }),
    // league_members-insert og rollback-delete awaites direkte
    then(resolve: (v: unknown) => void) { resolve({ data: [], error: null }) },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => ({ data: { user: { id: ME } }, error: null }),
      },
      from: (table: string) => builder(table),
    },
  },
})

const { POST } = await import('@/app/api/leagues/route')

// Egen IP per forespørsel — se rate-limit-merknaden øverst.
let ipTeller = 0

async function opprett(): Promise<Response> {
  ipTeller++
  const request = new Request('https://quizkanonen.no/api/leagues', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      'x-forwarded-for': `10.0.0.${ipTeller}`,
    },
    body: JSON.stringify({ name: 'Testliga' }),
  })
  return POST(request as never)
}

beforeEach(() => {
  state.profile = profile()
  state.premiumLookupFails = false
  state.inserts = []
})

test('GRATIS: 403 — og ingenting er skrevet', async () => {
  const res = await opprett()

  assert.equal(res.status, 403)
  assert.deepEqual(state.inserts, [], 'en avvist kaller skal ikke ha opprettet noe')
})

test('PREMIUM: 201 med liga — positiv kontroll på at opprettelsen virker', async () => {
  state.profile = profile({ premium_status: true })

  const res = await opprett()

  assert.equal(res.status, 201)
  const json = await res.json() as { league: { id: string; is_owner: boolean } }
  assert.equal(json.league.is_owner, true)
  assert.deepEqual(
    state.inserts.map(i => i.table),
    ['leagues', 'league_members'],
    'både ligaen og eier-medlemskapet skal skrives',
  )
})

test('ORG-karens: 201 — karens teller som Premium også her', async () => {
  state.profile = profile({ org_premium_grace_until: OM_TRE_DAGER() })
  assert.equal((await opprett()).status, 201)
})

test('PERSONLIG karens (midt i dunning): 201', async () => {
  state.profile = profile({ personal_grace_until: OM_TRE_DAGER() })
  assert.equal((await opprett()).status, 201)
})

test('UTLØPT karens: 403 — karensen er tidsbegrenset', async () => {
  state.profile = profile({
    org_premium_grace_until: FOR_EN_DAG_SIDEN(),
    personal_grace_until: FOR_EN_DAG_SIDEN(),
  })
  assert.equal((await opprett()).status, 403)
})

test('FEILET premium-oppslag: 503, og ingenting er skrevet', async () => {
  state.profile = profile({ premium_status: true })
  state.premiumLookupFails = true

  const res = await opprett()

  assert.equal(res.status, 503, 'et forbigående svar, ikke en dom over en betalende kunde')
  assert.deepEqual(state.inserts, [], 'i feiltilstand skal ingen liga opprettes')
})
