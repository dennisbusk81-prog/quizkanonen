import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideOrgScopeNotice } from './org-scope-notice'

// ── MUTASJONER SOM SKAL GI RØDT ─────────────────────────────────────────────
//   1. "if (!input.requestedOrg) return 'none'" → ""
//   2. "input.servedOrg === input.requestedOrg" → "input.servedOrg !== null"
//   3. "? 'colleagues' : 'degraded'" → "? 'colleagues' : 'colleagues'"
//      (dette er nøyaktig regresjonen den naive nullstillingen ville gitt)

test('nasjonal visning: ingen linje, og ingen degradering', () => {
  assert.equal(decideOrgScopeNotice({ requestedOrg: null, servedOrg: null }), 'none')
})

test('org etterspurt og servert: kollegene dine', () => {
  assert.equal(decideOrgScopeNotice({ requestedOrg: 'e1c72409', servedOrg: 'e1c72409' }), 'colleagues')
})

test('INVARIANTEN: vi lover aldri kolleger over en nasjonal liste', () => {
  // Dette er hele grunnen til at flagget ble byttet ut. Den naive fiksen —
  // «nullstill orgScopeDegraded når auth kommer seg» — ga nøyaktig denne
  // tilstanden: bedt om org, hentet uten scope, og teksten sa «Resultater
  // blant kollegene dine».
  assert.equal(decideOrgScopeNotice({ requestedOrg: 'e1c72409', servedOrg: null }), 'degraded')
})

test('en ANNEN org enn den etterspurte er også degradert', () => {
  // «Kollegene dine» er feil ord når kollegene tilhører en annen bedrift.
  assert.equal(decideOrgScopeNotice({ requestedOrg: 'e1c72409', servedOrg: 'annen-org' }), 'degraded')
})

test('«kolleger» krever at BEGGE er sanne — aldri servedOrg alene', () => {
  // Faller likhetssjekken bort til «servedOrg finnes», overlever denne likevel
  // hvis man bare tester null. Derfor en ikke-tom, ulik verdi.
  assert.notEqual(
    decideOrgScopeNotice({ requestedOrg: 'e1c72409', servedOrg: 'noe-annet' }),
    'colleagues',
  )
})

test('degradering er UMULIG uten at en org ble etterspurt', () => {
  // Gaten som gjør at nasjonal visning ikke kan vise en feilmelding.
  for (const servedOrg of [null, 'e1c72409']) {
    assert.equal(decideOrgScopeNotice({ requestedOrg: null, servedOrg }), 'none', `servedOrg=${servedOrg}`)
  }
})

test('klebrighet er ikke lenger en tilstand som kan drive', () => {
  // Poenget med utledningen: samme inndata gir samme svar, uansett hvor mange
  // auth-events som har passert. Det finnes ingen flagg å nullstille.
  const served = { requestedOrg: 'e1c72409', servedOrg: null }
  const first = decideOrgScopeNotice(served)
  for (let i = 0; i < 5; i++) assert.equal(decideOrgScopeNotice(served), first)
  // Og når listen FAKTISK hentes på nytt med scope, følger teksten med.
  assert.equal(decideOrgScopeNotice({ requestedOrg: 'e1c72409', servedOrg: 'e1c72409' }), 'colleagues')
})
