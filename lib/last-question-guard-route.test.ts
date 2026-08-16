// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av DELETE på /api/admin/quizzes/[id]/questions/[qid]:
// en quiz må beholde minst ett spørsmål.
//
// BAKGRUNN
// Sperren fantes bare i klienten, og bare i den ene av to editorer
// (app/admin/quizzes/new/page.tsx). Spørsmålsoversikten sletter uten noen sjekk,
// så en quiz kunne tømmes helt — og ble liggende med is_active=true, klar til å
// bli annonsert av de tre varslingsrutene. Det er den ene realistiske veien til
// en quiz med NULL spørsmålsrader; alle andre veier ender med TOMME rader, som
// er innholdsvaktens bord (lib/opened-quiz-lookup.ts).
//
// MUTASJONSBEVIS — hver mutasjon under er faktisk lagt inn i ruten, testene
// kjørt, og endringen rullet tilbake (16. august 2026):
//   • hele `if ((count ?? 0) <= 1)`-blokka fjernet → «siste spørsmål kan ikke
//     slettes» og «tellingen gjelder quizen i URL-en» ryker.
//   • `<= 1` byttet til `< 1` (av-med-én) → samme to ryker: raden slettes og
//     quizen står igjen tom.
//   • `.eq('quiz_id', quizId)` fjernet fra slettingen → «slettingen er scopet
//     til quizen» ryker; tellingen ville da gjelde én quiz og slettingen en
//     annen, og sperren over ville ikke betydd noe.
//   • auth-sjekken fjernet fra DELETE → «uten admin-token: 401, og databasen
//     røres ikke» ryker.
//   • tellefeil-grenen slått av (`if (countError)` → `if (false)`) → «tellefeil
//     sletter ingenting» ryker på STATUSEN (409 i stedet for 500), ikke på
//     slettingen. Det er verdt å vite hvorfor: ved tellefeil er `count` null,
//     og `(count ?? 0) <= 1` fanger den da som «siste spørsmål». De to sperrene
//     dekker altså hverandre, og fail-closed-oppførselen overlever at den ene
//     forsvinner. Testen felles likevel, fordi kontrakten utad endrer seg.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const QUIZ = 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e'
const ANNEN_QUIZ = '11111111-2222-3333-4444-555555555555'

type QuestionRow = { id: string; quiz_id: string }

const state: {
  adminOk: boolean
  questions: QuestionRow[]
  countFails: boolean
  deletes: Array<{ eqs: Record<string, unknown> }>
  countQueries: number
} = { adminOk: true, questions: [], countFails: false, deletes: [], countQueries: 0 }

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => state.adminOk },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from(table: string) {
        assert.equal(table, 'questions')
        const eqs: Record<string, unknown> = {}
        let head = false
        let deleting = false

        const b = {
          select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            head = opts?.head === true
            if (head) state.countQueries++
            return b
          },
          eq(col: string, val: unknown) { eqs[col] = val; return b },
          delete() { deleting = true; return b },
          then(resolve: (v: unknown) => void) {
            if (deleting) {
              state.deletes.push({ eqs: { ...eqs } })
              // Slettingen speiler filtrene, slik at en manglende
              // `.eq('quiz_id')` faktisk ville truffet feil quiz.
              state.questions = state.questions.filter(
                q => !Object.entries(eqs).every(([k, v]) => (q as unknown as Record<string, unknown>)[k] === v)
              )
              return resolve({ error: null })
            }
            if (head) {
              if (state.countFails) return resolve({ count: null, error: { message: 'statement timeout' } })
              const n = state.questions.filter(
                q => Object.entries(eqs).every(([k, v]) => (q as unknown as Record<string, unknown>)[k] === v)
              ).length
              return resolve({ count: n, error: null })
            }
            return resolve({ data: [], error: null })
          },
        }
        return b
      },
    },
  },
})

