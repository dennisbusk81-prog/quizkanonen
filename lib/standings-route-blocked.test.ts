// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av /api/quiz/[id]/standings sin globale synlighets-gate
// (5. august 2026): resultatskjermens topp-3 og plassering skal regnes mot det
// SAMME synlige feltet som /api/leaderboard/[id] — ikke det ufiltrerte.
// Fram til nå sa resultatskjermen «av 63» mens leaderboard-siden sa «av 59»
// for samme quiz (målt i prod, Fredagsquiz 31.07).
//
// ranking-snapshot-modulen er EKTE her (kun supabase-admin under den er
// mocket, med en fersk cache-rad): re-rank og computePlacement bevises mot
// reell kode, ikke en kopi.
//
// MUTASJONSBEVIS
//   • Fjernes publicSnapshot-filteret, dukker den blokkerte opp i top3 igjen
//     og «blokkert bruker er fjernet …» ryker.
//   • Droppes den posisjonelle re-ranken (map med i+1), beholder gjenværende
//     hull i rank og placement.rank-asserten (2, ikke 3) ryker.
//   • Fjernes callerBlocked-fallbacken (placementPool alltid publicSnapshot),
//     mister en blokkert kaller plasseringen sin (computePlacement finner ikke
//     attemptId i det filtrerte feltet og estimerer mot feil total) og
//     «blokkert kaller beholder egen plassering …» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { SnapshotEntry } from './ranking-snapshot'

function entry(id: string, userId: string | null, name: string, rank: number, correct: number, timeMs: number): SnapshotEntry {
  return {
    id, user_id: userId, player_name: name, rank,
    correct_answers: correct, total_time_ms: timeMs, correct_streak: 0,
  }
}

const state: {
  snapshot: SnapshotEntry[]
  quizRow: { closes_at: string | null; season_points_awarded: boolean } | null
  blocked: string[]
  blockedCalls: { quizId: string; ids: string[]; awarded: boolean }[]
} = { snapshot: [], quizRow: null, blocked: [], blockedCalls: [] }

function snapshotBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() {
      // Fersk cache-rad → getOrBuildSnapshot returnerer den uten rebuild og
      // uten skriving. Testene sender alltid et attemptId som finnes i
      // snapshoten (ellers ville ensureAttemptId tvunget en rebuild mot en
      // attempts-tabell denne mocken bevisst ikke har).
      return { data: { snapshot: state.snapshot, created_at: new Date().toISOString() } }
    },
  }
  return b
}

function quizzesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() { return { data: state.quizRow } },
  }
  return b
}

function profilesBuilder() {
  const b = {
    select() { return b },
    in() { return b },
    then(resolve: (r: { data: never[] }) => unknown) {
      return Promise.resolve({ data: [] as never[] }).then(resolve)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'ranking_snapshots') return snapshotBuilder() as never
        if (table === 'quizzes') return quizzesBuilder() as never
        if (table === 'profiles') return profilesBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

mock.module('@/lib/globally-blocked-set', {
  namedExports: {
    getGloballyBlockedSet: async (quizId: string, ids: string[], awarded: boolean) => {
      state.blockedCalls.push({ quizId, ids: [...ids], awarded })
      return new Set(state.blocked)
    },
  },
})

const { GET } = await import('@/app/api/quiz/[id]/standings/route')

function call(query = '') {
  const request = new Request(`https://quizkanonen.no/api/quiz/q-1/standings${query ? `?${query}` : ''}`)
  return GET(request as never, { params: Promise.resolve({ id: 'q-1' }) })
}

beforeEach(() => {
  state.snapshot = [
    entry('a-anna', 'u-anna', 'Anna', 1, 12, 60_000),
    entry('a-bjorn', 'u-bjorn', 'Bjørn', 2, 11, 65_000),
    entry('a-cato', 'u-cato', 'Cato', 3, 10, 70_000),
    entry('a-gjest', null, 'Gjest Gjestesen', 4, 9, 75_000),
  ]
  state.quizRow = { closes_at: '2026-07-31T14:00:00Z', season_points_awarded: true }
  state.blocked = []
  state.blockedCalls = []
})

// ── Positiv kontroll FØRST: uten blokkerte er alt som før ───────────────────

test('positiv kontroll: uten blokkerte er top3 og plassering uendret, og gaten ble spurt riktig', async () => {
  const res = await call('attemptId=a-bjorn&correct=11&time=65000')
  assert.equal(res.status, 200)
  const j = await res.json()
  assert.deepEqual(
    j.top3.map((e: { player_name: string }) => e.player_name),
    ['Anna', 'Bjørn', 'Cato'],
  )
  assert.equal(j.placement.rank, 2)
  assert.equal(j.placement.total, 4)
  // Gaten ble konsultert med quizens id, alle innloggede i snapshoten (aldri
  // gjesten) og oppgjørsstatusen — ruten er koblet på, ikke bare tom.
  assert.equal(state.blockedCalls.length, 1)
  assert.equal(state.blockedCalls[0].quizId, 'q-1')
  assert.deepEqual([...state.blockedCalls[0].ids].sort(), ['u-anna', 'u-bjorn', 'u-cato'])
  assert.equal(state.blockedCalls[0].awarded, true)
})

// ── Blokkert forsvinner fra top3, og gjenværende re-rankes uten hull ────────

test('blokkert bruker er fjernet fra top3, og en ikke-blokkert kallers plassering re-rankes', async () => {
  state.blocked = ['u-bjorn']
  const j = await (await call('attemptId=a-cato&correct=10&time=70000')).json()
  assert.deepEqual(
    j.top3.map((e: { player_name: string }) => e.player_name),
    ['Anna', 'Cato', 'Gjest Gjestesen'],
  )
  // Cato rykker fra 3 til 2 i det synlige feltet — og totalen følger det.
  assert.equal(j.placement.rank, 2)
  assert.equal(j.placement.total, 3)
})

// ── Egne tall skjules aldri for en selv — mot det ufiltrerte feltet ─────────

test('blokkert kaller beholder egen plassering fra det ufiltrerte feltet, men står ikke i top3', async () => {
  state.blocked = ['u-bjorn']
  const j = await (await call('attemptId=a-bjorn&correct=11&time=65000')).json()
  // Plasseringen er den opprinnelige (mot hele feltet) — klientens
  // placement-visibility-lag avgjør om den vises (internal-only viser internt
  // tall i stedet).
  assert.equal(j.placement.rank, 2)
  assert.equal(j.placement.total, 4)
  // ...men i den offentlige topp-3 finnes hen ikke.
  assert.ok(!j.top3.some((e: { player_name: string }) => e.player_name === 'Bjørn'))
})

// ── Gjester (user_id null) berøres aldri av gaten ───────────────────────────

test('gjest står i top3 selv når blokkert-settet er ikke-tomt', async () => {
  state.blocked = ['u-anna', 'u-bjorn']
  const j = await (await call('attemptId=a-cato&correct=10&time=70000')).json()
  assert.deepEqual(
    j.top3.map((e: { player_name: string }) => e.player_name),
    ['Cato', 'Gjest Gjestesen'],
  )
  assert.equal(j.placement.rank, 1)
  assert.equal(j.placement.total, 2)
})
