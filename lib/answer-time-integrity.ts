// ── Integritetssjekk på klientrapportert svartid ─────────────────────────────
// Ren logikk, ingen I/O. Brukt av app/api/quiz/[id]/submit/route.ts.
//
// BAKGRUNN (1. august 2026): `total_time_ms` avgjør plassering — både på
// quiz-leaderboardet og i `rankSeasonAttempts` (lib/season-points.ts), som
// sorterer på riktige svar og deretter STIGENDE total_time_ms. Tiden kom
// utelukkende fra klienten (`Date.now() - questionStartTime` i quiz-siden), og
// den eneste kontrollen på den var en clamp til [0, tidsgrense]. Null er
// innenfor det intervallet. Et script med ett gyldig attempt-token kunne derfor
// sende `timeMs: 0` på hvert spørsmål, få `total_time_ms = 0` og ta 1. plass
// garantert — uten en eneste advarsel i loggen.
//
// HVA SOM IKKE VIRKER — og hvorfor det står her:
// Den nærliggende sjekken er å sammenligne SUMMEN av rapporterte tider mot
// faktisk forløpt veggklokketid siden `attempts.completed_at`. Den kan ikke
// brukes til å sette et GULV på summen, og det er ikke en detalj: mellom hvert
// spørsmål ligger en mellomskjerm (fasit, live-plassering, "Neste"-knapp) der
// klokka IKKE går på noe spørsmål. En ekte spiller som tar en pause midt i
// quizen kan ha 40 sekunder rapportert svartid og 20 minutter forløpt tid.
// Summen er derfor bare BEGRENSET OPPOVER av forløpt tid, aldri nedover, og et
// hvilket som helst forholdstall-gulv ville rammet ekte spillere først.
// Forløpt tid brukes derfor kun til logging her (se `sum_over_elapsed`).
//
// HVA SOM VIRKER: et absolutt gulv per spørsmål. Det er uavhengig av forløpt
// tid og av spillerens tempo, og det finnes en fysisk nedre grense for et
// menneske som skal lese et spørsmål, lese alternativene og trykke.

/** Gulv per besvart spørsmål. Under dette har ingen rukket å lese noe. */
export const MIN_ANSWER_MS = 400

/**
 * Snitt-tid der innsendingen avvises i stedet for å korrigeres. Et menneske
 * som svarer på ti spørsmål på under 100 ms i snitt finnes ikke — det er ikke
 * en rask spiller, det er et script. Egen, mye lavere terskel enn gulvet over,
 * nettopp for at korrigering (ikke avvisning) skal være normalveien.
 */
export const IMPOSSIBLE_AVG_MS = 100

/**
 * Slingringsmonn før vi logger at rapportert sum overstiger forløpt tid.
 * `completed_at` settes av Postgres-klokka (Supabase, eu-west-1) mens forløpt
 * tid måles mot Node-klokka (Vercel, fra1) — to maskiner, to klokker. Sjekken
 * er ren logging, så monnet skal være romslig heller enn presist.
 */
export const CLOCK_SKEW_SLACK_MS = 5_000

export type ReportedAnswer = {
  /** Rå `timeMs` fra klienten — kan være hva som helst, inkludert NaN. */
  timeMs: number
  /** Tidsgrensen for dette spørsmålet i ms (spørsmål-nivå, ellers quiz-nivå). */
  limitMs: number
}

export type TimeIntegrityResult = {
  /** Korrigerte tider, samme rekkefølge som input. Dette er det som lagres. */
  times: number[]
  /** Sum av `times` — det som skrives til `attempts.total_time_ms`. */
  totalMs: number
  /** Sum slik klienten rapporterte den (etter clamp OPP mot tidsgrensen). */
  rawTotalMs: number
  /** Antall spørsmål der gulvet måtte løfte tiden. */
  clampedCount: number
  /** Sann når innsendingen skal avvises (403). */
  reject: boolean
  /** Sann når noe er verdt å logge, uavhengig av om den avvises. */
  suspicious: boolean
  /** Maskinlesbare grunner, for loggen og for et framtidig varslingssystem. */
  reasons: string[]
}

/**
 * Korrigerer og vurderer klientrapporterte svartider.
 *
 * Rekkefølgen er bevisst: først tak (tidsgrensen), så gulv. Gulvet legges
 * ALDRI over spørsmålets egen tidsgrense — et spørsmål med 0,2 sekunders
 * grense skal ikke kunne få 0,4 sekunder registrert.
 *
 * `elapsedMs` brukes kun til logging (se filtoppen).
 */
export function applyAnswerTimeIntegrity(
  answers: ReportedAnswer[],
  elapsedMs: number,
): TimeIntegrityResult {
  const times: number[] = []
  let rawTotalMs = 0
  let clampedCount = 0

  for (const a of answers) {
    // Et ikke-endelig tall (NaN, Infinity) tolkes som "ingen tid rapportert" og
    // koster full tidsgrense. Samme regel som før denne modulen fantes.
    const safe = Number.isFinite(a.timeMs) ? a.timeMs : a.limitMs
    const limit = Math.max(a.limitMs, 0)
    const capped = Math.min(Math.max(safe, 0), limit)

    const floor = Math.min(MIN_ANSWER_MS, limit)
    const finalMs = Math.max(capped, floor)

    if (finalMs > capped) clampedCount++
    rawTotalMs += capped
    times.push(finalMs)
  }

  const reasons: string[] = []

  // Avvisning: snittet av det klienten faktisk påsto, ikke av det korrigerte.
  // Leses fra `rawTotalMs` slik at gulvet over ikke kan skjule signalet for
  // sin egen sjekk.
  const reject =
    answers.length > 0 && rawTotalMs < answers.length * IMPOSSIBLE_AVG_MS
  if (reject) reasons.push('impossible_avg')

  if (clampedCount > 0) reasons.push('floor_clamped')

  // Rapportert sum større enn forløpt tid er fysisk umulig. Vi korrigerer den
  // bevisst IKKE ned: en lavere tid gir bedre plassering, så en nedjustering
  // her ville belønnet den som overrapporterer. Kun logging.
  if (rawTotalMs > elapsedMs + CLOCK_SKEW_SLACK_MS) reasons.push('sum_over_elapsed')

  return {
    times,
    totalMs: times.reduce((sum, t) => sum + t, 0),
    rawTotalMs,
    clampedCount,
    reject,
    suspicious: reasons.length > 0,
    reasons,
  }
}
