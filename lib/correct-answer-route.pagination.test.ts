// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte fasitrettings-ruten
// (app/api/admin/correct-answer/route.ts) mot en fake som oppfører seg som
// PostgREST på BEGGE de målte takene:
//   • aldri mer enn 1000 rader per svar (radtaket, målt 2. august 2026)
//   • .in()-lister over 390 nøkler feiler med «Bad Request» (URL-taket,
//     målt 26. juli 2026)
//
// HVORFOR AKKURAT DENNE RUTEN HAR EGEN TEST: bruddet kommer MIDT I en
// flerstegsoperasjon. Når `.in('attempt_id', attemptIds)` feiler, har ruten
// allerede skrevet ny fasit på spørsmålet og ny is_correct på hver svarrad,
// men den rekker verken å oppdatere totalene i attempts eller å kjøre
// resyncSeasonScoresForQuiz. Svarradene sier da én ting, spillernes poeng og
// sesongpoeng noe annet — permanent, siden et nytt forsøk treffer nøyaktig
// samme vegg. Dette er det eneste stedet i pagineringssveipet der sesongpoeng
// kan bli VARIG feil.
//
// MUTASJONSBEVIS: byttes fetchAllRowsChunked tilbake til fetchAllRows med
// `.in('attempt_id', attemptIds)`, svarer faken «Bad Request», fetchAllRows
// kaster, og POST() rejecter. Da ryker BÅDE 200-asserten, alle
// attempts-totalene OG asserten om at resyncen ble kjørt — altså nøyaktig den
// halvferdige tilstanden testen finnes for å hindre.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_CAP = 390

const QUIZ_ID = 'quiz-fredag'
const QUESTION_COUNT = 10
const CORRECTED_INDEX = 5
const QUESTION_IDS = Array.from({ length: QUESTION_COUNT }, (_, i) => `q-${String(i).padStart(3, '0')}`)
const CORRECTED_QUESTION = QUESTION_IDS[CORRECTED_INDEX]

// 401 deltakere: over URL-taket på ~390, så en uchunket .in() feiler. Med 10
// spørsmål hver blir første bit (200 deltakere) 2000 rader — også over
// radtaket, så hver bit MÅ pagineres i tillegg.
const ATTEMPT_COUNT = 401
const ATTEMPT_IDS = Array.from({ length: ATTEMPT_COUNT }, (_, i) => `a-${String(i).padStart(3, '0')}`)

process.env.ADMIN_PASSWORD = 'test-admin-passord'

type AnswerRow = {
  id: string
  attempt_id: string
  question_id: string
  selected_answer: string | null
  is_correct: boolean
}

const state: {
  answers: AnswerRow[]
  questionKey: { correct_answer: string | null; correct_answers: string[] | null }
  attemptTotals: Map<string, { correct_answers: number; correct_streak: number }>
  inChunkSizes: number[]
  bulkReadQueries: number
  resyncCalls: string[]
} = {
  answers: [],
  questionKey: { correct_answer: 'A', correct_answers: null },
  attemptTotals: new Map(),
  inChunkSizes: [],
  bulkReadQueries: 0,
  resyncCalls: [],
}

