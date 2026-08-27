// Kjøres med:  npm test
//
// ENHETSTEST av lib/archive-source-quiz.ts — beslutningen om hvorvidt en
// arkivkopi i det hele tatt HAR et frosset felt å måles mot.
//
// FIXTURE-REGELEN er fulgt: hver forelder har distinkt id, og testene som
// hviler på quiz_type/is_test har distinkte verdier i BEGGE feltene, så et
// ledd som leser feil felt ikke kan se riktig ut.
//
// MUTASJONSBEVIS (alle kjørt 27. august 2026 og revertert). Kjørt mot denne
// filen + lib/arkiv-create-route.test.ts (41 tester til sammen), fordi
// koblingen bare er verdt noe hvis den også skrives av ruten:
//   • fjern `if (!erEkteQuiz(quiz)) return null`                     (2 røde)
//       → testquiz og quiz_type='archive' ga plutselig en kobling
//   • bytt `else if (shared !== id) return null` → `else if (false)` (4 røde)
//       → generert quiz fikk id-en til det FØRSTE spørsmålet som kobling
//   • slå av dekningskravet (`parentQuestionCount !== rows.length`)  (3 røde)
//       → delvis kopi (2 av 15) ga kobling, både i enhetstesten og i ruten
//
// ÆRLIG UNNTAK: `if (input.parentQuestionCount === null) return null` er IKKE
// felt av noen test, og skal ikke påstås felt. Linja er REDUNDANT med
// dekningskravet rett under (`null !== rows.length` er alltid sant), altså en
// semantisk ekvivalent mutasjon. Den står igjen fordi den uttrykker en annen
// INTENSJON — «vet ikke er ikke en kobling» — som ellers ville blitt en
// tilfeldig konsekvens av en ulikhetssjekk noen kunne skrevet om.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveArchiveSourceQuizId,
  singleSourceParentId,
  type ArchiveSourceRow,
} from './archive-source-quiz'

const QUIZ_47 = 'quiz-47'
const QUIZ_48 = 'quiz-48'

/** Ekte forelder: weekly, ikke test. */
function ekte(id: string): ArchiveSourceRow {
  return { quiz: { id, is_test: false, quiz_type: 'weekly' } }
}

// ── singleSourceParentId ───────────────────────────────────────────────────

test('tom liste har ingen forelder', () => {
  assert.equal(singleSourceParentId([]), null)
})

test('alle spørsmål fra samme ekte quiz → forelderens id', () => {
  assert.equal(singleSourceParentId([ekte(QUIZ_47), ekte(QUIZ_47), ekte(QUIZ_47)]), QUIZ_47)
})

test('to ulike foreldre (generert quiz) → ingen kobling', () => {
  assert.equal(singleSourceParentId([ekte(QUIZ_47), ekte(QUIZ_48)]), null)
})

test('manglende forelder-rad → ingen kobling', () => {
  assert.equal(singleSourceParentId([ekte(QUIZ_47), { quiz: null }]), null)
})

test('forelder uten id → ingen kobling', () => {
  assert.equal(
    singleSourceParentId([{ quiz: { id: null, is_test: false, quiz_type: 'weekly' } }]),
    null
  )
})

test('forelder er testquiz (is_test) → ingen kobling, selv med lovlig quiz_type', () => {
  assert.equal(
    singleSourceParentId([{ quiz: { id: QUIZ_47, is_test: true, quiz_type: 'weekly' } }]),
    null
  )
})

test('forelder har ikke-ekte quiz_type → ingen kobling, selv med is_test false', () => {
  // Arkiv av et arkiv, og en framtidig ukjent type. Hvitelisten i
  // lib/real-quiz-population.ts er kilden — ikke en egen regel her.
  for (const type of ['archive', 'test', 'christmas']) {
    assert.equal(
      singleSourceParentId([{ quiz: { id: QUIZ_47, is_test: false, quiz_type: type } }]),
      null,
      `quiz_type='${type}' skal ikke gi kobling`
    )
  }
})

test('bonus teller som ekte forelder (hvitelisten, ikke bare weekly)', () => {
  assert.equal(
    singleSourceParentId([{ quiz: { id: QUIZ_48, is_test: false, quiz_type: 'bonus' } }]),
    QUIZ_48
  )
})

// ── deriveArchiveSourceQuizId — dekningskravet ─────────────────────────────

test('FULL reprise (like mange spørsmål som forelderen) → kobling', () => {
  assert.equal(
    deriveArchiveSourceQuizId({
      rows: [ekte(QUIZ_47), ekte(QUIZ_47), ekte(QUIZ_47)],
      parentQuestionCount: 3,
    }),
    QUIZ_47
  )
})

test('DELVIS kopi (5 av 15) → ingen kobling — feltets tall gjelder 15 spørsmål', () => {
  assert.equal(
    deriveArchiveSourceQuizId({
      rows: Array.from({ length: 5 }, () => ekte(QUIZ_47)),
      parentQuestionCount: 15,
    }),
    null
  )
})

test('flere spørsmål enn forelderen har → ingen kobling', () => {
  assert.equal(
    deriveArchiveSourceQuizId({
      rows: [ekte(QUIZ_47), ekte(QUIZ_47), ekte(QUIZ_47)],
      parentQuestionCount: 2,
    }),
    null
  )
})

test('tellingen feilet (null) → ingen kobling, ikke en gjetning', () => {
  assert.equal(
    deriveArchiveSourceQuizId({
      rows: [ekte(QUIZ_47), ekte(QUIZ_47)],
      parentQuestionCount: null,
    }),
    null
  )
})

test('ingen felles forelder → ingen kobling uansett hva tellingen sier', () => {
  assert.equal(
    deriveArchiveSourceQuizId({
      rows: [ekte(QUIZ_47), ekte(QUIZ_48)],
      parentQuestionCount: 2,
    }),
    null
  )
})
