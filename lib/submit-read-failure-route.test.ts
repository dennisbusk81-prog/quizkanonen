// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av funn 1 fra feil-som-ikke-synes-kartleggingen
// (18. august 2026): submit-ruten kunne stemple 0 riktige som ENDELIG fasit.
//
// Feilen testene finnes for: fasit-hentingen destrukturerte aldri `error`.
// En transient DB-feil ga questionRows = null → tom qMap → hvert svar
// «ukjent spørsmål» → correct_answers = 0 skrevet MED submitted_at satt.
// Dobbel-scoring-vernet gjorde nullen permanent, attempt_answers-innsettingen
// ble hoppet over stille (scored tom), så heller ikke Sentry-varselet fyrte.
// Spilleren mistet uken uten ett eneste loggspor. Samme Promise.all-ben for
// quizzes ga fallback 30 s tidsgrense — som INGEN quiz i prod har (målt
// 18. august: 15 s × 12, 10 s × 1) — og skrev feil total_time_ms like
// permanent.
//
// Kravet testene håndhever: attempt-raden skal ALDRI stemples som submitted
// med feil score. En spiller som får «prøv igjen» (503) har mistet ingenting;
// en som får 0 permanent har mistet uken. Derfor asserter testene på
// SIDEEFFEKTEN (UPDATE aldri kalt), ikke bare på statuskoden.
//
// MUTASJONSBEVIS (kjørt 18. august 2026, hver mutasjon reversert etterpå)
//   • Fjern `if (quizErr || questionsErr)`-vakten → «fasit-oppslaget feiler …»
//     og «quiz-oppslaget feiler …» ryker: ruten svarer 200 med 0 riktige og
//     UPDATE er kalt.
//   • Fjern invariant-vakten (`answers.length > 0 && scored.length === 0`) →
//     «fasiten er TOM …» og «svar mot ukjente id-er …» ryker på samme måte —
//     og de ryker UAVHENGIG av lesefeil-vakten, som er hele poenget med den.
//   • Fjern `isTransientAuthStatus`-vakten i submit → «transient GoTrue-feil …»
//     ryker: 403 i stedet for 503, og anon-nøkkelen dukker opp i den delte
//     telleren.
//   • Sett attempt-oppslaget tilbake til `if (attErr || !attempt) → 404` →
//     «transient feil på attempt-oppslaget gir 503, ikke 404» ryker.
//   • Fjern vakten i start-attempt → «start-attempt: transient …» ryker:
//     forsøket opprettes som GJEST (user_id NULL, utenfor replay-sperre og
//     unik-indeks) i stedet for å avvises.
import { test, mock, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { ALREADY_SUBMITTED_ERROR } from '@/lib/submit-response'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const Q1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const Q2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const UKJENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const FOR_LENGE_SIDEN = () => new Date(Date.now() - 3 * 60_000).toISOString()
const OM_EN_TIME = () => new Date(Date.now() + 3_600_000).toISOString()
const FOR_EN_TIME_SIDEN = () => new Date(Date.now() - 3_600_000).toISOString()

type DbError = { message: string } | null

// ── Styrbar feiltilstand + sideeffekt-opptak ────────────────────────────────
const state: {
  quizError: DbError
  questionsError: DbError
  questionsRows: { id: string; correct_answer: string | null; correct_answers: string[] | null; time_limit_seconds: number | null }[]
  attemptError: DbError
  attemptUserId: string | null
  authFailStatus: number | null // GoTrue-feil med denne statusen (null = ok)
  attemptUpdates: number        // antall UPDATE mot attempts (stemplingen)
  attemptInserts: number        // antall INSERT mot attempts (start-attempt)
  answerInserts: number         // antall INSERT mot attempt_answers
  /** true = UPDATE ... .is('submitted_at', null) treffer 0 rader (race-grenen). */
  raceLost: boolean
  /** Hva gjenlesingen av vinnerraden i race-grenen skal svare. */
  winnerRead: 'found' | 'missing' | 'error'
  attemptLookups: number
} = {
  quizError: null, questionsError: null, questionsRows: [], attemptError: null,
  // Standardtilstanden er en INNLOGGET spiller som leverer sitt eget forsøk
  // (endret 24. august 2026). Fram til da sto den på `null` — altså en
  // gjeste-rad levert uten Authorization-header — og dermed testet hele denne
  // filen sine hovedstier gjennom en kodesti som ikke fantes i prod
  // (625 forsøk, 0 med user_id NULL). Da submit-rutens gjeste-gren ble lukket,
  // falt ni tester på én gang, og det var stillaset som falt, ikke ruten.
  attemptUserId: 'user-anna', authFailStatus: null,
  attemptUpdates: 0, attemptInserts: 0, answerInserts: 0,
  raceLost: false, winnerRead: 'found', attemptLookups: 0,
}

const fasit = () => [
  { id: Q1, correct_answer: 'A', correct_answers: null, time_limit_seconds: 15 },
  { id: Q2, correct_answer: 'B', correct_answers: null, time_limit_seconds: 15 },
]

// ── Sentry-opptaker: fast melding per sak er en del av kontrakten ───────────
const sentry: { messages: { message: string; extra: Record<string, unknown> }[] } = { messages: [] }
mock.module('@sentry/nextjs', {
  namedExports: {
    captureMessage: (message: string, opts?: { extra?: Record<string, unknown> }) => {
      sentry.messages.push({ message, extra: opts?.extra ?? {} })
    },
  },
})

// ── Delt teller-opptaker: beviser hvilken bøtte et kall havnet i ────────────
const shared: { keys: string[] } = { keys: [] }
mock.module('@/lib/rate-limit-shared', {
  namedExports: {
    rateLimitShared: async (key: string) => {
      shared.keys.push(key)
      return { success: true, remaining: 99 }
    },
    SHARED_RATE_LIMIT_TIMEOUT_MS: 1000,
  },
})

function attemptsBuilder() {
  const calls = { not: false, is: false, insert: false, update: false }
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    not() { calls.not = true; return b },
    is() { calls.is = true; return b },
    order() { return b },
    limit() { return b },
    insert() { calls.insert = true; return b },
    update() { calls.update = true; return b },
    async maybeSingle() {
      if (calls.not || calls.is) return { data: null, error: null }
      if (state.attemptError) return { data: null, error: state.attemptError }
      state.attemptLookups++
      // Oppslag 1 = forhåndssjekken øverst i ruten. Oppslag 2 = gjenlesingen av
      // vinnerraden i race-grenen, som er den eneste av de to som kan svare
      // «fant ikke» eller feile på en interessant måte.
      if (state.attemptLookups > 1) {
        if (state.winnerRead === 'error') return { data: null, error: { message: 'connection reset' } }
        if (state.winnerRead === 'missing') return { data: null, error: null }
        return {
          data: { correct_answers: 1, total_time_ms: 4000, correct_streak: 1 },
          error: null,
        }
      }
      return {
        data: {
          id: ATTEMPT, quiz_id: QUIZ, user_id: state.attemptUserId,
          correct_answers: 0, submitted_at: null, completed_at: FOR_LENGE_SIDEN(),
        },
        error: null,
      }
    },
    async single() {
      if (calls.insert) state.attemptInserts++
      return { data: { id: ATTEMPT }, error: null }
    },
    then(resolve: (v: unknown) => void) {
      if (calls.update) {
        state.attemptUpdates++
        // Null rader = en samtidig forespørsel rakk å levere først.
        return resolve({ data: state.raceLost ? [] : [{ id: ATTEMPT }], error: null })
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
    in() { return b },
    is() { return b },
    order() { return b },
    limit() { return b },
    insert() { if (table === 'attempt_answers') state.answerInserts++; return b },
    update() { return b },
    async maybeSingle() {
      if (table === 'profiles') return { data: { suspended_until: null }, error: null }
      if (table === 'quizzes') {
        if (state.quizError) return { data: null, error: state.quizError }
        return {
          data: { id: QUIZ, opens_at: FOR_EN_TIME_SIDEN(), closes_at: OM_EN_TIME(), time_limit_seconds: 15 },
          error: null,
        }
      }
      return { data: null, error: null }
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'questions') {
        if (state.questionsError) return resolve({ count: null, data: null, error: state.questionsError })
        return resolve({ count: state.questionsRows.length, data: state.questionsRows, error: null })
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
        getUser: async (token: string) => {
          if (state.authFailStatus !== null) {
            // Feilformen speiler @supabase/auth-js: transiente feil bærer
            // status 0/5xx (AuthRetryableFetchError), ugyldig JWT 401/403
            // (AuthApiError). Se lib/auth-transient.ts.
            return { data: { user: null }, error: { message: 'gotrue-feil', status: state.authFailStatus } }
          }
          return token && token !== 'ugyldig'
            ? { data: { user: { id: `user-${token}` } }, error: null }
            : { data: { user: null }, error: { message: 'invalid JWT', status: 403 } }
        },
      },
      from: (table: string) => (table === 'attempts' ? attemptsBuilder() : simpleBuilder(table)),
    },
  },
})

