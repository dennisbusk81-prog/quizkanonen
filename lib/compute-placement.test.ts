// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// KARAKTERISERINGSTEST av computePlacement (lib/ranking-snapshot.ts) —
// skrevet 26. august 2026 som grunnlag for arkiv-arbeidet. Den dokumenterer
// hva funksjonen GJØR i dag, ikke hva vi ønsker at den skal gjøre. Fram til
// nå hadde funksjonen ingen direkte enhetstest: de to rutetestene som nevner
// den (lib/ranking-snapshot-rekey-route.test.ts, lib/standings-cache.test.ts)
// mocker den bort.
//
// DET VIKTIGSTE FUNNET, for «ingen plassering finnes»-designet i arkivet:
// computePlacement har INGEN tom-tilstand. Et tomt felt gir rank 1 av 1 —
// funksjonen legger alltid spilleren selv til i sitt eget «av N». En arkivquiz
// der plassering ikke skal finnes må derfor håndteres av KALLEREN (la være å
// kalle funksjonen / ikke vise resultatet), ikke ved å sende inn et tomt felt.
//
// FIXTURE-REGEL (fella som bet to ganger 25. august): hver rad har DISTINKTE
// verdier i hvert felt testen hviler på (rank, correct_answers, total_time_ms)
// — et filter eller en sammenligning mot feil felt kan da ikke se riktig ut
// ved et sammentreff. Unntaket er tiebreak-testen, som BEVISST deler
// correct_answers for å isolere tid-feltet.
//
// MUTASJONSBEVIS (kjørt 26. august 2026, begge revertert):
//   • `const rank = strictlyBetter.length + 1` → `strictlyBetter.length`:
//     estimat-testene ryker.
//   • self-grenen leser `self.rank` → hardkodet `1`: «rank leses fra egen
//     rad»-testen ryker.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { SnapshotEntry } from './ranking-snapshot'

// ranking-snapshot importerer supabase-admin på toppnivå; computePlacement
// selv rører den aldri (ren funksjon) — mocken finnes kun for at importen
// ikke skal kreve env-variabler.
mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: {} },
})

const { computePlacement } = await import('./ranking-snapshot')

function entry(
  id: string, name: string, rank: number, correct: number, timeMs: number,
): SnapshotEntry {
  return {
    id, user_id: null, player_name: name, rank,
    correct_answers: correct, total_time_ms: timeMs, correct_streak: 0,
  }
}

// Distinkte verdier i alle felt (se fixture-regelen over).
const A = entry('a-1', 'Astrid', 1, 14, 61_000)
const B = entry('b-2', 'Bjørn', 2, 12, 72_000)
const C = entry('c-3', 'Carina', 3, 9, 83_000)

test('tomt felt: rank 1 av 1 — «ingen plassering» finnes IKKE som utfall', () => {
  // playerInPool: false (under spill) → total = ferdige (0) + 1.
  assert.deepEqual(
    computePlacement([], { attemptId: 'x-9', correct: 7, time: 55_000, playerInPool: false }),
    { rank: 1, total: 1, low: 1, high: 1, above: null, below: null },
  )
  // playerInPool: true (resultatskjerm) → total = max(ferdige 0, rank 1) = 1.
  // Samme svar begge veier: et tomt felt påstår alltid «nr. 1 av 1».
  assert.deepEqual(
    computePlacement([], { attemptId: 'x-9', correct: 7, time: 55_000, playerInPool: true }),
    { rank: 1, total: 1, low: 1, high: 1, above: null, below: null },
  )
})

test('felt med ÉN deltaker som ER spilleren: rank 1 av 1, ingen naboer', () => {
  assert.deepEqual(
    computePlacement([A], { attemptId: 'a-1', correct: 14, time: 61_000, playerInPool: true }),
    { rank: 1, total: 1, low: 1, high: 1, above: null, below: null },
  )
})

