// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av POST /api/admin/quizzes/[id]/questions/reorder, med
// hovedvekt på quiz_played-vakten (migrasjon 20260824000001).
//
// REGELEN (Dennis, 24. august 2026): rekkefølge er en visningsdetalj og skal
// ALDRI kunne endre resultatet av en spilt quiz. Bytte bryter den indirekte:
// correct_streak (tiebreaker nr. 3) rekonstrueres fra order_index-rekkefølgen
// når en fasitretting kjøres — byttes to spørsmål etter at noen har levert,
// regner en senere retting streak i en rekkefølge spillerne aldri så. Vakten
// bor hos SKRIVEREN (RPC-en, quiz-nivå); ruten er oversetteren til 409. Den
// empiriske verifiseringen mot ekte database ligger i
// scripts/verify-swap-played-guard.mjs.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • quiz_played-mappingen fjernes fra ruten (alle RPC-feil → 500) →
//     «bytte på spilt quiz: 409 quiz_played» ryker.
//   • Ukjent RPC-feil behandles som suksess → «ukjent RPC-feil er 500» ryker.
//   • Valideringen questionA ≠ questionB fjernes → «samme id to ganger: 400,
//     og RPC-en kalles ikke» ryker.
//   • Auth-sjekken fjernes → «uten admin-token: 401» ryker.
//   • Byggeren slutter å vise 409-forklaringen → koblingstesten nederst ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const QUIZ = 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e'
const QA = 'aaaaaaaa-1111-2222-3333-444444444444'
const QB = 'bbbbbbbb-1111-2222-3333-444444444444'

const state: {
  adminOk: boolean
  rpcCalls: Array<{ fn: string; params: Record<string, unknown> }>
  rpcOutcome: 'ok' | string
} = { adminOk: true, rpcCalls: [], rpcOutcome: 'ok' }

const SWAPPED = [
  { question_id: QA, new_order_index: 2 },
  { question_id: QB, new_order_index: 1 },
]

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => state.adminOk },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      rpc: async (fn: string, params: Record<string, unknown>) => {
        state.rpcCalls.push({ fn, params })
        if (state.rpcOutcome === 'ok') return { data: SWAPPED, error: null }
        return { data: null, error: { code: 'P0001', message: state.rpcOutcome } }
      },
    },
  },
})

const { POST } = await import('@/app/api/admin/quizzes/[id]/questions/reorder/route')

const bytt = (body: unknown, quizId = QUIZ) =>
  POST(
    new Request(`https://quizkanonen.no/api/admin/quizzes/${quizId}/questions/reorder`, {
      method: 'POST',
      headers: { 'x-admin-token': 'test' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: quizId }) },
  )

beforeEach(() => {
  state.adminOk = true
  state.rpcCalls = []
  state.rpcOutcome = 'ok'
})

test('vellykket bytte: RPC kalles med begge id-ene, svaret bærer ny rekkefølge', async () => {
  const res = await bytt({ questionA: QA, questionB: QB })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(state.rpcCalls.length, 1)
  assert.equal(state.rpcCalls[0].fn, 'swap_question_order')
  assert.deepEqual(state.rpcCalls[0].params, { p_quiz_id: QUIZ, p_question_a: QA, p_question_b: QB })
  assert.deepEqual(body, { ok: true, questions: SWAPPED })
})

test('bytte på spilt quiz: 409 quiz_played med forklaring', async () => {
  state.rpcOutcome = `quiz_played: quiz ${QUIZ} har registrerte besvarelser`

  const res = await bytt({ questionA: QA, questionB: QB })
  const body = await res.json() as { error?: string; code?: string }

  assert.equal(res.status, 409)
  assert.equal(body.code, 'quiz_played')
  // Forklaringen må si HVORFOR — låst rekkefølge uten begrunnelse ser ut
  // som en bug for den som bygger fredagsquizen.
  assert.match(body.error ?? '', /besvarelser/)
})

test('ukjent RPC-feil er 500, aldri ok', async () => {
  state.rpcOutcome = 'connection reset by peer'

  const res = await bytt({ questionA: QA, questionB: QB })

  assert.equal(res.status, 500)
  assert.equal((await res.json()).ok, undefined)
})

test('samme id to ganger: 400, og RPC-en kalles ikke', async () => {
  const res = await bytt({ questionA: QA, questionB: QA })

  assert.equal(res.status, 400)
  assert.deepEqual(state.rpcCalls, [])
})

test('manglende id-er: 400, og RPC-en kalles ikke', async () => {
  const res = await bytt({ questionA: QA })

  assert.equal(res.status, 400)
  assert.deepEqual(state.rpcCalls, [])
})

test('uten admin-token: 401, og RPC-en kalles ikke', async () => {
  state.adminOk = false

  const res = await bytt({ questionA: QA, questionB: QB })

  assert.equal(res.status, 401)
  assert.deepEqual(state.rpcCalls, [])
})

// ── Kobling: byggeren viser avslaget der flyttingen ble forsøkt ─────────────

function activeLines(relPath: string): string[] {
  const raw = readFileSync(join(process.cwd(), relPath), 'utf8')
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('{/*'))
}

test('byggeren viser 409-forklaringen ved pilene, ikke bare en feilstatus', () => {
  const lines = activeLines('app/admin/quizzes/new/page.tsx')
  assert.ok(
    lines.some(l => l.includes('if (res.status === 409 && d?.error) setMoveError(d.error)')),
    'moveQuestion må fange 409-kroppen og sette moveError — ellers ser sperren ut som en teknisk feil som «aldri gir seg»',
  )
  assert.ok(
    lines.some(l => l.includes('{moveError && <p')),
    'moveError må faktisk rendres — en satt state uten visning er verdiløs',
  )
})
