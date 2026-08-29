// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av is_active-vakten i spillestien (27. august 2026).
//
// Fram til nå leste HVERKEN start-attempt ELLER questions-ruten `is_active`.
// At en skjult eller halvbygd quiz likevel ikke kunne spilles, skyldtes at
// `opens_at` tilfeldigvis pekte framover — en bieffekt, ikke en vakt. Samme rad
// med `opens_at` i fortiden var fullt spillbar, og «Skjul» i admin fjernet
// quizen fra listene uten å stenge spilleveien.
//
// Begge rutene testes i SAMME fil med felles tilstand, fordi de deler vakten:
// porten (start-attempt) hindrer nye forsøk, og questions-ruten hindrer at et
// forsøk som ble startet FØR skjulingen fortsetter å hente FASITEN etterpå.
// Rettes bare den ene, står den andre igjen som et hull som ser lukket ut.
//
// MUTASJONSBEVIS (alle fem kjørt og drept 27. august 2026):
//   M1  vakten i start-attempt gjort død      → «skjult quiz avvises av porten»,
//       NULL-porttesten og kolonne-testen ryker (3 røde).
//   M2  vakten i questions-ruten gjort død    → «skjult quiz serverer ikke
//       spørsmål» og NULL-questions-testen ryker (2 røde).
//   M3  `!== true` svekket til `=== false`    → begge NULL-testene og
//       kolonne-testen ryker (3 røde).
//   M4  `is_active` ut av SELECT i start-attempt  → positiv kontroll ryker.
//   M5  `is_active` ut av SELECT i questions      → positiv kontroll ryker.
//
// M4/M5 OVERLEVDE FØRSTE FORSØK, og det er verdt å huske hvorfor: mocken
// returnerte hele quiz-raden uansett hvilke kolonner ruten ba om, så en rute
// som sluttet å HENTE `is_active` fikk den likevel utlevert og alt forble
// grønt. Ekte PostgREST ville gitt en rad uten kolonnen. Projeksjonen i
// `projiser()` under er det som lukker den utettheten — uten den er dette
// filen som ser ut til å dekke select-lista uten å gjøre det.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { QUIZ_CLOSED_ERROR } from '@/lib/late-play-window'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

// `undefined` = kolonnen mangler i raden. Egen verdi fordi den er det som
// oppstår hvis noen fjerner `is_active` fra select-listen igjen.
const state: {
  quizIsActive: boolean | null | undefined
  attemptInserts: number
} = {
  quizIsActive: true,
  attemptInserts: 0,
}

const QUESTION_ROW = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  question_text: 'Hva er hovedstaden i Norge?',
  option_a: 'Oslo', option_b: 'Bergen', option_c: 'Trondheim', option_d: 'Stavanger',
  correct_answer: 'A', correct_answers: null,
  explanation: null, time_limit_seconds: 15, shuffle_options: false,
  category: 'Geografi', order_index: 0,
}

/** Quiz-raden slik begge rutene henter den: åpent vindu rundt «nå», så det er
 *  utelukkende `is_active` som avgjør utfallet i denne filen. */
function quizRow() {
  const rad: Record<string, unknown> = {
    id: QUIZ,
    opens_at: minutesAgo(60),
    closes_at: minutesFromNow(60),
    randomize_questions: false,
    quiz_type: 'weekly',
    time_limit_seconds: 30,
  }
  // Utelates nøkkelen HELT når verdien er undefined — ellers ville testen for
  // «kolonnen mangler» vært utett (en eksplisitt `is_active: undefined` er noe
  // annet enn en rad uten kolonnen).
  if (state.quizIsActive !== undefined) rad.is_active = state.quizIsActive
  return rad
}

mock.module('@sentry/nextjs', {
  namedExports: { captureMessage: () => {}, captureException: () => {} },
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
    update() { return b },
    async maybeSingle() {
      // questions-ruten henter attempt-RADEN (ingen .not/.is), start-attempt
      // bruker de to filtrerte oppslagene. Skilles på hvilken metode som ble
      // kalt — samme mønster som lib/start-attempt-grace-route.test.ts.
      if (calls.not || calls.is) return { data: null, error: null }
      return {
        data: {
          id: ATTEMPT, quiz_id: QUIZ, question_order: null,
          submitted_at: null, completed_at: minutesAgo(10),
        },
        error: null,
      }
    },
    async single() {
      if (calls.insert) state.attemptInserts++
      return { data: { id: ATTEMPT }, error: null }
    },
  }
  return b
}

/** Projiserer en rad ned på kolonnene som faktisk ble bedt om.
 *
 *  Uten dette er mocken UTETT på nøyaktig den mutasjonen som betyr mest:
 *  fjernes `is_active` fra select-lista i ruten, ville en mock som alltid
 *  returnerer hele raden fortsatt levere kolonnen, vakten ville se `true`, og
 *  ingen test ville blitt rød — mens ekte PostgREST hadde returnert en rad
 *  UTEN kolonnen og avvist alt. Målt: uten projeksjonen overlevde den
 *  mutasjonen (46 grønne). */
function projiser(rad: Record<string, unknown>, kolonner: string[] | null) {
  if (!kolonner) return rad
  const ut: Record<string, unknown> = {}
  for (const k of kolonner) if (k in rad) ut[k] = rad[k]
  return ut
}