test('felt med ÉN deltaker som IKKE er spilleren: spilleren estimeres inn, total blir 2', () => {
  // Dårligere enn den ene → nr. 2 av 2, den ene som `above`.
  assert.deepEqual(
    computePlacement([A], { attemptId: 'x-9', correct: 9, time: 83_000, playerInPool: false }),
    { rank: 2, total: 2, low: 1, high: 2, above: { name: 'Astrid', correct: 14 }, below: null },
  )
  // Bedre enn den ene → nr. 1 av 2, den ene som `below`.
  assert.deepEqual(
    computePlacement([A], { attemptId: 'x-9', correct: 15, time: 50_000, playerInPool: false }),
    { rank: 1, total: 2, low: 1, high: 2, above: null, below: { name: 'Astrid', correct: 14 } },
  )
})

test('spilleren finnes i feltet: rank leses fra EGEN rad, ikke beregnet på nytt', () => {
  // B står med rank 2 i snapshoten. Svaret skal komme fra self.rank —
  // muteres grenen til å hardkode 1, ryker denne.
  assert.deepEqual(
    computePlacement([A, B], { attemptId: 'b-2', correct: 12, time: 72_000, playerInPool: true }),
    { rank: 2, total: 2, low: 1, high: 2, above: { name: 'Astrid', correct: 14 }, below: null },
  )
})

test('egen rad trukket UT av feltet først (publicSnapshot-mønsteret): total teller ikke spilleren', () => {
  // Feltet var A, B, C der B er spilleren. Kalleren har fjernet B og
  // re-ranket resten posisjonelt (A=1, C=2) — slik blocked-flyten i
  // lib/public-snapshot.ts gjør — og sender B sine egne tall inn.
  // self finnes ikke → estimat-grenen, selv med playerInPool: true.
  // MERK: total blir 2, IKKE 3 — spilleren telles ikke med i «av N» når
  // raden er trukket ut og playerInPool står true (total = max(ferdige, rank)).
  const publicSnapshot = [
    entry('a-1', 'Astrid', 1, 14, 61_000),
    entry('c-3', 'Carina', 2, 9, 83_000),
  ]
  assert.deepEqual(
    computePlacement(publicSnapshot, { attemptId: 'b-2', correct: 12, time: 72_000, playerInPool: true }),
    { rank: 2, total: 2, low: 1, high: 2, above: { name: 'Astrid', correct: 14 }, below: { name: 'Carina', correct: 9 } },
  )
})

test('tiebreak: lik correct avgjøres av tid — kun når spillerens tid > 0', () => {
  // D deler correct med spillerens 12 (bevisst brudd på distinkt-regelen for å
  // isolere tid-feltet), men er tregere → spilleren foran.
  const D = entry('d-4', 'Dagny', 2, 12, 90_000)
  assert.deepEqual(
    computePlacement([A, D], { attemptId: 'x-9', correct: 12, time: 72_000, playerInPool: false }),
    { rank: 2, total: 3, low: 1, high: 3, above: { name: 'Astrid', correct: 14 }, below: { name: 'Dagny', correct: 12 } },
  )
  // time = 0 skrur tid-tiebreaket av: D verken bedre eller dårligere —
  // spilleren får samme rank, men D forsvinner fra above/below-naboskapet.
  assert.deepEqual(
    computePlacement([A, D], { attemptId: 'x-9', correct: 12, time: 0, playerInPool: false }),
    { rank: 2, total: 3, low: 1, high: 3, above: { name: 'Astrid', correct: 14 }, below: null },
  )
})

test('ren funksjon: muterer ikke feltet, deterministisk, synkron', () => {
  const snapshot = [A, B, C].map(e => Object.freeze({ ...e }))
  Object.freeze(snapshot)
  const opts = { attemptId: 'b-2', correct: 12, time: 72_000, playerInPool: true }
  // Frosne inputs: et muterende kall ville kastet TypeError her.
  const first = computePlacement(snapshot, opts)
  const second = computePlacement(snapshot, opts)
  assert.deepEqual(first, second)
  // Ingen I/O: returverdien er et objekt, ikke et Promise.
  assert.equal(typeof (first as { then?: unknown }).then, 'undefined')
})
