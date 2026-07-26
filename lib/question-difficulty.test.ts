// Kjøres med:  npm test
//
// Vokter to ting: at count=1 er bit-for-bit identisk med den opprinnelige
// admin-logikken (én kopi flyttet hit, IKKE en ny beregning — se
// lib/question-difficulty.ts), og at count=2 (den nye Premium-visningen i
// leaderboard/[id]) aldri lar samme spørsmål opptre som både lettest og
// vanskeligst.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectEasiestAndHardest, type QuestionDifficulty } from '@/lib/question-difficulty'

const q = (id: string, pct: number, total = 10): QuestionDifficulty => ({
  question_id: id, order_index: Number(id), question_text: `Spørsmål ${id}`,
  total, correct: Math.round(total * pct / 100), correct_pct: pct,
})

test('count=1: identisk med den opprinnelige admin-logikken — 15 spørsmål', () => {
  const stats = [q('1', 90), q('2', 40), q('3', 10), q('4', 60), q('5', 100),
    q('6', 20), q('7', 70), q('8', 30), q('9', 80), q('10', 50),
    q('11', 5), q('12', 95), q('13', 45), q('14', 65), q('15', 15)]
  const { easiest, hardest } = selectEasiestAndHardest(stats, 1)
  assert.equal(easiest.length, 1)
  assert.equal(hardest.length, 1)
  assert.equal(easiest[0].question_id, '5')  // 100%
  assert.equal(hardest[0].question_id, '11') // 5%
})

test('count=1: kun 1 kvalifisert spørsmål — hardest tom, ikke null-krasj', () => {
  const { easiest, hardest } = selectEasiestAndHardest([q('1', 80)], 1)
  assert.equal(easiest.length, 1)
  assert.deepEqual(hardest, [])
})

test('count=1: 0 kvalifiserte (alle under minAnswers) — begge tomme', () => {
  const stats = [{ ...q('1', 80), total: 1 }] // under minAnswers=2
  const { easiest, hardest } = selectEasiestAndHardest(stats, 1)
  assert.deepEqual(easiest, [])
  assert.deepEqual(hardest, [])
})

test('count=1: nøyaktig 2 kvalifiserte — easiest og hardest er de to ulike', () => {
  const { easiest, hardest } = selectEasiestAndHardest([q('1', 90), q('2', 30)], 1)
  assert.equal(easiest[0].question_id, '1')
  assert.equal(hardest[0].question_id, '2')
})

test('count=2: 15 spørsmål gir topp 2 og bunn 2, ingen overlapp', () => {
  const stats = [q('1', 90), q('2', 40), q('3', 10), q('4', 60), q('5', 100),
    q('6', 20), q('7', 70), q('8', 30), q('9', 80), q('10', 50),
    q('11', 5), q('12', 95), q('13', 45), q('14', 65), q('15', 15)]
  const { easiest, hardest } = selectEasiestAndHardest(stats, 2)
  assert.deepEqual(easiest.map(q => q.question_id), ['5', '12'])   // 100%, 95%
  assert.deepEqual(hardest.map(q => q.question_id), ['11', '3'])  // 5%, 10% — verst først
  const overlap = easiest.filter(e => hardest.some(h => h.question_id === e.question_id))
  assert.deepEqual(overlap, [])
})

test('count=2: kun 3 kvalifiserte — deler uten overlapp i stedet for å gjenta', () => {
  const { easiest, hardest } = selectEasiestAndHardest([q('1', 90), q('2', 50), q('3', 10)], 2)
  assert.equal(easiest.length, 2)
  assert.equal(hardest.length, 1)
  const overlap = easiest.filter(e => hardest.some(h => h.question_id === e.question_id))
  assert.deepEqual(overlap, [], 'ingen spørsmål skal opptre i begge listene')
})

test('count=2: kvalifiserer kun spørsmål med minst minAnswers svar', () => {
  const stats = [q('1', 90, 5), { ...q('2', 100), total: 1 }, q('3', 10, 5)]
  const { easiest, hardest } = selectEasiestAndHardest(stats, 2, 2)
  const ids = [...easiest, ...hardest].map(x => x.question_id)
  assert.ok(!ids.includes('2'), 'spørsmål med kun 1 svar skal ikke kvalifisere')
})

test('vanskeligste sorteres verst-først (stigende pct), ikke i tabell-rekkefølge', () => {
  const stats = [q('1', 30, 5), q('2', 90, 5), q('3', 5, 5), q('4', 60, 5)]
  const { hardest } = selectEasiestAndHardest(stats, 2, 2)
  assert.deepEqual(hardest.map(q => q.correct_pct), [5, 30])
})