const { POST: submit } = await import('@/app/api/quiz/[id]/submit/route')
const { POST: startAttempt } = await import('@/app/api/quiz/start-attempt/route')
const { createAttemptToken } = await import('@/lib/attempt-token')

let ipTeller = 0
const nyIp = () => `203.0.113.${++ipTeller}`

function send(opts?: { token?: string; answers?: unknown[] }) {
  return submit(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': nyIp(),
        'x-attempt-token': createAttemptToken(ATTEMPT, QUIZ) ?? '',
        // Standard er Annas token — hun eier `state.attemptUserId`. Kall som
        // vil teste noe annet sender `{ token: 'ugyldig' }` eksplisitt.
        authorization: `Bearer ${opts?.token ?? 'anna'}`,
      },
      body: JSON.stringify({
        attemptId: ATTEMPT,
        answers: opts?.answers ?? [
          { questionId: Q1, selectedAnswer: 'A', timeMs: 5000 },
          { questionId: Q2, selectedAnswer: 'C', timeMs: 5000 },
        ],
      }),
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  )
}

function start(opts?: { token?: string }) {
  return startAttempt(new Request('https://quizkanonen.no/api/quiz/start-attempt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': nyIp(),
      ...(opts?.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({ quizId: QUIZ, playerName: 'Spiller' }),
  }) as never)
}

