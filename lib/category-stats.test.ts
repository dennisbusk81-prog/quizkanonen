// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCategoryStats, UNCATEGORIZED_LABEL } from './category-stats'

type A = { questionId: string; isCorrect: boolean }
type Q = { id: string; category: string | null }

function q(id: string, category: string | null): Q {
  return { id, category }
}

function sumTotal(stats: { total: number }[]): number {
  return stats.reduce((s, r) => s + r.total, 0)
}

// ── Invarianten (QK_4 punkt 12): summen går alltid opp ──────────────────────

test('svar uten kategori havner i «Uten kategori» — summen er antall besvarte', () => {
  const questions = [q('a', 'Historie'), q('b', 'Historie'), q('c', null), q('d', 'Sport')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: true },
    { questionId: 'd', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(sumTotal(stats), answers.length)
  const uncat = stats.find(r => r.category === UNCATEGORIZED_LABEL)
  assert.ok(uncat, 'mangler «Uten kategori»-raden')
  assert.deepEqual(uncat, { category: UNCATEGORIZED_LABEL, correct: 1, total: 1 })
})

test('whitespace-kategori og ukjent questionId regnes også som uten kategori', () => {
  const questions = [q('a', 'Sport'), q('b', '   '), q('c', '')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: false },
    { questionId: 'finnes-ikke', isCorrect: false },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(sumTotal(stats), answers.length)
  const uncat = stats.find(r => r.category === UNCATEGORIZED_LABEL)
  assert.deepEqual(uncat, { category: UNCATEGORIZED_LABEL, correct: 1, total: 3 })
})

test('«Uten kategori» står alltid nederst', () => {
  const questions = [q('u', null), q('a', 'Historie'), q('b', 'Sport')]
  // Det ukategoriserte svaret kommer FØRST — raden skal likevel sist.
  const answers: A[] = [
    { questionId: 'u', isCorrect: false },
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(stats[stats.length - 1].category, UNCATEGORIZED_LABEL)
})

// ── «Diverse» telles som vanlig kategori her ────────────────────────────────

test('«Diverse» får egen rad — ekskluderingen gjelder kun mellomskjerm-meldingen', () => {
  const questions = [q('a', 'Diverse'), q('b', 'Diverse'), q('c', 'Historie')]
  const answers: A[] = questions.map(x => ({ questionId: x.id, isCorrect: true }))
  const stats = computeCategoryStats(answers, questions)
  assert.equal(sumTotal(stats), answers.length)
  assert.deepEqual(
    stats.find(r => r.category === 'Diverse'),
    { category: 'Diverse', correct: 2, total: 2 }
  )
})

// ── Normalisering ───────────────────────────────────────────────────────────

test('trim- og case-varianter slås sammen til én rad', () => {
  const questions = [q('a', 'Historie '), q('b', 'historie'), q('c', 'Sport')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(stats.length, 2)
  const historie = stats.find(r => r.category.toLowerCase() === 'historie')
  assert.ok(historie)
  assert.equal(historie!.total, 2)
  assert.equal(historie!.correct, 1)
  assert.equal(historie!.category, historie!.category.trim())
})

test('rekkefølge: kategoriene kommer i første-svar-rekkefølge', () => {
  const questions = [q('a', 'Sport'), q('b', 'Historie'), q('c', 'Musikk')]
  const answers: A[] = [
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: true },
    { questionId: 'a', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.deepEqual(stats.map(r => r.category), ['Historie', 'Musikk', 'Sport'])
})

// ── Kanter ──────────────────────────────────────────────────────────────────

test('kun ukategoriserte svar → tom liste (seksjonen skjules)', () => {
  const questions = [q('a', null), q('b', '')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
  ]
  assert.deepEqual(computeCategoryStats(answers, questions), [])
})

test('ingen svar → tom liste', () => {
  assert.deepEqual(computeCategoryStats([], [q('a', 'Sport')]), [])
})

test('en reell kategori som heter «Uten kategori» slås sammen med restbøtta', () => {
  const questions = [q('a', 'Uten kategori'), q('b', null), q('c', 'Sport')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(sumTotal(stats), answers.length)
  const rows = stats.filter(r => r.category.toLowerCase() === 'uten kategori')
  assert.equal(rows.length, 1, 'to «Uten kategori»-rader')
  assert.equal(rows[0].total, 2)
  assert.equal(rows[0].correct, 1)
})
