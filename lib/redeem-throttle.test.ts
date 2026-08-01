// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideRedeemThrottle,
  ipScopeId,
  REDEEM_MISS_LIMIT_IP,
  REDEEM_MISS_LIMIT_USER,
} from './redeem-throttle'

// ── Beslutningen ────────────────────────────────────────────────────────────

test('under begge grensene slipper gjennom', () => {
  const d = decideRedeemThrottle({
    userMisses: REDEEM_MISS_LIMIT_USER - 1,
    ipMisses: REDEEM_MISS_LIMIT_IP - 1,
  })
  assert.equal(d.allowed, true)
})

test('grensen er inklusiv — nøyaktig N bom stopper forsøk N+1', () => {
  // Er dette en `>` i stedet for `>=`, får man ett gratis forsøk ekstra på
  // begge dimensjonene. Testen finnes for å låse akkurat den off-by-one.
  const atUser = decideRedeemThrottle({ userMisses: REDEEM_MISS_LIMIT_USER, ipMisses: 0 })
  assert.equal(atUser.allowed, false)

  const atIp = decideRedeemThrottle({ userMisses: 0, ipMisses: REDEEM_MISS_LIMIT_IP })
  assert.equal(atIp.allowed, false)
})

test('konto-grensen navngis før IP-grensen når begge er nådd', () => {
  // Meldingen skal peke på det brukeren selv kan gjøre noe med.
  const d = decideRedeemThrottle({
    userMisses: REDEEM_MISS_LIMIT_USER,
    ipMisses: REDEEM_MISS_LIMIT_IP,
  })
  assert.equal(d.allowed, false)
  assert.equal(d.allowed === false && d.scope, 'user')
})

test('IP-grensen har sin egen melding — brukeren skal skjønne at det ikke er dem', () => {
  const d = decideRedeemThrottle({ userMisses: 0, ipMisses: REDEEM_MISS_LIMIT_IP })
  assert.equal(d.allowed === false && d.scope, 'ip')
  assert.match(d.allowed === false ? d.message : '', /nettverket/i)
})

test('IP-grensen er romsligere enn konto-grensen', () => {
  // Flere ekte brukere kan dele utgående IP (mobilnett, kontornett). Blir denne
  // strammere enn konto-grensen, rammer bremsen delte nett først — stikk motsatt
  // av hensikten.
  assert.ok(REDEEM_MISS_LIMIT_IP > REDEEM_MISS_LIMIT_USER)
})

// ── IP-bøtta ────────────────────────────────────────────────────────────────

test('samme IP gir alltid samme bøtte', () => {
  assert.equal(ipScopeId('203.0.113.5'), ipScopeId('203.0.113.5'))
})

test('ulike IP-er gir ulike bøtter', () => {
  assert.notEqual(ipScopeId('203.0.113.5'), ipScopeId('203.0.113.6'))
})

test('kun første hopp i x-forwarded-for teller', () => {
  // Kjeden bak klienten skifter med rutingen. Tok vi hele strengen, ville samme
  // klient fått nye bøtter — og grensen kunne omgås ved å legge på et hopp.
  const direct = ipScopeId('203.0.113.5')
  assert.equal(ipScopeId('203.0.113.5, 10.0.0.1'), direct)
  assert.equal(ipScopeId('203.0.113.5, 10.0.0.1, 10.0.0.2'), direct)
  assert.equal(ipScopeId('  203.0.113.5  '), direct)
})

test('bøtta er en gyldig uuid — admin_actions.scope_id er av typen uuid', () => {
  // Er formatet feil, feiler INSERT-en i prod med 22P02 og bommet blir aldri
  // bokført. Det ville gjort bremsen til ren pynt.
  assert.match(
    ipScopeId('203.0.113.5'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  )
})

test('bøtta bærer ikke IP-en videre inn i databasen', () => {
  const ip = '203.0.113.5'
  assert.ok(!ipScopeId(ip).includes('203'))
  assert.ok(!ipScopeId(ip).includes(ip.replace(/\./g, '')))
})

test('ukjent IP får sin egen bøtte i stedet for å kaste', () => {
  // x-forwarded-for mangler av og til. Da skal tellingen fortsatt virke.
  assert.match(ipScopeId(''), /^[0-9a-f-]{36}$/)
  assert.equal(ipScopeId(''), ipScopeId('   '))
})