// Feil-stiene logger med console.error — det er meningen. Demp dem i testen
// så npm test-utskriften ikke ser ut som en feilende kjøring.
const ekteConsoleError = console.error
console.error = () => {}

beforeEach(() => {
  state.quizError = null
  state.questionsError = null
  state.questionsRows = fasit()
  state.attemptError = null
  state.attemptUserId = 'user-anna'
  state.authFailStatus = null
  state.attemptUpdates = 0
  state.attemptInserts = 0
  state.answerInserts = 0
  state.raceLost = false
  state.winnerRead = 'found'
  state.attemptLookups = 0
  sentry.messages = []
  shared.keys = []
})

// ── Positiv kontroll: normalstien er UENDRET ────────────────────────────────

test('positiv kontroll: en vellykket innsending scores og stemples som før', async () => {
  const res = await send()
  assert.equal(res.status, 200, await res.clone().text())
  const body = await res.json()
  assert.equal(body.correctAnswers, 1, 'A er riktig på Q1, C er feil på Q2')
  assert.equal(state.attemptUpdates, 1, 'raden skal stemples nøyaktig én gang')
  assert.equal(state.answerInserts, 1, 'svar-radene skal settes inn')
  assert.equal(sentry.messages.length, 0, 'ingen Sentry-støy på happy path')
})

// ── KJERNEN: lesefeil skal ALDRI bli en stemplet 0-er ───────────────────────

test('fasit-oppslaget feiler → 503, og raden stemples IKKE', async () => {
  state.questionsError = { message: 'connection reset' }
  const res = await send()
  assert.equal(res.status, 503)
  assert.equal(state.attemptUpdates, 0, 'UPDATE mot attempts skal aldri skje')
  assert.equal(state.answerInserts, 0)
  assert.equal(sentry.messages.length, 1)
  assert.equal(sentry.messages[0].message, 'submit: quiz-/fasit-oppslag feilet — avvist med 503, ingenting lagret')
  assert.equal(sentry.messages[0].extra.attemptId, ATTEMPT)
  assert.equal(sentry.messages[0].extra.quizId, QUIZ)
  assert.equal(sentry.messages[0].extra.questionsError, 'connection reset')
})

test('quiz-oppslaget feiler → 503, ingen 30 s-fallback skrives (ingen quiz har 30 s)', async () => {
  state.quizError = { message: 'timeout' }
  const res = await send()
  assert.equal(res.status, 503)
  assert.equal(state.attemptUpdates, 0)
  assert.equal(sentry.messages.length, 1)
  assert.equal(sentry.messages[0].message, 'submit: quiz-/fasit-oppslag feilet — avvist med 503, ingenting lagret')
  assert.equal(sentry.messages[0].extra.quizError, 'timeout')
})

