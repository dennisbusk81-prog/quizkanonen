// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Puljen for genererte quizer. To deler:
//   • sampleDistinct — ren trekning, deterministisk RNG injisert
//   • fetchPoolQuestionIds — mot en REGISTRERENDE supabase-admin-mock, så
//     testene kan felle FILTRENE (hva som spørres), ikke bare resultatet.
//
// Puljen er en sikkerhetsgrense like mye som en funksjon: uten
// `.is('quiz_id', null)` trekkes fra alle spørsmål inkl. fredagens uåpnede
// quiz; uten hvitelisten på quizzes trekkes fra archive-kopier (kopier av
// kopier). Assert på filtrene, ikke bare på hva mocken returnerte.
//
// MUTASJONSBEVIS (kjørt 8. september 2026 og revertert):
//   • fjern `.is('quiz_id', null)` i bankspørringen      → bank-filter-testen rød
//   • fjern onlyRealQuizzes på quizzes-spørringen         → hviteliste-testen rød
//   • fjern `.eq('is_test', false)` på quizzes            → is_test-testen rød
//   • fjern `.lte('closes_at', nowIso)`                   → stengt-testen rød
//   • fjern kategorifilteret i én av de to spørringene    → kategori-testen rød
//   • bytt Set-unionen med concat                         → distinkt-testen rød
//   • returner `{ ok: true, value: [] }` i catch          → feil-testen rød
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

type Op = {
  table: string
  filters: { method: string; args: unknown[] }[]
  range: [number, number] | null
}

const state = {
  bankPages: [] as { id: string }[][],
  closedQuizzes: [] as { id: string }[],
  playedRows: [] as { id: string }[],
  failTable: null as string | null,
  ops: [] as Op[],
}

function resolveOp(op: Op): { data: unknown; error: { message: string } | null } {
  if (state.failTable === op.table) return { data: null, error: { message: 'simulert lesefeil' } }
  if (op.table === 'quizzes') return { data: state.closedQuizzes, error: null }
  const erBank = op.filters.some((f) => f.method === 'is' && f.args[0] === 'quiz_id')
  if (erBank) {
    const from = op.range?.[0] ?? 0
    const pageIndex = Math.floor(from / 1000)
    return { data: state.bankPages[pageIndex] ?? [], error: null }
  }
  return { data: state.playedRows, error: null }
}

function makeBuilder(table: string) {
  const op: Op = { table, filters: [], range: null }
  const push = (method: string) => (...args: unknown[]) => {
    op.filters.push({ method, args })
    return builder
  }
  const builder: Record<string, unknown> = {
    select() { return builder },
    is: push('is'), eq: push('eq'), in: push('in'), lte: push('lte'), not: push('not'),
    order: push('order'),
    range(from: number, to: number) { op.range = [from, to]; return builder },
    then(resolve: (v: unknown) => unknown) {
      state.ops.push(op)
      return resolve(resolveOp(op))
    },
  }
  return builder
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (table: string) => makeBuilder(table) } },
})

const { fetchPoolQuestionIds, sampleDistinct } = await import('@/lib/generated-quiz-pool')

