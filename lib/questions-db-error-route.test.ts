// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av feilskillet i questions-ruten (5. september 2026).
//
// BAKGRUNN: ruten leste `attemptRes.data` alene og kastet `error`. TRE ulike
// tilstander falt ned i én gren og kom ut som «Ingen tilgang til dette
// forsøket» / 403:
//   1. raden fantes ikke
//   2. raden hørte til en annen quiz
//   3. oppslaget FEILET  ← usynlig, og den som traff i prod
// supabase-js kaster ikke ved nettverksfeil eller PostgREST-5xx; den svarer
// `{ data: null, error }`. Målt i prod 4. september: attempt f06fa0dd fikk
// 403 på index 0, 3,3 sekunder etter at raden ble opprettet, med et
// attempt-token som passerte — altså kunne verken «finnes ikke» eller
// «feil quiz» være sant.
//
// Skillet er submit-rutens (:255-272), og fordi oppslagene er PARALLELLE
// speiles submits parallelle form: én samlet sjekk som logger begge.
//
// MUTASJONSBEVIS (hver mutasjon anvendt på route.ts og verifisert felt):
//   - `if (attemptRes.error || quizRes.error)` → `if (false)`
//       ryker: alle fire 503-testene + logglinje-testen
//   - `attemptRes.error ||` fjernes fra betingelsen
//       ryker: «attempt-oppslag feilet → 503» og «begge feiler → 503»
//   - `|| quizRes.error` fjernes fra betingelsen
//       ryker: «quiz-oppslag feilet → 503»
//   - `if (!attemptRow)` 404 → `if (!attemptRow) ... 403`
//       ryker: «rad null → 404»
//   - `attemptRow.quiz_id !== quizId` slås sammen med `!attemptRow` igjen
//       ryker: «rad null → 404» (den ville da gitt 403)
//   - hele 503-blokken flyttes NED under attempt-gatene
//       ryker: «begge feiler → 503, ikke 403» — rekkefølgen er selve poenget
//   - `console.error(...)` i 503-grenen fjernes
//       ryker: logglinje-testen
//   - `console.error(...)` i 404-grenen fjernes
//       ryker: «404-grenen skriver FAKTISK en loggelinje»
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ANNEN_QUIZ = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

// Nøyaktig formen supabase-js gir. `details` er med i fixturen med vilje: den
// skal IKKE havne i loggen (den bærer stack og URL-er hos supabase-js).
const DB_FEIL = {
  message: 'TypeError: fetch failed',
  details: 'Error: connect ECONNREFUSED 10.0.0.1:5432 — postgres://bruker:hemmelig@db',
  hint: '',
  code: '',
}

