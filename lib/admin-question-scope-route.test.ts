// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av GET og PATCH på /api/admin/quizzes/[id]/questions/[qid].
//
// BAKGRUNN (K-5, 9. september 2026): begge slo opp spørsmålet på `id` ALENE.
// Quiz-id-en i stien ble aldri brukt til å avgrense, så ruten kunne lese og
// skrive en hvilken som helst rad i `questions` via en hvilken som helst
// quiz-id — inkludert bibliotekradene (quiz_id IS NULL), som er kilde for
// arkiv- og kanonkule-kopiering. fbc5597 la `.eq('quiz_id', quizId)` på tre
// linjer. Ingen test ble rød av å fjerne dem igjen; denne fila er den vakten.
//
// HVORFOR MOCKEN FILTRERER PÅ EKTE: en mock som bare returnerer en fast rad
// ville vært like grønn med og uten avgrensningen — den ville testet at ruten
// oversetter et svar, ikke at den ber om riktig rad. `matching()` under kjører
// derfor .eq-filtrene mot et radlager, akkurat som PostgREST ville gjort.
// Faller en `.eq('quiz_id', …)` bort i ruten, finner mocken den fremmede raden
// og testene blir røde.
//
// HVORFOR BÅDE STATUS OG SKRIVING ASSERTERES: en test som bare sjekker 404
// ville fortsatt vært grønn hvis skrivingen SKJEDDE og noe feilet etterpå.
// Derfor teller `state.mutated` rader som faktisk ble endret, og fixturen
// leses tilbake for å bekrefte at teksten står urørt.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • `.eq('quiz_id', quizId)` fjernes fra SKRIVELINJEN → «fremmed quiz» og
//     «bankrad» ryker: raden blir mutert og svaret blir 200.
//   • `.eq('quiz_id', quizId)` fjernes fra FASIT-OPPSLAGET → «fremmed quiz med
//     fasit» ryker: ruten går videre, teller besvarelser og sender en UPDATE i
//     stedet for å stoppe på 404.
//   • `.eq('quiz_id', quizId)` fjernes fra GET → «GET på fremmed quiz» ryker:
//     fasiten kommer ut med 200.
//   • `.select('id')` + tomt-treff-sjekken fjernes fra skrivelinjen → «fremmed
//     quiz» ryker på status: en UPDATE som traff ingenting blir ok:true igjen.
//   • Auth-sjekken fjernes → 401-testene ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const QUIZ       = 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e'
const OTHER_QUIZ = 'c4e2d3e5-6f7b-4c8d-9e0f-1a2b3c4d5e6f'

const QID_OWN   = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const QID_OTHER = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
const QID_BANK  = 'cccccccc-dddd-eeee-ffff-000000000000'

const OPPRINNELIG_TEKST = 'Uendret spørsmålstekst'
const NY_TEKST = 'Redigert av en forespørsel som ikke skal nå fram'

type Row = Record<string, unknown>
type QueryResult = { data: unknown; count?: number | null; error: { message: string } | null }

const state: {
  adminOk: boolean
  questions: Row[]
  quizzes: Row[]
  /** Hva attempt_answers-tellingen skal svare. */
  answerCount: number
  /** Id-ene til rader som FAKTISK ble endret. Tom = ingen skriving skjedde. */
  mutated: string[]
  /** Antall UPDATE-setninger ruten sendte, uansett om de traff noe. */
  updatesIssued: number
  /** Antall ganger ruten telte besvarelser. */
  answerCountQueries: number
} = {
  adminOk: true,
  questions: [],
  quizzes: [],
  answerCount: 0,
  mutated: [],
  updatesIssued: 0,
  answerCountQueries: 0,
}

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => state.adminOk },
})

