import 'server-only'

// PostgREST returnerer maks 1000 rader per spørring uten eksplisitt range() —
// stille, uten feilmelding. Denne henter i batcher til en batch kommer
// tilbake mindre enn pageSize, slik at ingen kode trenger å anta at ett
// enkelt .select()-kall gir hele resultatet.
//
// buildQuery bygger HELE spørringen på nytt for hver batch (samme filtre,
// ulik range) — Supabase-js sine query-buildere kan ikke "klones" og få
// range() satt etterpå, så hele kjeden må gjenoppbygges per side.
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return rows
}

// ── .in()-lister: en ANNEN, LAVERE grense enn 1000-rads-taket ────────────────
//
// `.in('user_id', ids)` legger hver eneste id i URL-ens query-streng. Ved nok
// id-er sprenger URL-en serverens header-grense, og forespørselen feiler — den
// kuttes ikke stille slik radtaket gjør, men feilen er like usynlig hvis
// kalleren ikke sjekker `error`.
//
// Målt direkte mot prod-PostgREST 26. juli 2026 (rene SELECT-er, 2 forsøk per
// størrelse, helt reproduserbart):
//     380 UUID-er (~16 KB URL)  → OK
//     400 UUID-er (~17 KB URL)  → feiler
//     700 UUID-er (~29 KB URL)  → «Bad Request»
//
// Grensen ligger altså rundt 390 id-er. Det er LAVERE enn de ~1000 radene som
// utløser stille avkutting, så en spørring som filtrerer på mange id-er treffer
// denne veggen FØRST. Facebook-gruppa quizen henvender seg til har 400
// medlemmer, så det er innenfor rekkevidde og ikke et teoretisk problem.
//
// CHUNK_SIZE = 200 er halvparten av den målte grensen — samme «ta halvparten av
// det som faktisk brakk»-margin som WRITE_BATCH_SIZE i resync-season-scores.ts.
const CHUNK_SIZE = 200

/**
 * Som `fetchAllRows`, men for spørringer som filtrerer på en LISTE med nøkler
 * (`.in(kolonne, keys)`).
 *
 * Deler `keys` i biter som er trygt under URL-grensen, og paginerer HVER bit —
 * så begge takene er dekket av samme kall. `buildQuery` får biten den skal
 * filtrere på sammen med range-vinduet, og må bygge hele spørringen på nytt
 * (samme grunn som i `fetchAllRows`).
 *
 * Rekkefølgen på resultatet følger bitene, ikke noen global sortering — bruk
 * `.order()` inne i `buildQuery` hvis rekkefølgen innad i en bit betyr noe.
 */
export async function fetchAllRowsChunked<T>(
  keys: string[],
  buildQuery: (
    chunk: string[],
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { chunkSize?: number; pageSize?: number } = {}
): Promise<T[]> {
  const chunkSize = opts.chunkSize ?? CHUNK_SIZE
  if (keys.length === 0) return []

  const rows: T[] = []
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize)
    const chunkRows = await fetchAllRows<T>(
      (from, to) => buildQuery(chunk, from, to),
      opts.pageSize
    )
    rows.push(...chunkRows)
  }
  return rows
}
