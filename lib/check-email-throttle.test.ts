// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHECK_EMAIL_LIMIT_IP,
  decideCheckEmailThrottle,
} from './check-email-throttle'
import { REDEEM_MISS_LIMIT_IP } from './redeem-throttle'

test('under grensen slipper gjennom', () => {
  assert.equal(decideCheckEmailThrottle(CHECK_EMAIL_LIMIT_IP - 1).allowed, true)
})

test('grensen er inklusiv — nøyaktig N oppslag stopper oppslag N+1', () => {
  // Er dette en `>` i stedet for `>=`, får man ett gratis oppslag ekstra.
  assert.equal(decideCheckEmailThrottle(CHECK_EMAIL_LIMIT_IP).allowed, false)
})

test('meldingen peker på nettverket, ikke på brukeren', () => {
  // Den som treffer denne grensen er som regel én av mange bak samme IP. Da
  // skal de ikke tro at det er deres egen konto som er sperret.
  const d = decideCheckEmailThrottle(CHECK_EMAIL_LIMIT_IP)
  assert.match(d.allowed === false ? d.message : '', /nettverket/i)
})

test('grensen er romsligere enn bom-grensene i redeem', () => {
  // Her telles ALLE oppslag, ikke bare bom. En grense på redeem-nivå ville
  // rammet et kontornett eller en mobil-CGNAT-pool midt i en registreringsbølge.
  assert.ok(CHECK_EMAIL_LIMIT_IP > REDEEM_MISS_LIMIT_IP)
})

test('grensen tåler en realistisk registreringsbølge fra én IP', () => {
  // To kall per registrering (pre-signup + post-signup). Vi vil kunne ta imot
  // minst 40 registreringer fra samme utgående IP innenfor en time uten å
  // bremse noen.
  assert.ok(CHECK_EMAIL_LIMIT_IP >= 40 * 2)
})