const state: {
  attemptError: unknown
  quizError: unknown
  attemptRowQuizId: string
  attemptRowFinnes: boolean
} = {
  attemptError: null,
  quizError: null,
  attemptRowQuizId: QUIZ,
  attemptRowFinnes: true,
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
        if (state.quizError) return { data: null, error: state.quizError }
        return {
          data: {
            id: QUIZ, is_active: true, opens_at: minutesAgo(240), closes_at: null,
            randomize_questions: false, quiz_type: 'weekly',
          },
          error: null,
        }
      }
      if (table === 'attempts') {
        if (state.attemptError) return { data: null, error: state.attemptError }
        if (!state.attemptRowFinnes) return { data: null, error: null }
        return {
          data: {
            id: ATTEMPT, quiz_id: state.attemptRowQuizId, question_order: null,
            submitted_at: null, completed_at: minutesAgo(10),
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

// Tokenet signeres alltid over (ATTEMPT, QUIZ) — altså URL-ens par. Det er
// nettopp det som gjør «feil quiz_id»-testen meningsfull: token-gaten passerer,
// og radens egen quiz_id er det eneste som avviker.
const fetchQuestion = () => questions(
  new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/questions?index=0&attemptId=${ATTEMPT}`, {
    headers: { 'x-attempt-token': createAttemptToken(ATTEMPT, QUIZ)! },
  }) as never,
  { params: Promise.resolve({ id: QUIZ }) } as never,
)

/** Fanger console.error for ÉN kjøring og gir linjene tilbake. */
async function medFangetErrorlogg<T>(fn: () => Promise<T>): Promise<{ verdi: T; linjer: string[] }> {
  const linjer: string[] = []
  const ekte = console.error
  console.error = (...args: unknown[]) => { linjer.push(args.map(String).join(' ')) }
  try {
    return { verdi: await fn(), linjer }
  } finally {
    console.error = ekte
  }
}

beforeEach(() => {
  state.attemptError = null
  state.quizError = null
  state.attemptRowQuizId = QUIZ
  state.attemptRowFinnes = true
})

test('positiv kontroll: alt friskt → 200, spørsmålet serveres uendret', async () => {
  const res = await fetchQuestion()
  assert.equal(res.status, 200, await res.clone().text())
  const body = await res.json()
  assert.equal(body.question.id, QUESTION_ROW.id)
  assert.equal(body.total, 15)
})

test('attempt-oppslaget FEILER → 503, ikke 403 — en lesefeil er ingen tilgangsnekt', async () => {
  state.attemptError = DB_FEIL
  const { verdi: res } = await medFangetErrorlogg(fetchQuestion)
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.equal(body.error, 'Kunne ikke hente quizdata. Prøv igjen om et øyeblikk.')
  assert.equal(body.question, undefined, 'aldri spørsmålsdata i en avvisning')
})

test('attempt-raden finnes IKKE → 404, ikke 403', async () => {
  state.attemptRowFinnes = false
  const { verdi: res } = await medFangetErrorlogg(fetchQuestion)
  assert.equal(res.status, 404)
  assert.equal((await res.json()).error, 'Forsøk ikke funnet')
})

test('404-grenen skriver FAKTISK en loggelinje — tilstanden er umulig, ikke støy', async () => {
  // Et gyldig token for en rad som ikke finnes kan ikke oppstå i normal drift
  // (tokenet er HMAC over paret, og start-attempt signerer kun rader den skrev).
  // Klienten varsler bare ved 403, så uten denne linja ville 404-en vært helt
  // stille — skillet ville gjort svaret ærligere for spilleren og usynlig for
  // driften. Ingen Sentry her med vilje: 503-ene varsler, denne skal være
  // gjenfinnbar.
  state.attemptRowFinnes = false
  const { linjer } = await medFangetErrorlogg(fetchQuestion)
  const linje = linjer.find(l => l.includes('[quiz/questions] attempt ikke funnet'))
  assert.ok(linje, `fant ingen logglinje med ankeret. Fanget: ${JSON.stringify(linjer)}`)

  assert.match(linje!, /^\[quiz\/questions\] attempt ikke funnet: /)
  assert.ok(linje!.includes(`quizId=${QUIZ}`), 'quizId skal være med')
  assert.ok(linje!.includes(`attemptId=${ATTEMPT}`), 'attemptId skal være med')
})

test('404-loggen bærer ikke tokenet', async () => {
  state.attemptRowFinnes = false
  const token = createAttemptToken(ATTEMPT, QUIZ)!
  const { linjer } = await medFangetErrorlogg(() => questions(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/questions?index=0&attemptId=${ATTEMPT}`, {
      headers: { 'x-attempt-token': token },
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  ))
  assert.ok(
    !linjer.join('\n').includes(token.split('.').pop()!),
    'attempt-tokenet skal aldri havne i loggen',
  )
})

test('raden hører til en ANNEN quiz → 403 med sin egen tekst', async () => {
  state.attemptRowQuizId = ANNEN_QUIZ
  const res = await fetchQuestion()
  assert.equal(res.status, 403)
  const body = await res.json()
  assert.equal(body.error, 'Forsøk hører ikke til denne quizen')
  assert.notEqual(
    body.error, 'Ingen tilgang til dette forsøket',
    'den gamle fellesteksten skal ikke kunne komme tilbake for denne tilstanden',
  )
})

test('quiz-oppslaget FEILER → 503, selv om attempt-raden er frisk', async () => {
  state.quizError = DB_FEIL
  const { verdi: res } = await medFangetErrorlogg(fetchQuestion)
  assert.equal(res.status, 503)
  assert.equal((await res.json()).error, 'Kunne ikke hente quizdata. Prøv igjen om et øyeblikk.')
})

test('BEGGE oppslagene feiler → 503, IKKE 403 — rekkefølgen er hele poenget', async () => {
  // Dette er scenariet fra prod-hendelsen skalert opp: Supabase helt nede.
  // Før fiksen vant attempt-gaten, og 60 spillere ville fått en tilgangsnekt
  // som pekte på rettighetene deres i stedet for på infrastrukturen.
  state.attemptError = DB_FEIL
  state.quizError = DB_FEIL
  const { verdi: res } = await medFangetErrorlogg(fetchQuestion)
  assert.equal(res.status, 503)
  assert.notEqual(res.status, 403, 'total DB-utilgjengelighet skal aldri komme ut som tilgangsnekt')
  assert.equal((await res.json()).error, 'Kunne ikke hente quizdata. Prøv igjen om et øyeblikk.')
})

test('503-grenen skriver FAKTISK en loggelinje — uten den er 503 usynlig for Dennis', async () => {
  // Klienten (fetchQuestionAt) sender Sentry-varsel KUN ved 403. Uten
  // serverlogging ville skillet gjort feilen ærlig for spilleren og usynlig
  // for driften — en regresjon forkledd som fiks.
  state.attemptError = DB_FEIL
  const { linjer } = await medFangetErrorlogg(fetchQuestion)
  const linje = linjer.find(l => l.includes('[quiz/questions] oppslag feilet'))
  assert.ok(linje, `fant ingen logglinje med ankeret. Fanget: ${JSON.stringify(linjer)}`)

  // Ankeret og nøklene er ASCII, så grep ikke krever ø/å.
  assert.match(linje!, /^\[quiz\/questions\] oppslag feilet: /)
  assert.match(linje!, /attempt=FEIL/)
  assert.match(linje!, /quiz=ok/, 'linja skal navngi HVILKET oppslag som feilet')
  assert.ok(linje!.includes(`quizId=${QUIZ}`), 'quizId skal være med')
  assert.ok(linje!.includes(`attemptId=${ATTEMPT}`), 'attemptId skal være med')
  assert.ok(linje!.includes('attemptMelding=TypeError: fetch failed'), 'message skal være med')
})

test('loggen bærer ikke `details` — der ligger stack og connection strings', async () => {
  state.attemptError = DB_FEIL
  const { linjer } = await medFangetErrorlogg(fetchQuestion)
  const alt = linjer.join('\n')
  assert.ok(!alt.includes('ECONNREFUSED'), 'details skal aldri i loggen')
  assert.ok(!alt.includes('postgres://'), 'en connection string skal aldri i loggen')
})

test('tokenet logges aldri', async () => {
  state.attemptError = DB_FEIL
  const token = createAttemptToken(ATTEMPT, QUIZ)!
  const { linjer } = await medFangetErrorlogg(() => questions(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/questions?index=0&attemptId=${ATTEMPT}`, {
      headers: { 'x-attempt-token': token },
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  ))
  const signatur = token.split('.').pop()!
  assert.ok(!linjer.join('\n').includes(signatur), 'attempt-tokenet skal aldri havne i loggen')
})

test('begge feiler → loggen navngir BEGGE, ikke bare den første', async () => {
  // Submits parallelle form (:255-272) logger begge feilene i én linje. To
  // separate if-er med hver sin return ville skjult den andre nettopp når
  // Supabase er helt nede — da loggen betyr mest.
  state.attemptError = DB_FEIL
  state.quizError = DB_FEIL
  const { linjer } = await medFangetErrorlogg(fetchQuestion)
  const linje = linjer.find(l => l.includes('[quiz/questions] oppslag feilet'))!
  assert.match(linje, /attempt=FEIL/)
  assert.match(linje, /quiz=FEIL/)
})
