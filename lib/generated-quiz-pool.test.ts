// Kjøres med:  npm test
//
// Trekningen for genererte quizer: sampleDistinct — ren trekning uten gjentak,
// deterministisk RNG injisert.
//
// Fram til 9. september 2026 testet fila også fetchPoolQuestionIds (den
// paginerte TS-puljen) mot en registrerende supabase-admin-mock — filtrene,
// hvitelisten, pagineringen. Den funksjonen ble fjernet da puljen flyttet
// inn i databasen (pick_pool_question_ids, migrasjon 20260909000000), etter
// at RPC-en var verifisert mot prod id for id. Pulje-regelen voktes nå
// tekstlig i lib/pool-rpc-wiring.test.ts, og I/O-veien (pickPoolQuestionIds)
// gjennom rutens integrasjonstest i lib/tilfeldig-quiz-route.test.ts.
//
// MUTASJONSBEVIS (8. september 2026):
//   • `j = i + Math.floor(random() * (pool.length - i))` → `Math.floor(random() * pool.length)`
//                                                          → «aldri to ganger»-testen rød
//   • `pool.slice(0, n)` → `pool.slice(0, count)`          → «count over puljen»-testen rød
//   • `const pool = [...items]` → `const pool = items as T[]` → «muterer ikke»-testen rød
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

// Modulen importerer supabase-admin (som krever env ved import); sampleDistinct
// rører den aldri, så en tom stubb holder.
mock.module('@/lib/supabase-admin', { namedExports: { supabaseAdmin: {} } })

const { sampleDistinct } = await import('@/lib/generated-quiz-pool')

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
