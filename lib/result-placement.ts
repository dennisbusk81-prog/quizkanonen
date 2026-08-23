// ── Hva skal plasseringsblokken på resultatskjermen vise? ────────────────────
// Ren logikk, uten I/O — testdekket i lib/result-placement.test.ts. Samme grep
// som lib/placement-visibility.ts: beslutningen bor her, JSX-en i
// app/quiz/[id]/page.tsx mapper kun utfall → markup.
//
// BAKGRUNN (7. august 2026): klienten forkastet serverens placement når
// total = 1 — `total > 1`-guarder ved BEGGE fetch-stedene og i render-blokken.
// Konsekvensen var at den aller FØRSTE som leverte så et helt tomt felt: ikke
// et tall, ikke venteteksten, ingenting. Spiller nr. 2 og oppover fikk
// ventetekst (gratis) eller eksakt plass (Premium).
//
// Guarden var et fossil: den ble født med selve plasseringsfeature-en
// (d78fffd) for å beskytte en prosentformel `(total - low) / total` som ville
// gitt tull ved total = 1. Formelen ble fjernet 2. august 2026, og
// persentillinja har siden hatt sin egen alene-vakt VED SLUKET
// (placementPercentLine i lib/placement-percent.ts returnerer null når det
// ikke finnes andre å sammenligne med). Guarden beskyttet altså ingenting
// lenger — den bare skjulte feltet for førstemann.
//
// Utfallene:
// - 'premium-first': eksakt plassering MED kontekst («du er først ute») —
//   Premium betaler for eksakt plassering, og «1. plass av 1» alene er hult.
// - 'free': gratis-kortet slik det alltid har vært; page.tsx sitt eksisterende
//   showSpan-skille (total >= 10 → spenn, ellers ventetekst) står URØRT der.
//   total = 1 faller dermed naturlig i venteteksten — samme som 2–9. Gratis
//   får BEVISST ikke noe spenn eller tall her: et «1–5»-spenn når det finnes
//   én deltaker påstår et felt som ikke eksisterer, og sommeren har handlet om
//   å fjerne nettopp den typen påstander («Topp X %», persentilhintet).
// - 'hidden': blokkert (internal-only viser det interne kortet i stedet),
//   uavklart (unknown — retry-mekanismen eier den tilstanden), eller ingen
//   placement-data i det hele tatt.

import type { PlacementDisplay } from './placement-visibility'

export type ResultPlacementView = 'hidden' | 'premium-first' | 'premium-exact' | 'free'

export function decideResultPlacementView(input: {
  mode: PlacementDisplay['mode']
  isPremium: boolean
  // `rank` er nullbar fordi serveren gater den (P-2, 23. august 2026): den
  // eksakte plasseringen forlater ikke /standings for en ikke-Premium kaller.
  placement: { rank: number | null; total: number } | null
}): ResultPlacementView {
  // Samme mode-gate som render-blokken alltid har hatt: internal-only har sitt
  // eget kort, unknown eies av retry-mekanismen (shouldOfferPlacementRetry).
  if (input.mode === 'internal-only' || input.mode === 'unknown') return 'hidden'
  // total < 1 kan ikke komme fra standings (placement regnes kun mot ikke-tom
  // pool), men leaderboard-fallbacken bygger fra to separate felt — defensivt.
  if (input.placement === null || input.placement.total < 1) return 'hidden'

  // ── PARITET MED SERVEREN (P-2, 23. august 2026) ───────────────────────────
  // `isPremium` her er KLIENTENS mening (ProfileProvider). Serveren har sin
  // egen, båret av det signerte attempt-tokenet, og de kan avvike i ett reelt
  // tilfelle: kjøper noen Premium midt i en quiz, sier tokenet «gratis» til
  // neste sidelast. Uten dette leddet ville premium-grenen da rendret
  // «${null}. plass» — en tom streng der tallet skulle stått.
  //
  // Regelen: DATAEN vinner over antakelsen. Kom det ingen eksakt plassering,
  // vises gratis-kortet, som bygger på `low`/`total` og alltid er komplett.
  // Det er samme felle som [P-3] 21. august (tom liste ved siden av «Plass 49
  // av 49»), og den lukkes her ved at de to aldri kan være uenige: visningen
  // følger hva svaret FAKTISK inneholder.
  if (input.isPremium && input.placement.rank !== null) {
    return input.placement.total === 1 ? 'premium-first' : 'premium-exact'
  }
  return 'free'
}
