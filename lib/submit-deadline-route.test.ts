// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av submit-portens innleveringsfrist (B-10, 24. august 2026).
// Fram til nå hadde submit INGEN closes_at-sjekk: den som satt på siste
// spørsmål kunne levere timer etter stengetid (attempt-tokenet lever i 6
// timer). Porten gjør vinduet eksplisitt: et forsøk startet FØR closes_at får
// levere i inntil SUBMIT_GRACE_MS etterpå — det er halve «fullfør og lever»-
// løftet, og hele grunnlaget for klientens delvis-leverings-sikkerhetsnett.
//
// Testene asserter på SIDEEFFEKTEN (stempling/svar-rader), ikke bare status —
// samme prinsipp som lib/submit-read-failure-route.test.ts.
//
// MUTASJONSBEVIS:
//   - fjernes hele 2b-gaten → «fristen er passert»- og «startet etter
//     stengetid»-testene ryker (200 med stempling i stedet for 403).
//   - byttes SUBMIT_GRACE_MS mot QUESTIONS_GRACE_MS → «innenfor vinduet»-testen
//     på 6 minutter ryker.
import { test, mock, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { SUBMIT_DEADLINE_ERROR, SUBMIT_GRACE_MS } from '@/lib/late-play-window'
import { ALREADY_SUBMITTED_ERROR } from '@/lib/submit-response'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const Q1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const Q2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

const state: {
  quizClosesAt: string | null
  attemptStartedAt: string
  attemptUpdates: number
  answerInserts: number
} = {
  quizClosesAt: null,
  attemptStartedAt: minutesAgo(10),
  attemptUpdates: 0,
  answerInserts: 0,
}

mock.module('@sentry/nextjs', {
  namedExports: { captureMessage: () => {} },
})
mock.module('@/lib/rate-limit-shared', {
  namedExports: {
    rateLimitShared: async () => ({ success: true, remaining: 99 }),
    SHARED_RATE_LIMIT_TIMEOUT_MS: 1000,
  },
})

function attemptsBuilder() {
  let updating = false
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    is() { return b },
    update() { updating = true; return b },
    async maybeSingle() {
      return {
        data: {
          id: ATTEMPT, quiz_id: QUIZ, user_id: 'user-anna',
          correct_answers: 0, submitted_at: null, completed_at: state.attemptStartedAt,
        },
        error: null,
      }
    },
    then(resolve: (v: unknown) => void) {
      if (updating) {
        state.attemptUpdates++
        return resolve({ data: [{ id: ATTEMPT }], error: null })
      }
      return resolve({ data: [], error: null })
    },
  }
  return b
}

function simpleBuilder(table: string) {
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    insert() { if (table === 'attempt_answers') state.answerInserts++; return b },
    update() { return b },
    async maybeSingle() {
      if (table === 'quizzes') {
        return { data: { time_limit_seconds: 15, closes_at: state.quizClosesAt }, error: null }
      }
      return { data: null, error: null }
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'questions') {
        return resolve({
          data: [
            { id: Q1, correct_answer: 'A', correct_answers: null, time_limit_seconds: 15 },
            { id: Q2, correct_answer: 'B', correct_answers: null, time_limit_seconds: 15 },
          ],
          error: null,
        })
      }
      return resolve({ data: [], error: null, count: 0 })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-anna' } }, error: null }),
      },
      from: (table: string) => (table === 'attempts' ? attemptsBuilder() : simpleBuilder(table)),
    },
  },
})

const { POST: submit } = await import('@/app/api/quiz/[id]/submit/route')
const { createAttemptToken } = await import('@/lib/attempt-token')

let ipTeller = 0
const send = (answers?: unknown[]) =>
  submit(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `203.0.113.${++ipTeller}`,
        'x-attempt-token': createAttemptToken(ATTEMPT, QUIZ) ?? '',
        authorization: 'Bearer anna',
      },
      body: JSON.stringify({
        attemptId: ATTEMPT,
        answers: answers ?? [
          { questionId: Q1, selectedAnswer: 'A', timeMs: 5000 },
          { questionId: Q2, selectedAnswer: 'C', timeMs: 5000 },
        ],
      }),
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  )

const stillLogg = console.warn
console.warn = () => {}
after(() => { console.warn = stillLogg })

beforeEach(() => {
  state.quizClosesAt = null
  state.attemptStartedAt = minutesAgo(10)
  state.attemptUpdates = 0
  state.answerInserts = 0
})

test('positiv kontroll: åpen quiz leverer som før', async () => {
  state.quizClosesAt = minutesFromNow(30)
  const res = await send()
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal(state.attemptUpdates, 1)
})

test('quiz uten stengetid har ingen frist', async () => {
  state.quizClosesAt = null
  const res = await send()
  assert.equal(res.status, 200)
})

test('stengte for 6 min siden, startet før stengetid → innenfor vinduet, leveres', async () => {
  // 6 min er MELLOM questions-vinduet (5) og submit-vinduet (7) — nøyaktig
  // sonen der sikkerhetsnettet (delvis levering) må kunne lande.
  state.quizClosesAt = minutesAgo(6)
  state.attemptStartedAt = minutesAgo(10)
  const res = await send()
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal(state.attemptUpdates, 1, 'leveringen skal stemples')
})

test('fristen er passert → 403 med egen tekst, INGENTING skrives', async () => {
  state.quizClosesAt = minutesAgo(Math.ceil(SUBMIT_GRACE_MS / 60_000) + 1)
  state.attemptStartedAt = minutesAgo(60)
  const res = await send()
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.equal(body.error, SUBMIT_DEADLINE_ERROR)
  assert.notEqual(body.error, ALREADY_SUBMITTED_ERROR, 'må aldri låne den milde kontraktsteksten')
  assert.equal(state.attemptUpdates, 0, 'ingen stempling etter fristen')
  assert.equal(state.answerInserts, 0)
})

test('forsøk startet ETTER stengetid avvises selv innenfor vinduet', async () => {
  // Skal ikke kunne finnes (start-attempt er stengt etter closes_at) — belte
  // og bukser mot en framtidig åpning.
  state.quizClosesAt = minutesAgo(6)
  state.attemptStartedAt = minutesAgo(3)
  const res = await send()
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, SUBMIT_DEADLINE_ERROR)
  assert.equal(state.attemptUpdates, 0)
})

test('delvis svarsett scores som det er — 1 av 2 gir 1 riktig', async () => {
  // Selve B-10-leveransen: submit teller aldri svar mot antall spørsmål.
  state.quizClosesAt = minutesAgo(6)
  const res = await send([{ questionId: Q1, selectedAnswer: 'A', timeMs: 5000 }])
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.correctAnswers, 1)
  assert.equal(state.attemptUpdates, 1)
})
