// ── Bremsing av gjetting mot org-prøvekoder (/api/org/trial-code/validate) ───
//
// BAKGRUNN
// Dette er den direkte analogien til B2C-verdikodene, som fikk bom-telling
// 1. august (lib/redeem-throttle.ts). org_trial_codes hadde ingen tilsvarende
// beskyttelse: ruten er uinnlogget, den svarer 404 på ukjent kode og 200 med
// pakke + antall prøvedager på en gyldig, og bak den ligger en kode som gir
// gratis B2B-trial. Kun en Map i minnet sto imellom.
//
// HVA SOM TELLES — kun bom, av nøyaktig samme grunn som i redeem
// Vi teller kun forsøk der koden IKKE finnes. Det er signalet på gjetting, og
// ingen ekte bruker treffer det:
//   • en som skriver inn en gyldig kode telles aldri — heller ikke tjue
//     kolleger bak samme NAT-IP som slår opp den samme gyldige koden, som er
//     den viktigste falsk-positiv-fellen på et B2B-endepunkt
//   • «allerede brukt» (409) telles heller ikke: koden FINNES, brukeren skal se
//     feilmeldingen sin hver gang i stedet for å bli utestengt
//
// INGEN KONTO-DIMENSJON
// Ruten kalles fra registreringssiden før noen er logget inn, så IP-bøtta er
// det eneste vi har å telle på. Til gjengjeld er kodene generert (samme
// generator som i lib/access-code.ts), så gjetting er uansett håpløst — denne
// grensen finnes for å stoppe kostnaden og støyen av at noen prøver.

export const ORG_TRIAL_CODE_MISS_ACTION = 'org_trial_code_miss'

/** Tellevindu. */
export const ORG_TRIAL_CODE_WINDOW_MS = 60 * 60 * 1000

// Lavere enn IP-grensen i redeem (30), fordi det ikke finnes noen konto-grense
// under den her — og fordi en ekte bedriftskunde som har fått en kode på e-post
// ikke bommer tjue ganger på en time.
export const ORG_TRIAL_CODE_MISS_LIMIT_IP = 20

export type OrgTrialCodeThrottleDecision =
  | { allowed: true }
  | { allowed: false; message: string }

/**
 * Ren beslutning: har denne IP-bøtta bommet for mye i vinduet?
 */
export function decideOrgTrialCodeThrottle(misses: number): OrgTrialCodeThrottleDecision {
  if (misses >= ORG_TRIAL_CODE_MISS_LIMIT_IP) {
    return {
      allowed: false,
      message: 'For mange mislykkede kodeforsøk fra dette nettverket. Prøv igjen om en stund.',
    }
  }
  return { allowed: true }
}
