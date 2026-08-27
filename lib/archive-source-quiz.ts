// ── Har denne arkivkopien et FROSSET FELT å måles mot? ───────────────────────
//
// Ren beslutning uten I/O, bygget 27. august 2026 ([ARK-1] steg 1B). Samme
// deling som lib/archive-copy.ts og lib/archive-play-gate.ts: hva som er
// SANT om en kopi avgjøres her, mens ruten kun skaffer fakta og skriver.
//
// Svaret lagres i `quizzes.source_quiz_id` (migrasjon 20260827000000) fordi
// det er den eneste veien tilbake til originalquizen: kopieringsruten MÅ
// kopiere spørsmålsradene (`questions.quiz_id` er én enkelt FK, ingen
// koblingstabell — kartlagt 26. august), så kopien bærer ellers ingen spor.
//
// ── TRE KRAV, OG HVERT AV DEM HAR EN KONKRET FEIL BAK SEG ──────────────────
//
// 1. ÉN FELLES FORELDER. En generert quiz er femten spørsmål fra femten ulike
//    fredager. Det finnes da ikke ETT felt å måles mot, og å velge det
//    første ville vært å finne på et.
//
// 2. FORELDEREN MÅ VÆRE EN EKTE QUIZ (`erEkteQuiz`, altså husets hviteliste
//    i lib/real-quiz-population.ts — ikke en egen kopi av regelen her).
//    En testquiz har et felt, men ikke ET FELT NOEN SKAL MÅLES MOT; det er
//    samme grense som gjør at arkivforsøk ikke teller i statistikken.
//    Kildegaten i POST /api/arkiv avviser allerede testquizer og alt som
//    ikke er stengt — kravet her er strengere OG uavhengig, fordi det svarer
//    på et annet spørsmål: ikke «er dette lov å kopiere», men «finnes det en
//    rangering det er forsvarlig å sammenligne seg med».
//
// 3. KOPIEN MÅ DEKKE HELE FORELDEREN. Dette er fella som ikke er åpenbar:
//    tar spilleren 5 av quiz 47 sine 15 spørsmål, har feltets rader
//    `correct_answers` av 15 mens hennes er av 5. computePlacement
//    sammenligner rå tall og ville rangert henne sist uansett hvor godt hun
//    svarte — en plassering som ser presis ut og er ren støy. Delvis kopi
//    får derfor NULL, ikke en tilnærming.
//
// ── «VET IKKE» BLIR NULL, OG DET ER RIKTIG RETNING HER ─────────────────────
// Klarer ikke ruten å telle forelderens spørsmål (`parentQuestionCount`
// null), er svaret NULL — ingen kobling. Det bryter ikke med «vet ikke er
// aldri en dom» (lib/archive-play-gate.ts): den regelen verner om TILGANG,
// der feil retning stenger en betalende kunde ute. Her er utfallet en
// visning som uteblir, og alternativet er å påstå en plassering vi ikke vet
// er sammenlignbar. NULL er dessuten en tilstand flaten uansett må
// håndtere fra dag én, ikke en feilsti.
//
// Merk at NULL er ENDELIG for den kopien: den skrives én gang, ved
// opprettelse. Det er med vilje — koblingen skal ikke kunne endre seg fordi
// en admin senere redigerer originalquizen.

import { erEkteQuiz } from './real-quiz-population'

/** Forelder-quizen slik kildeoppslaget i POST /api/arkiv leverer den. */
export type ArchiveParentQuiz = {
  id?: string | null
  is_test?: boolean | null
  quiz_type?: string | null
} | null

export type ArchiveSourceRow = { quiz: ArchiveParentQuiz }

/**
 * Har samtlige kildespørsmål samme forelder, og er den forelderen en ekte
 * quiz? Returnerer forelder-id-en, ellers null.
 *
 * Skilt ut som egen eksport fordi ruten trenger svaret FØR den bestemmer seg
 * for å bruke en rundtur på å telle forelderens spørsmål: er det ingen felles
 * forelder, er tellingen bortkastet. Den endelige avgjørelsen tas likevel kun
 * ett sted — `deriveArchiveSourceQuizId` kaller denne selv.
 */
export function singleSourceParentId(rows: readonly ArchiveSourceRow[]): string | null {
  if (rows.length === 0) return null

  let shared: string | null = null
  for (const row of rows) {
    const quiz = row.quiz
    const id = quiz?.id
    // Manglende forelder eller manglende id → ingen kobling. (Kildegaten
    // avviser allerede quiz-løse spørsmål, men denne funksjonen skal kunne
    // svare sant uten å hvile på at en annen gate kjørte først.)
    if (!quiz || typeof id !== 'string' || id.length === 0) return null
    // Hvitelisten, ikke en egen regel: utvides REAL_QUIZ_TYPES, følger denne
    // med automatisk (CLAUDE.md-fella om nye quiz_type-verdier).
    if (!erEkteQuiz(quiz)) return null
    if (shared === null) shared = id
    else if (shared !== id) return null
  }
  return shared
}

/**
 * Den endelige koblingen som skrives til `quizzes.source_quiz_id`.
 *
 * `parentQuestionCount` er antall spørsmål forelderen har TOTALT (null =
 * kunne ikke telles). Kopien må dekke hele forelderen — se krav 3 i filhodet.
 */
export function deriveArchiveSourceQuizId(input: {
  rows: readonly ArchiveSourceRow[]
  parentQuestionCount: number | null
}): string | null {
  const parentId = singleSourceParentId(input.rows)
  if (parentId === null) return null
  if (input.parentQuestionCount === null) return null
  // Likhet, ikke `>=`: kopien kan hverken mangle spørsmål (delvis reprise)
  // eller inneholde flere enn forelderen har (umulig gitt krav 1, men da er
  // premisset uansett brutt og en påstand om «samme quiz» er feil).
  if (input.parentQuestionCount !== input.rows.length) return null
  return parentId
}
