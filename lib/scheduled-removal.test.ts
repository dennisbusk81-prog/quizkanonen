// Kjøres med:  npm test
//
// Ren logikk — ingen mocks nødvendig. Dekker datoreglene for planlagt fjerning.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateScheduledRemovalDate,
  formatRemovalDate,
  MAX_MONTHS_AHEAD,
} from '@/lib/scheduled-removal'

const NOW = new Date('2026-07-29T14:00:00.000Z')

test('gyldig dato fram i tid lagres som UTC-midnatt', () => {
  const res = validateScheduledRemovalDate('2026-08-02', NOW)
  assert.equal(res.ok, true)
  assert.equal(res.ok && res.at, '2026-08-02T00:00:00.000Z')
})

test('i morgen er tidligste tillatte dato', () => {
  const res = validateScheduledRemovalDate('2026-07-30', NOW)
  assert.equal(res.ok, true)
})

test('i dag avvises — «Fjern nå» finnes allerede', () => {
  const res = validateScheduledRemovalDate('2026-07-29', NOW)
  assert.equal(res.ok, false)
  assert.match(res.ok === false ? res.error : '', /fram i tid/)
})

test('en dato som har passert avvises', () => {
  const res = validateScheduledRemovalDate('2026-07-28', NOW)
  assert.equal(res.ok, false)
})

test('senere samme dag teller fortsatt som «i dag» — klokkeslett skal ikke gi et smutthull', () => {
  const sentPaaDagen = new Date('2026-07-29T23:59:00.000Z')
  const res = validateScheduledRemovalDate('2026-07-29', sentPaaDagen)
  assert.equal(res.ok, false)
})

test(`maks ${MAX_MONTHS_AHEAD} måneder fram i tid`, () => {
  assert.equal(validateScheduledRemovalDate('2027-07-29', NOW).ok, true)
  const forLangt = validateScheduledRemovalDate('2027-07-30', NOW)
  assert.equal(forLangt.ok, false)
  assert.match(forLangt.ok === false ? forLangt.error : '', /12 måneder/)
})

test('datoer som ikke finnes avvises (31. februar blir ikke 3. mars)', () => {
  const res = validateScheduledRemovalDate('2027-02-31', NOW)
  assert.equal(res.ok, false)
  assert.match(res.ok === false ? res.error : '', /gyldig dato/)
})

test('søppel-input avvises uten å kaste', () => {
  for (const bad of [null, undefined, 42, '', '2. august', '02-08-2026', {}, '2026-8-2']) {
    const res = validateScheduledRemovalDate(bad, NOW)
    assert.equal(res.ok, false, `skulle avvist ${JSON.stringify(bad)}`)
  }
})

test('formatRemovalDate leser datoen i UTC — ikke i serverens lokale sone', () => {
  // Uten timeZone:'UTC' ville 2026-08-02T00:00:00Z blitt «1. august» for enhver
  // server vest for Greenwich, og modalen ville lovet feil dag.
  assert.equal(formatRemovalDate('2026-08-02T00:00:00.000Z'), '2. august 2026')
})
