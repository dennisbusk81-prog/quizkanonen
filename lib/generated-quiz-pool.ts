// ── Puljen: hvilke spørsmål en generert quiz kan trekkes fra, og trekningen ──
//
// Bygget 8. september 2026 for POST /api/tilfeldig-quiz. To deler:
//   • sampleDistinct      — REN trekning uten gjentak (testdekket, injiserbar RNG)
//   • pickPoolQuestionIds — I/O: trekker puljens id-er i databasen (én RPC)
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
// det (CLAUDE.md-fella om IN-listene i 20260825000000). Derfor sendes
// hvitelisten INN i RPC-en som argument (p_real_types) i stedet for å stå i
// SQL-en; migrasjon 20260909000000 har ingen egen IN-liste.
//
// ── HISTORIKK: FRA FEM RUNDTURER TIL ÉN (9. september 2026) ─────────────────
// Fram til 9. september hentet fetchPoolQuestionIds hele id-settet (4235
// rader) til Vercel i paginerte lesinger og lot sampleDistinct trekke. Målt
// 8. september: 1065–1218 ms av ~2,2 s total. pickPoolQuestionIds trekker i
// databasen i én rundtur (123–131 ms målt). Den gamle funksjonen ble fjernet
// etter at RPC-en var verifisert mot prod med scripts/verify-pool-rpc.ts:
// samme kandidatsett id for id (4235 blandet, 460 Sport, 252 Historie), fem
// trekninger fem ulike sett. `is_test = false` i SQL-en (ikke IS NOT TRUE):
// kildegaten (decideArchiveSourceEligibility) krever === false og avviser
// NULL som «vet ikke».
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { REAL_QUIZ_TYPES } from '@/lib/real-quiz-population'

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

/**
 * Trekker `count` distinkte spørsmåls-id-er fra puljen — i databasen, som
 * én RPC (pick_pool_question_ids, migrasjon 20260909000000). Hvitelisten
 * REAL_QUIZ_TYPES sendes inn, ikke gjentatt i SQL. Feil er { ok: false }
 * («vet ikke»), aldri en tom liste: en tom liste ville gitt «for få
 * spørsmål» til brukeren, som er et USANT svar når databasen bare var
 * utilgjengelig. Færre enn `count` id-er tilbake betyr at puljen er mindre
 * enn `count`; kalleren avgjør om det er nok.
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
