// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av submit-portens TRE utfall når identiteten skal avgjøres
// ([AU-2], 24. august 2026).
//
// SCENARIOET SOM UTLØSTE DEN
// En innlogget spiller mister sesjonen server-side midt i quizen: access-tokenet
// er signert og ikke utløpt, men `session_id`-claimet har ingen rad i `sessions`
// (`session_not_found` → `AuthSessionMissingError`, status 400). Hun merker
// ingenting — `questions` gater kun på attempt-token, med vilje — og spiller
// hele quizen ferdig. Ved MÅLSTREKEN svarte submit fram til nå 403 «Ingen
// tilgang til dette forsøket», som klienten viste som «Resultatet ble ikke
// lagret — sjekk internettforbindelsen din».
//
// To feil i én: feil årsak til spilleren, og ingen vei tilbake. `80dbab4` lukket
// den samme klassen ved STARTSTREKEN (401 { needsLogin: true } fra
// start-attempt). Dette er målstrek-halvdelen.
//
// Testene asserter på SIDEEFFEKTEN (stempling/svar-rader), ikke bare status —
// samme prinsipp som lib/submit-deadline-route.test.ts: en 401 som likevel
// stemplet raden ville vært verre enn den 403-en den erstattet.
//
// MUTASJONSBEVIS:
//   - slås 401 og 403 sammen igjen (`if (!tokenUserId || attempt.user_id !==
//     tokenUserId)`) → «død sesjon» ryker (403 i stedet for 401).
//   - svarer eierskapsfeilen 401 → «gyldig bruker, feil forsøk» ryker.
//   - fjernes `needsLogin: true` → «401 bærer needsLogin» ryker.
//   - flyttes 401-vakten FORAN transient-vakten → «GoTrue nede gir fortsatt
//     503» ryker (og en Supabase-blip ville da bedt spilleren logge inn).
import { test, mock, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { SESSION_EXPIRED_ERROR } from '@/lib/submit-response'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const Q1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

type AuthOutcome =
  | { kind: 'ok'; userId: string }
  | { kind: 'error'; status: number; message: string }

const state: {
  auth: AuthOutcome
  /** Hvem eier attempt-raden i basen. */
  attemptOwner: string | null
  attemptUpdates: number
  answerInserts: number
} = {
  auth: { kind: 'ok', userId: 'user-anna' },
  attemptOwner: 'user-anna',
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
          id: ATTEMPT, quiz_id: QUIZ, user_id: state.attemptOwner,
          correct_answers: 0, submitted_at: null, completed_at: minutesAgo(10),
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
      // closes_at null: denne filen tester identitet, ikke frister. B-10-vinduet
      // har sin egen fil.
      if (table === 'quizzes') return { data: { time_limit_seconds: 15, closes_at: null }, error: null }
      return { data: null, error: null }
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'questions') {
        return resolve({
          data: [{ id: Q1, correct_answer: 'A', correct_answers: null, time_limit_seconds: 15 }],
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
        getUser: async () => (
          state.auth.kind === 'ok'
            ? { data: { user: { id: state.auth.userId } }, error: null }
            // Formen GoTrue faktisk returnerer: ingen bruker OG en feil med status.
            : { data: { user: null }, error: { status: state.auth.status, message: state.auth.message } }
        ),
      },
      from: (table: string) => (table === 'attempts' ? attemptsBuilder() : simpleBuilder(table)),
    },
  },
})

const { POST: submit } = await import('@/app/api/quiz/[id]/submit/route')
const { createAttemptToken } = await import('@/lib/attempt-token')

let ipTeller = 0
const send = ({ withToken = true }: { withToken?: boolean } = {}) =>
  submit(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `198.51.100.${++ipTeller}`,
        'x-attempt-token': createAttemptToken(ATTEMPT, QUIZ) ?? '',
        ...(withToken ? { authorization: 'Bearer anna' } : {}),
      },
      body: JSON.stringify({
        attemptId: ATTEMPT,
        answers: [{ questionId: Q1, selectedAnswer: 'A', timeMs: 5000 }],
      }),
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  )

const stilleWarn = console.warn
const stilleError = console.error
console.warn = () => {}
console.error = () => {}
after(() => { console.warn = stilleWarn; console.error = stilleError })

beforeEach(() => {
  state.auth = { kind: 'ok', userId: 'user-anna' }
  state.attemptOwner = 'user-anna'
  state.attemptUpdates = 0
  state.answerInserts = 0
})

test('positiv kontroll: gyldig sesjon på eget forsøk leverer som før', async () => {
  const res = await send()
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal(state.attemptUpdates, 1)
  assert.equal(state.answerInserts, 1)
})

test('DØD SESJON → 401 needsLogin, og INGENTING skrives', async () => {
  // `session_not_found` kommer som AuthSessionMissingError, status 400. Den er
  // bevisst utenfor isTransientAuthStatus (0/429/5xx), så 503-vakten slipper
  // den forbi hit — det er nettopp derfor tilfellet fantes.
  state.auth = { kind: 'error', status: 400, message: 'Auth session missing!' }

  const res = await send()
  assert.equal(res.status, 401, await res.clone().text())
  const body = await res.json()
  assert.equal(body.needsLogin, true, 'klienten åpner innloggingsvinduet KUN når flagget er satt')
  assert.equal(body.error, SESSION_EXPIRED_ERROR)

  // Det avgjørende: raden står ustemplet, så innsendingen etter innlogging går
  // gjennom som et førstegangskall og ikke møter dobbel-scoring-vernet.
  assert.equal(state.attemptUpdates, 0, 'raden ble stemplet på et avvist kall')
  assert.equal(state.answerInserts, 0)
})

test('GYLDIG BRUKER, FEIL FORSØK → fortsatt 403, aldri en innloggingsoppfordring', async () => {
  // Den ekte tilgangsfeilen. Innlogging løser den ikke, og å tilby den ville
  // vært et falskt løfte — samme feilklasse som fiksen fjerner.
  state.attemptOwner = 'user-bjorn'

  const res = await send()
  assert.equal(res.status, 403, await res.clone().text())
  const body = await res.json()
  assert.equal(body.error, 'Ingen tilgang til dette forsøket')
  assert.notEqual(body.needsLogin, true, 'eierskapsfeil skal ikke bære needsLogin')
  assert.equal(state.attemptUpdates, 0)
  assert.equal(state.answerInserts, 0)
})

test('INGEN token → 403 «Mangler autentisering», ikke 401', async () => {
  // Klienten sender alltid token når den har en sesjon. Et tokenløst kall er
  // ikke en spiller hvis sesjon døde — det er et kall utenfra.
  const res = await send({ withToken: false })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, 'Mangler autentisering')
  assert.equal(state.attemptUpdates, 0)
})

test('GoTrue NEDE gir fortsatt 503 — en blip skal aldri be spilleren logge inn', async () => {
  // Vakten over 401-en. Uten den ville hvert Supabase-utfall sendt spillere til
  // innloggingsvinduet midt i en quiz, med et gyldig token i hånda.
  for (const status of [0, 429, 500, 503]) {
    state.attemptUpdates = 0
    state.auth = { kind: 'error', status, message: 'oppe og nede' }
    const res = await send()
    assert.equal(res.status, 503, `GoTrue-status ${status} ga ${res.status}, forventet 503`)
    assert.notEqual(res.status, 401, `transient feil (${status}) ble tolket som død sesjon`)
    assert.equal(state.attemptUpdates, 0)
  }
})
