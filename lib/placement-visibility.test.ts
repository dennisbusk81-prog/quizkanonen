import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidePlacementDisplay, type PlacementOrg } from './placement-visibility'

const openOrg: PlacementOrg = {
  orgSlug: 'aapen-as',
  orgName: 'Åpen AS',
  allowGlobalLeague: true,
  globalLeagueOptOut: null,
}

const closedOrg: PlacementOrg = {
  orgSlug: 'lukket-as',
  orgName: 'Lukket AS',
  allowGlobalLeague: false,
  globalLeagueOptOut: null,
}

// ── Positiv kontroll: ikke-org-brukere er HELT upåvirket ─────────────────────

test('gjest (userId null) er alltid public — også før org-svar', () => {
  const d = decidePlacementDisplay({ userId: null, orgsLoaded: false, orgs: [] })
  assert.equal(d.mode, 'public')
  assert.equal(d.org, null)
})

test('innlogget uten org-medlemskap er public', () => {
  const d = decidePlacementDisplay({ userId: 'u1', orgsLoaded: true, orgs: [] })
  assert.equal(d.mode, 'public')
  assert.equal(d.org, null)
})

// ── Uavklart org-status skal ALDRI vise offentlig plassering ─────────────────

test('innlogget med ulastet org-liste er unknown, ikke public', () => {
  // Mutasjonsbeviset: returnerte denne 'public' ville en blokkert ansatt fått
  // det offentlige tallet i vinduet før /api/org/my-orgs svarer.
  const d = decidePlacementDisplay({ userId: 'u1', orgsLoaded: false, orgs: [] })
  assert.equal(d.mode, 'unknown')
  assert.equal(d.org, null)
})

test('unknown gjelder også når en (stale) org-liste finnes men loaded er false', () => {
  const d = decidePlacementDisplay({ userId: 'u1', orgsLoaded: false, orgs: [closedOrg] })
  assert.equal(d.mode, 'unknown')
})

// ── Blokkert: org har sagt nei ───────────────────────────────────────────────

test('medlem av stengt org er internal-only, med den orgen', () => {
  const d = decidePlacementDisplay({ userId: 'u1', orgsLoaded: true, orgs: [closedOrg] })
  assert.equal(d.mode, 'internal-only')
  assert.equal(d.org?.orgSlug, 'lukket-as')
})

test('stengt org vinner over åpen org ved flere medlemskap', () => {
  const d = decidePlacementDisplay({ userId: 'u1', orgsLoaded: true, orgs: [openOrg, closedOrg] })
  assert.equal(d.mode, 'internal-only')
  assert.equal(d.org?.orgSlug, 'lukket-as')
})

// ── Blokkert: den ansatte har selv valgt «kun internt» ───────────────────────

test('eget opt-out i en ÅPEN org er også internal-only', () => {
  const d = decidePlacementDisplay({
    userId: 'u1',
    orgsLoaded: true,
    orgs: [{ ...openOrg, globalLeagueOptOut: true }],
  })
  assert.equal(d.mode, 'internal-only')
  assert.equal(d.org?.orgSlug, 'aapen-as')
})

// ── Åpent medlemskap: begge tall ─────────────────────────────────────────────

test('medlem av åpen org uten opt-out får both, med orgen', () => {
  const d = decidePlacementDisplay({ userId: 'u1', orgsLoaded: true, orgs: [openOrg] })
  assert.equal(d.mode, 'both')
  assert.equal(d.org?.orgSlug, 'aapen-as')
})

test('eksplisitt opt-in (optOut=false) er both — false er ikke true', () => {
  const d = decidePlacementDisplay({
    userId: 'u1',
    orgsLoaded: true,
    orgs: [{ ...openOrg, globalLeagueOptOut: false }],
  })
  assert.equal(d.mode, 'both')
})

test('ubesvart valg (optOut=null) i åpen org er both, ikke blokkert', () => {
  // null betyr «ikke besvart» — å behandle det som opt-out ville skjult det
  // offentlige tallet for alle som bare ikke har sett banneret ennå.
  const d = decidePlacementDisplay({
    userId: 'u1',
    orgsLoaded: true,
    orgs: [{ ...openOrg, globalLeagueOptOut: null }],
  })
  assert.equal(d.mode, 'both')
})
