// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av /api/toppliste sitt userBlockedFromGlobal-flagg og
// last_quiz-fallbacken (funn 3, 5. august 2026): en kaller som er blokkert fra
// den åpne topplisten (stengt org / eget opt-out) fikk userEntry: null, og
// klienten viste «Du spilte ikke ukens quiz.» til en som faktisk spilte —
// samme feilklasse som «Reaktiver Premium». Ruten speiler nå
// /api/leaderboard/[id] sin mine-fallback («egne tall skjules aldri for en
// selv») og bærer i tillegg et eksplisitt flagg klienten kan si sannheten med.
//
// MUTASJONSBEVIS
//   • Fjernes last_quiz-fallbacken, mister en blokkert kaller userEntry og
//     flagget — «blokkert kaller som leverte …» ryker.
//   • Settes flagget uten å kreve en LEVERT rad (mine), ryker «blokkert uten
//     forsøk …» (flagget skal være false når «Du spilte ikke» faktisk er sant).
//   • Fjernes scope-gaten på isUserGloballyBlockedLive, ryker «org-scope …»
//     (interne rom skal aldri få flagget) på orgMemsCalls-asserten.
//   • Fjernes periode-sjekken helt, ryker «periode: blokkert …».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type AttemptRow = {
  id: string
  user_id: string
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
  submitted_at: string | null
}

function att(id: string, userId: string, name: string, correct: number, timeMs: number): AttemptRow {
  return {
    id, user_id: userId, player_name: name,
    correct_answers: correct, total_time_ms: timeMs, correct_streak: 0,
    submitted_at: '2026-07-31T13:00:00Z',
  }
}

const state: {
  latestQuiz: { id: string; title: string; closes_at: string; season_points_awarded: boolean } | null
  attempts: AttemptRow[]
  blocked: string[]
  authUser: { id: string } | null
  profileRows: { id: string; display_name: string | null; nickname: string | null; premium_status: boolean | null }[]
  userProfile: { display_name: string | null; nickname: string | null; premium_status: boolean | null } | null
  rpcRanked: unknown[]
  rpcUserStats: unknown[]
  orgMems: { organization_id: string; global_league_opt_out: boolean | null }[]
  orgMemsCalls: number
  restrictedOrgs: { id: string }[]
} = {
  latestQuiz: null, attempts: [], blocked: [], authUser: null,
  profileRows: [], userProfile: null, rpcRanked: [], rpcUserStats: [],
  orgMems: [], orgMemsCalls: 0, restrictedOrgs: [],
}

function thenable<T>(data: T) {
  return {
    then(resolve: (r: { data: T; error: null }) => unknown) {
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
}

function quizzesBuilder() {
  let selectCols = ''
  let hasGt = false
  const b = {
    select(cols: string) { selectCols = cols; return b },
    eq() { return b },
    gt() { hasGt = true; return b },
    order() { return b },
    limit() { return b },
    async maybeSingle() {
      if (hasGt) return { data: null } // emptyResponse sitt openQuiz-oppslag
      if (selectCols.includes('attempts!inner')) return { data: state.latestQuiz }
      return { data: null }
    },
  }
  return b
}

function attemptsBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    not() { return b },
    in() { return b },
    ...thenable(state.attempts),
  }
  return b
}

