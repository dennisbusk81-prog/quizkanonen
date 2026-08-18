// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/leagues/[id]/leaderboard mot en fake
// som oppfører seg som PostgREST på begge de målte takene: aldri mer enn 1000
// rader per svar (db-max-rows), og «Bad Request» for .in()-lister over 390
// nøkler (URL-taket). Ligaen har 401 medlemmer og 1200+ attempts, så både
// chunking og paginering MÅ virke for at tallene skal stemme.
//
// MUTASJONSBEVIS: byttes fetchAllRowsChunked ut med ett rått kall, ryker
//   • quiz_count-asserten (kutt ved 1000 → 1000 i stedet for 1200), og
//   • siste_quiz-asserten (nyeste completed_at ligger i rad 1100+), og
//   • med 401 id-er i én URL feiler kallet i det hele tatt («Bad Request»).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_CAP = 390

type AttemptRow = {
  id: string
  quiz_id: string
  user_id: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  completed_at: string
}

const state: {
  memberIds: string[]
  attempts: AttemptRow[]
  attemptChunkSizes: number[]
  profileChunkSizes: number[]
} = { memberIds: [], attempts: [], attemptChunkSizes: [], profileChunkSizes: [] }

function leaguesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() {
      return { data: { id: 'liga-1', name: 'Testliga', reset_at: null }, error: null }
    },
  }
  return b
}

// To lesninger deler tabellen: medlemskaps-sjekken (maybeSingle) og
// medlemslisten (thenable).
function leagueMembersBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() { return { data: { user_id: 'u-000' }, error: null } },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve({
        data: state.memberIds.map(id => ({ user_id: id })),
        error: null,
      }).then(res, rej)
    },
  }
  return b
}

function profilesBuilder() {
  let chunk: string[] = []
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select() { return b },
    order() { return b },
    in(_col: string, keys: string[]) { chunk = keys; return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      state.profileChunkSizes.push(chunk.length)
      if (chunk.length > URL_CAP) {
        return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
      }
      const rows = chunk.map(id => ({ id, display_name: `Navn ${id}` }))
      const window = rows.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

function attemptsBuilder() {
  let chunk: string[] = []
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select() { return b },
    eq() { return b },
    gte() { return b },
    order() { return b },
    in(_col: string, keys: string[]) { chunk = keys; return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      state.attemptChunkSizes.push(chunk.length)
      if (chunk.length > URL_CAP) {
        return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
      }
      const set = new Set(chunk)
      const matching = state.attempts.filter(r => set.has(r.user_id))
      const window = matching.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

function quizzesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() { return { data: { title: 'Siste fredagsquiz' }, error: null } },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-000' } }, error: null }) },
      from: (table: string) => {
        if (table === 'leagues') return leaguesBuilder() as never
        if (table === 'league_members') return leagueMembersBuilder() as never
        if (table === 'profiles') return profilesBuilder() as never
        if (table === 'attempts') return attemptsBuilder() as never
        if (table === 'quizzes') return quizzesBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { GET } = await import('@/app/api/leagues/[id]/leaderboard/route')

function call() {
  const request = new Request('https://quizkanonen.no/api/leagues/liga-1/leaderboard', {
    headers: { authorization: 'Bearer tok' },
  })
  return GET(request as never, { params: Promise.resolve({ id: 'liga-1' }) })
}

// 401 medlemmer (> URL-taket i én liste) → 3 chunks. u-000 (i chunk 1) har
// 1200 attempts på 1200 ulike quizer; den NYESTE (q-sist) ligger på rad 1100
// — usynlig for et enkeltkall som kuttes ved 1000. u-200/u-400 beviser at
// chunk 2 og 3 leses.
beforeEach(() => {
  state.memberIds = Array.from({ length: 401 }, (_, i) => `u-${String(i).padStart(3, '0')}`)
  state.attempts = []
  state.attemptChunkSizes = []
  state.profileChunkSizes = []
  for (let i = 0; i < 1200; i++) {
    state.attempts.push({
      id: `a-${String(i).padStart(4, '0')}`,
      quiz_id: i === 1100 ? 'q-sist' : `q-${String(i).padStart(4, '0')}`,
      user_id: 'u-000',
      correct_answers: 1,
      total_questions: 10,
      total_time_ms: 60_000,
      // Rad 1100 har den NYESTE completed_at — alle andre ligger før i tid.
      completed_at: i === 1100 ? '2026-08-14T20:00:00.000Z' : `2026-0${i % 2 + 1}-01T0${i % 10}:00:00.000Z`,
    })
  }
  state.attempts.push({
    id: 'a-u200', quiz_id: 'q-sist', user_id: 'u-200',
    correct_answers: 9, total_questions: 10, total_time_ms: 50_000,
    completed_at: '2026-08-14T19:00:00.000Z',
  })
  state.attempts.push({
    id: 'a-u400', quiz_id: 'q-0001', user_id: 'u-400',
    correct_answers: 5, total_questions: 10, total_time_ms: 55_000,
    completed_at: '2026-03-01T10:00:00.000Z',
  })
})

test('liga-leaderboardet leser alle attempts forbi begge takene', async () => {
  const res = await call()
  assert.equal(res.status, 200)
  const j = await res.json()

  const u0 = j.all_time.find((r: { user_id: string }) => r.user_id === 'u-000')
  assert.equal(u0.quiz_count, 1200, 'kutt ved 1000 ville gitt 1000')
  assert.equal(u0.total_correct, 1200)

  // Chunk 2 og 3 ble lest — medlemmene der har tall, ikke nuller.
  const u200 = j.all_time.find((r: { user_id: string }) => r.user_id === 'u-200')
  assert.equal(u200.quiz_count, 1)
  const u400 = j.all_time.find((r: { user_id: string }) => r.user_id === 'u-400')
  assert.equal(u400.quiz_count, 1)

  // Navnene kom via den chunkede profiles-lesningen, ikke «Ukjent».
  assert.equal(u0.display_name, 'Navn u-000')

  assert.ok(state.attemptChunkSizes.every(n => n <= URL_CAP),
    `en attempts-.in()-liste oversteg URL-taket: ${JSON.stringify(state.attemptChunkSizes)}`)
  assert.ok(state.profileChunkSizes.every(n => n <= URL_CAP),
    `en profiles-.in()-liste oversteg URL-taket: ${JSON.stringify(state.profileChunkSizes)}`)
})

test('siste quiz er den med nyeste completed_at — også når raden ligger etter 1000-taket', async () => {
  const j = await (await call()).json()
  assert.equal(j.siste_quiz.quiz_id, 'q-sist',
    'nyeste forsøk ligger på rad 1100 — et kuttet radsett velger feil quiz')
  // Begge spillerne på q-sist er med, rangert på riktige svar.
  assert.deepEqual(
    j.siste_quiz.results.map((r: { user_id: string; rank: number }) => [r.user_id, r.rank]),
    [['u-200', 1], ['u-000', 2]],
  )
})