function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {}
  let patch: Row | null = null

  const rowsOf = (): Row[] =>
    table === 'questions' ? state.questions : table === 'quizzes' ? state.quizzes : []

  // Ekte filtrering: dette er hele grunnen til at fila vokter noe.
  const matching = (): Row[] =>
    rowsOf().filter(r => Object.entries(filters).every(([k, v]) => r[k] === v))

  const run = (): QueryResult => {
    if (table === 'attempt_answers') {
      state.answerCountQueries += 1
      return { data: null, count: state.answerCount, error: null }
    }
    const treff = matching()
    if (patch !== null) {
      state.updatesIssued += 1
      for (const r of treff) {
        Object.assign(r, patch)
        state.mutated.push(String(r.id))
      }
      return { data: treff.map(r => ({ id: r.id })), error: null }
    }
    return { data: treff, count: treff.length, error: null }
  }

  const builder = {
    // Kolonnelista og count-opsjonene er uinteressante her: det er .eq-filtrene
    // som avgjør hvilken rad ruten får, og det er dem testene handler om.
    select() { return builder },
    update(p: Row) { patch = p; return builder },
    eq(col: string, val: unknown) { filters[col] = val; return builder },
    async maybeSingle(): Promise<QueryResult> {
      const treff = matching()
      return { data: treff[0] ?? null, error: null }
    },
    then<TR1 = QueryResult, TR2 = never>(
      onfulfilled?: ((value: QueryResult) => TR1 | PromiseLike<TR1>) | null,
      onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null,
    ): PromiseLike<TR1 | TR2> {
      return Promise.resolve().then(run).then(onfulfilled, onrejected)
    },
  }
  return builder
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: { from: (table: string) => makeBuilder(table) },
  },
})

const { GET, PATCH } = await import('@/app/api/admin/quizzes/[id]/questions/[qid]/route')

const url = (quizId: string, qid: string) =>
  `https://quizkanonen.no/api/admin/quizzes/${quizId}/questions/${qid}`

const patchQuestion = (qid: string, body: Row, quizId = QUIZ) =>
  PATCH(
    new Request(url(quizId, qid), {
      method: 'PATCH',
      headers: { 'x-admin-token': 'test', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: quizId, qid }) },
  )

const getQuestion = (qid: string, quizId = QUIZ) =>
  GET(
    new Request(url(quizId, qid), { headers: { 'x-admin-token': 'test' } }) as never,
    { params: Promise.resolve({ id: quizId, qid }) },
  )

const tekstFor = (qid: string) =>
  state.questions.find(q => q.id === qid)?.question_text

beforeEach(() => {
  state.adminOk = true
  state.answerCount = 0
  state.mutated = []
  state.updatesIssued = 0
  state.answerCountQueries = 0
  state.quizzes = [
    { id: QUIZ, num_options: 4 },
    { id: OTHER_QUIZ, num_options: 4 },
  ]
  state.questions = [
    { id: QID_OWN,   quiz_id: QUIZ,       question_text: OPPRINNELIG_TEKST, correct_answer: 'A', correct_answers: null },
    { id: QID_OTHER, quiz_id: OTHER_QUIZ, question_text: OPPRINNELIG_TEKST, correct_answer: 'A', correct_answers: null },
    { id: QID_BANK,  quiz_id: null,       question_text: OPPRINNELIG_TEKST, correct_answer: 'A', correct_answers: null },
  ]
})

// ── 1. Normalveien: spørsmålet hører til quizen i stien ─────────────────────

test('PATCH på et spørsmål i quizen skriver, og svarer ok', async () => {
  const res = await patchQuestion(QID_OWN, { question_text: NY_TEKST })
  const body = await res.json() as { ok?: boolean; updated?: string[] }

  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.updated, ['question_text'])
  // Skrivingen traff faktisk raden — ellers ville testene under vært grønne
  // fordi ingenting noensinne skrives, ikke fordi avgrensningen virker.
  assert.deepEqual(state.mutated, [QID_OWN])
  assert.equal(tekstFor(QID_OWN), NY_TEKST)
})

// ── 2. Fremmed quiz — hovedpoenget ──────────────────────────────────────────

