// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Vakten som hindrer at en quiz UTEN spørsmål varsles til abonnentene, pluss
// strukturelle sperrer mot at de tre varslingsrutene får hver sin kopi av
// oppslaget tilbake.
//
// Den falske supabase-klienten under FILTRERER faktisk radene i stedet for å
// returnere et fast svar. Det er hele poenget: en test som bare returnerer
// «ingen rader» ville vært like grønn med og uten `.neq('question_text', '')`,
// og da beviser den ingenting om nettopp den linja.
//
// MUTASJONSBEVIS — hver mutasjon er faktisk lagt inn i lib/opened-quiz-lookup.ts,
// `npm test` kjørt, og linja rullet tilbake (16. august 2026):
//   • `.neq('question_text', '')` fjernet (altså en ren count-vakt) →
//     «placeholder-quiz varsles ikke» ryker. Dette er den viktigste: en
//     tellevakt SER riktig ut, men placeholder-radene gjør antallet ≥ 1 fra
//     første sekund.
//   • `.not('question_text', 'is', null)` fjernet → «NULL-tekst teller ikke
//     som innhold» ryker.
//   • `.eq('is_test', false)` fjernet fra quiz-oppslaget → «guardene ligger i
//     spørringen» ryker.
//   • innholdssjekken feiler LUKKET (return false ved error) → «DB-feil
//     stopper ikke varslingen» ryker.
//   • `varsle(...)` fjernet fra empty-grenen → «tilbakeholdt varsling
//     rapporteres» ryker, og funnet ville vært usynlig i prod.
//   • `status: 'empty'` byttet til `'none'` → «empty og none er ulike svar»
//     ryker (kalleren ville rapportert normaldrift).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const QUIZ = 'cccccccc-1111-2222-3333-444444444444'
const NOW = Date.parse('2026-08-21T10:05:00.000Z')

type QuizRow = { id: string; title: string | null; opens_at: string; closes_at: string | null }
type QuestionRow = { id: string; quiz_id: string; question_text: string | null }
type Filter = { op: string; col: string; val: unknown }
type Capture = { melding: string; ctx: { level: string; extra: Record<string, unknown> } }

const state: {
  quiz: QuizRow | null
  quizError: { message: string } | null
  questions: QuestionRow[]
  questionsError: { message: string } | null
  quizFilters: Filter[]
  questionQueries: number
} = {
  quiz: null, quizError: null, questions: [], questionsError: null,
  quizFilters: [], questionQueries: 0,
}

const captured: Capture[] = []

mock.module('@sentry/nextjs', {
  namedExports: {
    captureMessage: (melding: string, ctx: Capture['ctx']) => { captured.push({ melding, ctx }) },
  },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from(table: string) {
        if (table === 'quizzes') {
          const b = {
            select() { return b },
            eq(col: string, val: unknown) { state.quizFilters.push({ op: 'eq', col, val }); return b },
            lte(col: string, val: unknown) { state.quizFilters.push({ op: 'lte', col, val }); return b },
            gte(col: string, val: unknown) { state.quizFilters.push({ op: 'gte', col, val }); return b },
            order() { return b },
            limit() { return b },
            maybeSingle: async () =>
              state.quizError
                ? { data: null, error: state.quizError }
                : { data: state.quiz, error: null },
          }
          return b
        }

        if (table === 'questions') {
          state.questionQueries++
          // Filtrene bygges som predikater og brukes faktisk på radene, slik at
          // en fjernet filterlinje endrer resultatet — ikke bare formen.
          const preds: Array<(r: QuestionRow) => boolean> = []
          let take = Infinity
          const b = {
            select() { return b },
            eq(col: string, val: unknown) {
              preds.push(r => (r as unknown as Record<string, unknown>)[col] === val); return b
            },
            not(col: string, op: string, val: unknown) {
              if (op === 'is' && val === null) {
                preds.push(r => (r as unknown as Record<string, unknown>)[col] !== null)
              }
              return b
            },
            neq(col: string, val: unknown) {
              preds.push(r => (r as unknown as Record<string, unknown>)[col] !== val); return b
            },
            limit(n: number) { take = n; return b },
            then(resolve: (v: unknown) => void) {
              if (state.questionsError) return resolve({ data: null, error: state.questionsError })
              const rows = state.questions.filter(r => preds.every(p => p(r))).slice(0, take)
              return resolve({ data: rows, error: null })
            },
          }
          return b
        }

        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { findOpenedQuizToNotify, quizHasQuestions, NOTIFY_WINDOW_MS } =
  await import('@/lib/opened-quiz-lookup')

const åpenQuiz = (): QuizRow => ({
  id: QUIZ, title: 'Fredagsquiz 21.08.2026',
  opens_at: '2026-08-21T10:00:00.000Z', closes_at: '2026-08-22T10:00:00.000Z',
})

const ekteSpørsmål = (n: number): QuestionRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `q${i}`, quiz_id: QUIZ, question_text: `Hva heter hovedstaden i land nr. ${i}?`,
  }))

