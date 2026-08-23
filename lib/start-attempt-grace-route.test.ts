// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av reload-stien i start-attempt (B-10, 24. august 2026):
// etter stengetid finnes ÉN lovlig vei videre — GJENBRUK av et uferdig forsøk
// startet før closes_at, innenfor SUBMIT_GRACE_MS. QK_4 pekte på hullet:
// «en spiller som startet 21:58 og laster siden på nytt 22:01 får 403 og kan
// ikke gjenoppta. Løftet holder bare for den som aldri mister siden.»
//
// MUTASJONSBEVIS:
//   - åpnes insert-veien etter stengetid (fjern afterClose-vakten) → «ingen
//     uferdig → 403»-testen ryker (nye forsøk ville oppstått etter closes_at).
//   - fjernes started-before-close-betingelsen på gjenbruket → «startet etter
//     stengetid»-testen ryker.
//   - byttes SUBMIT_GRACE_MS mot QUESTIONS_GRACE_MS → «6 min siden»-testen
//     ryker (reload-levering skal virke i hele submit-vinduet).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { QUIZ_CLOSED_ERROR, SUBMIT_GRACE_MS } from '@/lib/late-play-window'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

const state: {
  quizClosesAt: string | null
  alreadyPlayed: boolean
  unfinished: { id: string; completed_at: string } | null
  attemptInserts: number
} = {
  quizClosesAt: null,
  alreadyPlayed: false,
  unfinished: null,
  attemptInserts: 0,
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
  const calls = { not: false, is: false, insert: false }
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    not() { calls.not = true; return b },
    is() { calls.is = true; return b },
    order() { return b },
    limit() { return b },
    insert() { calls.insert = true; return b },
    async maybeSingle() {
      // Replay-sperren (.not('submitted_at','is',null)) og gjenbruks-oppslaget
      // (.is('submitted_at', null)) skilles på hvilken metode som ble kalt.
      if (calls.not) return { data: state.alreadyPlayed ? { id: 'ferdig' } : null, error: null }
      if (calls.is) return { data: state.unfinished, error: null }
      return { data: null, error: null }
    },
    async single() {
      if (calls.insert) state.attemptInserts++
      return { data: { id: ATTEMPT }, error: null }
    },
  }
  return b
}

function simpleBuilder(table: string) {
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    async maybeSingle() {
      if (table === 'profiles') return { data: { suspended_until: null }, error: null }
      if (table === 'quizzes') {
        return {
          data: { id: QUIZ, opens_at: minutesAgo(240), closes_at: state.quizClosesAt },
          error: null,
        }
      }
      return { data: null, error: null }
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'questions') return resolve({ count: 15, error: null })
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

const { POST: startAttempt } = await import('@/app/api/quiz/start-attempt/route')

let ipTeller = 0
const start = () =>
  startAttempt(new Request('https://quizkanonen.no/api/quiz/start-attempt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `203.0.113.${++ipTeller}`,
      authorization: 'Bearer anna',
    },
    body: JSON.stringify({ quizId: QUIZ, playerName: 'Anna' }),
  }) as never)

beforeEach(() => {
  state.quizClosesAt = null
  state.alreadyPlayed = false
  state.unfinished = null
  state.attemptInserts = 0
})

test('positiv kontroll: åpen quiz uten uferdig forsøk oppretter som før', async () => {
  state.quizClosesAt = minutesFromNow(30)
  const res = await start()
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal((await res.json()).attemptId, ATTEMPT)
  assert.equal(state.attemptInserts, 1)
})

test('positiv kontroll: åpen quiz gjenbruker uferdig forsøk som før', async () => {
  state.quizClosesAt = minutesFromNow(30)
  state.unfinished = { id: ATTEMPT, completed_at: minutesAgo(5) }
  const res = await start()
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.reused, true)
  assert.ok(body.attemptToken, 'tokenet må følge med gjenbruket')
  assert.equal(state.attemptInserts, 0)
})

test('stengt for 3 min siden: uferdig forsøk startet FØR stengetid gjenbrukes', async () => {
  state.quizClosesAt = minutesAgo(3)
  state.unfinished = { id: ATTEMPT, completed_at: minutesAgo(10) }
  const res = await start()
  assert.equal(res.status, 200, await res.clone().text())
  const body = await res.json()
  assert.equal(body.reused, true)
  assert.ok(body.attemptToken)
  assert.equal(state.attemptInserts, 0)
})

test('stengt for 6 min siden (mellom spørsmåls- og submit-frist): gjenbruk virker fortsatt', async () => {
  // Reload-LEVERING skal virke i hele submit-vinduet, selv om ingen nye
  // spørsmål serveres der.
  state.quizClosesAt = minutesAgo(6)
  state.unfinished = { id: ATTEMPT, completed_at: minutesAgo(20) }
  const res = await start()
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal((await res.json()).reused, true)
})

test('stengt: INGEN uferdig å gjenbruke → 403, og det opprettes ALDRI et nytt forsøk', async () => {
  state.quizClosesAt = minutesAgo(3)
  state.unfinished = null
  const res = await start()
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, QUIZ_CLOSED_ERROR)
  assert.equal(state.attemptInserts, 0, 'reload-stien skal aldri åpne en ny spillevei etter stengetid')
})

test('stengt: uferdig forsøk startet ETTER stengetid gjenbrukes ikke', async () => {
  state.quizClosesAt = minutesAgo(3)
  state.unfinished = { id: ATTEMPT, completed_at: minutesAgo(1) }
  const res = await start()
  assert.equal(res.status, 403)
  assert.equal(state.attemptInserts, 0)
})

test('forbi submit-fristen: 403 også med gjenbrukbart forsøk', async () => {
  state.quizClosesAt = minutesAgo(Math.ceil(SUBMIT_GRACE_MS / 60_000) + 1)
  state.unfinished = { id: ATTEMPT, completed_at: minutesAgo(60) }
  const res = await start()
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, QUIZ_CLOSED_ERROR)
})

test('allerede spilt vinner over vinduet: 409, ikke 403', async () => {
  state.quizClosesAt = minutesAgo(3)
  state.alreadyPlayed = true
  const res = await start()
  assert.equal(res.status, 409)
  assert.equal((await res.json()).alreadyPlayed, true)
})
