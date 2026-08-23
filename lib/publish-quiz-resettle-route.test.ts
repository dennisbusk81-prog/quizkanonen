// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Rekjøringsvinduet i cron/publish-quiz (Endring 2, 24. august 2026): en quiz
// som allerede er gjort opp skal etterjusteres KUN når (1) den stengte innenfor
// RESETTLE_SCAN_MS og (2) en sen innsending fra sesongpoeng-populasjonen (solo,
// innlogget, submitted_at > closes_at) faktisk finnes. Mocken implementerer
// filtrene ekte mot mini-tabeller, så testene måler grensene.
//
// MUTASJONSBEVIS:
//   - fjernes gte-grensen i utvalget → «utenfor skannevinduet»-testen feiler
//     (og det er DEN grensen som hindrer retroaktiv omskriving av historikk
//     nå som upserten er en merge).
//   - fjernes vaktspørringen → «ingen sen innsending»-testen feiler.
//   - fjernes is_team-/user_id-filtrene i vakten → lag-/gjestetestene feiler.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { RESETTLE_SCAN_MS } from './late-play-window'

process.env.CRON_SECRET = 'test-cron-secret'

type QuizRow = {
  id: string
  title: string
  is_active: boolean
  is_test: boolean
  scheduled_at: string | null
  opens_at: string | null
  closes_at: string | null
  season_points_awarded: boolean
}
type AttemptRow = {
  id: string
  quiz_id: string
  user_id: string | null
  is_team: boolean
  submitted_at: string | null
}

const db: { quizzes: QuizRow[]; attempts: AttemptRow[] } = { quizzes: [], attempts: [] }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

const processQuizMock = mock.fn(async (_quizId: string, _closesAt: string) => ({ rows: 1, error: null }))

// waitUntil-promisene samles slik at testene kan vente dem ferdig — i prod
// kjører de etter at responsen er sendt.
const pending: Promise<unknown>[] = []

type Row = QuizRow | AttemptRow
type Pred = (r: Row) => boolean

function builder(table: string) {
  assert.ok(table === 'quizzes' || table === 'attempts', `uventet tabell: ${table}`)
  const preds: Pred[] = []
  let updatePatch: Partial<QuizRow> | null = null
  let limitN: number | null = null
  let single = false

  const val = (r: Row, col: string) => (r as unknown as Record<string, unknown>)[col]

  const rows = (): Row[] => {
    const src: Row[] = table === 'quizzes' ? db.quizzes : db.attempts
    let out = src.filter(r => preds.every(p => p(r)))
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    update(patch: Partial<QuizRow>) { updatePatch = patch; return b },
    select() { return b },
    eq(col: string, v: unknown) { preds.push(r => val(r, col) === v); return b },
    lte(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) <= v); return b },
    lt(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) < v); return b },
    gt(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) > v); return b },
    gte(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) >= v); return b },
    not(col: string, op: string, v: unknown) {
      assert.equal(op, 'is')
      assert.equal(v, null)
      preds.push(r => val(r, col) !== null)
      return b
    },
    or(expr: string) {
      const parts = expr.split(',').map(p => {
        const [col, op, ...rest] = p.split('.')
        const v = rest.join('.')
        if (op === 'is' && v === 'null') return (r: Row) => val(r, col) === null
        if (op === 'gte') return (r: Row) => val(r, col) !== null && String(val(r, col)) >= v
        throw new Error(`ukjent or-form i mock: ${p}`)
      })
      preds.push(r => parts.some(p => p(r)))
      return b
    },
    order() { return b },
    limit(n: number) { limitN = n; return b },
    maybeSingle() { single = true; return b },
    then(resolve: (v: unknown) => void) {
      if (updatePatch) {
        const hit = rows()
        for (const r of hit) Object.assign(r, updatePatch)
        return resolve({ data: hit.map(r => ({ id: (r as QuizRow).id, title: (r as QuizRow).title })), error: null })
      }
      if (single) return resolve({ data: rows()[0] ?? null, error: null })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})
mock.module('next/cache', {
  namedExports: { revalidateTag: () => {} },
})
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})
mock.module('@/lib/award-season-points', {
  namedExports: { processQuiz: processQuizMock },
})

