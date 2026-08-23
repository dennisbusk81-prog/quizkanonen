// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/toppliste sin last_quiz-gren mot en
// fake som kutter ved 1000 rader (PostgREST db-max-rows, målt oppførsel).
// getLastQuizAttempts går via fetchAllRows (18. august 2026); før det så
// rangeringen bare de 1000 første radene.
//
// MUTASJONSBEVIS: byttes fetchAllRows tilbake til ett rått kall, ser ruten
// 1000 av 1100 forsøk — vinneren (13 riktige) ligger på rad 1050 og
// forsvinner, så entries[0]-asserten OG totalCount-asserten ryker.
//
// FEILSTIEN er også dekket: en spørrefeil skal gi tom liste for DENNE
// forespørselen (samme synlige oppførsel som før pagineringen), men IKKE
// caches — neste forespørsel etter at basen er frisk skal se radene igjen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000

type AttemptRow = {
  id: string
  user_id: string
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
  submitted_at: string | null
}

const state: {
  latestQuiz: { id: string; title: string; closes_at: string; season_points_awarded: boolean; show_leaderboard: boolean } | null
  attempts: AttemptRow[]
  attemptQueries: number
  dbDown: boolean
} = { latestQuiz: null, attempts: [], attemptQueries: 0, dbDown: false }

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
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select() { return b },
    eq() { return b },
    not() { return b },
    in() { return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      state.attemptQueries++
      if (state.dbDown) {
        return Promise.resolve({ data: null, error: { message: 'db nede' } }).then(res, rej)
      }
      const window = state.attempts.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

function profilesBuilder() {
  let mode: 'suspended' | 'list' = 'list'
  const b = {
    select() { return b },
    gt() { mode = 'suspended'; return b },
    in() { mode = 'list'; return b },
    eq() { return b },
    async maybeSingle() { return { data: null } },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      void mode
      // Tom profilliste → displayName faller tilbake på player_name, som er
      // alt denne testen trenger.
      return Promise.resolve({ data: [], error: null }).then(res, rej)
    },
  }
  return b
}

function excludedBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    is() { return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      rpc: async () => ({ data: [], error: null }),
      from: (table: string) => {
        if (table === 'quizzes') return quizzesBuilder() as never
        if (table === 'attempts') return attemptsBuilder() as never
        if (table === 'profiles') return profilesBuilder() as never
        if (table === 'excluded_members') return excludedBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

mock.module('@/lib/globally-blocked-set', {
  namedExports: { getGloballyBlockedSet: async () => new Set<string>() },
})

const { GET } = await import('@/app/api/toppliste/route')

function call() {
  const request = new Request('https://quizkanonen.no/api/toppliste?period=last_quiz&scope=global')
  return GET(request as never)
}

// Rutens attempts-cache er modul-lokal med 30s TTL — hver test bruker sin egen
// quiz-id slik at forrige tests rader aldri serveres fra cachen.
let quizSeq = 0
beforeEach(() => {
  quizSeq++
  state.latestQuiz = {
    id: `q-${quizSeq}`, title: 'Fredagsquiz 14.08.2026',
    closes_at: '2026-08-14T20:00:00Z', season_points_awarded: true,
    // Speiler DB-defaulten — uten feltet regner ruten (fail-safe, med vilje)
    // resultatene som permanent av og tømmer entries.
    show_leaderboard: true,
  }
  // 1100 distinkte innloggede spillere. Vinneren (13 riktige, alle andre har
  // 10) ligger på rad 1050 — bak 1000-taket.
  state.attempts = Array.from({ length: 1100 }, (_, i) => ({
    id: `a-${String(i).padStart(4, '0')}`,
    user_id: `u-${String(i).padStart(4, '0')}`,
    player_name: i === 1050 ? 'Vinner' : `Spiller ${i}`,
    correct_answers: i === 1050 ? 13 : 10,
    total_time_ms: 60_000 + i,
    correct_streak: 0,
    submitted_at: '2026-08-14T19:00:00Z',
  }))
  state.attemptQueries = 0
  state.dbDown = false
})

test('last_quiz rangerer HELE feltet — vinneren bak 1000-taket er #1', async () => {
  const res = await call()
  assert.equal(res.status, 200)
  const j = await res.json()

  assert.equal(j.entries[0].displayName, 'Vinner',
    'vinneren ligger på rad 1050 — uten paginering er hen usynlig')
  assert.equal(j.entries[0].rank, 1)
  assert.equal(j.totalCount, 1100, 'kutt ved 1000 ville gitt 1000')
  assert.ok(state.attemptQueries >= 2,
    `forventet paginering, fikk ${state.attemptQueries} spørring(er)`)
})

test('feil gir tom liste for forespørselen, men caches IKKE — neste kall ser radene', async () => {
  state.dbDown = true
  const j1 = await (await call()).json()
  assert.deepEqual(j1.entries, [], 'en spørrefeil skal gi tom liste, ikke en 500')

  // Basen «friskner til» — samme quiz-id. Var den tomme listen cachet, ville
  // dette kallet også vært tomt i 30 s (nøyaktig det kommentaren i ruten lover
  // at ikke skjer).
  state.dbDown = false
  const j2 = await (await call()).json()
  assert.equal(j2.totalCount, 1100, 'feilresponsen ble cachet — tom liste serveres etter at basen er frisk')
  assert.equal(j2.entries[0].displayName, 'Vinner')
})

test('kontroll: de 1000 første radene inneholder ikke vinneren', () => {
  const kuttet = state.attempts.slice(0, PG_ROW_CAP)
  assert.ok(!kuttet.some(r => r.player_name === 'Vinner'),
    'datasettet må gjemme vinneren bak taket — ellers beviser testen ingenting')
})
