// ── Premium-CTA-ene på resultatskjermen: ÉN kilde til ordlyden ──────────────
//
// Fram til 12. september 2026 sa den ene premium-linja som er synlig uten
// scroll («Oppgrader til Premium for å se nøyaktig plassering →») noe annet
// enn panelet lenger ned («Prøv Premium gratis i 14 dager» / «Prøv gratis —
// ingen kortinfo →»). «Oppgrader» leser som betal, og linja solgte den svakeste
// fordelen — mens tilbudet som faktisk finnes (gratis, uten kort) sto mer enn
// én skjermhøyde ned. Samme grep som lib/premium-features.ts og
// lib/kanonkuler-tekst.ts: teksten bor her, flatene leser den, og
// lib/premium-cta-tekst.test.ts krever at ingen flate har en egen kopi.
//
// Tilbudet (`TrialOffer`) avgjøres i lib/trial-offer.ts og er VISNING, ikke
// en gate — serveren avgjør retten ved aktivering. Finnes det ikke noe tilbud
// (brukt opp, eller dagtallet mangler i site_settings), faller alle tre
// tekstene tilbake til den vanlige Premium-ordlyden uten dagtall, slik panelet
// alltid har gjort.
//
// Ren fil, ingen I/O og ingen React.
import type { TrialOffer } from './trial-offer'

export const INGEN_KORTINFO = 'ingen kortinfo'

/** «Prøv Premium gratis i 14 dager» — stammen både overskriften og linja bygger på. */
export function provPremiumGratis(days: number): string {
  return `Prøv Premium gratis i ${days} dager`
}

export type PremiumCtaTekster = {
  /** Panelets overskrift. */
  overskrift: string
  /** Panelets knapp — kort, fordi overskriften rett over bærer dagtallet. */
  knapp: string
  /** Linja i plasseringskortet — står alene, og må derfor bære hele framingen selv. */
  linje: string
}

/**
 * `null`/`undefined` betyr «tilbudet er ikke hentet» (gjest, eller oppslaget
 * landet ikke) og behandles som «ingen tilbud»: vi lover aldri gratis dager
 * vi ikke har fått bekreftet et tall for.
 */
export function premiumCtaTekster(offer: TrialOffer | null | undefined): PremiumCtaTekster {
  if (offer?.show) {
    const stamme = provPremiumGratis(offer.days)
    return {
      overskrift: stamme,
      knapp: `Prøv gratis — ${INGEN_KORTINFO} →`,
      linje: `${stamme} — ${INGEN_KORTINFO} →`,
    }
  }
  return {
    overskrift: 'Følg fremgangen din uke etter uke',
    knapp: 'Oppgrader til Premium →',
    linje: 'Oppgrader til Premium →',
  }
}