const { GET } = await import('@/app/api/cron/publish-quiz/route')

const call = async () => {
  const res = await GET(new Request('https://quizkanonen.no/api/cron/publish-quiz', {
    headers: { authorization: 'Bearer test-cron-secret' },
  }) as never)
  await Promise.all(pending.splice(0))
  return res
}

const processedQuizIds = () => processQuizMock.mock.calls.map(c => c.arguments[0] as unknown as string)

// En oppgjort fredagsquiz som stengte for `min` minutter siden.
const settledQuiz = (min: number): QuizRow => ({
  id: 'q1', title: 'Fredagsquiz', is_active: true, is_test: false,
  scheduled_at: null, opens_at: minutesAgo(min + 240), closes_at: minutesAgo(min),
  season_points_awarded: true,
})
// En innsending levert `minAfterClose` minutter ETTER quizens stengetid.
const lateAttempt = (quiz: QuizRow, minAfterClose: number, over: Partial<AttemptRow> = {}): AttemptRow => ({
  id: 'a1', quiz_id: quiz.id, user_id: 'u1', is_team: false,
  submitted_at: new Date(Date.parse(quiz.closes_at!) + minAfterClose * 60_000).toISOString(),
  ...over,
})

beforeEach(() => {
  db.quizzes = []
  db.attempts = []
  processQuizMock.mock.resetCalls()
})

test('sen solo-innsending innenfor skannevinduet utløser rekjøring', async () => {
  const quiz = settledQuiz(3)
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2)]
  await call()
  assert.deepEqual(processedQuizIds(), ['q1'])
})

test('ingen sen innsending → ingen rekjøring, selv i vinduet', async () => {
  const quiz = settledQuiz(3)
  db.quizzes = [quiz]
  // Innsending FØR stengetid — det normale.
  db.attempts = [lateAttempt(quiz, -30)]
  await call()
  assert.deepEqual(processedQuizIds(), [])
})

test('utenfor skannevinduet → ingen rekjøring uansett sen innsending (historikk-vernet)', async () => {
  const min = Math.ceil(RESETTLE_SCAN_MS / 60_000) + 5
  const quiz = settledQuiz(min)
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2)]
  await call()
  assert.deepEqual(processedQuizIds(), [],
    'processQuiz mot en gammel quiz omskriver historikk med dagens medlemskap — utvalget er beskyttelsen')
})

test('quiz stengt for to uker siden røres aldri, uansett sene innsendinger', async () => {
  // Samme grense som testen over, men med avstanden en faktisk historisk quiz
  // har — dette er scenarioet «deploy-feil/manuell trigger mot gammel quiz»
  // på UTVALGS-nivå. Skriveren har i tillegg sitt eget belte
  // (insert-only utenfor vinduet — se lib/award-season-points.pagination.test.ts).
  const quiz = settledQuiz(14 * 24 * 60)
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2)]
  await call()
  assert.deepEqual(processedQuizIds(), [])
})

test('sen LAG-innsending utløser ikke rekjøring (utenfor sesongpoeng-populasjonen)', async () => {
  const quiz = settledQuiz(3)
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2, { is_team: true })]
  await call()
  assert.deepEqual(processedQuizIds(), [])
})

test('sen innsending uten user_id utløser ikke rekjøring', async () => {
  const quiz = settledQuiz(3)
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2, { user_id: null })]
  await call()
  assert.deepEqual(processedQuizIds(), [])
})

test('testquiz rekjøres aldri', async () => {
  const quiz = { ...settledQuiz(3), is_test: true }
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2)]
  await call()
  assert.deepEqual(processedQuizIds(), [])
})

test('førstegangs-oppgjør av uoppgjort quiz kjører fortsatt — nøyaktig én gang', async () => {
  const quiz = { ...settledQuiz(3), season_points_awarded: false }
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2)]
  await call()
  // Mocken setter ikke flagget, så rekjørings-utvalget (awarded=true) ser den
  // ikke — kallet skal komme fra førstegangs-løkken alene.
  assert.deepEqual(processedQuizIds(), ['q1'])
})
