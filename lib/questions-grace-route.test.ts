// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av nådevinduet i questions-ruten (B-10, 24. august 2026):
// et forsøk startet FØR closes_at får hente gjenstående spørsmål i inntil
// QUESTIONS_GRACE_MS etterpå. Alle de eksisterende gatene skal stå urørt —
// spesielt submitted_at-sperren, som er det som hindrer at et brukt token
// henter fasiten i ro og mak etter levering.
//
// MUTASJONSBEVIS:
//   - fjernes hele grace-grenen (tilbake til flat now > closesAt → 403) →
//     «innenfor vinduet»-testen ryker.
//   - fjernes attemptStartedBeforeClose-betingelsen → «startet etter
//     stengetid»-testen ryker.
//   - byttes QUESTIONS_GRACE_MS mot SUBMIT_GRACE_MS → «utenfor vinduet»-testen
//     på 6 minutter ryker (6 er mellom de to fristene med vilje).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { QUIZ_CLOSED_ERROR } from '@/lib/late-play-window'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

const state: {
  quizClosesAt: string | null
  attemptStartedAt: string
  attemptSubmittedAt: string | null
} = {
  quizClosesAt: null,
  attemptStartedAt: minutesAgo(10),
  attemptSubmittedAt: null,
}

const QUESTION_ROW = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  question_text: 'Hva er hovedstaden i Norge?',
  option_a: 'Oslo', option_b: 'Bergen', option_c: 'Trondheim', option_d: 'Stavanger',
  correct_answer: 'A', correct_answers: null,
  explanation: null, time_limit_seconds: 15, shuffle_options: false,
  category: 'Geografi', order_index: 0,
}

function builder(table: string) {
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    is() { return b },
    order() { return b },
    range() { return b },
    update() { return b },
    async maybeSingle() {
      if (table === 'quizzes') {
        return {
          data: {
            id: QUIZ, is_active: true, opens_at: minutesAgo(240), closes_at: state.quizClosesAt,
            randomize_questions: false, quiz_type: 'weekly',
          },
          error: null,
        }
      }
      if (table === 'attempts') {
        return {
          data: {
            id: ATTEMPT, quiz_id: QUIZ, question_order: null,
            submitted_at: state.attemptSubmittedAt, completed_at: state.attemptStartedAt,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'questions') {
        return resolve({ data: [QUESTION_ROW], count: 15, error: null })
      }
      return resolve({ data: [], count: 0, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { GET: questions } = await import('@/app/api/quiz/[id]/questions/route')
const { createAttemptToken } = await import('@/lib/attempt-token')

const fetchQuestion = (opts?: { token?: string | null }) => {
  const token = opts && 'token' in opts ? opts.token : createAttemptToken(ATTEMPT, QUIZ)
  return questions(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/questions?index=8&attemptId=${ATTEMPT}`, {
      headers: token ? { 'x-attempt-token': token } : {},
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  )
}

beforeEach(() => {
  state.quizClosesAt = null
  state.attemptStartedAt = minutesAgo(10)
  state.attemptSubmittedAt = null
})

test('positiv kontroll: åpen quiz serverer spørsmålet', async () => {
  state.quizClosesAt = minutesFromNow(30)
  const res = await fetchQuestion()
  assert.equal(res.status, 200, await res.clone().text())
  const body = await res.json()
  assert.equal(body.question.id, QUESTION_ROW.id)
  assert.equal(body.total, 15)
})

test('stengte for 3 min siden, forsøk startet før stengetid → serveres (vinduet)', async () => {
  state.quizClosesAt = minutesAgo(3)
  state.attemptStartedAt = minutesAgo(10)
  const res = await fetchQuestion()
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal((await res.json()).question.id, QUESTION_ROW.id)
})

test('stengte for 6 min siden → 403, vinduet er 5 minutter', async () => {
  // 6 er MELLOM questions-vinduet (5) og submit-vinduet (7) med vilje: her skal
  // spørsmål nektes mens en levering fortsatt aksepteres — det er sonen
  // klientens delvis-leverings-sikkerhetsnett lever i.
  state.quizClosesAt = minutesAgo(6)
  state.attemptStartedAt = minutesAgo(60)
  const res = await fetchQuestion()
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.equal(body.error, QUIZ_CLOSED_ERROR)
  assert.equal(body.question, undefined, 'aldri spørsmålsdata i en avvisning')
})

test('forsøk startet ETTER stengetid får ingenting, selv i vinduet', async () => {
  state.quizClosesAt = minutesAgo(3)
  state.attemptStartedAt = minutesAgo(1)
  const res = await fetchQuestion()
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, QUIZ_CLOSED_ERROR)
})

test('levert forsøk avvises også i vinduet — fasit-sperren etter innsending står', async () => {
  state.quizClosesAt = minutesAgo(3)
  state.attemptSubmittedAt = minutesAgo(2)
  const res = await fetchQuestion()
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, 'Forsøket er allerede levert')
})

test('uten token avvises som før, også i vinduet', async () => {
  state.quizClosesAt = minutesAgo(3)
  const res = await fetchQuestion({ token: null })
  assert.equal(res.status, 401)
})
