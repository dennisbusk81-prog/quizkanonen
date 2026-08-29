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

// Må settes FØR attempt-token brukes: signingKey() leser env ved hvert kall.
process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

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
const { createAttemptToken } = await import('@/lib/attempt-token')

// ── Hvorfor kallene nå bærer et PREMIUM-token (P-2, 23. august 2026) ─────────
// `placement.rank` er observatøren nesten alle testene under bruker for å bevise
// at blokkert-gaten re-rankes riktig. Etter premium-gaten sender ruten det
// eksakte tallet KUN til en kaller med et signert premium-krav, så uten token
// ville hver eneste assert lest `null` — og filen ville bevist premium-gaten i
// stedet for den blokkert-gaten den er skrevet for.
//
// Tokenet er ekte (lib/attempt-token er ikke mocket her), signert over samme
// (attemptId, quizId) som forespørselen gjelder. Dermed dekker filen samtidig
// at de to gatene KOMPONERER: en premium-kaller får eksakt rank, men den
// ranken er fortsatt regnet mot det FILTRERTE feltet. En egen test nederst
// dekker samme kall uten token.
function call(query = '', opts: { attemptId?: string; premium?: boolean } = {}) {
  const { attemptId, premium = true } = opts
  // attemptId hentes ut av query-strengen når den ikke er oppgitt eksplisitt,
  // så tokenet alltid gjelder NØYAKTIG det forsøket kallet spør om.
  const id = attemptId ?? new URLSearchParams(query).get('attemptId')
  // `id === null` er en EKTE testinngang (kallet uten token nederst i fila).
  // En null fra createAttemptToken betyr derimot at signeringsnøkkelen mangler,
  // og de to må ikke se like ut: den siste ville stille gjort et premium-kall
  // token-løst og latt premium-gaten skjule `rank` — grønt av feil grunn.
  let token: string | null = null
  if (id) {
    token = createAttemptToken(id, 'q-1', { premium })
    assert.ok(token, 'createAttemptToken ga null — er QUIZ_TOKEN_SECRET fjernet fra toppen av fila?')
  }
  const request = new Request(
    `https://quizkanonen.no/api/quiz/q-1/standings${query ? `?${query}` : ''}`,
    token ? { headers: { 'x-attempt-token': token } } : undefined,
  )
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

// ── PREMIUM-GATEN (P-2, 23. august 2026) ────────────────────────────────────
// Testene over kjører alle MED premium-token, slik at blokkert-gaten kan
// observeres gjennom `rank`. Disse to dekker gaten selv.
//
// MUTASJONSBEVIS
//   • Fjern gatePlacement-kallet i ruten (send rawPlacement rått), og
//     «uten premium-token …» ryker: rank og nabonavn dukker opp igjen.
//   • Gjeninnfør placement på det upersonlige kallet, og «upersonlig kall …»
//     ryker — det er den CDN-cachede grenen, se punkt (b) i rutens
//     toppkommentar.

test('uten premium-token: spenn og total, men ingen eksakt rank og ingen nabonavn', async () => {
  const j = await (await call('attemptId=a-bjorn&correct=11&time=65000', { premium: false })).json()
  assert.equal(j.placement.rank, null, 'eksakt plassering skal ikke forlate serveren')
  assert.equal(j.placement.above, null, 'nabonavn er en personopplysning, ikke et tall')
  assert.equal(j.placement.below, null)
  // ...men gratisvisningen er komplett: spennet og feltstørrelsen kommer som før.
  assert.equal(j.placement.total, 4)
  assert.equal(typeof j.placement.low, 'number')
  assert.equal(typeof j.placement.high, 'number')
  // Topp-3 er IKKE premium-gatet — den har alltid vært offentlig.
  assert.deepEqual(
    j.top3.map((e: { player_name: string }) => e.player_name),
    ['Anna', 'Bjørn', 'Cato'],
  )
})

test('helt anonymt kall (ingen token i det hele tatt) får heller ingen eksakt rank', async () => {
  const j = await (await call('attemptId=a-bjorn&correct=11&time=65000', { attemptId: undefined, premium: false })).json()
  assert.equal(j.placement.rank, null)
  assert.equal(j.placement.above, null)
  assert.equal(j.placement.below, null)
})

test('upersonlig kall får INGEN placement — den grenen er CDN-cachet', async () => {
  // Uten attemptId/correct/time er svaret delt (public, s-maxage). En placement
  // der ville vært et tall for en spiller med 0 riktige på 0 ms — og den ville
  // ligget i CDN-en. Se punkt (a) og (b) i rutens toppkommentar.
  const res = await call()
  const j = await res.json()
  assert.equal(j.placement, null)
  assert.match(res.headers.get('cache-control') ?? '', /^public,/)
  // Topp-3 leveres som før — det er det eneste klienten leser fra denne grenen.
  assert.equal(j.top3.length, 3)
})
