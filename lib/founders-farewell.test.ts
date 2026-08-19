// Kjøres med:  npm test
//
// Gate-logikken for founders-farvel-flaten — hvem ser den, og at hvert av de
// tre signalene faktisk deltar i beslutningen.
//
// MUTASJONSBEVIS (alle kjørt, se rapporten 19. august 2026):
//   • Fjernes `s.hasUsedTrial &&` → «aldri hatt trial»-testen ryker.
//   • Fjernes `!s.isPremium` → «levende dekning skjuler»-testene ryker
//     (inkludert source=founders-brukeren med fortsatt aktivt abonnement).
//   • Fjernes `!s.farewellDismissed` → «vises aldri igjen etter lukking» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldShowFoundersFarewell } from './founders-farewell'

test('MÅLGRUPPEN: utløpt trial, ingen dekning, ikke lukket → vises', () => {
  assert.equal(
    shouldShowFoundersFarewell({ hasUsedTrial: true, isPremium: false, farewellDismissed: false }),
    true,
  )
})

test('ALDRI HATT TRIAL: vanlig gratisbruker ser aldri flaten', () => {
  assert.equal(
    shouldShowFoundersFarewell({ hasUsedTrial: false, isPremium: false, farewellDismissed: false }),
    false,
  )
})

test('LEVENDE DEKNING skjuler flaten — «prøveperioden er over» ville vært usant', () => {
  // Dekker alle Premium-kilder likt (abonnement, kode, org, karens): gaten ser
  // kun det ferdig utledede isPremium. Dette er også tilfellet fra del 1-funnet:
  // source=founders-brukeren med fortsatt aktivt abonnement har isPremium=true
  // og skal aldri se flaten så lenge dekningen lever.
  assert.equal(
    shouldShowFoundersFarewell({ hasUsedTrial: true, isPremium: true, farewellDismissed: false }),
    false,
  )
})

test('KONVERTERT OG SENERE KANSELLERT: trial-merket + dekning falt → flaten vises', () => {
  // Faller dekningen til en konvertert eks-founder senere bort, er
  // «prøveperioden er over» sann igjen — da SKAL flaten vises (én gang).
  assert.equal(
    shouldShowFoundersFarewell({ hasUsedTrial: true, isPremium: false, farewellDismissed: false }),
    true,
  )
})

test('LUKKET: vises aldri igjen — uansett de andre signalene', () => {
  assert.equal(
    shouldShowFoundersFarewell({ hasUsedTrial: true, isPremium: false, farewellDismissed: true }),
    false,
  )
})

test('ALLE AV: default-tilstanden før serversvar holder flaten skjult', () => {
  // ProfileProvider starter med alle tre false → skjult. Flash-sikkerheten
  // hviler på at hasUsedTrial=true kun ankommer i et definitivt svar som også
  // bærer isPremium og farewellDismissed.
  assert.equal(
    shouldShowFoundersFarewell({ hasUsedTrial: false, isPremium: false, farewellDismissed: false }),
    false,
  )
})
