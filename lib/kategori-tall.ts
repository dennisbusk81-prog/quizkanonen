// Avgjør om «25% riktige (1 av 4)» kan vises under et kategorinavn på
// /historikk. Ren funksjon, testdekket i kategori-tall.test.ts.
//
// Hvorfor dette er en egen, testbar funksjon og ikke en `&&` inne i JSX:
// 4. august 2026 rendret kategorikortene «% riktige ( av )» på Dennis' egen
// konto. Tallene var riktige i databasen og riktige ut av getPlayerStats —
// feilen satt i det ene uttrykket som avgjorde om linja skulle vises, og det
// uttrykket kunne ikke kjøres av testsuiten fordi det lå i en .tsx-fil bak
// innlogging og Premium. Nå kan det.

export type KategoriTallVerdier = {
  prosent: number
  riktige: number
  besvart: number
}

/**
 * Returnerer tallene bare når ALLE tre finnes — ellers null, og kalleren
 * viser ingenting.
 *
 * `== null` er bevisst løs sammenligning: den fanger BÅDE `null` og
 * `undefined`. Typene i `PlayerStats` sier `number | null`, men de beskriver
 * det serveren returnerer i dag — ikke det som ligger i `sessionStorage`.
 * /historikk bufrer hele API-svaret under `qk_historikk_*`, og et blob
 * skrevet av en tidligere deploy mangler felt som ble lagt til etterpå.
 * TypeScript kan ikke se det: typen påstås ved `JSON.parse`, den
 * kontrolleres ikke. En `!== null`-vakt slipper `undefined` rett gjennom, og
 * React rendrer `undefined` som tom streng — derav «% riktige ( av )».
 *
 * De tre tallene henger sammen: en prosent uten nevner er nettopp det
 * kortene skulle slutte å vise, så delvis data behandles som ingen data.
 */
export function kategoriTall(
  prosent: number | null | undefined,
  riktige: number | null | undefined,
  besvart: number | null | undefined,
): KategoriTallVerdier | null {
  if (prosent == null || riktige == null || besvart == null) return null
  return { prosent, riktige, besvart }
}
