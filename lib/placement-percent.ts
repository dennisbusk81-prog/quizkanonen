// ── Persentiltallet på resultatskjermen ──────────────────────────────────────
// «Bedre enn Y % av deltakerne» — andelen av de ANDRE spilleren slo.
//
// HISTORIKK, fordi den forklarer hvorfor det bare er ETT tall her nå:
//
// Fram til 2. august 2026 sto det «Topp X % · bedre enn Y % av deltakerne», og
// «bedre enn» ble regnet som (antall − rang) / ANTALL — med spilleren selv talt
// med i feltet hun sammenlignes mot. Vinneren av en tospillerquiz fikk «bedre
// enn 50 %» enda hun hadde slått alle de andre (1 av 1). Rapportert av Dennis
// 30. juli 2026.
//
// De gamle tallene summerte pent til 100, og det er nettopp derfor feilen
// overlevde: paret SÅ riktig ut. Etter at nevneren ble rettet ble begge tallene
// sanne, men de sluttet å summere — «Topp 51 % · bedre enn 50 %» — fordi de har
// ULIKE NEVNERE: «Topp» måler mot alle deltakere inkludert deg selv, «bedre
// enn» måler mot de andre. Leseren ser to prosenttall om samme plassering som
// ikke henger sammen, og konkluderer med at noe er ødelagt.
//
// Løsningen ble å vise ett tall i stedet for to. «Topp X %» tilførte lite når
// plasseringen allerede står i stort format rett over («3. plass av 55
// deltakere») — det er samme informasjon pakket om — og i et felt på 50–70
// spillere er «topp 2 %» en oppblåst måte å si «du vant». Kan vurderes på nytt
// hvis deltakerantallet en dag blir stort nok til at «topp 1 %» er meningsfullt;
// funksjonen `topPercent` (rang / antall, med avrundingsvakter) lå her fram til
// 2. august og kan hentes fra git-historikken.

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function invalid(rank: number, total: number): boolean {
  return (
    !Number.isFinite(rank) ||
    !Number.isFinite(total) ||
    total < 1 ||
    rank < 1 ||
    rank > total
  )
}

/**
 * «Bedre enn Y % av deltakerne» — andelen av de ANDRE spilleren slo.
 *
 * Nevneren er `total − 1`, ikke `total`: du sammenligner deg med de andre, ikke
 * med deg selv. Returnerer null når du er alene (ingen andre å slå).
 *
 * 100 er forbeholdt førsteplassen og 0 sisteplassen — mellomliggende
 * plasseringer klampes til 1–99, slik at avrunding aldri kan påstå «bedre enn
 * 100 %» for en som ble slått, eller «bedre enn 0 %» for en som slo noen.
 * (Grensene nås først rundt 200 deltakere; dagens største quiz har 71.)
 */
export function beatenPercent(rank: number, total: number): number | null {
  if (invalid(rank, total)) return null
  const others = total - 1
  if (others <= 0) return null
  if (rank === 1) return 100
  if (rank === total) return 0
  return clamp(Math.round(((total - rank) / others) * 100), 1, 99)
}

/**
 * Tallet til linja «Bedre enn Y % av deltakerne», eller `null` når linja ikke
 * skal vises i det hele tatt.
 *
 * VAKTEN BOR HER, IKKE HOS KALLEREN. Samme grunn som at `escapeHtml` brukes
 * inne i `lib/email-templates.ts` og ikke hos den som sender e-posten: en regel
 * som ligger ved sluket kan ingen framtidig kaller glemme. Skal linja vises et
 * nytt sted, arver den vakten gratis ved å kalle denne funksjonen i stedet for
 * å regne selv.
 *
 * Returnerer null når:
 *   • verdiene er ugyldige, eller spilleren er alene (ingen å sammenligne med)
 *   • spilleren kom SIST — «bedre enn 0 % av deltakerne» er sant, men ikke
 *     hyggelig lesning, og tilfører ingenting: plasseringen står allerede rett
 *     over («55. plass av 55 deltakere»), så ingen informasjon går tapt.
 *
 * `beatenPercent` beholder sitt ærlige svar for sisteplass (0) — det er LINJA
 * som undertrykkes, ikke tallet.
 */
export function placementPercentLine(rank: number, total: number): number | null {
  const beaten = beatenPercent(rank, total)
  if (beaten === null) return null
  if (rank === total) return null
  return beaten
}
