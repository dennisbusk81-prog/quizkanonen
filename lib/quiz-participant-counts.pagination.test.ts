// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte fetchParticipantCounts() (deltakertellingen på
// /quizer, trukket ut av app/quizer/page.tsx 18. august 2026). Faken oppfører
// seg som PostgREST på BEGGE de målte takene:
//   • aldri mer enn 1000 rader per svar (db-max-rows, målt 2. august 2026)
//   • .in()-lister over 390 nøkler feiler med «Bad Request» (URL-taket,
//     målt 26. juli 2026)
//
// MUTASJONSBEVIS: byttes fetchAllRowsChunked ut med ett rått
// .in(quizIds)-kall, ryker testen to ganger — 401 quiz-id-er i én URL gir
// «Bad Request» (og feilhåndteringen gjør da tellingen tom, så q-000-asserten
// feiler), og selv under URL-taket ville radkuttet ved 1000 gitt feil tall.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_CAP = 390

type AttemptRow = { quiz_id: string; user_id: string }

const state: {
  attempts: AttemptRow[]
  excluded: { user_id: string }[]
  attemptQueries: number
  chunkSizes: number[]
  dbDown: boolean
} = { attempts: [], excluded: [], attemptQueries: 0, chunkSizes: [], dbDown: false }

function attemptsBuilder() {
  let chunk: string[] = []
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select() { return b },
    eq() { return b },
    not() { return b },
    order() { return b },
    in(_col: string, keys: string[]) { chunk = keys; return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      state.attemptQueries++
      state.chunkSizes.push(chunk.length)
      if (state.dbDown || chunk.length > URL_CAP) {
        // Målt prod-oppførsel: for lang .in()-liste = feil, ikke stille kutt.
        return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
      }
      const set = new Set(chunk)
      const matching = state.attempts.filter(r => set.has(r.quiz_id))
      const window = matching.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
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
      return Promise.resolve({ data: state.excluded, error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'attempts') return attemptsBuilder()
        if (table === 'excluded_members') return excludedBuilder()
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { fetchParticipantCounts } = await import('@/lib/quiz-participant-counts')

// 401 quiz-id-er (> URL-taket på 390 hvis de sendes i ÉN liste) — chunkes til
// 200 + 200 + 1. q-000 har 1500 distinkte spillere, så chunk 1 må dessuten
// pagineres forbi 1000-radstaket. u-ekskludert er én av de 1500.
const QUIZ_IDS = Array.from({ length: 401 }, (_, i) => `q-${String(i).padStart(3, '0')}`)

function seed() {
  state.attempts = []
  state.excluded = [{ user_id: 'u-ekskludert' }]
  state.attemptQueries = 0
  state.chunkSizes = []
  state.dbDown = false
  for (let i = 0; i < 1499; i++) state.attempts.push({ quiz_id: 'q-000', user_id: `u-${i}` })
  state.attempts.push({ quiz_id: 'q-000', user_id: 'u-ekskludert' })
  // Én quiz i hver av de andre chunkene, så alle tre bitene beviselig leses.
  state.attempts.push({ quiz_id: 'q-200', user_id: 'u-1' })
  state.attempts.push({ quiz_id: 'q-200', user_id: 'u-2' })
  state.attempts.push({ quiz_id: 'q-400', user_id: 'u-3' })
}

test('deltakertellingen leser forbi både URL-taket og 1000-radstaket', async () => {
  seed()
  const counts = await fetchParticipantCounts(QUIZ_IDS)

  assert.equal(counts.get('q-000'), 1499, '1500 spillere minus 1 ekskludert — kutt ved 1000 ville gitt 999')
  assert.equal(counts.get('q-200'), 2, 'chunk 2 ble aldri lest')
  assert.equal(counts.get('q-400'), 1, 'chunk 3 ble aldri lest')
  assert.ok(
    state.chunkSizes.every(n => n <= URL_CAP),
    `en .in()-liste oversteg URL-taket: ${JSON.stringify(state.chunkSizes)}`,
  )
  assert.ok(
    state.attemptQueries >= 4,
    `forventet minst 4 spørringer (2 sider i chunk 1 + chunk 2 + chunk 3), fikk ${state.attemptQueries}`,
  )
})

test('kontroll: ett rått kall hadde gitt feil svar — datasettet skiller utfallene', () => {
  seed()
  // Under URL-taket ville radkuttet alene gitt 1000 rader — og dermed feil tall.
  const kuttet = state.attempts.slice(0, PG_ROW_CAP)
  const distinkte = new Set(kuttet.filter(r => r.quiz_id === 'q-000').map(r => r.user_id))
  assert.ok(distinkte.size < 1499, 'de 1000 første radene må mangle spillere fra q-000')
  // Og selve listen er over URL-taket, så det rå kallet hadde strengt tatt feilet før det.
  assert.ok(QUIZ_IDS.length > URL_CAP)
})

test('feil gir tom map — aldri et delvis tall, og siden velter ikke', async () => {
  seed()
  state.dbDown = true
  const counts = await fetchParticipantCounts(QUIZ_IDS)
  assert.equal(counts.size, 0, 'en spørrefeil skal gi tom map, ikke et delvis resultat')
})
