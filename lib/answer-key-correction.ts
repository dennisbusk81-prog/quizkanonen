// Ren logikk for fasit («answer key») på et spørsmål — ingen I/O.
//
// PRINSIPP: det skal finnes ÉN kodesti som endrer fasiten på et spørsmål som
// alt er spilt, og det er /api/admin/correct-answer. Den ruten regraderer
// attempt_answers, rekalkulerer attempts.correct_answers/correct_streak og
// synkroniserer season_scores i samme forespørsel.
//
// Den vanlige PATCH-ruten (app/api/admin/quizzes/[id]/questions/[qid]) hadde
// fram til nå sin EGEN, udokumenterte regradering: den satte is_correct på
// attempt_answers ut fra body.correct_answer, men rørte hverken attempts eller
// season_scores. To feil fulgte av det:
//   1. Multi-svar ble kollapset stille. Regraderingen så kun på ÉN bokstav, så
//      et spørsmål med fasit ['A','C'] fikk alle C-svar satt til is_correct =
//      false ved en hvilken som helst vanlig lagring (f.eks. en rettet
//      skrivefeil i spørsmålsteksten) — mens questions.correct_answers fortsatt
//      sa at C var riktig.
//   2. Timeout-rader (selected_answer IS NULL) ble aldri truffet, fordi
//      Postgres' `selected_answer != 'A'` er NULL — ikke true — for NULL-rader.
//
// Regraderingen er nå fjernet fra PATCH. `decideAnswerKeyPatch` under er
// vakten som erstatter den: den slipper gjennom vanlig redigering uendret,
// skriver fasiten direkte så lenge ingen har svart, og LÅSER fasitendringen
// når det finnes svarrader — slik at endringen må gå via correct-answer-ruten.

import { calculateStreak } from '@/lib/ranking'

export const ANSWER_LETTERS = ['A', 'B', 'C', 'D'] as const

/** Fasiten slik den ligger lagret på en questions-rad. */
export type StoredAnswerKey = {
  correct_answer: string | null
  correct_answers: string[] | null
}

/** De to kolonnene som til sammen utgjør fasiten. */
export type AnswerKeyColumns = {
  correct_answer: string
  correct_answers: string[] | null
}

export type ParsedAnswerKey =
  | { ok: true; keys: string[] }
  | { ok: false; error: string }

/**
 * Normaliser og valider et ønsket fasit-sett.
 *
 * Tar imot både `'A'` og `['A', 'C']` — den gamle enkelt-verdi-formen er
 * fortsatt gyldig, slik at en klient som ikke er oppdatert ennå ikke brekker.
 * Store/små bokstaver og mellomrom tåles; duplikater fjernes med rekkefølgen
 * bevart, fordi det FØRSTE elementet blir `correct_answer` (primærsvaret som
 * vises der UI-et bare har plass til ett).
 */
export function parseAnswerKey(input: unknown, maxOptions = 4): ParsedAnswerKey {
  const limit = Number.isFinite(maxOptions) ? Math.min(Math.max(Math.trunc(maxOptions), 2), 4) : 4
  const allowed: readonly string[] = ANSWER_LETTERS.slice(0, limit)

  const raw = Array.isArray(input) ? input : [input]
  if (raw.length === 0) {
    return { ok: false, error: 'Minst ett riktig svar må velges.' }
  }

  const keys: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') {
      return { ok: false, error: 'Riktig svar må angis som bokstav(er) A–D.' }
    }
    const letter = value.trim().toUpperCase()
    if (!allowed.includes(letter)) {
      return {
        ok: false,
        error: `Ugyldig svaralternativ «${value}». Denne quizen har alternativene ${allowed.join(', ')}.`,
      }
    }
    if (!keys.includes(letter)) keys.push(letter)
  }

  return { ok: true, keys }
}

/**
 * Fasiten som en liste, uansett om raden bruker den gamle enkelt-kolonnen
 * eller correct_answers-arrayet. Samme fallback som scoringen i
 * app/api/quiz/[id]/submit/route.ts: arrayet vinner når det har innhold.
 */
export function readStoredKey(row: StoredAnswerKey): string[] {
  if (row.correct_answers && row.correct_answers.length > 0) return row.correct_answers
  return row.correct_answer ? [row.correct_answer] : []
}

/**
 * Fasiten skrevet tilbake til kolonneform.
 *
 * `correct_answers` settes til NULL når det bare er ett riktig svar — nøyaktig
 * samme form som «Spørsmål»-siden alltid har skrevet ved opprettelse, slik at
 * det ikke oppstår to ulike representasjoner av samme fasit i tabellen.
 */
export function answerKeyColumns(keys: string[]): AnswerKeyColumns {
  return {
    correct_answer: keys[0],
    correct_answers: keys.length > 1 ? keys : null,
  }
}

/** Sammenligner to fasit-sett som MENGDER — rekkefølge betyr ingenting her. */
export function sameAnswerKey(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every(k => setB.has(k))
}

/**
 * Er ett enkelt svar riktig gitt fasiten?
 *
 * Timeout (selected_answer = NULL) er ALLTID feil og sjekkes eksplisitt — se
 * samme vakt i submit-ruten. Uten den ville en NULL-fasit og et NULL-svar
 * kunne matche hverandre.
 */
