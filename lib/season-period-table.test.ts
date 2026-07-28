// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatQuizCount, shouldShowPlacementRow, buildPlacementRow, type PlacementRowState, type PlacementRowSource } from './season-period-table'

// ── formatQuizCount ──────────────────────────────────────────────────────────

test('formatQuizCount: entall for 1 quiz', () => {
  assert.equal(formatQuizCount(1), '1 quiz')
})

test('formatQuizCount: flertall for 0 og for >1', () => {
  assert.equal(formatQuizCount(0), '0 quizer')
  assert.equal(formatQuizCount(2), '2 quizer')
  assert.equal(formatQuizCount(12), '12 quizer')
})

// ── shouldShowPlacementRow ───────────────────────────────────────────────────

const baseState = (overrides: Partial<PlacementRowState> = {}): PlacementRowState => ({
  userVisible: false,
  userEntryRank: 23,
  isPremium: true,
  scope: 'global',
  ...overrides,
})

test('Premium, utenfor topp 10, periode-visning → vis plasseringsrad', () => {
  assert.equal(shouldShowPlacementRow(baseState()), true)
})

// Regresjonstest for 28. juli-fiksen: gaten skilte tidligere last_quiz fra
// periode-visninger via et eget isLastQuiz-felt (fjernet fra typen — ingen
// gjenstående skille her). Kalleren (SeasonLeaderboard.tsx sin buildRows())
// avgjør nå selv innholdet i totalTimeMs/metricSubLabel ut fra isLastQuiz,
// men SELVE synlighets-gaten er identisk for alle faner.
test('gaten er scope-/rank-basert, ikke periode-basert — samme svar uansett hvilken fane kalleren representerer', () => {
  assert.equal(shouldShowPlacementRow(baseState()), true)
  assert.equal(shouldShowPlacementRow(baseState({ isPremium: false, scope: 'global' })), false)
})

test('brukeren er allerede synlig i hovedlisten → ingen egen rad (unngår duplikat)', () => {
  assert.equal(shouldShowPlacementRow(baseState({ userVisible: true })), false)
})

test('ingen userEntry (ikke spilt denne perioden/quizen) → ingen rad', () => {
  assert.equal(shouldShowPlacementRow(baseState({ userEntryRank: null })), false)
})

test('innenfor topp 10 → ingen egen rad (allerede i hovedlisten uansett)', () => {
  assert.equal(shouldShowPlacementRow(baseState({ userEntryRank: 10 })), false)
  assert.equal(shouldShowPlacementRow(baseState({ userEntryRank: 1 })), false)
})

test('nøyaktig rank 11 (rett utenfor topp 10) → vis rad', () => {
  assert.equal(shouldShowPlacementRow(baseState({ userEntryRank: 11 })), true)
})

test('ikke Premium, ikke org-scope → ingen rad (samme gate som Oppgrader-CTA-en)', () => {
  assert.equal(shouldShowPlacementRow(baseState({ isPremium: false, scope: 'global' })), false)
  assert.equal(shouldShowPlacementRow(baseState({ isPremium: false, scope: 'league' })), false)
})

test('org-scope teller som "premium nok" selv uten personlig Premium-abonnement', () => {
  assert.equal(shouldShowPlacementRow(baseState({ isPremium: false, scope: 'organization' })), true)
})

// ── buildPlacementRow ────────────────────────────────────────────────────────
// Regresjonsdekning for 28. juli-fiksen: userEntry.fastestMs skal faktisk
// brukes for Siste quiz (Tid-kolonnen er synlig der), og IKKE brukes for
// periode-visninger (som viser quizCount i stedet — ingen tid-begrep).

const baseUe = (overrides: Partial<PlacementRowSource> = {}): PlacementRowSource => ({
  rank: 23,
  displayName: 'Renate Ellingsen',
  nickname: null,
  points: 42,
  quizCount: 3,
  fastestMs: 38900,
  ...overrides,
})

test('Siste quiz: totalTimeMs settes fra fastestMs, metricSubLabel er tom (Tid-kolonnen er synlig)', () => {
  const row = buildPlacementRow(baseUe(), true)
  assert.equal(row.totalTimeMs, 38900)
  assert.equal(row.metricSubLabel, null)
})

test('periode-visning: totalTimeMs er 0 (kolonnen skjules uansett), metricSubLabel viser quizCount', () => {
  const row = buildPlacementRow(baseUe(), false)
  assert.equal(row.totalTimeMs, 0)
  assert.equal(row.metricSubLabel, '3 quizer')
})

test('Siste quiz uten fastestMs (bør ikke skje etter fiksen, men skal ikke krasje) → 0', () => {
  const row = buildPlacementRow(baseUe({ fastestMs: null }), true)
  assert.equal(row.totalTimeMs, 0)
})

test('kallenavn prioriteres på navnelinjen, ekte navn havner på andrelinjen — likt attemptToRow/entryToRow', () => {
  const row = buildPlacementRow(baseUe({ nickname: 'Ren' }), false)
  assert.equal(row.name, 'Ren')
  assert.equal(row.secondary, 'Renate Ellingsen')
})

test('ingen kallenavn → visningsnavn alene, ingen andrelinje', () => {
  const row = buildPlacementRow(baseUe({ nickname: null }), false)
  assert.equal(row.name, 'Renate Ellingsen')
  assert.equal(row.secondary, null)
})

test('separatorLabel og highlight er alltid satt, uansett fane', () => {
  for (const isLastQuiz of [true, false]) {
    const row = buildPlacementRow(baseUe(), isLastQuiz)
    assert.equal(row.separatorLabel, '— Din plassering —')
    assert.equal(row.highlight, true)
  }
})
