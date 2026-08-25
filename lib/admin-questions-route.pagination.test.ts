// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte spørsmålsbank-ruten
// (app/api/admin/questions/route.ts) mot en fake som oppfører seg som
// PostgREST på BEGGE de målte takene:
//   • aldri mer enn 1000 rader per svar (radtaket)
//   • .in()-lister over 390 nøkler feiler med «Bad Request» (URL-taket,
//     målt 26. juli 2026)
//
// HVORFOR DENNE RUTEN HAR EGEN TEST: banken har 195 rader i dag, men skal ta
// imot flere tusen. Bruddet er STILLE i begge ender — radtaket kutter uten
// feilmelding, og den ignorerte .in()-feilen ga tomme quiz-titler. Admin ville
// sett en liste som så komplett ut.
//
// MUTASJONSBEVIS: fjernes pagineringen på questions faller listen til 1000 av
// 2400 og «bank-2399» forsvinner. Fjernes chunkingen på quiz-titlene svarer
// faken «Bad Request», ruten logger og fortsetter, og ALLE quiz_title blir null.
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_CAP = 390

// 2400 spørsmål fordelt på 400 quizer: over radtaket (2,4 sider) OG over
// URL-taket på antall distinkte quiz-id-er (400 > 390). Ett datasett som
// skiller begge fiksene fra hverandre.
const QUIZ_COUNT = 400
const QUESTIONS_PER_QUIZ = 6
const QUESTION_COUNT = QUIZ_COUNT * QUESTIONS_PER_QUIZ

process.env.ADMIN_PASSWORD = 'test-admin-passord'

type QRow = {
  id: string
  question_text: string
  quiz_id: string
  created_at: string
  is_classic: boolean
}

const state: {
  questions: QRow[]
  inChunkSizes: number[]
  questionPages: number
  titleLookupFailed: boolean
} = { questions: [], inChunkSizes: [], questionPages: 0, titleLookupFailed: false }

