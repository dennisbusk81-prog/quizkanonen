/**
 * Standard tidsgrense (sekunder per spørsmål) for en NY quiz/spørsmål.
 *
 * ÉN kilde, delt av alle stedene som setter tidsgrensen ved opprettelse:
 *   - `app/api/admin/quizzes/import/route.ts` — quiz-nivå-feltet
 *     (`quizzes.time_limit_seconds`), satt både for Excel-import og for
 *     "+ Ny quiz" (som også går via denne ruten)
 *   - `app/admin/quizzes/new/page.tsx` — spørsmål-nivå-default i UI-et
 *     (tomt skjema, AI-generering, placeholder-spørsmålene POSTet ved
 *     tittel-blur)
 *
 * Fram til 31. juli 2026 var dette to tall som hadde driftet fra hverandre:
 * quiz-nivå-feltet var hardkodet 20 (det tallet "Xs per spørsmål"-teksten på
 * /quizer og /admin/quizzes faktisk leser), mens spørsmål-nivå-defaulten i
 * "+ Ny quiz"-skjemaet var hardkodet 10 — og spørsmål-nivå-verdien vinner
 * over quiz-nivå ved faktisk spilling (`question.time_limit_seconds ||
 * quiz.time_limit_seconds`, se `app/quiz/[id]/page.tsx`). Enhver quiz
 * opprettet via "+ Ny quiz" spilte dermed faktisk med 10 sekunder per
 * spørsmål mens listevisningene viste 20 — ikke en "kopier forrige quiz"-bug,
 * men to hardkodede tall som aldri var koblet sammen.
 *
 * Gjelder KUN opprettelse av nye rader. Rører ikke `time_limit_seconds` på
 * allerede lagrede quizer/spørsmål.
 */
export const DEFAULT_QUESTION_TIME_LIMIT_SECONDS = 15

/**
 * Bygger tallet i teksten «Xs per spørsmål» ut fra den tidsgrensen spilleren
 * FAKTISK møter.
 *
 * BAKGRUNN (7. august 2026): tre visningsflater skrev `quizzes.time_limit_seconds`
 * rett ut, mens spillingen bruker `question.time_limit_seconds ||
 * quiz.time_limit_seconds` (se `getTimeLimit` i `app/quiz/[id]/page.tsx`) —
 * altså spørsmål-nivået, med quiz-nivået kun som fallback. De to nivåene er
 * uavhengige kolonner og har divergert i prod: Fredagsquiz 19.06.2026 har
 * quiz-feltet 10 mens alle 15 spørsmål har 15, så startskjermen lovet 10
 * sekunder på en quiz som ble spilt med 15.
 *
 * Den effektive grensen er derfor det ENESTE tallet en tekst har lov å påstå,
 * og den må utledes per spørsmål — ikke leses fra quiz-raden.
 *
 * SPRIK MELLOM SPØRSMÅL: `questions.time_limit_seconds` er nullable og settes
 * per spørsmål i admin (5–60 sek), så ett spørsmål kan ha en annen grense enn
 * naboen. I prod i dag gjør ingen quiz det, men skjemaet tillater det og admin
 * lager det med to klikk. Vi viser da INTERVALLET («10–20s»), ikke den
 * vanligste verdien: en «vanligste verdi» ville vært en ny påstand som er feil
 * for noen av spørsmålene — nøyaktig feilklassen denne funksjonen finnes for.
 *
 * Returnerer null når det ikke finnes noe sant tall å vise, slik at kalleren
 * kan utelate teksten helt i stedet for å rendre «s per spørsmål» uten tall.
 */
export function describeQuestionTimeLimit(
  questionLimits: readonly (number | null | undefined)[],
  quizLimit: number | null | undefined,
): string | null {
  const fallback = isUsableLimit(quizLimit) ? quizLimit : null

  // Samme prioritering som getTimeLimit: spørsmålets egen grense vinner, og
  // quiz-nivået trår til for spørsmål som ikke har satt sin egen.
  const effective: number[] = []
  for (const raw of questionLimits) {
    const limit = isUsableLimit(raw) ? raw : fallback
    if (limit !== null) effective.push(limit)
  }

  // Ingen spørsmål lastet (eller ingen av dem ga et brukbart tall) — fall
  // tilbake på quiz-nivået, som er nøyaktig oppførselen flatene hadde før.
  if (effective.length === 0) return fallback === null ? null : `${fallback}s`

  const min = Math.min(...effective)
  const max = Math.max(...effective)
  return min === max ? `${min}s` : `${min}–${max}s`
}

// 0 og negative tall er ikke en tidsgrense noen har ment å sette, og `||`-kjeden
// i getTimeLimit hopper allerede over dem. Vi speiler den, ellers ville en
// 0-rad gitt «0s per spørsmål» på en quiz som spilles med quiz-nivå-grensen.
function isUsableLimit(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
