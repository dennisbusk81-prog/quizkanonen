// ── Puljen: hvilke spørsmål en generert quiz kan trekkes fra, og trekningen ──
//
// Bygget 8. september 2026 for POST /api/tilfeldig-quiz. To deler:
//   • sampleDistinct   — REN trekning uten gjentak (testdekket, injiserbar RNG)
//   • fetchPoolQuestionIds — I/O: henter puljens id-er fra databasen
//
// ── PULJEN ──────────────────────────────────────────────────────────────────
//   spørsmål med quiz_id IS NULL (biblioteket — 4040 rader importert
//     september 2026, fjorten kategorier med samme navn som
//     lib/quiz-categories.ts), ELLER
//   spørsmål i en quiz med quiz_type i REAL_QUIZ_TYPES ('weekly','bonus'),
//     is_test = false, og closes_at i fortiden
//
// ALDRI spørsmål fra archive-quizer. De er allerede kopier — tas de med,
// kopierer generatoren kopier, og biblioteket dobles stille for hver quiz
// som genereres. Utelukkelsen er ikke en egen svarteliste her, men følger av
// husets HVITELISTE (onlyRealQuizzes, lib/real-quiz-population.ts): 'archive'
// står ikke i REAL_QUIZ_TYPES. Utvides hvitelisten med en ny ekte type,
// følger puljen med automatisk — og en SQL-kopi av regelen ville ikke gjort
// det (CLAUDE.md-fella om IN-listene i 20260825000000). Det er grunnen til at
// puljen bygges i TS med paginerte lesinger, ikke som én RPC.
//
// `.eq('is_test', false)` står i TILLEGG til hvitelistens `IS NOT TRUE`:
// kildegaten (decideArchiveSourceEligibility) krever `=== false` og avviser
// NULL som «vet ikke». Uten det eksplisitte filteret kunne puljen levere en
// rad gaten så avviser, og hele genereringen ville feilet på ett spørsmål.
//
// ── PAGINERT FRA FØRSTE LINJE ───────────────────────────────────────────────
// Biblioteket er 4040 rader — over PostgREST sitt stille 1000-radskutt fra
// dag én. Uten fetchAllRows ville «blandet quiz» trukket fra de første 1000
// radene i id-rekkefølge, hver gang, uten feilmelding. Alle spørringene har
// .order('id') (totalordning) så et paginert kutt er reproduserbart (husregel:
// .range() uten .order() = ustabilt radsett).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows, fetchAllRowsChunked } from '@/lib/paginate'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'
import type { Loaded } from '@/lib/fetch-result'

/**
 * Trekker `count` DISTINKTE elementer fra `items`, tilfeldig og uten gjentak
 * (delvis Fisher–Yates). Er `items` kortere enn `count`, returneres alle i
 * tilfeldig rekkefølge — kalleren avgjør om det er nok.
 *
 * Ren: `random` injiseres (default Math.random) så trekningen er
 * deterministisk i test. Muterer aldri `items`.
 */
export function sampleDistinct<T>(
  items: readonly T[],
  count: number,
  random: () => number = Math.random
): T[] {
  const pool = [...items]
  const n = Math.min(Math.max(0, Math.floor(count)), pool.length)
  for (let i = 0; i < n; i++) {
    // Indeks i [i, pool.length): hvert element velges nøyaktig én gang.
    const j = i + Math.floor(random() * (pool.length - i))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  return pool.slice(0, n)
}

type IdRow = { id: string }

/**
 * Puljens spørsmåls-id-er — biblioteket + stengte ekte quizer, valgfritt
 * avgrenset til én kategori. Feil er `{ ok: false }` (vet ikke), aldri en
 * tom liste: en tom liste ville gitt «for få spørsmål» til brukeren, som er
 * et USANT svar når databasen bare var utilgjengelig.
 */
export async function fetchPoolQuestionIds(input: {
  category: string | null
  nowIso: string
}): Promise<Loaded<string[]>> {
  const { category, nowIso } = input
  try {
    // Del 1: biblioteket.
    const bank = await fetchAllRows<IdRow>((from, to) => {
      let q = supabaseAdmin.from('questions').select('id').is('quiz_id', null)
      if (category !== null) q = q.eq('category', category)
      return q.order('id', { ascending: true }).range(from, to)
    })

    // Del 2a: de stengte ekte quizene. Spørringen i en lokal variabel og
    // helperen påført ETTERPÅ — inlinet som argument gir TS2589 i `next build`
    // (regelen i lib/real-quiz-population.ts; samme form som /api/arkiv GET).
    const closedQuizzes = await fetchAllRows<IdRow>((from, to) => {
      const base = supabaseAdmin
        .from('quizzes')
        .select('id')
        .eq('is_test', false)
        .lte('closes_at', nowIso)
      const query = onlyRealQuizzes(base)
      return query.order('id', { ascending: true }).range(from, to)
    })

    // Del 2b: spørsmålene deres. .in()-lister brekker ved ~390 id-er, derfor
    // chunket (lib/paginate.ts).
    const played = await fetchAllRowsChunked<IdRow>(
      closedQuizzes.map((q) => q.id),
      (chunk, from, to) => {
        let q = supabaseAdmin.from('questions').select('id').in('quiz_id', chunk)
        if (category !== null) q = q.eq('category', category)
        return q.order('id', { ascending: true }).range(from, to)
      }
    )

    // Union på id — de to delene er disjunkte (quiz_id NULL vs. satt), men
    // et Set koster ingenting og gjør «samme spørsmål to ganger» strukturelt
    // umulig her, ikke bare sannsynlig.
    const ids = new Set<string>()
    for (const row of bank) ids.add(row.id)
    for (const row of played) ids.add(row.id)
    return { ok: true, value: [...ids] }
  } catch (e) {
    console.error(
      '[generated-quiz-pool] kunne ikke lese puljen:',
      e instanceof Error ? e.message : e
    )
    return { ok: false }
  }
}
