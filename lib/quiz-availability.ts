// ── Er quizen spillbar akkurat nå? — ÉN kilde for alle klientflater ──────────
// (24. august 2026)
//
// Bakgrunn: tre flater lovet spilling på en quiz som var over eller ikke hadde
// åpnet. `66007ee` rettet kortet på /leaderboard/[id], `700347d` rettet
// innloggingspanelet — men begge regnet ut tilstanden inline, og startskjermen
// (den innloggede spilleren) gjorde det ikke i det hele tatt: hun så «Start
// quiz», trykket, og fikk 403 fra start-attempt.
//
// Regelen bor derfor HER, ikke som en tredje kopi. Kallerne velger tekst; de
// avgjør ikke lenger selv hva tilstanden er.
//
// PARITET MED SKRIVEREN (samme regel som admin-sesjonen i CLAUDE.md): denne
// funksjonen speiler åpen-sjekken i `app/api/quiz/start-attempt/route.ts`.
// Tolker klienten STRENGERE, nektes en spiller som serveren ville sluppet
// gjennom; tolker den MILDERE, vises en knapp som svarer 403. Endres vakten i
// ruten, skal denne følge etter.
import { SUBMIT_GRACE_MS, isWithinGrace } from './late-play-window'

export type QuizAvailability =
  /** Spillbar nå — eller: et påbegynt forsøk kan fortsatt leveres (B-10). */
  | 'open'
  /** `opens_at` ligger i framtiden. Ingen kan starte. */
  | 'not-open-yet'
  /** `closes_at` er passert, og det finnes ingen lovlig vei videre. */
  | 'closed'

type QuizWindow = { opens_at?: string | null; closes_at?: string | null }

/**
 * `hasResumableProgress` er klientens beste proxy for serverens
 * «finnes et uferdig forsøk startet før stengetid» — den settes av lagret
 * fremdrift i localStorage (`qk_progress_<quizId>`), som først skrives når
 * spilleren har svart på minst ett spørsmål. Uten den ville reload-stien
 * (`cc9b14a`, gjenbruk innenfor SUBMIT_GRACE_MS) møtt en «stengt»-skjerm av
 * klienten selv om serveren ville svart `reused: true`.
 *
 * Proxyen kan ikke bli for SNILL: er den sann uten at serveren gjenbruker noe,
 * er utfallet kun at spilleren ser knappen og får rutens ærlige feiltekst —
 * altså oppførselen fra før denne gaten fantes.
 */
export function decideQuizAvailability(
  quiz: QuizWindow | null | undefined,
  now: Date,
  { hasResumableProgress = false }: { hasResumableProgress?: boolean } = {},
): QuizAvailability {
  // Ingen quiz-rad: en SKJULT quiz (anon ser den ikke via RLS) eller et
  // oppslag som feilet. Kalleren skal da beholde sin generiske tekst — vi
  // bekrefter ikke hvilke quiz-id-er som finnes, og gjetter ikke tilstand.
  if (!quiz) return 'open'

  const nowMs = now.getTime()
  // NaN for tom/ugyldig verdi. Alle sammenligninger under blir da usanne, og
  // utfallet er 'open' — samme slepphendte tolkning som rutene: en quiz uten
  // gyldig tidsvindu er ikke stengt.
  const opensAt = quiz.opens_at ? new Date(quiz.opens_at).getTime() : NaN
  const closesAt = quiz.closes_at ? new Date(quiz.closes_at).getTime() : NaN

  // Rekkefølgen er ikke tilfeldig: `not-open-yet` vinner over `closed`. En rad
  // med opens_at i framtiden OG closes_at i fortiden er inkonsistente data, og
  // «åpner <dato>» er da den eneste av de to tekstene som kan bli sann.
  if (opensAt > nowMs) return 'not-open-yet'
  if (!(closesAt < nowMs)) return 'open'

  // Etter stengetid finnes ÉN lovlig vei videre — den samme som ruten har:
  // levere et påbegynt forsøk innenfor submit-fristen.
  if (hasResumableProgress && isWithinGrace(closesAt, nowMs, SUBMIT_GRACE_MS)) return 'open'
  return 'closed'
}

/**
 * Innleveringsfristen for et påbegynt forsøk etter stengetid — tallet
 * gjenbruk-skjermen viser spilleren. Null når quizen ikke stenger eller
 * datoen er ugyldig (da finnes ingen frist å love).
 */
export function lateSubmitDeadline(closesAt: string | null | undefined): Date | null {
  if (!closesAt) return null
  const ms = new Date(closesAt).getTime()
  if (Number.isNaN(ms)) return null
  return new Date(ms + SUBMIT_GRACE_MS)
}