/** Radene admin-editoren lager på tittel-blur: de FINNES, men er tomme. */
const placeholderSpørsmål = (n: number): QuestionRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i}`, quiz_id: QUIZ, question_text: '' }))

beforeEach(() => {
  state.quiz = åpenQuiz()
  state.quizError = null
  state.questions = ekteSpørsmål(15)
  state.questionsError = null
  state.quizFilters = []
  state.questionQueries = 0
  captured.length = 0
})

// ── Kjernen ─────────────────────────────────────────────────────────────────

test('ferdig quiz → found, og ingenting rapporteres', async () => {
  const res = await findOpenedQuizToNotify('test', NOW)

  assert.equal(res.status, 'found')
  assert.equal(res.status === 'found' && res.quiz.id, QUIZ)
  assert.deepEqual(captured, [], 'en normal fredagsquiz skal ikke varsle noen')
})

test('placeholder-quiz varsles ikke — count > 0 er ikke nok', async () => {
  // NØYAKTIG tilstanden admin-editoren lager: quiz-raden finnes, is_active er
  // true, og det finnes 15 spørsmålsrader — alle uten tekst. En `count > 0`-vakt
  // ville sluppet denne rett gjennom til påmeldingslisten.
  state.questions = placeholderSpørsmål(15)

  const res = await findOpenedQuizToNotify('cron/notify-subscribers', NOW)

  assert.equal(res.status, 'empty')
  assert.equal(res.status === 'empty' && res.quizId, QUIZ)
})

test('tilbakeholdt varsling rapporteres til Sentry med id og konsekvens', async () => {
  state.questions = placeholderSpørsmål(15)

  await findOpenedQuizToNotify('cron/send-push', NOW)

  assert.equal(captured.length, 1)
  assert.match(captured[0].melding, /quiz åpnet uten spørsmål/)
  assert.equal(captured[0].ctx.level, 'error', 'quizen står live og tom — dette er ikke en advarsel')
  assert.equal(captured[0].ctx.extra.quizId, QUIZ)
  assert.equal(captured[0].ctx.extra.context, 'cron/send-push')
  assert.match(String(captured[0].ctx.extra.consequence), /ingen spørsmål/i)
})

test('NULL-tekst teller ikke som innhold', async () => {
  state.questions = [{ id: 'q0', quiz_id: QUIZ, question_text: null }]

  const res = await findOpenedQuizToNotify('test', NOW)

  assert.equal(res.status, 'empty')
})

test('én ekte tekst blant placeholders er nok til å varsle', async () => {
  // Vakten skal ikke kreve en KOMPLETT quiz. En halvferdig quiz er admins eget
  // ansvar; den vi stopper er den som ikke har ett eneste spørsmål med tekst.
  state.questions = [...placeholderSpørsmål(14), ...ekteSpørsmål(1)]

  const res = await findOpenedQuizToNotify('test', NOW)

  assert.equal(res.status, 'found')
  assert.deepEqual(captured, [])
})

test('empty og none er ULIKE svar', async () => {
  // Kalleren skiller på dem i responsteksten. Kollapser de to, rapporteres en
  // tilbakeholdt varsling som «ingen quiz i vinduet» — normalmeldingen nesten
  // hele tiden, altså stille undersending forkledd som normaldrift.
  state.questions = placeholderSpørsmål(3)
  const tom = await findOpenedQuizToNotify('test', NOW)

  state.quiz = null
  const ingen = await findOpenedQuizToNotify('test', NOW)

  assert.equal(tom.status, 'empty')
  assert.equal(ingen.status, 'none')
})

// ── Oppslaget selv ──────────────────────────────────────────────────────────

test('ingen quiz i vinduet → innholdssjekken kjøres ikke', async () => {
  state.quiz = null

  const res = await findOpenedQuizToNotify('test', NOW)

  assert.equal(res.status, 'none')
  assert.equal(state.questionQueries, 0, 'normaltilstanden skal ikke koste en ekstra spørring')
})

test('guardene ligger i spørringen, ikke i etterkant', async () => {
  await findOpenedQuizToNotify('test', NOW)

  const har = (op: string, col: string, val?: unknown) =>
    state.quizFilters.some(f => f.op === op && f.col === col && (val === undefined || f.val === val))

  assert.ok(har('eq', 'is_test', false), 'testquiz kan vinne order(opens_at desc)')
  assert.ok(har('eq', 'is_active', true), 'en skjult quiz («Skjul» i admin) skal ikke varsles')
  assert.ok(har('lte', 'opens_at'), 'en quiz som ikke har åpnet ennå skal ikke varsles')
  assert.ok(har('gte', 'opens_at'), 'uten nedre grense kan en gammel quiz legge beslag på oppslaget')

  const nedre = state.quizFilters.find(f => f.op === 'gte' && f.col === 'opens_at')
  assert.equal(Date.parse(String(nedre?.val)), NOW - NOTIFY_WINDOW_MS)
})

test('quiz-oppslaget feiler → error, ikke «ingen quiz»', async () => {
  // notify-subscribers leste tidligere kun `data`, så en DB-feil så ut som
  // normaldrift og ruten svarte 200.
  state.quizError = { message: 'connection reset' }

  const res = await findOpenedQuizToNotify('test', NOW)

  assert.equal(res.status, 'error')
  assert.equal(res.status === 'error' && res.message, 'connection reset')
  assert.equal(state.questionQueries, 0)
})

// ── Feilretning ─────────────────────────────────────────────────────────────

test('DB-feil i innholdssjekken stopper ikke varslingen', async () => {
  // Fail-open: en forbigående feil skal ikke koste fredagens varsling til hele
  // listen. Feiler den derimot LUKKET, forsvinner varslingen stille.
  state.questionsError = { message: 'statement timeout' }

  const res = await findOpenedQuizToNotify('test', NOW)

  assert.equal(res.status, 'found')
})

test('fail-open rapporteres, så den ikke blir stille', async () => {
  state.questionsError = { message: 'statement timeout' }

  await findOpenedQuizToNotify('cron/send-reminders', NOW)

  assert.equal(captured.length, 1)
  assert.match(captured[0].melding, /innholdssjekken feilet/)
  assert.equal(captured[0].ctx.level, 'warning')
})

test('quizHasQuestions kan brukes frittstående på en quiz vi alt har', async () => {
  // Org-stengevarselet i send-reminders finner quizen sin med et annet oppslag.
  state.questions = placeholderSpørsmål(10)
  assert.equal(await quizHasQuestions(QUIZ, 'test'), false)

  state.questions = ekteSpørsmål(10)
  assert.equal(await quizHasQuestions(QUIZ, 'test'), true)
})

test('innholdssjekken er scopet til RIKTIG quiz', async () => {
  // En annen quiz sine spørsmål skal ikke kunne dekke over en tom quiz.
  state.questions = [{ id: 'q0', quiz_id: 'en-helt-annen-quiz', question_text: 'Ekte spørsmål' }]

  assert.equal(await quizHasQuestions(QUIZ, 'test'), false)
})

// ── Strukturelle sperrer: én kilde, tre ruter ───────────────────────────────

const ROT = join(import.meta.dirname, '..')
const RUTER = [
  'app/api/cron/notify-subscribers/route.ts',
  'app/api/cron/send-reminders/route.ts',
  'app/api/cron/send-push/route.ts',
]

/**
 * Kildekoden uten kommentarer.
 *
 * Uten dette ville testene passert på en UTKOMMENTERT vakt — regexen finner
 * teksten uansett om linja kjører. Blokkommentarer fjernes, og linjer som
 * BEGYNNER med `//` fjernes helt; en `//` midt på en linje røres ikke, slik at
 * URL-er i strenger ikke kutter resten av linja bort.
 */
