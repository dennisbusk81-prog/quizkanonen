// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// SCOPE-GATEN i /api/toppliste og /api/toppliste/history (6. august 2026):
// begge rutene leste scope/scope_id rått fra query og serverte navngitte org-/
// ligamedlemmer anonymt (målt mot prod: 28 ansatte hos B2B-kunden, med
// displayName, poeng og userId, uten en eneste header). Gaten speiler
// /api/leagues/[id]/leaderboard og /api/org/[slug]/dashboard:
//   401 uten sesjon, 403 uten medlemskap, 400 ved misdannet scope,
//   503 (avvis) når medlemskap ikke kan avgjøres — og 'global' HELT uendret.
//
// MUTASJONSBEVIS (kjørt, ikke påstått — se rapporten for kjøringene)
//   • Fjernes 401-sjekken (!userId), ryker «anonym + org-scope → 401».
//   • Fjernes medlemskaps-sjekken (!membership), ryker begge 403-testene.
//   • Gjøres fail-safe om til fail-open (memberError ignoreres), ryker
//     «DB-feil → 503».
//   • Nøkles gaten på parameter-TILSTEDEVÆRELSE i stedet for verdien
//     ('global' krever plutselig innlogging), ryker «eksplisitt scope=global
//     anonymt → 200» — regresjonen på den offentlige topplisten.
//   • Fjernes respond()-betingelsen i history (public-cache på alt), ryker
//     «history: scoped svar har INGEN cache-header».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const state = {
  authUser: null as { id: string } | null,
  // null = ikke medlem; objekt = medlemsrad; 'error' = DB-feil på oppslaget
  leagueMembership: null as { user_id: string } | null | 'error',
  orgMembership: null as { user_id: string } | null | 'error',
  membershipLookups: [] as string[], // tabeller gaten faktisk spurte
}

function thenable<T>(data: T) {
  return {
    then(resolve: (r: { data: T; error: null }) => unknown) {
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
}

function membershipBuilder(table: 'league_members' | 'organization_members') {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() {
      state.membershipLookups.push(table)
      const m = table === 'league_members' ? state.leagueMembership : state.orgMembership
      if (m === 'error') return { data: null, error: { message: 'db nede' } }
      return { data: m, error: null }
    },
    // getMemberSet-lesningen (liste) — kun relevant når gaten har sluppet
    // kalleren gjennom; tom liste er nok for disse testene.
    ...thenable([] as never[]),
  }
  return b
}

function quizzesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    gt() { return b },
    lt() { return b },
    order() { return b },
    limit() { return b },
    async maybeSingle() { return { data: null } },
    ...thenable([] as never[]),
  }
  return b
}

function genericBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    gt() { return b },
    in() { return b },
    is() { return b },
    not() { return b },
    async maybeSingle() { return { data: null } },
    ...thenable([] as never[]),
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () =>
          state.authUser
            ? { data: { user: state.authUser }, error: null }
            : { data: { user: null }, error: { message: 'ugyldig token' } },
      },
      rpc: async (fn: string) => {
        if (fn === 'season_leaderboard_ranked') return { data: [], error: null }
        if (fn === 'season_leaderboard_user_stats') return { data: [], error: null }
        if (fn === 'season_leaderboard_period_quizzes') return { data: [], error: null }
        throw new Error(`uventet rpc: ${fn}`)
      },
      from: (table: string) => {
        if (table === 'league_members') return membershipBuilder('league_members') as never
        if (table === 'organization_members') return membershipBuilder('organization_members') as never
        if (table === 'quizzes') return quizzesBuilder() as never
        return genericBuilder() as never
      },
    },
  },
})

// history-ruten leser season_scores via fetchAllRows — tom liste holder her.
mock.module('@/lib/paginate', {
  namedExports: {
    fetchAllRows: async () => [],
    fetchAllRowsChunked: async () => [], // importeres av globally-blocked-set
  },
})

const { GET: getToppliste } = await import('@/app/api/toppliste/route')
const { GET: getHistory } = await import('@/app/api/toppliste/history/route')

