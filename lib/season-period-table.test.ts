// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatQuizCount, shouldShowPeriodPlacementRow, type PlacementRowState } from './season-period-table'

// ── formatQuizCount ──────────────────────────────────────────────────────────

test('formatQuizCount: entall for 1 quiz', () => {
  assert.equal(formatQuizCount(1), '1 quiz')
})

test('formatQuizCount: flertall for 0 og for >1', () => {
  assert.equal(formatQuizCount(0), '0 quizer')
  assert.equal(formatQuizCount(2), '2 quizer')
  assert.equal(formatQuizCount(12), '12 quizer')
})

// ── shouldShowPeriodPlacementRow ────────────────────────────────────────────

const baseState = (overrides: Partial<PlacementRowState> = {}): PlacementRowState => ({
  isLastQuiz: false,
  userVisible: false,
  userEntryRank: 23,
  isPremium: true,
  scope: 'global',
  ...overrides,
})

test('Premium, utenfor topp 10, periode-visning → vis plasseringsrad', () => {
  assert.equal(shouldShowPeriodPlacementRow(baseState()), true)
})

test('Siste quiz → ALDRI plasseringsrad, uansett de andre feltene (userEntry mangler fastestMs)', () => {
  assert.equal(shouldShowPeriodPlacementRow(baseState({ isLastQuiz: true })), false)
  assert.equal(shouldShowPeriodPlacementRow(baseState({ isLastQuiz: true, isPremium: true, scope: 'organization' })), false)
})

test('brukeren er allerede synlig i hovedlisten → ingen egen rad (unngår duplikat)', () => {
  assert.equal(shouldShowPeriodPlacementRow(baseState({ userVisible: true })), false)
})

test('ingen userEntry (ikke spilt denne perioden) → ingen rad', () => {
  assert.equal(shouldShowPeriodPlacementRow(baseState({ userEntryRank: null })), false)
})

test('innenfor topp 10 → ingen egen rad (allerede i hovedlisten uansett)', () => {
  assert.equal(shouldShowPeriodPlacementRow(baseState({ userEntryRank: 10 })), false)
  assert.equal(shouldShowPeriodPlacementRow(baseState({ userEntryRank: 1 })), false)
})

test('nøyaktig rank 11 (rett utenfor topp 10) → vis rad', () => {
  assert.equal(shouldShowPeriodPlacementRow(baseState({ userEntryRank: 11 })), true)
})

test('ikke Premium, ikke org-scope → ingen rad (samme gate som Oppgrader-CTA-en)', () => {
  assert.equal(shouldShowPeriodPlacementRow(baseState({ isPremium: false, scope: 'global' })), false)
  assert.equal(shouldShowPeriodPlacementRow(baseState({ isPremium: false, scope: 'league' })), false)
})

test('org-scope teller som "premium nok" selv uten personlig Premium-abonnement', () => {
  assert.equal(shouldShowPeriodPlacementRow(baseState({ isPremium: false, scope: 'organization' })), true)
})
