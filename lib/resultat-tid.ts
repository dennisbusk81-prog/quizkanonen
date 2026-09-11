// ── Hvordan en tid SKRIVES i et resultat ────────────────────────────────────
//
// ÉN form, delt av resultatkortet (bildet) og delingsteksten. De to havner i
// det samme Facebook-innlegget, og skrev fram til 11. september 2026 samme tall
// på hver sin måte: bildet «63.4s», teksten «1:03». Samme spiller, samme
// forsøk, to tall som ikke engang ser like ut.
//
// Formen som vant er sekunder med én desimal. Ikke fordi `m:ss` er dårligere i
// seg selv, men fordi `63.4s` er det som allerede står på resultatlista
// spillerne ser — `defaultFormatTime` i components/ResultsTable.tsx og
// `formatTime` i components/SeasonLeaderboard.tsx. Skal bildet erstatte et
// skjermbilde av den lista, må tallene være gjenkjennelige.
//
// ÆRLIG: de to komponentene over har fortsatt HVER SIN identiske kopi av dette
// uttrykket. De er klientkomponenter og ble ikke rørt i denne runden — det er
// en egen opprydding, ikke en del av samtykke-/populasjonssaken. Endres formen
// her, må de to følge etter, ellers spriker bildet fra lista igjen.

/**
 * Sekunder med én desimal: `63408` → `«63.4s»`.
 *
 * Millisekunder inn, aldri sekunder — alle kildene i denne kodebasen
 * (`attempts.total_time_ms`, snapshot-radene) er i ms.
 */
export function formatTid(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}