// Rad-id-ene sorterer deltaker-for-deltaker, så .order('id') gir en
// deterministisk sidedeling — nøyaktig som i prod.
function seed() {
  state.answers = []
  state.questionKey = { correct_answer: 'A', correct_answers: null }
  state.attemptTotals = new Map()
  state.inChunkSizes = []
  state.bulkReadQueries = 0
  state.resyncCalls = []

  ATTEMPT_IDS.forEach((attemptId, i) => {
    QUESTION_IDS.forEach((questionId, qi) => {
      const isCorrected = questionId === CORRECTED_QUESTION
      // På det rettede spørsmålet svarte annenhver deltaker C — som blir
      // riktig først etter at fasiten utvides fra ['A'] til ['A','C'].
      const selected = isCorrected ? (i % 2 === 0 ? 'A' : 'C') : 'A'
      state.answers.push({
        id: `${attemptId}-${questionId}`,
        attempt_id: attemptId,
        question_id: questionId,
        selected_answer: selected,
        // Gammel tilstand: q-000..q-004 riktige, q-005 kun for A-svarene,
        // q-006..q-009 feil.
        is_correct: qi < CORRECTED_INDEX ? true : isCorrected ? i % 2 === 0 : false,
      })
    })
  })
  state.answers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function answersBuilder() {
  let op: 'select' | 'update' = 'select'
  let updateValues: Record<string, unknown> = {}
  const eqs: Record<string, string> = {}
  let inKeys: string[] | null = null
  let from = 0
  let to = PG_ROW_CAP - 1

  const b = {
    select() { return b },
    update(values: Record<string, unknown>) { op = 'update'; updateValues = values; return b },
    eq(col: string, val: string) { eqs[col] = val; return b },
    in(_col: string, keys: string[]) { inKeys = keys; return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      if (op === 'update') {
        const row = state.answers.find(r => r.id === eqs.id)
        if (row) row.is_correct = updateValues.is_correct === true
        return Promise.resolve({ data: null, error: null }).then(res, rej)
      }

      if (inKeys) {
        state.bulkReadQueries++
        state.inChunkSizes.push(inKeys.length)
        // Målt prod-oppførsel: for lang .in()-liste = feil, ikke stille kutt.
        if (inKeys.length > URL_CAP) {
          return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
        }
        const set = new Set(inKeys)
        const matching = state.answers.filter(r => set.has(r.attempt_id))
        const window = matching.slice(from, to + 1).slice(0, PG_ROW_CAP)
        return Promise.resolve({ data: window, error: null }).then(res, rej)
      }

      const matching = state.answers.filter(r => r.question_id === eqs.question_id)
      const window = matching.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

function questionsBuilder() {
  let op: 'select' | 'update' = 'select'
  let updateValues: Record<string, unknown> = {}
  let from = 0
  let to = PG_ROW_CAP - 1

  const b = {
    select() { return b },
    update(values: Record<string, unknown>) { op = 'update'; updateValues = values; return b },
    eq() { return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    single() {
      return Promise.resolve({
        data: {
          id: CORRECTED_QUESTION,
          question_text: 'Hva heter hovedstaden i Norge?',
          quiz_id: QUIZ_ID,
          correct_answer: state.questionKey.correct_answer,
          correct_answers: state.questionKey.correct_answers,
        },
        error: null,
      })
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      if (op === 'update') {
        state.questionKey = {
          correct_answer: updateValues.correct_answer as string,
          correct_answers: (updateValues.correct_answers as string[] | null) ?? null,
        }
        return Promise.resolve({ data: null, error: null }).then(res, rej)
      }
      const rows = QUESTION_IDS.map((id, order_index) => ({ id, order_index }))
      const window = rows.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

function quizzesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    maybeSingle() { return Promise.resolve({ data: { num_options: 4 }, error: null }) },
  }
  return b
}

function attemptsBuilder() {
  let updateValues: Record<string, unknown> = {}
  const b = {
    update(values: Record<string, unknown>) { updateValues = values; return b },
    eq(_col: string, val: string) {
      state.attemptTotals.set(val, {
        correct_answers: updateValues.correct_answers as number,
        correct_streak: updateValues.correct_streak as number,
      })
      return b
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve({ data: null, error: null }).then(res, rej)
    },
  }
  return b
}

function adminActionsBuilder() {
  return { insert: () => Promise.resolve({ error: null }) }
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'attempt_answers') return answersBuilder()
        if (table === 'questions') return questionsBuilder()
        if (table === 'quizzes') return quizzesBuilder()
        if (table === 'attempts') return attemptsBuilder()
        if (table === 'admin_actions') return adminActionsBuilder()
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

// Resyncen er STEGET SOM ALDRI KJØRER når .in()-kallet feiler. Den mockes bort
// (den har egne tester) — det som betyr noe her er OM den ble kalt.
mock.module('@/lib/resync-season-scores', {
  namedExports: {
    resyncSeasonScoresForQuiz: async (quizId: string) => {
      state.resyncCalls.push(quizId)
      return { quizId, checked: 0, updated: 0, unresolvable: 0, changes: [], error: null }
    },
  },
})

mock.module('next/cache', { namedExports: { revalidateTag: () => {} } })

const { POST } = await import('@/app/api/admin/correct-answer/route')

function call() {
  const request = new Request('https://quizkanonen.no/api/admin/correct-answer', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-password': process.env.ADMIN_PASSWORD as string,
    },
    body: JSON.stringify({ questionId: CORRECTED_QUESTION, newCorrectAnswers: ['A', 'C'] }),
  })
  return POST(request as never)
}

beforeEach(seed)

test('fasitretting med 401 deltakere: fullfører HELE kjeden, ingen .in()-liste over URL-taket', async () => {
  const res = await call()

  assert.equal(
    res.status,
    200,
    'et rått .in(alle 401) hadde fått Bad Request → fetchAllRows kaster → ruten dør etter at fasit og is_correct er skrevet',
  )

  assert.ok(
    state.inChunkSizes.every(n => n <= URL_CAP),
    `en .in()-liste oversteg URL-taket: ${JSON.stringify(state.inChunkSizes)}`,
  )

  // Steg for steg — det er REKKEFØLGEN som er poenget.
  assert.deepEqual(state.questionKey.correct_answers, ['A', 'C'], 'fasiten skal være skrevet')
  assert.equal(
    state.answers.filter(r => r.question_id === CORRECTED_QUESTION && r.is_correct).length,
    ATTEMPT_COUNT,
    'alle svarradene på det rettede spørsmålet skal nå være riktige',
  )
  assert.equal(state.attemptTotals.size, ATTEMPT_COUNT, 'hvert berørte forsøk skal ha fått nye totaler')
  assert.deepEqual(state.resyncCalls, [QUIZ_ID], 'season_scores-resyncen MÅ ha kjørt — det er steget som mistes ved brudd')
})

test('totalene stemmer for deltakere i alle tre bitene, også forbi radtaket', async () => {
  const res = await call()
  assert.equal(res.status, 200)

  // Etter rettingen er q-000..q-005 riktige for alle: 6 riktige, streak 6.
  const forventet = { correct_answers: 6, correct_streak: 6 }

  // a-001: bit 1, innenfor de 1000 første radene.
  assert.deepEqual(state.attemptTotals.get('a-001'), forventet, 'bit 1 (tidlig) fikk feil totaler')
  // a-150: bit 1, men FORBI radtaket — bare synlig hvis biten pagineres.
  assert.deepEqual(state.attemptTotals.get('a-150'), forventet, 'bit 1 ble ikke paginert forbi 1000-radstaket')
  // a-250 og a-400: bit 2 og bit 3 — bare synlige hvis listen chunkes.
  assert.deepEqual(state.attemptTotals.get('a-250'), forventet, 'bit 2 ble aldri lest')
  assert.deepEqual(state.attemptTotals.get('a-400'), forventet, 'bit 3 ble aldri lest')

  assert.ok(
    state.bulkReadQueries >= 5,
    `forventet minst 5 spørringer (3 sider i bit 1 + bit 2 + bit 3), fikk ${state.bulkReadQueries}`,
  )
})

test('kontroll: datasettet SKILLER de to variantene — ett rått kall hadde gitt feil svar', () => {
  seed()

  // 1) Listen er over URL-taket, så det rå kallet hadde feilet før noe ble lest.
  assert.ok(ATTEMPT_COUNT > URL_CAP, 'færre deltakere enn URL-taket ville ikke bevist noe')

  // 2) Og selv under URL-taket ville radkuttet alene skjult deltakere: de 1000
  //    første radene i bit 1 dekker bare de 100 første forsøkene.
  const bit1 = state.answers.filter(r => ATTEMPT_IDS.slice(0, 200).includes(r.attempt_id))
  const kuttet = new Set(bit1.slice(0, PG_ROW_CAP).map(r => r.attempt_id))
  assert.ok(bit1.length > PG_ROW_CAP, 'bit 1 må ha flere rader enn radtaket')
  assert.ok(!kuttet.has('a-150'), 'a-150 må være usynlig for en upaginert bit — ellers beviser testen ingenting')

  // 3) Halvparten av deltakerne endrer faktisk score, så en manglende skriving
  //    er observerbar (ikke bare «samme tall som før»).
  const c = state.answers.filter(r => r.question_id === CORRECTED_QUESTION && r.selected_answer === 'C')
  assert.ok(c.length > 0 && c.every(r => !r.is_correct), 'C-svarene må starte som feil')
})
