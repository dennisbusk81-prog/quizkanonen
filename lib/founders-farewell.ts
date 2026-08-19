// Gate for founders-farvel-flaten (19. august 2026) — REN logikk, testdekket
// i lib/founders-farewell.test.ts etter B-3-mønsteret.
//
// Hvem skal se flaten: tidligere Founders-brukere som i dag er nedgradert til
// gratis, én gang, til de selv lukker den. Gaten er et rent DB-signal —
// bevisst INGEN bruk av lib/founders-farewell-list.json (foreldet allerede,
// og inneholder e-postadresser som aldri skal nå en klient-bundle):
//
//   • hasUsedTrial — profiles.has_used_trial, det varige merket fra
//     founders-activate/backfillen. Populasjonen er lukket: founders-activate
//     er trial-sperret og UI-et fjernet, så merket peker ikke på noen
//     framtidig, ukjent gruppe.
//   • isPremium — enhver levende dekning (abonnement, kode, org, karens)
//     skjuler flaten. Dette utelater automatisk de fem i kohorten som er
//     Premium i dag, inkludert source=founders-brukeren med fortsatt aktivt
//     abonnement: «prøveperioden er over» er usant for henne så lenge
//     dekningen lever. Faller dekningen senere, er teksten sann — og da
//     SKAL flaten vises.
//   • farewellDismissed — profiles.founders_farewell_dismissed_at satt.
//     Varig, per person, på tvers av enheter.
//
// Flash-sikkerhet uten eget loading-flagg: alle tre signalene ankommer i
// SAMME definitive svar fra premium-status-ruta (ProfileProvider endrer dem
// aldri på transient feil). Standardverdien hasUsedTrial=false holder flaten
// skjult til svaret foreligger — det finnes ingen mellomtilstand der
// hasUsedTrial er bekreftet mens isPremium/farewellDismissed ikke er det.

export interface FoundersFarewellSignals {
  hasUsedTrial: boolean
  isPremium: boolean
  farewellDismissed: boolean
}

export function shouldShowFoundersFarewell(s: FoundersFarewellSignals): boolean {
  return s.hasUsedTrial && !s.isPremium && !s.farewellDismissed
}