test('PATCH på et spørsmål i EN ANNEN quiz: 404, og ingen rad er skrevet', async () => {
  const res = await patchQuestion(QID_OTHER, { question_text: NY_TEKST })
  const body = await res.json() as { error?: string; ok?: boolean }

  assert.equal(res.status, 404)
  assert.match(body.error ?? '', /finnes ikke i denne quizen/)
  assert.equal(body.ok, undefined)

  // Begge halvdelene: ingen rad endret, og fixturen står urørt. Uten den siste
  // ville testen vært grønn selv om skrivingen skjedde og feilet etterpå.
  assert.deepEqual(state.mutated, [])
  assert.equal(tekstFor(QID_OTHER), OPPRINNELIG_TEKST)
})

test('PATCH på en bankrad (quiz_id IS NULL): 404, og ingen rad er skrevet', async () => {
  const res = await patchQuestion(QID_BANK, { question_text: NY_TEKST })
  const body = await res.json() as { error?: string; ok?: boolean }

  assert.equal(res.status, 404)
  assert.match(body.error ?? '', /finnes ikke i denne quizen/)
  assert.equal(body.ok, undefined)

  assert.deepEqual(state.mutated, [])
  assert.equal(tekstFor(QID_BANK), OPPRINNELIG_TEKST)
})

// ── 3. Fasit-oppslaget har sin EGEN avgrensning, og sin egen tripwire ───────

test('PATCH med fasit på et spørsmål i en annen quiz stoppes FØR noen UPDATE', async () => {
  // Uten .eq('quiz_id', …) på fasit-oppslaget finner ruten den fremmede raden,
  // teller besvarelser og sender en UPDATE. Statusen ville fortsatt blitt 404
  // (skrivelinjen har sin egen avgrensning), så status alene skiller ikke —
  // det gjør derimot at ingen telling og ingen UPDATE skal ha skjedd.
  state.answerCount = 7

  const res = await patchQuestion(QID_OTHER, { correct_answer: 'B', correct_answers: null })
  const body = await res.json() as { error?: string }

  assert.equal(res.status, 404)
  assert.match(body.error ?? '', /finnes ikke i denne quizen/)

  assert.equal(state.answerCountQueries, 0, 'skal ikke telle besvarelser på en fremmed rad')
  assert.equal(state.updatesIssued, 0, 'skal ikke sende UPDATE i det hele tatt')
  assert.deepEqual(state.mutated, [])
})

// ── 4. GET ──────────────────────────────────────────────────────────────────

test('GET på et spørsmål i quizen gir fasiten', async () => {
  state.answerCount = 3

  const res = await getQuestion(QID_OWN)
  const body = await res.json() as { answeredCount?: number; correctAnswers?: string[] }

  assert.equal(res.status, 200)
  assert.equal(body.answeredCount, 3)
  assert.deepEqual(body.correctAnswers, ['A'])
})

test('GET på et spørsmål i EN ANNEN quiz: 404, og fasiten kommer ikke ut', async () => {
  const res = await getQuestion(QID_OTHER)
  const body = await res.json() as { error?: string; correctAnswers?: string[] }

  assert.equal(res.status, 404)
  assert.match(body.error ?? '', /finnes ikke i denne quizen/)
  assert.equal(body.correctAnswers, undefined)
})

test('GET på en bankrad: 404, og fasiten kommer ikke ut', async () => {
  const res = await getQuestion(QID_BANK)
  const body = await res.json() as { error?: string; correctAnswers?: string[] }

  assert.equal(res.status, 404)
  assert.equal(body.correctAnswers, undefined)
})

// ── 5. Auth ─────────────────────────────────────────────────────────────────

test('uten admin-token: 401, og ingenting skrives', async () => {
  state.adminOk = false

  const res = await patchQuestion(QID_OWN, { question_text: NY_TEKST })

  assert.equal(res.status, 401)
  assert.deepEqual(state.mutated, [])
  assert.equal(tekstFor(QID_OWN), OPPRINNELIG_TEKST)
})

test('uten admin-token svarer GET 401 uten å røre fasiten', async () => {
  state.adminOk = false

  const res = await getQuestion(QID_OWN)

  assert.equal(res.status, 401)
})
