// «Feil er ikke tomt» (lib/fetch-result.ts) for historikk-cachen i
// components/SeasonLeaderboard.tsx.
//
// Cachen er et Map fra periodenøkkel til innhold, og fram til 29. august 2026
// skrev catch-grenen en TOM LISTE inn i det: skjermen viste «Ingen data for
// denne perioden» — en faktapåstand om at ingen spilte — og fordi guarden var
// `if (expandedData.has(key)) return`, ble feilen CACHET permanent. Å lukke og
// åpne raden hentet aldri på nytt; eneste vei ut var å laste hele siden.
//
// Derfor er 'error' en egen verdi i cachen (samme form som 'loading', som
// allerede lå der), og guarden bor her som ren, testbar logikk i stedet for en
// `has()`-sjekk som ikke kan skille «vet» fra «feilet».
export type ExpandedPanelValue<T> = T[] | 'loading' | 'error'

// Hent når vi ikke VET: aldri hentet (undefined) eller forsøkt og feilet
// ('error'). En faktisk liste — OGSÅ en tom — er viten og caches; 'loading'
// er underveis og skal ikke få et konkurrerende kall.
export function shouldFetchExpanded<T>(existing: ExpandedPanelValue<T> | undefined): boolean {
  return existing === undefined || existing === 'error'
}
