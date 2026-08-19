// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av /api/leaderboard/[id] og prev-rank sin globale
// synlighets-gate (steg 2, 4. august 2026): brukere blokkert fra den åpne
// konkurransen (org med allow_global_league=false, eller eget opt-out) skal
// ikke vises i den OFFENTLIGE resultatlisten for en enkeltquiz.
//
// MUTASJONSBEVIS
//   • Fjernes publicRows-filteret i hovedruten, dukker den blokkerte opp i
//     entries igjen og «blokkert bruker er fjernet …» ryker.
//   • Rankes entries fra det ufiltrerte feltet, ryker re-rank-asserten
//     (gjenværende skal starte på 1 uten hull).
//   • Gates ?org=-stien ved en feil, ryker «org-modus gates IKKE» på at
//     getGloballyBlockedSet i det hele tatt ble kalt / at medlemmet mangler.
//   • Fjernes mine-fallbacken, mister en blokkert kaller sin egen rad
//     (userEntry) og «egen rad skjules aldri for en selv» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type FakeRow = {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  is_team: boolean
  team_size: number
  leader_display_name: string | null
  submitted_at: string | null
}

function row(id: string, userId: string | null, name: string, correct: number, timeMs: number): FakeRow {
  return {
    id, user_id: userId, player_name: name,
    correct_answers: correct, total_questions: 15, total_time_ms: timeMs,
    correct_streak: 0, is_team: false, team_size: 1, leader_display_name: null,
    submitted_at: '2026-07-31T13:00:00Z',
  }
}

const state: {
  attempts: FakeRow[]
  quizRow: Record<string, unknown> | null
  currentQuiz: { closes_at: string } | null
  prevQuiz: { id: string; season_points_awarded: boolean } | null
  blocked: string[]
  blockedCalls: { quizId: string; ids: string[]; awarded: boolean }[]
  orgGate: { ok: true; orgId: string; memberIds: string[] } | { ok: false; status: 401 | 403; error: string }
  premium: boolean
  authUser: { id: string } | null
} = {
  attempts: [], quizRow: null, currentQuiz: null, prevQuiz: null,
  blocked: [], blockedCalls: [],
  orgGate: { ok: false, status: 403, error: 'Ikke tilgang' },
  premium: false, authUser: null,
}

// Én felles, kjede-tolerant builder per tabell. quizzes-oppslagene skilles på
// select-strengen (hovedruten ber om hide_leaderboard_until_closed, prev-rank
// sitt current-oppslag om kun closes_at) og på .lt() (prev-quiz-oppslaget).
function quizzesBuilder() {
  let selectCols = ''
  let hasLt = false
  const b = {
    select(cols: string) { selectCols = cols; return b },
    eq() { return b },
    lt() { hasLt = true; return b },
    order() { return b },
    limit() { return b },
    async maybeSingle() {
      if (hasLt) return { data: state.prevQuiz }
      if (selectCols.includes('hide_leaderboard_until_closed')) return { data: state.quizRow }
      return { data: state.currentQuiz }
    },
  }
  return b
}

function attemptsBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    limit() { return b },
    // Hovedruten henter attempts via fetchAllRows (paginert 18. august 2026)
    // — .order()/.range() må finnes. Fixturene er små (< pageSize), så én
    // side holder og hele settet kan returneres uavhengig av vinduet.
    order() { return b },
    range() { return b },
    then(resolve: (r: { data: FakeRow[]; error: null }) => unknown) {
      return Promise.resolve({ data: state.attempts, error: null }).then(resolve)
    },
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
      auth: {
        getUser: async () => ({ data: { user: state.authUser }, error: null }),
      },
      from: (table: string) => {
        if (table === 'attempts') return attemptsBuilder() as never
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

mock.module('@/lib/org-membership', {
  namedExports: { resolveOrgMembership: async () => state.orgGate },
})

mock.module('@/lib/premium-check', {
  namedExports: { getUserPremium: async () => ({ ok: true as const, value: state.premium }) },
})

const { GET } = await import('@/app/api/leaderboard/[id]/route')
const { GET: GET_PREV } = await import('@/app/api/leaderboard/[id]/prev-rank/route')

function callMain(query = '', token?: string) {
  const request = new Request(`https://quizkanonen.no/api/leaderboard/q-main${query ? `?${query}` : ''}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return GET(request as never, { params: Promise.resolve({ id: 'q-main' }) })
}

function callPrev(query = '', token?: string) {
  const request = new Request(`https://quizkanonen.no/api/leaderboard/q-current/prev-rank${query ? `?${query}` : ''}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return GET_PREV(request as never, { params: Promise.resolve({ id: 'q-current' }) })
}

beforeEach(() => {
  state.attempts = [
    row('a-anna', 'u-anna', 'Anna', 12, 60_000),
    row('a-bjorn', 'u-bjorn', 'Bjørn', 11, 65_000),
    row('a-cato', 'u-cato', 'Cato', 10, 70_000),
  ]
  // Stengt, gjort opp, leaderboard på — ingen skjuling i veien for entries.
  state.quizRow = {
    closes_at: '2026-07-31T14:00:00Z',
    hide_leaderboard_until_closed: false,
    show_leaderboard: true,
    season_points_awarded: true,
  }
  state.currentQuiz = { closes_at: '2026-08-07T14:00:00Z' }
  state.prevQuiz = { id: 'q-prev', season_points_awarded: true }
  state.blocked = []
  state.blockedCalls = []
  state.orgGate = { ok: false, status: 403, error: 'Ikke tilgang' }
  state.premium = false
  state.authUser = null
})

// ── Positiv kontroll FØRST: åpen org → alle synlige, gaten spurte riktig ─────

test('positiv kontroll: uten blokkerte vises alle i entries med rank 1..n', async () => {
  const res = await callMain()
  assert.equal(res.status, 200)
  const j = await res.json()
  assert.deepEqual(
    j.entries.map((e: { playerName: string; rank: number }) => [e.playerName, e.rank]),
    [['Anna', 1], ['Bjørn', 2], ['Cato', 3]],
  )
  assert.equal(j.totalCount, 3)
  // Gaten ble faktisk konsultert, med quizens id, alle innloggede spillere og
  // oppgjørsstatusen — beviser at ruten er koblet på, ikke bare at settet var tomt.
  assert.equal(state.blockedCalls.length, 1)
  assert.equal(state.blockedCalls[0].quizId, 'q-main')
  assert.deepEqual([...state.blockedCalls[0].ids].sort(), ['u-anna', 'u-bjorn', 'u-cato'])
  assert.equal(state.blockedCalls[0].awarded, true)
})

// ── Blokkert forsvinner, og gjenværende re-rankes uten hull ──────────────────

test('blokkert bruker er fjernet fra entries og gjenværende re-rankes', async () => {
  state.blocked = ['u-bjorn']
  const j = await (await callMain()).json()
  assert.deepEqual(
    j.entries.map((e: { playerName: string; rank: number }) => [e.playerName, e.rank]),
    [['Anna', 1], ['Cato', 2]], // Cato rykker fra 3 til 2 — ikke [1, 3]
  )
  assert.equal(j.totalCount, 2)
})

// ── ?org=-modus gates IKKE — der er de blokkerte legitime ────────────────────

test('org-modus: blokkert medlem vises, og gaten kalles ikke i det hele tatt', async () => {
  state.blocked = ['u-bjorn']
  state.orgGate = { ok: true, orgId: 'org-1', memberIds: ['u-anna', 'u-bjorn'] }
  const j = await (await callMain('org=lukket-as', 'tok')).json()
  assert.deepEqual(
    j.entries.map((e: { playerName: string; rank: number }) => [e.playerName, e.rank]),
    [['Anna', 1], ['Bjørn', 2]], // org-feltet: Cato er ikke medlem, Bjørn er med
  )
  assert.equal(state.blockedCalls.length, 0)
})

// ── Lag-rommet gates ikke (blocked-settet er utledet fra solo-populasjonen) ──

test('is_team=true konsulterer ikke gaten', async () => {
  state.blocked = ['u-bjorn']
  await callMain('is_team=true')
  assert.equal(state.blockedCalls.length, 0)
})

// ── Egen rad skjules aldri for en selv ───────────────────────────────────────

test('blokkert kaller beholder userEntry (egne tall), men står ikke i entries', async () => {
  state.blocked = ['u-bjorn']
  state.authUser = { id: 'u-bjorn' }
  const j = await (await callMain('', 'tok-bjorn')).json()
  // Egen rad finnes — score/tid er brukerens egne resultater.
  assert.ok(j.userEntry, 'blokkert kaller skal fortsatt få sin egen rad')
  assert.equal(j.userEntry.playerName, 'Bjørn')
  assert.equal(j.userEntry.correctAnswers, 11)
  // ...men i den offentlige listen finnes hen ikke.
  assert.ok(!j.entries.some((e: { playerName: string }) => e.playerName === 'Bjørn'))
})

// ── prev-rank: samme gate, forrige quiz' id og oppgjørsstatus ────────────────

test('prev-rank: blokkert mangler i rank-mappen, gjenværende re-rankes', async () => {
  state.blocked = ['u-bjorn']
  const j = await (await callPrev()).json()
  assert.equal(j.prevRanks['u-anna'], 1)
  assert.equal(j.prevRanks['u-cato'], 2) // re-ranket fra 3
  assert.ok(!('u-bjorn' in j.prevRanks))
  // Gaten ble spurt for FORRIGE quiz, ikke gjeldende.
  assert.equal(state.blockedCalls.length, 1)
  assert.equal(state.blockedCalls[0].quizId, 'q-prev')
  assert.equal(state.blockedCalls[0].awarded, true)
})

test('prev-rank positiv kontroll: uten blokkerte er alle med', async () => {
  const j = await (await callPrev()).json()
  assert.deepEqual(
    ['u-anna', 'u-bjorn', 'u-cato'].map(id => j.prevRanks[id]),
    [1, 2, 3],
  )
})