function call(route: 'toppliste' | 'history', query: string, token?: string) {
  const path = route === 'history' ? '/api/toppliste/history' : '/api/toppliste'
  const request = new Request(`https://quizkanonen.no${path}?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return (route === 'history' ? getHistory : getToppliste)(request as never)
}

beforeEach(() => {
  state.authUser = null
  state.leagueMembership = null
  state.orgMembership = null
  state.membershipLookups = []
})

// ── /api/toppliste: avvisningene ─────────────────────────────────────────────

test('anonym + org-scope → 401, ingen medlemsdata i svaret', async () => {
  const res = await call('toppliste', 'period=alltime&scope=organization&scope_id=org-1')
  assert.equal(res.status, 401)
  const j = await res.json()
  assert.equal(j.entries, undefined)
  assert.equal(j.userEntry, undefined)
})

test('anonym + liga-scope → 401', async () => {
  const res = await call('toppliste', 'period=month&scope=league&scope_id=liga-1')
  assert.equal(res.status, 401)
  assert.equal((await res.json()).entries, undefined)
})

test('innlogget ikke-medlem, org → 403, ingen medlemsdata', async () => {
  state.authUser = { id: 'u-utenfor' }
  const res = await call('toppliste', 'period=alltime&scope=organization&scope_id=org-1', 'tok')
  assert.equal(res.status, 403)
  const j = await res.json()
  assert.equal(j.entries, undefined)
  // Gaten spurte faktisk medlemstabellen — 403 er et svar, ikke en snarvei.
  assert.deepEqual(state.membershipLookups, ['organization_members'])
})

test('innlogget ikke-medlem, liga → 403', async () => {
  state.authUser = { id: 'u-utenfor' }
  const res = await call('toppliste', 'period=month&scope=league&scope_id=liga-1', 'tok')
  assert.equal(res.status, 403)
  assert.deepEqual(state.membershipLookups, ['league_members'])
})

test('DB-feil på medlemsoppslaget → 503 (fail-safe: avvis, aldri lekk)', async () => {
  state.authUser = { id: 'u-medlem' }
  state.orgMembership = 'error'
  const res = await call('toppliste', 'period=alltime&scope=organization&scope_id=org-1', 'tok')
  assert.equal(res.status, 503)
  assert.equal((await res.json()).entries, undefined)
})

test('ukjent scope-verdi → 400', async () => {
  const res = await call('toppliste', 'period=month&scope=foo&scope_id=x')
  assert.equal(res.status, 400)
})

test('scope uten scope_id → 400 (før: last_quiz serverte hele det globale feltet)', async () => {
  const res = await call('toppliste', 'period=last_quiz&scope=organization')
  assert.equal(res.status, 400)
})

// ── /api/toppliste: medlemmer slipper gjennom ────────────────────────────────

test('positiv kontroll: org-medlem får 200', async () => {
  state.authUser = { id: 'u-medlem' }
  state.orgMembership = { user_id: 'u-medlem' }
  const res = await call('toppliste', 'period=month&scope=organization&scope_id=org-1', 'tok')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray((await res.json()).entries))
})

test('positiv kontroll: liga-medlem får 200', async () => {
  state.authUser = { id: 'u-medlem' }
  state.leagueMembership = { user_id: 'u-medlem' }
  const res = await call('toppliste', 'period=month&scope=league&scope_id=liga-1', 'tok')
  assert.equal(res.status, 200)
})

// ── /api/toppliste: global er BEVISLIG uendret ───────────────────────────────

test('uten scope-parameter, anonymt → 200 som før, intet medlemsoppslag', async () => {
  const res = await call('toppliste', 'period=month')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray((await res.json()).entries))
  assert.deepEqual(state.membershipLookups, [])
})

test('eksplisitt scope=global anonymt → 200 som før (slik SeasonLeaderboard kaller)', async () => {
  const res = await call('toppliste', 'period=month&scope=global')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray((await res.json()).entries))
  assert.deepEqual(state.membershipLookups, [])
})

// ── /api/toppliste/history: samme gate ───────────────────────────────────────

test('history: anonym + org-scope → 401', async () => {
  const res = await call('history', 'period=month&scope=organization&scope_id=org-1')
  assert.equal(res.status, 401)
  assert.equal((await res.json()).entries, undefined)
})

test('history: innlogget ikke-medlem → 403', async () => {
  state.authUser = { id: 'u-utenfor' }
  const res = await call('history', 'period=month&scope=league&scope_id=liga-1', 'tok')
  assert.equal(res.status, 403)
})

test('history: DB-feil på medlemsoppslaget → 503', async () => {
  state.authUser = { id: 'u-medlem' }
  state.orgMembership = 'error'
  const res = await call('history', 'period=month&scope=organization&scope_id=org-1', 'tok')
  assert.equal(res.status, 503)
})

test('history: scope uten scope_id → 400', async () => {
  const res = await call('history', 'period=month&scope=league')
  assert.equal(res.status, 400)
})

// ── /api/toppliste/history: cache-headeren ───────────────────────────────────
// Et scoped svar er autorisert per kaller. `public, s-maxage` ville latt
// CDN-en cache et medlems svar på URL-en og servere det til anonyme
// (Authorization er ikke del av cache-nøkkelen). Global beholder cachingen.

test('history: global svar beholder public-cache', async () => {
  const res = await call('history', 'period=month&scope=global')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'public, s-maxage=300')
})

test('history: scoped svar har INGEN cache-header', async () => {
  state.authUser = { id: 'u-medlem' }
  state.orgMembership = { user_id: 'u-medlem' }
  const res = await call('history', 'period=month&scope=organization&scope_id=org-1', 'tok')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), null)
})
