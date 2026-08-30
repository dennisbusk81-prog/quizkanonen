// ── «Alle quizer» på /admin/quizzes, delt i to grupper ──────────────────────
// (30. august 2026, B-29b)
//
// BAKGRUNN
// c32c62d merket arkivkopiene med egen badge, men de LIGGER fortsatt øverst:
// lista sorteres av ruten på `created_at` DESC, og en arkivkopi er per
// definisjon nyere enn fredagsquizen den er kopiert fra. Med tre kopier ble
// Dennis' tre ekte quizer (11.09, 04.09, 28.08) skjøvet under skjermkanten —
// og hver arkivrunde han spiller legger til en ny på toppen, for alltid.
//
// Kravet, ordrett: «jeg kommer nok aldri til å se på disse treningsforsøk,
// men greit hvis de ligger en plass. men de skal ikke forurense min viktigste
// quizoversikt.»
//
// ── HVORFOR EN DELING OG IKKE ET FILTER ────────────────────────────────────
// Arkivkopiene skal BLI VÆRENDE på flaten — /admin/quizzes er Dennis' eneste
// vei til å slette dem. Samme grep som /historikk fikk 25.–26. august:
// arkivforsøkene i egen seksjon, ikke blandet inn i fredagshistorikken, og
// ikke fjernet. Ruten røres ikke: GET /api/admin/quizzes mater også «Siste
// quizer» på /admin, som har motsatt behov (se lib/admin-recent-quizzes.ts).
//
// ── SKILLET ER `erEkteQuiz`, IKKE `quiz_type === 'archive'` ────────────────
// Definisjonen av «ekte quiz» bor ÉTT sted (lib/real-quiz-population.ts) og
// har to halvdeler som fanger hver sin quiz: hvitelisten på `quiz_type` tar
// oppskriftens testquiz og arkivkopiene, mens `is_test` tar admin-editorens
// testbryter (som lar `quiz_type` stå på 'weekly'). En håndskrevet
// arkiv-sjekk her ville sluppet den siste opp i hovedlista — og den er like
// mye forurensning som en arkivkopi.
//
// Delingen er derfor UTTØMMENDE og gjensidig utelukkende: hver rad havner i
// nøyaktig én gruppe, og ingen rad forsvinner. Testet som sum-invariant, ikke
// bare som «arkiv havnet i arkiv».
import { erEkteQuiz } from './real-quiz-population'

export type QuizGrupper<T> = {
  /** Fredagsquizene. Rekkefølgen fra kalleren er urørt. */
  ekte: T[]
  /** Alt som ikke er ekte konkurranse — arkivkopier og testquizer. */
  arkiv: T[]
}

type GrupperbarQuiz = { is_test?: boolean | null; quiz_type?: string | null }

/**
 * Deler quiz-lista i to grupper uten å sortere om eller slippe noe.
 *
 * Sorteringen er bevisst ikke rørt: hovedlista skal beholde nøyaktig den
 * rekkefølgen ruten leverte (`created_at` DESC), og arkivgruppen arver den
 * samme. Deling er alt denne funksjonen gjør.
 */
export function splitAdminQuizList<T extends GrupperbarQuiz>(rows: readonly T[]): QuizGrupper<T> {
  const ekte: T[] = []
  const arkiv: T[] = []
  for (const rad of rows) (erEkteQuiz(rad) ? ekte : arkiv).push(rad)
  return { ekte, arkiv }
}

/**
 * Overskriften på den sammenslåtte seksjonen, med antall.
 *
 * Gruppen er definert som «ikke ekte quiz», og den rommer derfor to ting:
 * arkivkopier og testquizer. I prod finnes i dag kun det første (13 weekly +
 * 3 archive, målt 30. august 2026), og «Arkivkopier» er da den ærlige
 * teksten. Etiketten utledes likevel av innholdet i stedet for å være en
 * konstant — en testquiz opprettet fra admin-editorens bryter havner i samme
 * gruppe, og en overskrift som da fortsatt sa «Arkivkopier» ville vært en
 * påstand om innholdet som ikke stemmer.
 */
export function arkivGruppeTittel(arkiv: readonly GrupperbarQuiz[]): string {
  const kunArkiv = arkiv.every(q => q.quiz_type === 'archive')
  return `${kunArkiv ? 'Arkivkopier' : 'Arkivkopier og testquizer'} (${arkiv.length})`
}
