// ── Persentiltallene på resultatskjermen ─────────────────────────────────────
// TO ULIKE størrelser, som fram til 2. august 2026 var koblet sammen med
// `topp = 100 − bedreEnn`. Koblingen var feil, fordi de har ulike nevnere:
//
//   topPercent    — HVOR I FELTET du havnet:   rang / antall
//                   «Topp 10 %» = du er blant de 10 % beste.
//   beatenPercent — hvor mange ANDRE du slo:   (antall − rang) / (antall − 1)
//
// Den gamle koden regnet «bedre enn» som (antall − rang) / ANTALL, altså med
// spilleren SELV talt med i feltet hun sammenlignes mot. Vinneren av en
// tospillerquiz fikk «bedre enn 50 %» enda hun hadde slått alle de andre
// (1 av 1), og nummer 2 av 2 fikk «Topp 100 % · bedre enn 0 %». Rapportert av
// Dennis 30. juli 2026.
//
// Merk at «Topp X %» var korrekt hele tiden: 100 − (n−r)/n·100 er identisk med
// r/n·100. Det er kun «bedre enn» som hadde feil nevner — derfor er de to nå
// skilt, i stedet for å utledes av hverandre.
//
// Begge returnerer `null` når tallet ikke ville betydd noe (ugyldige inn-
// verdier, eller ingen andre å sammenligne seg med). Kalleren skal da skjule
// linja — ikke vise 0, ikke vise 100. «Bedre enn 100 % av 0 andre» er en
// påstand om en sammenligning som ikke finnes.

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
 * «Topp X %» — hvor i feltet spilleren havnet. 1. plass av 10 → 10.
 *
 * Avrundingsgulv på 1: med 201+ deltakere gir rang 1 et råtall på 0,49 %, som
 * ville blitt «Topp 0 %». Ingen er i toppen 0 %.
 * Avrundingstak på 99 for alle andre enn sisteplassen: rang 200 av 201 gir
 * 99,5 % → 100, som ville påstått sisteplass for en spiller som slo noen.
 * Eksakt 100 er forbeholdt den som faktisk er sist.
 */
export function topPercent(rank: number, total: number): number | null {
  if (invalid(rank, total)) return null
  if (rank === total) return 100
  return clamp(Math.round((rank / total) * 100), 1, 99)
}

/**
 * «Bedre enn X % av deltakerne» — andelen av de ANDRE spilleren slo.
 *
 * Nevneren er `total − 1`, ikke `total`: du sammenligner deg med de andre, ikke
 * med deg selv. Returnerer null når du er alene (ingen andre å slå).
 *
 * 100 er forbeholdt førsteplassen og 0 sisteplassen — mellomliggende
 * plasseringer klampes til 1–99, slik at avrunding aldri kan påstå «bedre enn
 * 100 %» for en som ble slått, eller «bedre enn 0 %» for en som slo noen.
 */
export function beatenPercent(rank: number, total: number): number | null {
  if (invalid(rank, total)) return null
  const others = total - 1
  if (others <= 0) return null
  if (rank === 1) return 100
  if (rank === total) return 0
  return clamp(Math.round(((total - rank) / others) * 100), 1, 99)
}

export type PlacementPercentLine = { top: number; beaten: number }

/**
 * Tallene til linja «Topp X % · bedre enn Y % av deltakerne», eller `null` når
 * linja ikke skal vises i det hele tatt.
 *
 * VAKTEN BOR HER, IKKE HOS KALLEREN. Samme grunn som at `escapeHtml` brukes
 * inne i `lib/email-templates.ts` og ikke hos den som sender e-posten: en regel
 * som ligger ved sluket kan ingen framtidig kaller glemme. Skal linja vises et
 * nytt sted (delekortet, historikk, en framtidig flate), arver den vakten
 * gratis ved å kalle denne funksjonen i stedet for å regne selv.
 *
 * Returnerer null når:
 *   • verdiene er ugyldige, eller spilleren er alene (ingen å sammenligne med)
 *   • spilleren kom SIST — da ville linja lest «Topp 100 % · bedre enn 0 % av
 *     deltakerne». Begge tallene er sanne etter nevner-fiksen 2. august 2026,
 *     men «Topp 100 %» er en superlativ-innramming av det dårligste utfallet,
 *     og «bedre enn 0 %» er ikke hyggeligere alene. Linja tilfører ingenting:
 *     plasseringen står allerede i stort format rett over («55. plass av 55
 *     deltakere»), så ingen informasjon går tapt ved å skjule den.
 *
 * Primitivene `topPercent`/`beatenPercent` beholder sine ærlige svar for
 * sisteplass (100 og 0) — det er LINJA som undertrykkes, ikke tallene.
 */
export function placementPercentLine(
  rank: number,
  total: number,
): PlacementPercentLine | null {
  const top = topPercent(rank, total)
  const beaten = beatenPercent(rank, total)
  if (top === null || beaten === null) return null
  if (rank === total) return null
  return { top, beaten }
}
