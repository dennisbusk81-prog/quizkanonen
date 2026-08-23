// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte getQuestionStatsByAttempts() mot en fake som
// oppfører seg som PostgREST på BEGGE de målte takene:
//   • aldri mer enn 1000 rader per svar (radtaket, målt 2. august 2026)
//   • .in()-lister over 390 nøkler feiler med «Bad Request» (URL-taket,
//     målt 26. juli 2026)
//
// TO STIER, og testen dekker begge. NORMALSTIEN er RPC-en
// `attempt_answer_stats_by_attempts` — den aggregerer i databasen og sender
// id-ene i POST-body, så URL-taket gjelder ikke der. JS-fallbacken brukes bare
// når RPC-en svikter (ikke migrert ennå, eller nede), og det var DEN som la
// hele attemptIds-listen i URL-en: over ~390 forsøk kastet fetchAllRows, og
// fallbacken velter i stedet for å svare. Fem kallere: admin/results,
// quiz-results-text, org quiz-insights, forsidens «Ukens fakta» og
// answer-distribution (sistnevnte via den andre funksjonen).
//
// Ingen varig skade — dette er ren lesing — men fallbacken finnes nettopp for
// å holde flatene i live når RPC-en ikke gjør det, og en fallback som velter
// ved 400 deltakere er ingen fallback.
//
// MUTASJONSBEVIS: byttes fetchAllRowsChunked tilbake til fetchAllRows med
// `.in('attempt_id', attemptIds)`, svarer faken «Bad Request», fetchAllRows
// kaster, og fallback-testene rejecter. Fjernes pagineringen innad i biten,
// ryker telleren for spørsmålene (401 forventet, 1000-radskuttet gir færre).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_CAP = 390

const QUESTION_COUNT = 10
const QUESTION_IDS = Array.from({ length: QUESTION_COUNT }, (_, i) => `q-${String(i).padStart(3, '0')}`)

// 401 forsøk: over URL-taket på ~390. Med 10 svar hver blir første bit
// (200 forsøk) 2000 rader — også over radtaket, så hver bit MÅ pagineres.
const ATTEMPT_COUNT = 401
const ATTEMPT_IDS = Array.from({ length: ATTEMPT_COUNT }, (_, i) => `a-${String(i).padStart(3, '0')}`)

type AnswerRow = { id: string; attempt_id: string; question_id: string; is_correct: boolean }

const state: {
  rows: AnswerRow[]
  rpcAvailable: boolean
  rpcCalls: string[]
  tableQueries: number
  chunkSizes: number[]
} = { rows: [], rpcAvailable: false, rpcCalls: [], tableQueries: 0, chunkSizes: [] }

