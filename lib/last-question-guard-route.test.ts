// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av DELETE på /api/admin/quizzes/[id]/questions/[qid].
//
// BAKGRUNN, to lag:
// 1) Minst-ett-spørsmål-sperren (16. august 2026): fantes før bare i den ene
//    klienten, så en quiz kunne tømmes helt og bli varslet om uten innhold.
// 2) RPC-overgangen (24. august 2026): ruten telte og slettet i TO kall
//    (dokumentert race: to samtidige slettinger på en to-spørsmåls-quiz kunne
//    begge se count=2 og tømme den), og renummereringen lå hos klientene.
//    Nå gjør public.delete_question_and_renumber sperre + sletting +
//    renummerering i ÉN transaksjon, og ruten er bare oversetteren:
//    RPC-utfall → HTTP-status. Testene her feller oversettelsen; selve
//    SQL-planen felles av lib/delete-question-renumber.test.ts, og den
//    empiriske verifiseringen mot ekte database ligger i
//    scripts/verify-delete-renumber.mjs.
//
// question_played er NY og håndhever regelen fra Dennis 24. august 2026:
// resultatene på en spilt quiz er urørlige — et spørsmål med besvarelser kan
// ikke slettes, for en senere fasitretting ville rekalkulert poeng fra et
// amputert radsett. Vakten bor hos SKRIVEREN (RPC-en); ruten oversetter den
// til 409 med forklaring.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Ruten går tilbake til tell-så-slett med query-builder → «slettingen går
//     via RPC-en» ryker (from() finnes ikke i mocken og kaster).
//   • last_question-mappingen fjernes (alle RPC-feil → 500) → «siste spørsmål
//     kan ikke slettes» ryker på status og code.
//   • question_played-mappingen fjernes → «besvart spørsmål kan ikke slettes»
//     ryker.
//   • Suksess-svaret slutter å bære questions-listen → «vellykket sletting
//     returnerer den renummererte listen» ryker.
//   • En ukjent RPC-feil behandles som suksess → «ukjent RPC-feil er 500,
//     aldri ok» ryker.
//   • Auth-sjekken fjernes → «uten admin-token: 401, og RPC-en kalles ikke»
//     ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const QUIZ = 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e'
const QID  = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

type RpcCall = { fn: string; params: Record<string, unknown> }

const state: {
  adminOk: boolean
  rpcCalls: RpcCall[]
  // Hva RPC-en skal svare: 'ok' | en feilmelding fra RAISE EXCEPTION
  rpcOutcome: 'ok' | string
} = { adminOk: true, rpcCalls: [], rpcOutcome: 'ok' }

const RENUMBERED = [
  { question_id: 'q-1', new_order_index: 1 },
  { question_id: 'q-3', new_order_index: 2 },
]

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => state.adminOk },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      // Kun rpc() finnes: går ruten tilbake til tell-så-slett via
      // query-builderen, kaster mocken og testene blir røde.
      rpc: async (fn: string, params: Record<string, unknown>) => {
        state.rpcCalls.push({ fn, params })
        if (state.rpcOutcome === 'ok') return { data: RENUMBERED, error: null }
        return { data: null, error: { code: 'P0001', message: state.rpcOutcome } }
      },
    },
  },
})

const { DELETE } = await import('@/app/api/admin/quizzes/[id]/questions/[qid]/route')

const slett = (qid = QID, quizId = QUIZ) =>
  DELETE(
    new Request(`https://quizkanonen.no/api/admin/quizzes/${quizId}/questions/${qid}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': 'test' },
    }) as never,
    { params: Promise.resolve({ id: quizId, qid }) },
  )

beforeEach(() => {
  state.adminOk = true
  state.rpcCalls = []
  state.rpcOutcome = 'ok'
})

// ── Suksess ─────────────────────────────────────────────────────────────────

test('slettingen går via RPC-en, med quiz og spørsmål fra URL-en', async () => {
  const res = await slett()

  assert.equal(res.status, 200)
  assert.equal(state.rpcCalls.length, 1)
  assert.equal(state.rpcCalls[0].fn, 'delete_question_and_renumber')
  assert.deepEqual(state.rpcCalls[0].params, { p_quiz_id: QUIZ, p_question_id: QID })
})

test('vellykket sletting returnerer den renummererte listen', async () => {
  const res = await slett()
  const body = await res.json()

  assert.equal(body.ok, true)
  assert.deepEqual(body.questions, RENUMBERED)
})

// ── Forretningsutfallene fra RPC-en ─────────────────────────────────────────

test('siste spørsmål kan ikke slettes: 409 last_question', async () => {
  state.rpcOutcome = 'last_question: en quiz må beholde minst ett spørsmål (quiz=b3f1...)'

  const res = await slett()
  const body = await res.json() as { error?: string; code?: string }

  assert.equal(res.status, 409)
  assert.equal(body.code, 'last_question')
  assert.match(body.error ?? '', /minst ett spørsmål/)
})

test('besvart spørsmål kan ikke slettes: 409 question_played', async () => {
  state.rpcOutcome = 'question_played: spørsmål aaa... har registrerte besvarelser'

  const res = await slett()
  const body = await res.json() as { error?: string; code?: string }

  assert.equal(res.status, 409)
  assert.equal(body.code, 'question_played')
  // Meldingen må peke videre til riktig verktøy — sletting er sperret,
  // men admin skal vite hva som IKKE er det.
  assert.match(body.error ?? '', /Rett svar/)
})

test('ukjent spørsmål eller feil quiz: 404', async () => {
  state.rpcOutcome = 'question_not_found: spørsmål aaa... finnes ikke i quiz bbb...'

  const res = await slett()

  assert.equal(res.status, 404)
})

// ── Feilretning: fail-closed ────────────────────────────────────────────────

test('ukjent RPC-feil er 500, aldri ok — og svaret sier at ingenting er slettet', async () => {
  // Transaksjonen garanterer at en feil betyr «ingenting skjedde»; svaret må
  // si det samme, ellers tror admin at quizen mistet et spørsmål den beholdt.
  state.rpcOutcome = 'connection reset by peer'

  const res = await slett()
  const body = await res.json() as { error?: string; ok?: boolean }

  assert.equal(res.status, 500)
  assert.equal(body.ok, undefined)
  assert.match(body.error ?? '', /Ingenting er slettet/)
})

// ── Auth ────────────────────────────────────────────────────────────────────

test('uten admin-token: 401, og RPC-en kalles ikke', async () => {
  state.adminOk = false

  const res = await slett()

  assert.equal(res.status, 401)
  assert.deepEqual(state.rpcCalls, [])
})