const NOW_ISO = '2026-09-08T10:00:00.000Z'
const ids = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${String(i).padStart(4, '0')}` }))

beforeEach(() => {
  state.bankPages = [ids('bank', 3)]
  state.closedQuizzes = [{ id: 'quiz-A' }, { id: 'quiz-B' }]
  state.playedRows = ids('spilt', 2)
  state.failTable = null
  state.ops = []
})

const bankOps = () => state.ops.filter((o) => o.table === 'questions' && o.filters.some((f) => f.method === 'is'))
const quizOps = () => state.ops.filter((o) => o.table === 'quizzes')
const playedOps = () => state.ops.filter((o) => o.table === 'questions' && o.filters.some((f) => f.method === 'in'))
const har = (op: Op, method: string, ...args: unknown[]) =>
  op.filters.some((f) => f.method === method && JSON.stringify(f.args) === JSON.stringify(args))

// ── sampleDistinct ──────────────────────────────────────────────────────────

test('sampleDistinct: nøyaktig count elementer, alle distinkte, alle fra puljen', () => {
  const pool = Array.from({ length: 50 }, (_, i) => `q${i}`)
  let seed = 7
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
  const picked = sampleDistinct(pool, 15, rng)
  assert.equal(picked.length, 15)
  assert.equal(new Set(picked).size, 15)
  for (const p of picked) assert.ok(pool.includes(p))
})

test('sampleDistinct: samme spørsmål kan ALDRI komme to ganger — selv med en RNG som alltid gir 0', () => {
  const picked = sampleDistinct(['a', 'b', 'c', 'd'], 4, () => 0)
  assert.equal(new Set(picked).size, 4)
})

test('sampleDistinct: RNG som alltid gir nesten 1 treffer aldri utenfor puljen', () => {
  const picked = sampleDistinct(['a', 'b', 'c'], 3, () => 0.999999)
  assert.deepEqual([...picked].sort(), ['a', 'b', 'c'])
})

test('sampleDistinct: count over puljens størrelse gir hele puljen', () => {
  const picked = sampleDistinct(['a', 'b'], 15, () => 0.5)
  assert.deepEqual([...picked].sort(), ['a', 'b'])
})

test('sampleDistinct: muterer ikke inngangen', () => {
  const pool = ['a', 'b', 'c', 'd', 'e']
  sampleDistinct(pool, 3, () => 0)
  assert.deepEqual(pool, ['a', 'b', 'c', 'd', 'e'])
})

test('sampleDistinct: count 0 eller negativ gir tom liste', () => {
  assert.deepEqual(sampleDistinct(['a'], 0), [])
  assert.deepEqual(sampleDistinct(['a'], -3), [])
})

// ── fetchPoolQuestionIds: filtrene ──────────────────────────────────────────

test('bank: filtrerer på quiz_id IS NULL, og IKKE på kategori når ingen er valgt', async () => {
  await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  const [op] = bankOps()
  assert.ok(op, 'bankspørringen ble ikke kjørt')
  assert.ok(har(op, 'is', 'quiz_id', null))
  assert.ok(!op.filters.some((f) => f.method === 'eq' && f.args[0] === 'category'))
})

test('kategori: begge spørsmålsspørringene får .eq(category) når kategori er valgt', async () => {
  await fetchPoolQuestionIds({ category: 'Sport', nowIso: NOW_ISO })
  assert.ok(har(bankOps()[0], 'eq', 'category', 'Sport'), 'bank mangler kategorifilter')
  assert.ok(har(playedOps()[0], 'eq', 'category', 'Sport'), 'spilte mangler kategorifilter')
})

test('quizzes: HVITELISTEN (weekly, bonus) — archive-kopier er aldri kilde', async () => {
  await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  const [op] = quizOps()
  assert.ok(op, 'quizzes-spørringen ble ikke kjørt')
  assert.ok(har(op, 'in', 'quiz_type', ['weekly', 'bonus']), 'mangler hvitelisten')
  assert.ok(har(op, 'not', 'is_test', 'is', true), 'mangler onlyRealQuizzes sin is_test-vakt')
})

test('quizzes: is_test = false EKSPLISITT (kildegaten krever === false, NULL er «vet ikke»)', async () => {
  await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.ok(har(quizOps()[0], 'eq', 'is_test', false))
})

test('quizzes: kun STENGTE — closes_at <= nå', async () => {
  await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.ok(har(quizOps()[0], 'lte', 'closes_at', NOW_ISO))
})

test('spilte: spørsmålene hentes med .in(quiz_id, <de stengte quizene>)', async () => {
  await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.ok(har(playedOps()[0], 'in', 'quiz_id', ['quiz-A', 'quiz-B']))
})

test('ingen stengte quizer → ingen spilte-spørring, puljen er bare banken', async () => {
  state.closedQuizzes = []
  const r = await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.equal(playedOps().length, 0)
  assert.deepEqual(r, { ok: true, value: ['bank-0000', 'bank-0001', 'bank-0002'] })
})

// ── fetchPoolQuestionIds: resultatet ────────────────────────────────────────

test('unionen er bank + spilte, distinkt', async () => {
  const r = await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.ok(r.ok)
  assert.deepEqual(r.value, ['bank-0000', 'bank-0001', 'bank-0002', 'spilt-0000', 'spilt-0001'])
})

test('samme id i begge delene kollapser til én', async () => {
  state.playedRows = [{ id: 'bank-0001' }, { id: 'spilt-0000' }]
  const r = await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.ok(r.ok)
  assert.equal(r.value.length, new Set(r.value).size)
  assert.equal(r.value.length, 4)
})

test('alle spørringene har .order(id) — paginert kutt uten totalordning er ustabilt', async () => {
  await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  for (const op of state.ops) {
    assert.ok(op.filters.some((f) => f.method === 'order' && f.args[0] === 'id'), `${op.table} mangler order(id)`)
  }
})

test('paginering: 1000 bankrader på side 1 utløser side 2 (biblioteket er 4040 rader)', async () => {
  state.bankPages = [ids('side1', 1000), ids('side2', 40)]
  const r = await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.ok(r.ok)
  assert.equal(r.value.filter((id) => id.startsWith('side')).length, 1040)
  assert.deepEqual(bankOps().map((o) => o.range), [[0, 999], [1000, 1999]])
})

// ── fetchPoolQuestionIds: feil er «vet ikke», aldri tom ─────────────────────

test('lesefeil på banken → { ok: false }, ikke en tom pulje', async () => {
  state.failTable = 'questions'
  const r = await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.deepEqual(r, { ok: false })
})

test('lesefeil på quizzes → { ok: false }', async () => {
  state.failTable = 'quizzes'
  const r = await fetchPoolQuestionIds({ category: null, nowIso: NOW_ISO })
  assert.deepEqual(r, { ok: false })
})