// Rad-id-ene sorterer forsøk-for-forsøk, så .order('id') gir en deterministisk
// sidedeling — nøyaktig som i prod.
function seed() {
  state.rows = []
  state.rpcAvailable = false
  state.rpcCalls = []
  state.tableQueries = 0
  state.chunkSizes = []

  ATTEMPT_IDS.forEach((attemptId, i) => {
    QUESTION_IDS.forEach((questionId, qi) => {
      state.rows.push({
        id: `${attemptId}-${questionId}`,
        attempt_id: attemptId,
        question_id: questionId,
        // q-000 er lett (alle riktig), q-009 er vanskelig (ingen riktig),
        // resten varierer med forsøket — så et avkuttet radsett gir ANDRE tall,
        // ikke bare færre rader.
        is_correct: qi === 0 ? true : qi === QUESTION_COUNT - 1 ? false : i % 2 === 0,
      })
    })
  })
  state.rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function answersBuilder() {
  let inKeys: string[] = []
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select() { return b },
    in(_col: string, keys: string[]) { inKeys = keys; return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      state.tableQueries++
      state.chunkSizes.push(inKeys.length)
      // Målt prod-oppførsel: for lang .in()-liste = feil, ikke stille kutt.
      if (inKeys.length > URL_CAP) {
        return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
      }
      const set = new Set(inKeys)
      const matching = state.rows.filter(r => set.has(r.attempt_id))
      const window = matching.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      rpc: async (name: string) => {
        state.rpcCalls.push(name)
        if (!state.rpcAvailable) {
          return { data: null, error: { message: 'function does not exist' } }
        }
        const perQuestion = new Map<string, { total: number; correct: number }>()
        for (const r of state.rows) {
          const s = perQuestion.get(r.question_id) ?? { total: 0, correct: 0 }
          s.total++
          if (r.is_correct) s.correct++
          perQuestion.set(r.question_id, s)
        }
        return {
          data: [...perQuestion].map(([question_id, s]) => ({ question_id, ...s })),
          error: null,
        }
      },
      from: (table: string) => {
        if (table === 'attempt_answers') return answersBuilder()
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { getQuestionStatsByAttempts } = await import('@/lib/attempt-answer-stats')

beforeEach(seed)

// ── NORMALSTIEN ──────────────────────────────────────────────────────────────

test('normalstien: RPC-en svarer, og tabellen røres ikke i det hele tatt', async () => {
  state.rpcAvailable = true

  const stats = await getQuestionStatsByAttempts(ATTEMPT_IDS)

  assert.deepEqual(state.rpcCalls, ['attempt_answer_stats_by_attempts'])
  assert.equal(state.tableQueries, 0, 'RPC-stien skal ikke lese tabellen — id-ene går i POST-body, ikke i URL-en')
  assert.equal(stats.get('q-000')?.total, ATTEMPT_COUNT)
  assert.equal(stats.get('q-000')?.correct, ATTEMPT_COUNT)
})

// ── FALLBACKEN ───────────────────────────────────────────────────────────────

test('fallbacken med 401 forsøk: svarer, og ingen .in()-liste over URL-taket', async () => {
  const stats = await getQuestionStatsByAttempts(ATTEMPT_IDS)

  assert.ok(
    state.chunkSizes.every(n => n <= URL_CAP),
    `en .in()-liste oversteg URL-taket: ${JSON.stringify(state.chunkSizes)}`,
  )
  assert.equal(stats.size, QUESTION_COUNT, 'alle spørsmålene skal være med')
})

test('fallbacken teller ALLE forsøk — også forbi radtaket i hver bit', async () => {
  const stats = await getQuestionStatsByAttempts(ATTEMPT_IDS)

  // Hvert forsøk svarte på hvert spørsmål: total = 401 for alle ti.
  for (const qid of QUESTION_IDS) {
    assert.equal(stats.get(qid)?.total, ATTEMPT_COUNT, `${qid} fikk feil total — rader gikk tapt`)
  }

  // Og tallene må stemme, ikke bare radantallet: 201 forsøk har partall-indeks.
  const partall = ATTEMPT_IDS.filter((_, i) => i % 2 === 0).length
  assert.equal(stats.get('q-000')?.correct, ATTEMPT_COUNT, 'q-000 er riktig for alle')
  assert.equal(stats.get('q-005')?.correct, partall, 'q-005 er riktig for annenhver')
  assert.equal(stats.get('q-009')?.correct, 0, 'q-009 er feil for alle')

  assert.ok(
    state.tableQueries >= 5,
    `forventet minst 5 spørringer (3 sider i bit 1 + bit 2 + bit 3), fikk ${state.tableQueries}`,
  )
})

test('kontroll: datasettet SKILLER de to variantene', () => {
  seed()

  // 1) Listen er over URL-taket, så ett rått kall hadde feilet før noe ble lest.
  assert.ok(ATTEMPT_COUNT > URL_CAP, 'færre forsøk enn URL-taket ville ikke bevist noe')

  // 2) Og selv under URL-taket ville radkuttet alene gitt feil tall: de 1000
  //    første radene i bit 1 dekker bare de 100 første forsøkene.
  const bit1 = state.rows.filter(r => ATTEMPT_IDS.slice(0, 200).includes(r.attempt_id))
  assert.ok(bit1.length > PG_ROW_CAP, 'bit 1 må ha flere rader enn radtaket')
  const kuttet = bit1.slice(0, PG_ROW_CAP).filter(r => r.question_id === 'q-000').length
  assert.ok(kuttet < ATTEMPT_COUNT, 'et kuttet radsett må gi et ANNET tall enn det riktige')
})
