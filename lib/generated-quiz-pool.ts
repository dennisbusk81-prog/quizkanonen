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
// det (CLAUDE.md-fella om IN-listene i 20260825000000).
//
// ── TO VEIER TIL SAMME PULJE (9. september 2026) ────────────────────────────
// fetchPoolQuestionIds (under) henter hele id-settet til Vercel i paginerte
// lesinger og lar sampleDistinct trekke. Målt 8. september: 1065–1218 ms av
// ~2,2 s total — fem rundturer for å trekke 15. pickPoolQuestionIds (nederst)
// er den nye veien: én RPC (migrasjon 20260909000000) som trekker i
// databasen. Hvitelisten sendes INN som argument (REAL_QUIZ_TYPES), så
// SQL-en har ingen egen IN-liste å drifte — det var innvendingen mot en RPC,
// og den er svart på. Den gamle funksjonen står til den nye er verifisert
// mot prod (samme kandidatsett, blandet og per kategori); ruten bruker den
// nye.
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
import { onlyRealQuizzes, REAL_QUIZ_TYPES } from '@/lib/real-quiz-population'
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

/**
 * Trekker `count` distinkte spørsmåls-id-er fra puljen — i databasen, som
 * én RPC (pick_pool_question_ids, migrasjon 20260909000000). Samme
 * kandidatsett som fetchPoolQuestionIds over; hvitelisten REAL_QUIZ_TYPES
 * sendes inn, ikke gjentatt i SQL. Feil er { ok: false } («vet ikke»), aldri
 * en tom liste — av samme grunn som over. Færre enn `count` id-er tilbake
 * betyr at puljen er mindre enn `count`; kalleren avgjør om det er nok.
 */
export async function pickPoolQuestionIds(input: {
  category: string | null
  count: number
  nowIso: string
}): Promise<Loaded<string[]>> {
  const { data, error } = await supabaseAdmin.rpc('pick_pool_question_ids', {
    p_category: input.category,
    p_count: input.count,
    p_real_types: [...REAL_QUIZ_TYPES],
    p_now: input.nowIso,
  })
  if (error) {
    console.error('[generated-quiz-pool] pick_pool_question_ids feilet:', error.message)
    return { ok: false }
  }
  if (!Array.isArray(data) || !data.every((x) => typeof x === 'string')) {
    console.error('[generated-quiz-pool] pick_pool_question_ids ga uventet form:', typeof data)
    return { ok: false }
  }
  // Distinkt per konstruksjon (LIMIT over ett sett) — Set-et er et belte i
  // tillegg til bukseselene, som i unionen over.
  return { ok: true, value: [...new Set(data as string[])] }
}
