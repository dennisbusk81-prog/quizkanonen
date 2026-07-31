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
