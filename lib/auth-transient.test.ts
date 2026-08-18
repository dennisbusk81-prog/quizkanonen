// Kjøres med:  npm test
//
// lib/auth-transient.ts skiller «GoTrue er nede» fra «tokenet er ugyldig».
// Grensene er ikke valgt fritt — de speiler faktisk oppførsel i
// @supabase/auth-js (se kildehenvisningen i lib/auth-transient.ts):
// nettverksfeil får status 0, gateway-feil 502–530 beholder sin status,
// og et ugyldig JWT svarer 401/403.
//
// MUTASJONSBEVIS
//   • Fjern `status === 0` → «ren nettverksfeil er transient» ryker.
//   • Fjern `status === 429` → «GoTrue-429 er transient» ryker.
//   • Endre `>= 500` til `> 500` → «500 er transient» ryker (500 er nettopp
//     en av statusene auth-js selv IKKE regner som retryable — se
//     middleware-vakten — men som for oss betyr «prøv igjen», ikke
//     «ugyldig token»).
//   • Endre `typeof status !== 'number'` til å returnere true → «ukjent
//     feilform behandles som i dag» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isTransientAuthStatus } from './auth-transient'

test('ren nettverksfeil (status 0) er transient', () => {
  assert.equal(isTransientAuthStatus(0), true)
})

test('GoTrue-429 er transient — sier ingenting om tokenets gyldighet', () => {
  assert.equal(isTransientAuthStatus(429), true)
})

test('500 er transient', () => {
  assert.equal(isTransientAuthStatus(500), true)
})

test('gateway-statusene 502–530 er transiente', () => {
  for (const s of [502, 503, 504, 520, 521, 522, 523, 524, 530]) {
    assert.equal(isTransientAuthStatus(s), true, `status ${s}`)
  }
})

test('ugyldig/utløpt token (401/403) er IKKE transient — skal gi anon-behandling som før', () => {
  assert.equal(isTransientAuthStatus(401), false)
  assert.equal(isTransientAuthStatus(403), false)
})

test('øvrige 4xx er IKKE transiente', () => {
  for (const s of [400, 404, 422]) {
    assert.equal(isTransientAuthStatus(s), false, `status ${s}`)
  }
})

test('ukjent feilform (uten status) behandles som i dag — ikke transient', () => {
  assert.equal(isTransientAuthStatus(undefined), false)
  assert.equal(isTransientAuthStatus(null), false)
})