export function gradeAnswer(selected: string | null, keys: string[]): boolean {
  if (selected === null) return false
  return keys.includes(selected)
}

export type AnswerRow = { id: string; selected_answer: string | null }
export type RegradedRow = { id: string; is_correct: boolean }

/** Ny is_correct for hver svarrad på spørsmålet som rettes. */
export function gradeAnswerRows(rows: AnswerRow[], keys: string[]): RegradedRow[] {
  return rows.map(r => ({ id: r.id, is_correct: gradeAnswer(r.selected_answer, keys) }))
}

export type AttemptAnswerRow = { attempt_id: string; question_id: string; is_correct: boolean }
export type AttemptTotals = { correctAnswers: number; correctStreak: number }

/**
 * Nye totaler per forsøk etter en regradering.
 *
 * `orderedQuestionIds` MÅ være quizens spørsmål i order_index-rekkefølge:
 * correct_streak er lengste sammenhengende rekke slik SPILLEREN så
 * spørsmålene, ikke slik radene tilfeldigvis ligger i attempt_answers.
 * (attempts.question_order er NULL for alle rader i prod, så order_index er
 * den faktiske rekkefølgen.)
 *
 * correct_answers telles over RÅ rader. Bevisst: noen få forsøk har duplikate
 * svarrader, og å telle distinkt her ville endret lagrede poengsummer — og
 * dermed plasseringer — som en utilsiktet bieffekt av en fasitretting.
 * Duplikatene håndteres som egen sak.
 */
export function planAttemptTotals(
  rows: AttemptAnswerRow[],
  orderedQuestionIds: string[],
): Map<string, AttemptTotals> {
  const byAttempt = new Map<string, AttemptAnswerRow[]>()
  for (const r of rows) {
    const list = byAttempt.get(r.attempt_id) ?? []
    list.push(r)
    byAttempt.set(r.attempt_id, list)
  }

  const totals = new Map<string, AttemptTotals>()
  for (const [attemptId, attemptRows] of byAttempt) {
    const correctAnswers = attemptRows.filter(r => r.is_correct).length

    // Siste rad vinner ved duplikater — samme rad-sett som telles over, så
    // streaken kan ikke bli lengre enn antall riktige.
    const gradeByQuestion = new Map(attemptRows.map(r => [r.question_id, r.is_correct]))
    const correctStreak = calculateStreak(
      orderedQuestionIds.map(qid => ({ is_correct: gradeByQuestion.get(qid) === true })),
    )

    totals.set(attemptId, { correctAnswers, correctStreak })
  }
  return totals
}

// ── PATCH-vakten ─────────────────────────────────────────────────────────────

export type AnswerKeyPatchDecision =
  /** Fasiten er ikke med i forespørselen, eller er identisk med den lagrede.
   *  PATCH skal droppe fasit-kolonnene og lagre resten som normalt. */
  | { action: 'unchanged' }
  /** Ingen har svart ennå — fasiten kan skrives rett inn, ingenting å regradere. */
  | { action: 'write'; columns: AnswerKeyColumns; keys: string[] }
  /** Spørsmålet er spilt. PATCH skal IKKE røre fasiten; endringen må gå via
   *  /api/admin/correct-answer, som regraderer og synker season_scores. */
  | { action: 'locked'; currentKey: string[]; requestedKey: string[]; answeredCount: number }
  | { action: 'invalid'; error: string }

/**
 * Avgjør hva PATCH skal gjøre med fasiten i en forespørsel.
 *
 * Merk at 'locked' krever at fasiten FAKTISK er endret. Begge admin-sidene
 * sender fasiten i hver eneste lagring, også når admin bare rettet en
 * skrivefeil — de lagringene må gå gjennom uendret, ellers ville en spilt quiz
 * blitt uredigerbar.
 *
 * Et forsøk som er startet, men ikke levert, har ingen attempt_answers-rader
 * ennå (de skrives ved innsending). Da er answeredCount 0 og fasiten skrives
 * direkte — spilleren scores på den nye fasiten ved innsending, som er samme
 * oppførsel som før.
 */
export function decideAnswerKeyPatch(args: {
  /** Fasit-feltene slik de kom inn. `undefined` = ikke med i forespørselen. */
  requested: unknown | undefined
  stored: StoredAnswerKey
  answeredCount: number
  maxOptions?: number
}): AnswerKeyPatchDecision {
  const { requested, stored, answeredCount, maxOptions } = args

  if (requested === undefined || requested === null) return { action: 'unchanged' }

  const parsed = parseAnswerKey(requested, maxOptions ?? 4)
  if (!parsed.ok) return { action: 'invalid', error: parsed.error }

  const currentKey = readStoredKey(stored)
  if (currentKey.length > 0 && sameAnswerKey(parsed.keys, currentKey)) {
    return { action: 'unchanged' }
  }

  if (answeredCount > 0) {
    return { action: 'locked', currentKey, requestedKey: parsed.keys, answeredCount }
  }

  return { action: 'write', columns: answerKeyColumns(parsed.keys), keys: parsed.keys }
}
