// ── Hvilket varsel skal en 403 fra questions-ruten telles som? ───────────────
//
// BAKGRUNN (5. september 2026): varselet i `fetchQuestionAt`
// (app/quiz/[id]/page.tsx) fyrte på ENHVER 403 med teksten «spiller trolig
// strandet ved stengetid». Betingelsen var `res.status === 403` og ingenting
// annet — «ved stengetid» var en påstand i meldingsstrengen, ikke noe koden
// hadde regnet ut.
//
// Det ble målt: 4. september fyrte varselet på en ARKIVQUIZ med
// `opens_at = NULL` og `closes_at = NULL`. Den kan ikke stenge. Spilleren
// startet 12:16:28, fikk 403-en 3,3 sekunder senere, spilte ferdig alle 15
// spørsmål og leverte 12:18:21 — hun strandet aldri, og stengetid var aldri
// inne i bildet. Saken i Sentry talte da to ulike ting under én overskrift, og
// tallet var ikke lesbart i noen retning.
//
// LØSNINGEN ER IKKE EN DATOSAMMENLIGNING. Å filtrere på `closes_at === null`
// ville skjult akkurat denne hendelsen uten å fjerne feilen: den samme usanne
// meldingen ville fortsatt fyrt på et token-403 i en quiz som HAR en
// stengetid. Klienten skulle uansett ikke begynt å tolke datoer på egen hånd —
// da ville den tolkningen kunne drifte fra rutens (samme paritetsregel som for
// admin-sesjonen i CLAUDE.md).
//
// I stedet skilles det på det serveren FAKTISK sa. `QUIZ_CLOSED_ERROR` er den
// delte kontrakten med questions-ruten (lib/late-play-window.ts): sier den det,
// ER quizen stengt — per definisjon, uten at noen klokke er lest. Alt annet er
// en av rutens fire STILLE 403-utganger (ugyldig token, manglende tilgang til
// forsøket, allerede levert, skjult quiz), og om dem kan vi ikke påstå noe.
//
// HVORFOR `serverError` MÅ FØLGE MED I `extra`: questions-ruten logger
// INGENTING ved 403 — alle utgangene returnerer en ren JSON-respons uten et
// eneste `console.error`. Sentry-extra er dermed den ENESTE kilden til hvilken
// utgang som traff. Et «årsak ukjent»-varsel uten `serverError` ville ikke vært
// mer lesbart enn det vi erstatter. Derfor bygges melding og extra HER, i
// samme funksjon, av den samme normaliserte verdien: de to kan ikke drifte fra
// hverandre, og ingen framtidig kaller kan sende det ene uten det andre.
//
// TO KONSTANTER, ALDRI INTERPOLERT TEKST: Sentry grupperer på meldingsstrengen.
// `403 — ${serverError}` ville laget én sak per feiltekst; én felles streng
// ville slått dem sammen igjen. Nøyaktig to konstanter gir nøyaktig to tellere.
import { QUIZ_CLOSED_ERROR } from './late-play-window'

/**
 * Stengetid, bekreftet av serveren selv. Teksten er UENDRET siden a8b7adc, med
 * vilje: Sentry-saken som har talt B-10-hendelser siden 23. august skal beholde
 * historikken sin i stedet for å starte på null.
 */
export const QUESTIONS_403_CLOSED_ALERT =
  'quiz: spørsmålshenting avvist med 403 — spiller trolig strandet ved stengetid'

/** Alt annet: en av de stille utgangene. `serverError` i extra sier hvilken. */
export const QUESTIONS_403_UNKNOWN_ALERT =
  'quiz: spørsmålshenting avvist med 403 — årsak ukjent'

export type Questions403Alert = {
  message: string
  extra: {
    quizId: string
    attemptId: string | null
    index: number
    serverError: string | null
  }
}

export function buildQuestions403Alert(input: {
  quizId: string
  attemptId: string | null
  index: number
  /** `error`-feltet fra responsen. Mangler det (ulesbar body), er det null. */
  serverError: string | null | undefined
}): Questions403Alert {
  // Normaliseres ÉN gang og brukes både i valget og i extra. Skilles de to,
  // kan meldingen si «ukjent» mens extra viser stengetid, eller omvendt.
  const serverError = input.serverError ?? null

  return {
    message: serverError === QUIZ_CLOSED_ERROR
      ? QUESTIONS_403_CLOSED_ALERT
      : QUESTIONS_403_UNKNOWN_ALERT,
    extra: {
      quizId: input.quizId,
      attemptId: input.attemptId,
      index: input.index,
      serverError,
    },
  }
}
