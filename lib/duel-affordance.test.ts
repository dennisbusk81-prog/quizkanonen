// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDuelAffordance, type DuelAffordanceState } from './duel-affordance'

const baseState = (overrides: Partial<DuelAffordanceState> = {}): DuelAffordanceState => ({
  currentUserId: 'me',
  duelInvolvedIds: new Set(),
  challengeSentIds: new Set(),
  activeDuelExists: false,
  challengeLoadingId: null,
  ...overrides,
})

// ── Grunnleggende klikkbarhet ────────────────────────────────────────────────

test('klikkbar rad for en annen innlogget spiller uten eksisterende duell', () => {
  const res = computeDuelAffordance('rival-1', false, baseState())
  assert.equal(res.clickable, true)
  assert.equal(res.alreadySent, false)
})

test('egen rad er ALDRI klikkbar, uansett plassering i listen', () => {
  // Regresjonstest for bugen nevnt i commit 6ab7abe: isSelf må sjekkes
  // uavhengig av premium-gating (isUser) — her simulert direkte via isSelf=true.
  const res = computeDuelAffordance('me', true, baseState())
  assert.equal(res.clickable, false)
  assert.equal(res.alreadySent, false)
})

test('ingen currentUserId (ikke innlogget) → aldri klikkbar', () => {
  const res = computeDuelAffordance('rival-1', false, baseState({ currentUserId: null }))
  assert.equal(res.clickable, false)
})

test('rad uten user_id (gjest) → aldri klikkbar', () => {
  const res = computeDuelAffordance(null, false, baseState())
  assert.equal(res.clickable, false)
})

// ── Rader langt ned i en paginert liste (rad 61-71-scenarioet, 28. juli) ────

test('rad langt utenfor topp 50 (simulert paginert side 4, rad 61-70) er klikkbar akkurat som topp-N', () => {
  // computeDuelAffordance kjenner ikke til rangering/paginering i det hele
  // tatt — den skal oppføre seg identisk uansett hvor i listen brukeren er.
  // Dette er selve regresjonen fra avvik 2: browseEntryToRow kalte aldri
  // denne logikken før fiksen.
  for (const rank of [61, 62, 65, 70]) {
    const res = computeDuelAffordance(`player-rank-${rank}`, false, baseState())
    assert.equal(res.clickable, true, `rad ${rank} skal være klikkbar`)
  }
})

test('egen rad på rad 71 (siste rad i paginert vindu) er fortsatt ikke klikkbar', () => {
  const res = computeDuelAffordance('me', true, baseState())
  assert.equal(res.clickable, false)
})

// ── Allerede sendt / involvert ───────────────────────────────────────────────

test('utgående forespørsel allerede sendt → ikke klikkbar, alreadySent=true', () => {
  const res = computeDuelAffordance('rival-1', false, baseState({
    duelInvolvedIds: new Set(['rival-1']),
    challengeSentIds: new Set(['rival-1']),
  }))
  assert.equal(res.clickable, false)
  assert.equal(res.alreadySent, true)
})

test('involvert i duell men IKKE sendt av meg (innkommende) → skjules stille', () => {
  const res = computeDuelAffordance('rival-1', false, baseState({
    duelInvolvedIds: new Set(['rival-1']),
  }))
  assert.equal(res.clickable, false)
  assert.equal(res.alreadySent, false)
})

test('bruker har allerede en annen aktiv/ventende duell denne måneden → blokkerer alle andre rader', () => {
  const res = computeDuelAffordance('rival-2', false, baseState({ activeDuelExists: true }))
  assert.equal(res.clickable, false)
  assert.equal(res.alreadySent, false)
})

test('forespørsel til NETTOPP denne mottakeren er underveis → midlertidig ikke-klikkbar (hindrer dobbel-innsending)', () => {
  const res = computeDuelAffordance('rival-1', false, baseState({ challengeLoadingId: 'rival-1' }))
  assert.equal(res.clickable, false)
})

test('forespørsel underveis til EN ANNEN mottaker påvirker ikke denne raden', () => {
  const res = computeDuelAffordance('rival-1', false, baseState({ challengeLoadingId: 'rival-2' }))
  assert.equal(res.clickable, true)
})
