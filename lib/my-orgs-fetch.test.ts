// Kjøres med:  npm test
//
// Låser koblingen mellom /api/org/my-orgs sine statuskoder og context-state.
// Ruten svarer 401 ved ugyldig/manglende token og 500 ved oppslagsfeil — hele
// poenget med den endringen forsvinner hvis klienten oversetter dem tilbake til
// en tom liste, slik det gamle `r.ok ? r.json() : { orgs: [] }` gjorde.
//
// MUTASJONSBEVIS (verifisert manuelt):
//   * Byttes fetchResult ut med `res.ok ? … : { ok: true, value: [] }` (den
//     gamle oppførselen), feiler alle tre feiltestene — de gir da ok:true med
//     tom liste, altså nøyaktig påstanden «du er ikke medlem noe sted».
//   * Fjernes `?? []`-fallbacken, feiler «200 uten orgs-nøkkel».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchMyOrgsResult } from './my-orgs-fetch'

type Org = { orgSlug: string }

function response(ok: boolean, json: unknown) {
  return async () => ({ ok, json: async () => json })
}

test('200 med orgs → bekreftet liste', async () => {
  const r = await fetchMyOrgsResult<Org>(response(true, { orgs: [{ orgSlug: 'elkjop' }] }))
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.value, [{ orgSlug: 'elkjop' }])
})

test('200 med tom liste → bekreftet TOM (en bruker kan reelt være uten bedrift)', async () => {
  const r = await fetchMyOrgsResult<Org>(response(true, { orgs: [] }))
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.value, [])
})

test('200 uten orgs-nøkkel → bekreftet tom, ikke krasj', async () => {
  const r = await fetchMyOrgsResult<Org>(response(true, {}))
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.value, [])
})

test('401 (ugyldig/manglende token) → vet ikke, ALDRI tom liste', async () => {
  const r = await fetchMyOrgsResult<Org>(response(false, { error: 'unauthenticated' }))
  assert.equal(r.ok, false)
})

test('500 (oppslagsfeil) → vet ikke, ALDRI tom liste', async () => {
  const r = await fetchMyOrgsResult<Org>(response(false, { error: 'lookup_failed' }))
  assert.equal(r.ok, false)
})

test('nettverksfeil (fetch kaster) → vet ikke, ALDRI tom liste', async () => {
  const r = await fetchMyOrgsResult<Org>(async () => { throw new Error('offline') })
  assert.equal(r.ok, false)
})

test('ugyldig JSON i et 200-svar → vet ikke, ikke en halvveis lest verdi', async () => {
  const r = await fetchMyOrgsResult<Org>(async () => ({
    ok: true,
    json: async () => { throw new SyntaxError('Unexpected token') },
  }))
  assert.equal(r.ok, false)
})