const aktiveLinjer = (fil: string): string =>
  readFileSync(join(ROT, fil), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')

test('alle tre varslingsrutene går gjennom den delte vakten', async () => {
  for (const rute of RUTER) {
    assert.match(
      aktiveLinjer(rute),
      /findOpenedQuizToNotify\(/,
      `${rute} henter ikke quizen gjennom lib/opened-quiz-lookup.ts`,
    )
  }
})

test('ingen rute har sin egen kopi av åpnet-quiz-oppslaget', async () => {
  // `.gte('opens_at', ...)` er signaturen på nettopp dette oppslaget — org-
  // stengegrenen i send-reminders bruker closes_at og skal fortsatt få stå.
  // Dukker mønsteret opp igjen i en rute, har noen inlinet oppslaget på nytt,
  // og guardene kan drive fra hverandre slik de gjorde fram til 7c81c0a.
  for (const rute of RUTER) {
    assert.doesNotMatch(
      aktiveLinjer(rute),
      /\.gte\(\s*['"]opens_at['"]/,
      `${rute} har fått tilbake sitt eget åpnet-quiz-oppslag`,
    )
  }
})

test('org-stengevarselet har sin EGEN innholdssjekk', async () => {
  // Det oppslaget finner quizen med en annen spørring, så det arver ingenting
  // av vakten over. En feil har som regel søsken.
  assert.match(
    aktiveLinjer('app/api/cron/send-reminders/route.ts'),
    /quizHasQuestions\(/,
    'org-stengevarselet kan sendes for en quiz uten spørsmål',
  )
})
