// Kjøres med:  npm test
//
// ENHETSTEST av lib/archive-create-rules.ts — ren logikk, ingen mocks.
//
// FIXTURE-REGELEN er fulgt med vilje: hver rad har DISTINKTE verdier i id,
// closes_at og is_test der testen hviler på ett av feltene — et filter på
// feil felt skal ikke kunne se riktig ut fordi to felter deler verdi.
//
// MUTASJONSBEVIS (kjørt 26. august 2026, alle revertert):
//   • decideArchiveCreateQuota: `>=` → `>`             → «nøyaktig taket»-testen rød
//   • decideArchiveSourceEligibility: `is_test !== false` → `is_test === true`
//                                                      → is_test=NULL-testen rød
//   • decideArchiveSourceEligibility: `closedAtMs > now` uten Number.isFinite
//     (rå dato-sammenligning)                          → uparsbar-dato-testen rød
//   • fjern `!row.quiz`-grenen                         → quiz-løs-testen rød (kast/feil)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ARCHIVE_CREATE_MAX_PER_DAY,
  decideArchiveCreateQuota,
  decideArchiveSourceEligibility,
} from '@/lib/archive-create-rules'

// Fast klokke — hardkodede datoer i tester skal sammenlignes mot en fast
// `now`, aldri mot maskinklokka (se memory/feedback-hardcoded-future-dates).
const NOW = new Date('2026-08-26T20:00:00Z')

const Q1 = '11111111-aaaa-4aaa-8aaa-111111111111'
const Q2 = '22222222-bbbb-4bbb-8bbb-222222222222'

// ── Kvoten ──────────────────────────────────────────────────────────────────

test('kvote: under taket er tillatt, med riktig rest', () => {
  const decision = decideArchiveCreateQuota({ createdLastDay: 3 })
  assert.deepEqual(decision, { allowed: true, remaining: ARCHIVE_CREATE_MAX_PER_DAY - 3 })
})

test('kvote: nøyaktig taket avvises (grensen er >=, ikke >)', () => {
  const decision = decideArchiveCreateQuota({ createdLastDay: ARCHIVE_CREATE_MAX_PER_DAY })
  assert.equal(decision.allowed, false)
})

test('kvote: over taket avvises', () => {
  const decision = decideArchiveCreateQuota({ createdLastDay: ARCHIVE_CREATE_MAX_PER_DAY + 5 })
  assert.equal(decision.allowed, false)
})

test('kvote: null brukt gir full rest', () => {
  const decision = decideArchiveCreateQuota({ createdLastDay: 0 })
  assert.deepEqual(decision, { allowed: true, remaining: ARCHIVE_CREATE_MAX_PER_DAY })
})

// ── Kildegaten ──────────────────────────────────────────────────────────────

test('kildegate: stengte, ekte quizer slipper gjennom', () => {
  const decision = decideArchiveSourceEligibility(
    [
      { id: Q1, quiz: { closes_at: '2026-08-14T20:00:00Z', is_test: false } },
      { id: Q2, quiz: { closes_at: '2026-08-21T20:00:00Z', is_test: false } },
    ],
    NOW
  )
  assert.deepEqual(decision, { allowed: true })
})

test('kildegate: quiz som stenger i FRAMTIDEN avvises — fredagens fasit skal ikke kunne hentes', () => {
  const decision = decideArchiveSourceEligibility(
    [
      { id: Q1, quiz: { closes_at: '2026-08-14T20:00:00Z', is_test: false } },
      { id: Q2, quiz: { closes_at: '2026-08-28T20:00:00Z', is_test: false } },
    ],
    NOW
  )
  assert.deepEqual(decision, { allowed: false, reason: 'kilde-ikke-stengt', questionId: Q2 })
})

test('kildegate: closes_at=NULL avvises (dekker også arkivquizer som kilde — ingen kopikjeder)', () => {
  const decision = decideArchiveSourceEligibility(
    [{ id: Q1, quiz: { closes_at: null, is_test: false } }],
    NOW
  )
  assert.deepEqual(decision, { allowed: false, reason: 'kilde-ikke-stengt', questionId: Q1 })
})

test('kildegate: uparsbar closes_at avvises — NaN-sammenligning skal ikke slippe søppel gjennom', () => {
  const decision = decideArchiveSourceEligibility(
    [{ id: Q1, quiz: { closes_at: 'ikke-en-dato', is_test: false } }],
    NOW
  )
  assert.deepEqual(decision, { allowed: false, reason: 'kilde-ikke-stengt', questionId: Q1 })
})

test('kildegate: testquiz som kilde avvises', () => {
  const decision = decideArchiveSourceEligibility(
    [{ id: Q1, quiz: { closes_at: '2026-08-14T20:00:00Z', is_test: true } }],
    NOW
  )
  assert.deepEqual(decision, { allowed: false, reason: 'kilde-testquiz', questionId: Q1 })
})

test('kildegate: is_test=NULL er «vet ikke» og avvises (kravet er === false)', () => {
  const decision = decideArchiveSourceEligibility(
    [{ id: Q1, quiz: { closes_at: '2026-08-14T20:00:00Z', is_test: null } }],
    NOW
  )
  assert.deepEqual(decision, { allowed: false, reason: 'kilde-testquiz', questionId: Q1 })
})

test('kildegate: spørsmål uten forelder-quiz avvises', () => {
  const decision = decideArchiveSourceEligibility([{ id: Q2, quiz: null }], NOW)
  assert.deepEqual(decision, { allowed: false, reason: 'mangler-kildequiz', questionId: Q2 })
})

test('kildegate: stengetidspunktet NÅ (nøyaktig grense) regnes som stengt', () => {
  const decision = decideArchiveSourceEligibility(
    [{ id: Q1, quiz: { closes_at: NOW.toISOString(), is_test: false } }],
    NOW
  )
  assert.deepEqual(decision, { allowed: true })
})

test('kildegate: tom liste er trivielt lovlig — «tom bestilling» eies av buildArchiveCopy', () => {
  assert.deepEqual(decideArchiveSourceEligibility([], NOW), { allowed: true })
})