const { DELETE } = await import('@/app/api/admin/quizzes/[id]/questions/[qid]/route')

const slett = (qid: string, quizId = QUIZ) =>
  DELETE(
    new Request(`https://quizkanonen.no/api/admin/quizzes/${quizId}/questions/${qid}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': 'test' },
    }) as never,
    { params: Promise.resolve({ id: quizId, qid }) },
  )

const spørsmål = (quizId: string, n: number): QuestionRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${quizId}-q${i}`, quiz_id: quizId }))

beforeEach(() => {
  state.adminOk = true
  state.questions = spørsmål(QUIZ, 3)
  state.countFails = false
  state.deletes = []
  state.countQueries = 0
})

// ── Sperren ─────────────────────────────────────────────────────────────────

test('siste spørsmål kan ikke slettes', async () => {
  state.questions = spørsmål(QUIZ, 1)

  const res = await slett(`${QUIZ}-q0`)
  const body = await res.json() as { error?: string; code?: string }

  assert.equal(res.status, 409)
  assert.equal(body.code, 'last_question')
  assert.deepEqual(state.deletes, [], 'ingen sletting skal ha skjedd')
  assert.equal(state.questions.length, 1, 'quizen skal fortsatt ha spørsmålet sitt')
})

test('nest siste spørsmål KAN slettes', async () => {
  // Kontrollen: en sperre som alltid nekter ville sett like grønn ut i testen
  // over, og gjort det umulig å redigere en quiz.
  state.questions = spørsmål(QUIZ, 2)

  const res = await slett(`${QUIZ}-q1`)

  assert.equal(res.status, 200)
  assert.equal(state.questions.length, 1)
  assert.equal(state.questions[0].id, `${QUIZ}-q0`)
})

test('vanlig sletting midt i en quiz er upåvirket', async () => {
  const res = await slett(`${QUIZ}-q1`)

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal(state.questions.length, 2)
})

// ── Scoping ─────────────────────────────────────────────────────────────────

test('slettingen er scopet til quizen, ikke bare til spørsmåls-id-en', async () => {
  // Uten `.eq('quiz_id')` på slettingen kunne tellingen gjelde en quiz med
  // mange spørsmål mens slettingen tømte en annen.
  const res = await slett(`${QUIZ}-q1`)

  assert.equal(res.status, 200)
  assert.equal(state.deletes.length, 1)
  assert.deepEqual(state.deletes[0].eqs, { id: `${QUIZ}-q1`, quiz_id: QUIZ })
})

test('tellingen gjelder quizen i URL-en', async () => {
  // En annen quiz sine spørsmål skal ikke kunne «låne bort» antall.
  state.questions = [...spørsmål(QUIZ, 1), ...spørsmål(ANNEN_QUIZ, 10)]

  const res = await slett(`${QUIZ}-q0`)

  assert.equal(res.status, 409, 'nabo-quizens 10 spørsmål skal ikke telle med')
})

// ── Feilretning: fail-closed ────────────────────────────────────────────────

test('tellefeil sletter ingenting', async () => {
  // Motsatt retning av innholdsvakten i lib/opened-quiz-lookup.ts, og med
  // vilje: her er den dyre utgangen en tømt quiz. En admin som får 500 kan
  // prøve igjen; en tømt quiz oppdages først når noen spiller den.
  state.countFails = true

  const res = await slett(`${QUIZ}-q1`)

  assert.equal(res.status, 500)
  assert.deepEqual(state.deletes, [])
  assert.equal(state.questions.length, 3)
})

// ── Auth ────────────────────────────────────────────────────────────────────

test('uten admin-token: 401, og databasen røres ikke', async () => {
  state.adminOk = false

  const res = await slett(`${QUIZ}-q1`)

  assert.equal(res.status, 401)
  assert.equal(state.countQueries, 0, 'sperren skal ligge ETTER auth-sjekken')
  assert.deepEqual(state.deletes, [])
})