function profilesBuilder() {
  let mode: 'suspended' | 'list' | 'single' = 'list'
  const b = {
    select() { return b },
    gt() { mode = 'suspended'; return b },
    in() { mode = 'list'; return b },
    eq() { mode = 'single'; return b },
    async maybeSingle() { return { data: state.userProfile } },
    then(resolve: (r: { data: unknown; error: null }) => unknown) {
      const data = mode === 'suspended' ? [] : state.profileRows
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
  return b
}

function excludedBuilder() {
  const b = { select() { return b }, eq() { return b }, is() { return b }, ...thenable([] as never[]) }
  return b
}

function orgMembersBuilder() {
  state.orgMemsCalls++
  const b = { select() { return b }, eq() { return b }, ...thenable(state.orgMems) }
  return b
}

function organizationsBuilder() {
  const b = { select() { return b }, in() { return b }, eq() { return b }, ...thenable(state.restrictedOrgs) }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: state.authUser }, error: null }) },
      rpc: async (fn: string) => {
        if (fn === 'season_leaderboard_ranked') return { data: state.rpcRanked, error: null }
        if (fn === 'season_leaderboard_user_stats') return { data: state.rpcUserStats, error: null }
        if (fn === 'season_leaderboard_period_quizzes') return { data: [], error: null }
        throw new Error(`uventet rpc: ${fn}`)
      },
      from: (table: string) => {
        if (table === 'quizzes') return quizzesBuilder() as never
        if (table === 'attempts') return attemptsBuilder() as never
        if (table === 'profiles') return profilesBuilder() as never
        if (table === 'excluded_members') return excludedBuilder() as never
        if (table === 'organization_members') return orgMembersBuilder() as never
        if (table === 'organizations') return organizationsBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

mock.module('@/lib/globally-blocked-set', {
  namedExports: {
    getGloballyBlockedSet: async () => new Set(state.blocked),
  },
})

const { GET } = await import('@/app/api/toppliste/route')

function call(query: string, token?: string) {
  const request = new Request(`https://quizkanonen.no/api/toppliste?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return GET(request as never)
}

// Rutens attempts-cache er modul-lokal med 30s TTL — hver test bruker sin egen
// quiz-id slik at forrige tests rader aldri serveres fra cachen.
let quizSeq = 0
beforeEach(() => {
  quizSeq++
  state.latestQuiz = {
    id: `q-${quizSeq}`, title: 'Fredagsquiz 31.07.2026',
    closes_at: '2026-07-31T20:00:00Z', season_points_awarded: true,
  }
  state.attempts = [
    att('a-anna', 'u-anna', 'Anna', 12, 60_000),
    att('a-bjorn', 'u-bjorn', 'Bjørn', 11, 65_000),
    att('a-cato', 'u-cato', 'Cato', 10, 70_000),
  ]
  state.blocked = []
  state.authUser = null
  state.profileRows = [
    { id: 'u-anna', display_name: 'Anna', nickname: null, premium_status: false },
    { id: 'u-bjorn', display_name: 'Bjørn', nickname: null, premium_status: false },
    { id: 'u-cato', display_name: 'Cato', nickname: null, premium_status: false },
  ]
  state.userProfile = { display_name: 'Bjørn', nickname: null, premium_status: false }
  state.rpcRanked = []
  state.rpcUserStats = []
  state.orgMems = []
  state.orgMemsCalls = 0
  state.restrictedOrgs = []
})

// ── Siste quiz: positiv kontroll FØRST ───────────────────────────────────────

test('positiv kontroll: ikke-blokkert kaller får userEntry fra det synlige feltet, flagget er false', async () => {
  state.authUser = { id: 'u-bjorn' }
  const res = await call('period=last_quiz&scope=global', 'tok')
  assert.equal(res.status, 200)
  const j = await res.json()
  assert.deepEqual(
    j.entries.map((e: { displayName: string; rank: number }) => [e.displayName, e.rank]),
    [['Anna', 1], ['Bjørn', 2], ['Cato', 3]],
  )
  assert.equal(j.userEntry?.rank, 2)
  assert.equal(j.userBlockedFromGlobal, false)
})

// ── Siste quiz: blokkert kaller som leverte ──────────────────────────────────

test('blokkert kaller som leverte: ute av entries, men userEntry (egne tall) + flagg', async () => {
  state.blocked = ['u-bjorn']
  state.authUser = { id: 'u-bjorn' }
  const j = await (await call('period=last_quiz&scope=global', 'tok')).json()
  // Ute av den offentlige listen, gjenværende re-rankes.
  assert.deepEqual(
    j.entries.map((e: { displayName: string; rank: number }) => [e.displayName, e.rank]),
    [['Anna', 1], ['Cato', 2]],
  )
  assert.equal(j.totalCount, 2)
  // Egne tall skjules aldri for en selv — rank er mot det UFILTRERTE feltet
  // og tegnes ikke av klienten (userBlockedFromGlobal gater plasseringsraden).
  assert.ok(j.userEntry, 'blokkert kaller skal fortsatt få egne tall')
  assert.equal(j.userEntry.points, 11)
  assert.equal(j.userEntry.rank, 2)
  assert.equal(j.userBlockedFromGlobal, true)
})

// ── Siste quiz: blokkert uten forsøk — «Du spilte ikke» er da SANT ──────────

test('blokkert uten forsøk: flagget forblir false og userEntry null', async () => {
  state.blocked = ['u-doris']
  state.authUser = { id: 'u-doris' }
  state.userProfile = { display_name: 'Doris', nickname: null, premium_status: false }
  const j = await (await call('period=last_quiz&scope=global', 'tok')).json()
  assert.equal(j.userEntry, null)
  assert.equal(j.userBlockedFromGlobal, false)
})

// ── Periode-fanene: live-sjekken ─────────────────────────────────────────────

test('periode positiv kontroll: bruker uten org-medlemskap får flagget false', async () => {
  state.authUser = { id: 'u-bjorn' }
  const j = await (await call('period=month&scope=global', 'tok')).json()
  assert.equal(j.userBlockedFromGlobal, false)
})

test('periode: blokkert (eget opt-out) uten rader får flagget true', async () => {
  state.authUser = { id: 'u-bjorn' }
  state.orgMems = [{ organization_id: 'org-1', global_league_opt_out: true }]
  const j = await (await call('period=month&scope=global', 'tok')).json()
  assert.equal(j.userBlockedFromGlobal, true)
})

test('periode: blokkert via stengt org (allow_global_league=false) får flagget true', async () => {
  state.authUser = { id: 'u-bjorn' }
  state.orgMems = [{ organization_id: 'org-1', global_league_opt_out: null }]
  state.restrictedOrgs = [{ id: 'org-1' }]
  const j = await (await call('period=month&scope=global', 'tok')).json()
  assert.equal(j.userBlockedFromGlobal, true)
})

// ── Interne rom får aldri flagget ────────────────────────────────────────────

test('org-scope: live-sjekken kjøres ikke og flagget er false, selv for et opt-out-medlem', async () => {
  state.authUser = { id: 'u-bjorn' }
  state.orgMems = [{ organization_id: 'org-1', global_league_opt_out: true }]
  const j = await (await call('period=month&scope=organization&scope_id=org-1', 'tok')).json()
  assert.equal(j.userBlockedFromGlobal, false)
  // organization_members ble aldri spurt — gaten sitter på scope, ikke på svaret.
  assert.equal(state.orgMemsCalls, 0)
})
