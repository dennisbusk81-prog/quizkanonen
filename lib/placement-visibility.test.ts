import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidePlacementDisplay,
  globalExclusionReason,
  shouldOfferPlacementRetry,
  shouldShowFreePlacementCard,
  type PlacementOrg,
} from './placement-visibility'

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

// ── Årsaken bak internal-only (forklaringsteksten på resultatskjermen) ───────
// MUTASJONSBEVIS: byttes betingelsen til å lese globalLeagueOptOut først,
// ryker «begge sanne»-testen — og en ansatt i en stengt org ville da fått
// «du har valgt …» og blitt sendt til en profilbryter uten effekt.

test('stengt org gir org-policy', () => {
  assert.equal(globalExclusionReason(closedOrg), 'org-policy')
})

test('eget opt-out i åpen org gir own-choice', () => {
  assert.equal(globalExclusionReason({ ...openOrg, globalLeagueOptOut: true }), 'own-choice')
})

test('begge sanne: org-policy vinner — den ansattes bryter er da uten effekt', () => {
  assert.equal(
    globalExclusionReason({ ...closedOrg, globalLeagueOptOut: true }),
    'org-policy',
  )
})

test('årsaken er avledet av samme org decidePlacementDisplay plukket ut', () => {
  // Ved flere medlemskap må teksten beskrive den orgen plasseringstallet
  // gjelder, ikke en vilkårlig annen.
  const d = decidePlacementDisplay({
    userId: 'u1',
    orgsLoaded: true,
    orgs: [{ ...openOrg, globalLeagueOptOut: true }, closedOrg],
  })
  assert.equal(d.mode, 'internal-only')
  assert.equal(d.org?.orgSlug, 'aapen-as')
  assert.equal(globalExclusionReason(d.org as PlacementOrg), 'own-choice')
})

// ── Gratis-plasseringskortet på /leaderboard/[id] ────────────────────────────
// MUTASJONSBEVIS: fjernes suppressOwnPublicRank-sjekken i
// shouldShowFreePlacementCard, ryker «blokkert gratisbruker …»-testen under —
// det var nøyaktig den manglende sjekken som var funn 2 (5. august 2026).

const freeCardBase = {
  authLoading: false,
  hasSession: true,
  isPremium: false,
  hasPlayed: true,
  totalCount: 12,
  suppressOwnPublicRank: false,
}

test('positiv kontroll: ikke-blokkert gratisbruker som har spilt får kortet', () => {
  assert.equal(shouldShowFreePlacementCard(freeCardBase), true)
})

test('blokkert gratisbruker (suppressOwnPublicRank) får IKKE det offentlige båndet', () => {
  assert.equal(
    shouldShowFreePlacementCard({ ...freeCardBase, suppressOwnPublicRank: true }),
    false,
  )
})

// isClosed-gaten er BEVISST fjernet (P-1, 23. august 2026): spennet skal stå
// også etter at quizen stenger — gratis ser nå kun topp 10 i listen, og
// /slik-fungerer-det lover «Estimert plassering» uten forbehold om åpen quiz.
// Signaturen har ikke lenger noe isClosed-felt, så en gjeninnført gate må
// gjennom denne filen for å få parameteren tilbake.

test('kortet er fortsatt skjult for premium, ikke-spilt og tomt felt', () => {
  assert.equal(shouldShowFreePlacementCard({ ...freeCardBase, isPremium: true }), false)
  assert.equal(shouldShowFreePlacementCard({ ...freeCardBase, hasPlayed: false }), false)
  assert.equal(shouldShowFreePlacementCard({ ...freeCardBase, totalCount: 0 }), false)
  assert.equal(shouldShowFreePlacementCard({ ...freeCardBase, hasSession: false }), false)
  assert.equal(shouldShowFreePlacementCard({ ...freeCardBase, authLoading: true }), false)
})

// ── FUNN 1: en feilet my-orgs skal ikke kunne låse egen plassering ───────────
//
// MUTASJONSBEVIS (kjørt, ikke påstått — se rapporten for kjøringene):
//   • `return false` (funksjonen fjernet helt)  → «feilet henting tilbyr retry»
//     ryker. Det er den permanente låsingen som var hele funn 1.
//   • `mode === 'unknown'` alene (myOrgsError ignoreres) → «uavklart MENS
//     hentingen pågår tilbyr IKKE retry» ryker — vi ville lovet en utvei av en
//     tilstand som retter seg selv, og blinket en knapp ved hver sidelast.
//   • `myOrgsError` alene (mode ignoreres) → «et BEKREFTET svar tilbyr aldri
//     retry» ryker: en blokkert ansatt ville fått «Prøv igjen» på et utfall et
//     nytt forsøk aldri kan endre.
//   • `||` i stedet for `&&` → begge de negative testene ryker (2 av 21).

test('FUNN 1: uavklart org-status som har FEILET tilbyr en vei tilbake', () => {
  assert.equal(
    shouldOfferPlacementRetry({ mode: 'unknown', myOrgsError: true }),
    true,
    'uten dette forsvinner spillerens egen plassering for resten av økta',
  )
})

test('FUNN 1: uavklart MENS hentingen pågår tilbyr IKKE retry', () => {
  // Ingen feil ennå — svaret er underveis og retter seg selv. En knapp her
  // ville blinket i det normale oppstartsvinduet på hver eneste sidelast.
  assert.equal(shouldOfferPlacementRetry({ mode: 'unknown', myOrgsError: false }), false)
})

test('FUNN 1: et BEKREFTET svar tilbyr aldri retry — heller ikke ved en senere feil', () => {
  // 'internal-only' er ikke en feil: det offentlige tallet SKAL mangle, og et
  // nytt forsøk kan ikke endre det. 'public'/'both' viser det allerede.
  for (const mode of ['public', 'internal-only', 'both'] as const) {
    assert.equal(
      shouldOfferPlacementRetry({ mode, myOrgsError: true }),
      false,
      `${mode} er et bekreftet svar og skal ikke love en utvei`,
    )
    assert.equal(shouldOfferPlacementRetry({ mode, myOrgsError: false }), false)
  }
})

test('FUNN 1: decidePlacementDisplay er UENDRET — «vet ikke» blir aldri «vet»', () => {
  // Regresjonsvakt for kravet: retry-utveien skal ikke ha løsnet på
  // 'unknown'-semantikken. En feilet henting er fortsatt «vet ikke», altså
  // ingen offentlig plassering — knappen er veien ut, ikke en gjetning.
  const d = decidePlacementDisplay({ userId: 'u1', orgsLoaded: false, orgs: [closedOrg] })
  assert.equal(d.mode, 'unknown')
  assert.equal(d.org, null)
})
