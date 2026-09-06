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
// ── 'error' ERSTATTET AV ÅRSAKEN (6. september 2026) ────────────────────────
// Sentinelen bar tidligere bare «det feilet». Da fikk en ansatt som ble
// fjernet fra organisasjonen mens siden sto åpen «Kunne ikke hente topplisten
// for perioden. Prøv igjen» — et råd som ikke kan følges. Årsaken kommer nå
// fra samme klassifisering som hovedhentingen bruker
// (lib/leaderboard-avvisning.ts), slik at de tre hentestedene i
// SeasonLeaderboard ikke kan drive fra hverandre.
import type { Avvisning } from './leaderboard-avvisning'

export type ExpandedPanelValue<T> = T[] | 'loading' | Avvisning

// Hent når vi ikke VET og et nytt forsøk kan hjelpe: aldri hentet (undefined)
// eller en ekte feil ('feil' — nettverk, 500, 429). En faktisk liste — OGSÅ en
// tom — er viten og caches; 'loading' er underveis og skal ikke få et
// konkurrerende kall.
//
// 'uinnlogget' og 'ikke-medlem' hentes IKKE på nytt: serveren har svart
// entydig, og situasjonen endrer seg ikke av at raden lukkes og åpnes igjen.
// Visningen tilbyr derfor heller ingen retry-knapp der.
export function shouldFetchExpanded<T>(existing: ExpandedPanelValue<T> | undefined): boolean {
  return existing === undefined || existing === 'feil'
}