function simpleBuilder(table: string) {
  // Kun `quizzes` projiseres — profiles-oppslaget bruker en bygget
  // kolonnestreng (PREMIUM_PROFILE_COLUMNS) som ikke skal filtreres her.
  let valgteKolonner: string[] | null = null
  const b: Record<string, unknown> = {
    select(kolonner?: unknown) {
      if (table === 'quizzes' && typeof kolonner === 'string') {
        valgteKolonner = kolonner.split(',').map(s => s.trim())
      }
      return b
    },
    eq() { return b },
    is() { return b },
    order() { return b },
    range() { return b },
    async maybeSingle() {
      if (table === 'profiles') return { data: { suspended_until: null }, error: null }
      if (table === 'quizzes') return { data: projiser(quizRow(), valgteKolonner), error: null }
      return { data: null, error: null }
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'questions') return resolve({ data: [QUESTION_ROW], count: 15, error: null })
      return resolve({ data: [], count: 0, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-anna' } }, error: null }) },
      from: (table: string) => (table === 'attempts' ? attemptsBuilder() : simpleBuilder(table)),
    },
  },
})

const { POST: startAttempt } = await import('@/app/api/quiz/start-attempt/route')
const { GET: questions } = await import('@/app/api/quiz/[id]/questions/route')
const { createAttemptToken } = await import('@/lib/attempt-token')

let ipTeller = 0
const start = () =>
  startAttempt(new Request('https://quizkanonen.no/api/quiz/start-attempt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${++ipTeller}`,
      authorization: 'Bearer anna',
    },
    body: JSON.stringify({ quizId: QUIZ, playerName: 'Anna' }),
  }) as never)

const fetchQuestion = () => {
  // createAttemptToken returnerer `string | null` — null når signeringsnøkkelen
  // mangler. Nøkkelen settes øverst i fila, så grenen er uoppnåelig her, men
  // den skal KASTE, ikke falle tilbake på ''. Et tomt token er ikke «samme
  // token uten nøkkel»; det er en TOKEN-LØS forespørsel, og questions-ruten
  // avviser den på et helt annet grunnlag enn is_active-vakten denne fila
  // tester. Testene ville da vært grønne av feil grunn — nøyaktig samme
  // feilklasse som M4/M5 i toppkommentaren, der en for sjenerøs mock lot
  // rutene bestå uten å gjøre det de skulle.
  const token = createAttemptToken(ATTEMPT, QUIZ)
  assert.ok(token, 'createAttemptToken ga null — er QUIZ_TOKEN_SECRET fjernet fra toppen av fila?')
  return questions(
    new Request(
      `https://quizkanonen.no/api/quiz/${QUIZ}/questions?index=0&attemptId=${ATTEMPT}`,
      { headers: { 'x-attempt-token': token } },
    ) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  )
}

beforeEach(() => {
  state.quizIsActive = true
  state.attemptInserts = 0
})

// ── Fredagsquizen: UENDRET ──────────────────────────────────────────────────

test('positiv kontroll: aktiv quiz startes som før — fredagsquizen er uendret', async () => {
  const res = await start()
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal((await res.json()).attemptId, ATTEMPT)
  assert.equal(state.attemptInserts, 1, 'forsøket skal fortsatt opprettes')
})

test('positiv kontroll: aktiv quiz serverer spørsmålet som før', async () => {
  const res = await fetchQuestion()
  assert.equal(res.status, 200, await res.clone().text())
  const body = await res.json()
  assert.equal(body.question.id, QUESTION_ROW.id)
  assert.equal(body.total, 15)
})

// ── Skjult quiz (is_active = false): avvist begge steder ────────────────────

test('skjult quiz avvises av porten — og INGEN attempt-rad skrives', async () => {
  state.quizIsActive = false
  const res = await start()
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, QUIZ_CLOSED_ERROR)
  // Sideeffekt-asserten er poenget: en 403 som likevel hadde skrevet raden
  // ville vært en halv vakt. Jf. lib/start-attempt-archive-gate-route.test.ts.
  assert.equal(state.attemptInserts, 0, 'ingen attempt skal opprettes på en skjult quiz')
})

test('skjult quiz serverer ikke spørsmål — fasiten lekker ikke til et forsøk startet før skjulingen', async () => {
  state.quizIsActive = false
  const res = await fetchQuestion()
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.equal(body.error, QUIZ_CLOSED_ERROR)
  assert.equal(body.question, undefined, 'ingen spørsmålsdata i en avvist respons')
  assert.equal(body.correct_answer, undefined)
})

// ── NULL: paritet med listenes .eq('is_active', true) ───────────────────────
//
// `.eq('is_active', true)` i /quizer og /api/arkiv matcher IKKE NULL, så en
// NULL-rad er allerede usynlig overalt ellers. Da skal den heller ikke være
// spillbar — vakten er `!== true`, ikke `=== false`. (Målt mot prod 27. august
// 2026: 13 quizer, alle `true`, null NULL-rader — så dette er et vern mot en
// framtidig rad, ikke en beskrivelse av dagens data.)

test('is_active = NULL avvises av porten — paritet med listenes .eq(true)', async () => {
  state.quizIsActive = null
  const res = await start()
  assert.equal(res.status, 403)
  assert.equal(state.attemptInserts, 0)
})

test('is_active = NULL avvises av questions-ruten', async () => {
  state.quizIsActive = null
  const res = await fetchQuestion()
  assert.equal(res.status, 403)
})

// ── Kolonnen må faktisk HENTES ──────────────────────────────────────────────
//
// Feller mutasjonen «fjern is_active fra select-listen»: da blir verdien
// undefined i ruten, og `!== true` avviser ALT. Testen under beskriver hva som
// da skjer, slik at feilen leses som «kolonnen hentes ikke» og ikke som en
// mystisk 403 på en helt vanlig quiz.

test('rad uten is_active-kolonne avvises — vakt og select-liste hører sammen', async () => {
  state.quizIsActive = undefined
  const res = await start()
  assert.equal(res.status, 403, 'en manglende kolonne skal aldri tolkes som «aktiv»')
  assert.equal(state.attemptInserts, 0)
})
