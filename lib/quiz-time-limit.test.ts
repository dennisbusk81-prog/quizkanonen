// Kjøres med:  npm test
//
// describeQuestionTimeLimit — tallet i «Xs per spørsmål» på startskjermen
// (app/quiz/[id]/page.tsx) og i quiz-lista (app/quizer/page.tsx).
//
// HVA TESTENE VOKTER: at teksten utleder grensen fra SPØRSMÅLENE, med
// quiz-raden kun som fallback — samme prioritering som `getTimeLimit` i
// app/quiz/[id]/page.tsx bruker under faktisk spilling. Fram til 7. august
// 2026 skrev flatene `quizzes.time_limit_seconds` rett ut, og Fredagsquiz
// 19.06.2026 i prod (quiz=10, alle 15 spørsmål=15) beviste at de to nivåene
// kan divergere: teksten lovet 10 sekunder på en quiz som ble spilt med 15.
//
// MUTASJONER testene feller:
//   • Bytt prioriteringen (quiz-nivå vinner over spørsmål-nivå) → «prod-tilfellet»
//   • Fjern intervall-grenen og vis f.eks. første/vanligste verdi → «sprik»-testene
//   • La tom liste gi null i stedet for quiz-nivået → «ingen spørsmål»-testen
//   • La 0/negativ slippe gjennom som gyldig grense → «0 er ikke en grense»
//   • Returner '' i stedet for null når ingenting er kjent → «ingenting å påstå»

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeQuestionTimeLimit, DEFAULT_QUESTION_TIME_LIMIT_SECONDS } from './quiz-time-limit'

test('alle spørsmål like — viser det ene tallet', () => {
  assert.equal(describeQuestionTimeLimit([15, 15, 15], 15), '15s')
})

test('PROD-TILFELLET: spørsmål-nivået vinner over quiz-raden', () => {
  // Fredagsquiz 19.06.2026: quizzes.time_limit_seconds = 10, alle 15 spørsmål = 15.
  // Spilleren møtte 15 sekunder. Teksten sa 10. Den skal nå si 15.
  const limits = Array(15).fill(15)
  assert.equal(describeQuestionTimeLimit(limits, 10), '15s')
})

test('spørsmål uten egen grense arver quiz-raden', () => {
  assert.equal(describeQuestionTimeLimit([null, null, null], 20), '20s')
})

test('blandet: noen arver, resten har samme egne grense → fortsatt ett tall', () => {
  assert.equal(describeQuestionTimeLimit([null, 20, null, 20], 20), '20s')
})

test('SPRIK mellom spørsmål vises som intervall, ikke som ett tall', () => {
  assert.equal(describeQuestionTimeLimit([10, 20, 15], 15), '10–20s')
})

test('SPRIK oppstår også når arvede og egne grenser er ulike', () => {
  // To spørsmål arver quiz-nivået 15, ett har satt 30 selv.
  assert.equal(describeQuestionTimeLimit([null, null, 30], 15), '15–30s')
})

test('intervallet bruker tankestrek, ikke bindestrek', () => {
  // Typografisk detalj, men den er lett å miste i en refaktor.
  const label = describeQuestionTimeLimit([5, 60], 15)
  assert.equal(label, '5–60s')
  assert.ok(label!.includes('–'), 'skal bruke – (U+2013), ikke -')
})

test('ingen spørsmål lastet ennå → faller tilbake på quiz-raden', () => {
  // Startskjermen rendres før spørsmålsdataene har landet. Da skal teksten vise
  // det gamle, kjente tallet — ikke forsvinne og dukke opp igjen.
  assert.equal(describeQuestionTimeLimit([], 15), '15s')
})

test('ingenting å påstå → null, slik at kalleren kan utelate teksten', () => {
  assert.equal(describeQuestionTimeLimit([], null), null)
  assert.equal(describeQuestionTimeLimit([null, null], null), null)
  assert.equal(describeQuestionTimeLimit([], undefined), null)
})

test('0 er ikke en tidsgrense — verken på spørsmål eller quiz', () => {
  // `getTimeLimit` sin ||-kjede hopper over 0. Slapp 0 gjennom her, ville
  // teksten lovet «0s per spørsmål» på en quiz som spilles med quiz-grensen.
  assert.equal(describeQuestionTimeLimit([0, 0], 15), '15s')
  assert.equal(describeQuestionTimeLimit([15, 15], 0), '15s')
  assert.equal(describeQuestionTimeLimit([0], 0), null)
})

test('negative og ikke-endelige tall behandles som ikke satt', () => {
  assert.equal(describeQuestionTimeLimit([-5], 15), '15s')
  assert.equal(describeQuestionTimeLimit([NaN, 15], 15), '15s')
})

test('defaultkonstanten er uendret — teksten skal ikke drive den', () => {
  // Denne filen leser konstanten; den skal ikke kunne endres som en bieffekt
  // av en tekstfiks. 15 er verdien satt 31. juli 2026.
  assert.equal(DEFAULT_QUESTION_TIME_LIMIT_SECONDS, 15)
})