// ── Invariant-vakten: feller symptomet uavhengig av årsaken over ────────────

test('fasiten er TOM uten lesefeil → invariant-vakten gir 503, ingen stempling', async () => {
  // En framtidig vei til tom qMap som IKKE er en lesefeil — f.eks. alle
  // spørsmål slettet midt i spilling. Lesefeil-vakten slipper dette forbi;
  // invarianten skal felle det.
  state.questionsRows = []
  const res = await send()
  assert.equal(res.status, 503)
  assert.equal(state.attemptUpdates, 0)
  assert.equal(sentry.messages.length, 1)
  assert.equal(sentry.messages[0].message, 'submit: ingen svar traff fasiten — avvist med 503, ingenting lagret')
  assert.equal(sentry.messages[0].extra.answers, 2)
  assert.equal(sentry.messages[0].extra.fasitRader, 0)
})

test('svar mot bare ukjente spørsmåls-id-er → 503, ikke en stemplet 0-er', async () => {
  // qMap er IKKE tom her — vakten skal sitte på scored.length, ikke på
  // fasitlisten. Kan ikke skje for en ærlig klient (id-ene kommer fra
  // questions-ruten for samme quiz), så dette er per konstruksjon systemfeil.
  const res = await send({ answers: [{ questionId: UKJENT, selectedAnswer: 'A', timeMs: 5000 }] })
  assert.equal(res.status, 503)
  assert.equal(state.attemptUpdates, 0)
  assert.equal(sentry.messages[0]?.message, 'submit: ingen svar traff fasiten — avvist med 503, ingenting lagret')
})

test('null svar fra klienten går som før — invarianten krever answers til stede', async () => {
  // answers: [] er dagens (rare, men etablerte) oppførsel: 0 riktige uten
  // svar-rader. Invarianten skal IKKE endre den — den gjelder kun når svar
  // faktisk ble sendt inn og ingenting kunne scores.
  const res = await send({ answers: [] })
  assert.equal(res.status, 200)
  assert.equal(state.attemptUpdates, 1)
  assert.equal(sentry.messages.length, 0)
})

// ── Attempt-oppslaget: transient feil er ikke «finnes ikke» ─────────────────

test('transient feil på attempt-oppslaget gir 503, ikke 404', async () => {
  state.attemptError = { message: 'connection reset' }
  const res = await send()
  assert.equal(res.status, 503)
  assert.equal(state.attemptUpdates, 0)
})

// ── Auth-vakten: GoTrue nede ≠ ugyldig token ────────────────────────────────

test('transient GoTrue-feil (0/429/5xx) gir 503 FØR anon-bøtta — ikke 403', async () => {
  for (const status of [0, 429, 500, 503]) {
    shared.keys = []
    sentry.messages = []
    state.authFailStatus = status
    const res = await send({ token: 'anna' })
    assert.equal(res.status, 503, `status ${status} skal gi 503`)
    assert.equal(shared.keys.length, 0, `status ${status}: den delte telleren skal aldri nås — spilleren skal ikke i anon-bøtta`)
    assert.equal(sentry.messages[0]?.message, 'submit: auth-oppslag feilet transient — avvist med 503, ingenting lagret')
    assert.equal(sentry.messages[0]?.extra.authStatus, status)
  }
})

test('et faktisk UGYLDIG token (403 fra GoTrue) behandles som i dag: anon-bøtte og 403', async () => {
  const res = await send({ token: 'ugyldig' })
  assert.equal(res.status, 403, 'etablert oppførsel: token til stede men ugyldig → 403, ikke gjeste-behandling')
  assert.equal(shared.keys.length, 1)
  assert.match(shared.keys[0], /^submit:anon:/, 'ugyldig token skal fortsatt i anon-bøtta')
  assert.equal(sentry.messages.length, 0, 'ugyldig token er ikke en systemfeil')
})

// ── Samme form i start-attempt (søskenet på linje 41) ───────────────────────

test('start-attempt: transient GoTrue-feil gir 503 — forsøket opprettes IKKE som gjest', async () => {
  state.authFailStatus = 0
  const res = await start({ token: 'anna' })
  assert.equal(res.status, 503)
  assert.equal(state.attemptInserts, 0, 'uten vakten ville raden fått user_id NULL — utenfor replay-sperren og unik-indeksen')
  assert.equal(shared.keys.length, 0)
  assert.equal(sentry.messages[0]?.message, 'start-attempt: auth-oppslag feilet transient — avvist med 503')
})

