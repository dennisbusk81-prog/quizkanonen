// Kjøres med:  npm test
//
// Fristene i nådevinduet er tre tall i tre ulike kodestier (questions-ruten,
// submit-ruten, publish-quiz-cronen). Ingen av rutene kan selv oppdage at
// rekkefølgen deres er brutt — konsekvensen er en spiller som får servert et
// spørsmål hun ikke får levert, eller en levering som aldri får sesongpoeng.
// Denne testen feller enhver framtidig justering som bryter rekkefølgen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUESTIONS_GRACE_MS,
  SUBMIT_GRACE_MS,
  RESETTLE_SCAN_MS,
  isWithinGrace,
  attemptStartedBeforeClose,
} from './late-play-window'

test('invarianten QUESTIONS < SUBMIT <= SCAN holder', () => {
  assert.ok(
    QUESTIONS_GRACE_MS < SUBMIT_GRACE_MS,
    'questions-vinduet må slutte FØR submit-vinduet — ellers serveres spørsmål som ikke kan leveres',
  )
  assert.ok(
    SUBMIT_GRACE_MS <= RESETTLE_SCAN_MS,
    'skannevinduet må dekke submit-vinduet — ellers får en akseptert levering aldri sesongpoeng',
  )
})

test('produktvalget 24. august 2026: 5 / 7 / 10 minutter', () => {
  assert.equal(QUESTIONS_GRACE_MS, 5 * 60_000)
  assert.equal(SUBMIT_GRACE_MS, 7 * 60_000)
  assert.equal(RESETTLE_SCAN_MS, 10 * 60_000)
})

test('isWithinGrace: åpen quiz er ikke i noe vindu, grensene er inklusive/eksklusive riktig vei', () => {
  const closes = 1_000_000
  const grace = 5 * 60_000
  assert.equal(isWithinGrace(closes, closes - 1, grace), false, 'før stengetid er quizen ÅPEN, ikke i vindu')
  assert.equal(isWithinGrace(closes, closes, grace), false, 'nøyaktig closes_at er fortsatt åpen (rutene bruker now > closesAt)')
  assert.equal(isWithinGrace(closes, closes + 1, grace), true)
  assert.equal(isWithinGrace(closes, closes + grace, grace), true, 'vinduets siste millisekund er innenfor')
  assert.equal(isWithinGrace(closes, closes + grace + 1, grace), false)
  assert.equal(isWithinGrace(null, 123, grace), false, 'quiz uten stengetid har ikke noe vindu')
})

test('attemptStartedBeforeClose: grensen er inklusiv på closes_at', () => {
  const closes = Date.parse('2026-08-28T20:00:00.000Z')
  assert.equal(attemptStartedBeforeClose('2026-08-28T19:59:59.000Z', closes), true)
  assert.equal(attemptStartedBeforeClose('2026-08-28T20:00:00.000Z', closes), true)
  assert.equal(attemptStartedBeforeClose('2026-08-28T20:00:01.000Z', closes), false)
})
