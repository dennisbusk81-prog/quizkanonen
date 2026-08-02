// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ORG_TRIAL_CODE_MISS_LIMIT_IP,
  decideOrgTrialCodeThrottle,
} from './org-trial-code-throttle'

test('under grensen slipper gjennom', () => {
  assert.equal(decideOrgTrialCodeThrottle(ORG_TRIAL_CODE_MISS_LIMIT_IP - 1).allowed, true)
})

test('grensen er inklusiv — nøyaktig N bom stopper forsøk N+1', () => {
  assert.equal(decideOrgTrialCodeThrottle(ORG_TRIAL_CODE_MISS_LIMIT_IP).allowed, false)
})

test('meldingen peker på nettverket', () => {
  const d = decideOrgTrialCodeThrottle(ORG_TRIAL_CODE_MISS_LIMIT_IP)
  assert.match(d.allowed === false ? d.message : '', /nettverket/i)
})

test('grensen er høy nok til at en ekte kunde ikke låses ute av skrivefeil', () => {
  // En bedrift som har fått koden på e-post og skriver den feil noen ganger
  // skal aldri treffe dette taket.
  assert.ok(ORG_TRIAL_CODE_MISS_LIMIT_IP >= 10)
})
