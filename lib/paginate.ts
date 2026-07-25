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