test('start-attempt: ugyldig token avvises med 401 — ingen gjeste-rad (24. august 2026)', async () => {
  // Her sto tidligere det motsatte kravet: «ugyldig token gir fortsatt
  // gjeste-behandling (dagens oppførsel)». Det var en ærlig beskrivelse av en
  // åpen dør, ikke et ønske. Skillet mot testen rett over består: en TRANSIENT
  // GoTrue-feil er fortsatt 503 («prøv igjen»), et UGYLDIG token er 401
  // («logg inn»). De to skal aldri kollapse til samme svar — 401 på en
  // transient feil ville logget ut en spiller fordi Supabase hikstet.
  const res = await start({ token: 'ugyldig' })
  assert.equal(res.status, 401, await res.clone().text())
  assert.equal(state.attemptInserts, 0, 'ingen rad med user_id NULL skal kunne oppstå')
  assert.deepEqual(shared.keys, [], 'vakten står foran lag 2 — ingen Upstash-rundtur')
  assert.equal(sentry.messages.length, 0, 'et ugyldig token er ikke en systemfeil')
})

test('submit: en TOKENLØS innsending avvises, også mot en rad uten eier', async () => {
  // Søskenet til vakten i start-attempt. Fram til 24. august 2026 sto det
  // `else if (attempt.user_id !== null)` i submit: en tokenløs innsending
  // slapp gjennom mot en gjeste-rad. Grenen er uoppnåelig i prod (0 slike
  // rader), men en uoppnåelig gren som SLIPPER GJENNOM er en dør uten rom bak
  // — ikke et lukket hull. Testen setter derfor eieren til null EKSPLISITT for
  // å nå grenen i det hele tatt.
  state.attemptUserId = null
  const res = await submit(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': nyIp(),
        'x-attempt-token': createAttemptToken(ATTEMPT, QUIZ) ?? '',
      },
      body: JSON.stringify({
        attemptId: ATTEMPT,
        answers: [{ questionId: Q1, selectedAnswer: 'A', timeMs: 5000 }],
      }),
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  )
  assert.equal(res.status, 403, await res.clone().text())
  assert.equal(state.attemptUpdates, 0, 'ingenting skal stemples uten autentisering')
  assert.equal(state.answerInserts, 0)
})

after(() => { console.error = ekteConsoleError })

// ── Race-grenen: en LESEFEIL er ikke «raden fantes ikke» (19. august 2026) ──
// Taper vi kappløpet, leses vinnerraden tilbake og returneres — spilleren skal
// se resultatet sitt, ikke en feil, for en race hen ikke kan gjøre noe med.
// Gjenlesingen destrukturerte aldri `error`, så en transient DB-feil ble til
// `!winner` og dermed 409 med ALREADY_SUBMITTED-teksten. Den 409-en betyr noe
// presist (se lib/submit-response.ts: raden fantes IKKE, altså noe faktisk
// galt) og tolkes bevisst IKKE mildt av klienten — så en forbigående lesefeil
// ble vist som om noe var galt med et resultat som lå trygt lagret.

test('race + LESEFEIL på vinnerraden gir 503, ikke 409 «allerede levert»', async () => {
  state.raceLost = true
  state.winnerRead = 'error'

  const res = await send()

  assert.equal(res.status, 503, 'forbigående — klienten kan prøve igjen')
  const body = await res.json()
  assert.notEqual(body.error, ALREADY_SUBMITTED_ERROR, 'skal ikke låne den delte kontraktens tekst')
  assert.equal(state.answerInserts, 0, 'race-grenen skal fortsatt ikke skrive svar-rader')
})

test('race + raden FANTES IKKE gir fortsatt 409 — den grenen er urørt', async () => {
  state.raceLost = true
  state.winnerRead = 'missing'

  const res = await send()

  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, ALREADY_SUBMITTED_ERROR)
})

test('race + vellykket gjenlesing gir fortsatt 200 med vinnerens tall', async () => {
  state.raceLost = true
  state.winnerRead = 'found'

  const res = await send()

  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.alreadySubmitted, true)
  assert.equal(body.correctAnswers, 1, 'vinnerens lagrede score, ikke vår egen')
})
