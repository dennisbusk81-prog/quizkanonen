// Kjøres med:  npm test
//
// Ren logikk — planmodellen, medlemsgrensene og beslutningen om planbytte.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ORG_PLANS,
  getMemberLimit,
  checkMemberCapacity,
  decidePlanChange,
} from '@/lib/org-plan'

// ── Grensene ────────────────────────────────────────────────────────────────

test('grensene matcher det som selges på /bedrift', () => {
  assert.equal(ORG_PLANS.starter.memberLimit, 25)
  assert.equal(ORG_PLANS.standard.memberLimit, 50)
  assert.equal(ORG_PLANS.pro.memberLimit, null, 'Pro selges som uten øvre grense')
  assert.equal(ORG_PLANS.enterprise.memberLimit, null)
})

test('kun Starter og Standard kan byttes til selvbetjent', () => {
  assert.equal(ORG_PLANS.starter.selfServe, true)
  assert.equal(ORG_PLANS.standard.selfServe, true)
  assert.equal(ORG_PLANS.pro.selfServe, false)
  assert.equal(ORG_PLANS.enterprise.selfServe, false)
})

test('ukjent plan gir ingen grense — en org vi ikke kjenner igjen sperres ikke ute', () => {
  assert.equal(getMemberLimit('gullpakke'), null)
  assert.equal(getMemberLimit(null), null)
  assert.equal(getMemberLimit(undefined), null)
  assert.equal(checkMemberCapacity('gullpakke', 9999).ok, true)
})

// ── Kapasitet ───────────────────────────────────────────────────────────────

test('under grensen er det plass', () => {
  const res = checkMemberCapacity('starter', 24)
  assert.equal(res.ok, true)
  assert.equal(res.ok && res.remaining, 1)
})

test('PÅ grensen er det IKKE plass til flere', () => {
  const res = checkMemberCapacity('starter', 25)
  assert.equal(res.ok, false)
  assert.match(res.ok === false ? res.error : '', /Starter rommer 25/)
})

test('over grensen: eksisterende medlemmer beholdes, men ingen nye slipper inn', () => {
  // Grandfathering — en org som vokste seg over grensen før håndhevingen fantes
  // skal ikke miste noen, kun stoppes fra å ta inn flere.
  const res = checkMemberCapacity('starter', 40)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.memberCount, 40)
  assert.equal(res.ok === false && res.limit, 25)
})

test('Pro har plass uansett', () => {
  assert.equal(checkMemberCapacity('pro', 5000).ok, true)
})

// ── Planbytte ───────────────────────────────────────────────────────────────

test('oppgradering går alltid gjennom', () => {
  const res = decidePlanChange('starter', 'standard', 25)
  assert.equal(res.ok, true)
  assert.equal(res.ok && res.direction, 'up')
})

test('nedgradering går gjennom når medlemstallet er innenfor', () => {
  const res = decidePlanChange('standard', 'starter', 20)
  assert.equal(res.ok, true)
  assert.equal(res.ok && res.direction, 'down')
})

test('nedgradering blokkeres når medlemstallet overstiger den nye grensen', () => {
  const res = decidePlanChange('standard', 'starter', 40)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, 'limit_exceeded')
  // Meldingen må si nøyaktig hvor mange som må fjernes — ellers må admin regne selv.
  assert.match(res.ok === false ? res.error : '', /40 medlemmer/)
  assert.match(res.ok === false ? res.error : '', /rommer 25/)
  assert.match(res.ok === false ? res.error : '', /Fjern 15 medlemmer/)
})

test('nedgradering til NØYAKTIG medlemstallet er lov — grensen er inklusiv', () => {
  const res = decidePlanChange('standard', 'starter', 25)
  assert.equal(res.ok, true, '25 medlemmer får plass i en plan som rommer 25')
})

test('entall i meldingen når kun én må fjernes', () => {
  const res = decidePlanChange('standard', 'starter', 26)
  assert.match(res.ok === false ? res.error : '', /Fjern 1 medlem f/)
})

test('bytte til samme plan avvises', () => {
  const res = decidePlanChange('standard', 'standard', 10)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, 'same_plan')
})

test('ukjent målplan avvises', () => {
  for (const bad of ['gratis', '', null, 42, undefined]) {
    const res = decidePlanChange('standard', bad, 10)
    assert.equal(res.ok, false, `skulle avvist ${JSON.stringify(bad)}`)
    assert.equal(res.ok === false && res.code, 'unknown_plan')
  }
})

test('org uten kjent plan kan ikke bytte selv — sendes til support', () => {
  const res = decidePlanChange(null, 'standard', 10)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.code, 'unknown_plan')
})

test('oppgradering til Pro er lov når medlemstallet overstiger Standard', () => {
  const res = decidePlanChange('standard', 'pro', 200)
  assert.equal(res.ok, true, 'Pro har ingen grense')
})