function seed() {
  state.questions = []
  state.inChunkSizes = []
  state.questionPages = 0
  state.titleLookupFailed = false

  for (let i = 0; i < QUESTION_COUNT; i++) {
    const quizIdx = i % QUIZ_COUNT
    state.questions.push({
      id: `bank-${String(i).padStart(4, '0')}`,
      question_text: `Spørsmål nr. ${i}`,
      quiz_id: `quiz-${String(quizIdx).padStart(3, '0')}`,
      // Bulk-import: ALLE rader deler tidsstempel. Uten tiebreakeren på id er
      // sidedelingen da udefinert — dette er tilfellet .order('id') finnes for.
      created_at: '2026-08-25T10:00:00.000Z',
      is_classic: false,
    })
  }
  // Ruten sorterer created_at DESC, id ASC. Med likt tidsstempel er id-en den
  // eneste ordnende kolonnen — faken speiler det.
  state.questions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function questionsBuilder() {
  let from = 0
  let to = PG_ROW_CAP - 1
  const orderCols: string[] = []

  const b = {
    select() { return b },
    eq() { return b },
    order(col: string) { orderCols.push(col); return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      const page = state.questionPages++

      // Uten .order() er sidedelingen udefinert i prod. Faken avviser det, slik
      // at en range() uten order aldri kan bli grønn her.
      if (orderCols.length === 0) {
        return Promise.resolve({ data: null, error: { message: 'range() uten order()' } }).then(res, rej)
      }

      // ── Modellering av USTABIL sidedeling ────────────────────────────────
      // Alle rader deler created_at i dette datasettet. Sorteres det da KUN på
      // created_at, har Postgres ingen ordnende kolonne igjen, og radene kan
      // komme i ulik rekkefølge for hver side — samme rad kan dukke opp to
      // ganger og en annen aldri. En fake som alltid returnerer den samme
      // sorterte lista kan ikke felle en manglende tiebreaker; derfor roterer
      // denne rekkefølgen per side når id ikke er med i sorteringen.
      const stabil = orderCols.includes('id')
      const kilde = stabil
        ? state.questions
        : (() => {
            const skift = (page * 7) % state.questions.length
            return [...state.questions.slice(skift), ...state.questions.slice(0, skift)]
          })()

      const window = kilde.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

function quizzesBuilder() {
  let inKeys: string[] | null = null
  let from = 0
  let to = PG_ROW_CAP - 1

  const b = {
    select() { return b },
    in(_col: string, keys: string[]) { inKeys = keys; return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      const keys = inKeys ?? []
      state.inChunkSizes.push(keys.length)
      // Målt prod-oppførsel: for lang .in()-liste = feil, ikke stille kutt.
      if (keys.length > URL_CAP) {
        state.titleLookupFailed = true
        return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
      }
      const rows = keys.map(id => ({ id, title: `Tittel ${id}` }))
      const window = rows.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

// Svarstatistikken har allerede paginering og egen dekning — her holder det at
// den er tom, slik at testen måler spørsmåls- og tittelhentingen.
function answersBuilder() {
  const b = {
    select() { return b },
    order() { return b },
    range() { return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'questions') return questionsBuilder()
        if (table === 'quizzes') return quizzesBuilder()
        if (table === 'attempt_answers') return answersBuilder()
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { GET } = await import('@/app/api/admin/questions/route')

function call() {
  const request = new Request('https://quizkanonen.no/api/admin/questions', {
    headers: { 'x-admin-password': process.env.ADMIN_PASSWORD as string },
  })
  return GET(request as never)
}

beforeEach(seed)

test('2400 spørsmål: HELE banken kommer ut, ikke de 1000 første', async () => {
  const res = await call()
  assert.equal(res.status, 200)
  const body = (await res.json()) as { questions: { id: string; quiz_title: string | null }[] }

  assert.equal(
    body.questions.length,
    QUESTION_COUNT,
    'et rått .select() uten range() hadde stoppet på 1000 — stille, uten feilmelding',
  )

  const ids = new Set(body.questions.map(q => q.id))
  assert.equal(ids.size, QUESTION_COUNT, 'sidedelingen gjentok rader — tiebreakeren mangler')
  assert.ok(ids.has('bank-2399'), 'siste rad i banken mangler — pagineringen stoppet for tidlig')
  assert.ok(state.questionPages >= 3, `forventet minst 3 sider, fikk ${state.questionPages}`)
})

test('400 distinkte quizer: ingen .in()-liste over URL-taket, alle titler løses', async () => {
  const res = await call()
  assert.equal(res.status, 200)
  const body = (await res.json()) as { questions: { quiz_id: string; quiz_title: string | null }[] }

  assert.equal(state.titleLookupFailed, false, 'en .in()-liste sprengte URL-taket')
  assert.ok(
    state.inChunkSizes.every(n => n <= URL_CAP),
    `en .in()-liste oversteg URL-taket: ${JSON.stringify(state.inChunkSizes)}`,
  )

  const utenTittel = body.questions.filter(q => q.quiz_title === null)
  assert.equal(
    utenTittel.length,
    0,
    `${utenTittel.length} spørsmål mangler quiz-tittel — .in()-feilen ble ignorert og hele oppslaget falt bort`,
  )
  // Bevis at titlene faktisk kommer fra den chunkede lesingen, ikke fra en
  // tilfeldig default: siste quiz ligger i den SISTE biten.
  const sisteQuiz = body.questions.find(q => q.quiz_id === 'quiz-399')
  assert.equal(sisteQuiz?.quiz_title, 'Tittel quiz-399', 'siste bit ble aldri lest')
})

test('kontroll: datasettet SKILLER de to fiksene — én av dem alene er ikke nok', () => {
  seed()

  assert.ok(QUESTION_COUNT > PG_ROW_CAP, 'færre rader enn radtaket ville ikke bevist pagineringen')
  const distinkteQuizer = new Set(state.questions.map(q => q.quiz_id)).size
  assert.ok(distinkteQuizer > URL_CAP, 'færre quizer enn URL-taket ville ikke bevist chunkingen')

  // Uten paginering er bank-2399 usynlig — ellers beviser første test ingenting.
  const kuttet = new Set(state.questions.slice(0, PG_ROW_CAP).map(q => q.id))
  assert.ok(!kuttet.has('bank-2399'), 'siste rad må ligge forbi radtaket')

  // Alle rader deler created_at, så id-tiebreakeren er det eneste som gjør
  // sidedelingen deterministisk.
  assert.equal(
    new Set(state.questions.map(q => q.created_at)).size,
    1,
    'testen skal kjøre med identisk created_at — det er bulk-import-tilfellet',
  )
})
