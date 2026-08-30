// ── «Siste quizer» på /admin — utvalget, som ren funksjon ────────────────────
// (30. august 2026, B-29)
//
// Lista hentet HELE quiz-tabellen fra GET /api/admin/quizzes, sorterte på
// `updated_at` og tok de tre øverste. Arkivkopier er de ferskeste radene i
// basen, så de la seg ØVERST og skjøv de ekte fredagsquizene ut av en liste
// som bare har tre plasser.
//
// ── HVORFOR IKKE ET FILTER I RUTEN ─────────────────────────────────────────
// GET /api/admin/quizzes mater TO flater: denne lista OG hele /admin/quizzes.
// Den siste SKAL vise arkivkopiene — admin må kunne finne og slette dem
// (Dennis' beslutning 30. august, samme skille som /admin/users/[id] fikk
// 29. august: tellinger filtreres, den komplette lista beholdes med markør).
// Et filter i ruten ville lukket denne lekkasjen og åpnet den andre.
//
// ── HVORFOR EN EGEN FIL OG IKKE `.filter(erEkteQuiz)` PÅ KALLSTEDET ────────
// Utvalget er tre ledd som må stå i riktig rekkefølge — filtrer, SÅ sorter,
// SÅ kutt. Skrives de inline er `.slice(0, 3)` før filteret en endring som
// ser identisk ut i diffen og gir tre tomme plasser. Som ren funksjon kan
// rekkefølgen felles av en test.
//
// Populasjonsdefinisjonen kommer fra `erEkteQuiz` (lib/real-quiz-population.ts)
// — predikat-formen av `onlyRealQuizzes`, speilet ned på NULL-semantikken.
// Ikke skriv en egen `quiz_type !== 'archive'`-sjekk her: den slipper
// testquizer gjennom, som `is_test`-halvdelen av definisjonen fanger.
import { erEkteQuiz } from './real-quiz-population'

/** Antall rader lista viser. Kuttet skjer ETTER filtreringen. */
export const RECENT_QUIZ_LIMIT = 3

type SorterbarQuiz = {
  updated_at: string
  is_test?: boolean | null
  quiz_type?: string | null
}

/**
 * De `limit` sist oppdaterte EKTE quizene, nyest først.
 *
 * Muterer ikke inndata — `.sort()` sorterer på stedet, så kopien er ikke
 * kosmetikk: kalleren holder samme array i React-state.
 */
export function selectRecentQuizzes<T extends SorterbarQuiz>(
  rows: readonly T[],
  limit: number = RECENT_QUIZ_LIMIT,
): T[] {
  return rows
    .filter(erEkteQuiz)
    .slice()
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, limit)
}
