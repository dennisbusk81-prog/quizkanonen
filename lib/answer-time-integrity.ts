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
// UTVIDET (2. august 2026): første versjon avviste kun under 100 ms i snitt og
// lot dermed et script rapportere 400 ms per spørsmål og slå enhver ekte
// spiller (raskeste målte ekte snitt i prod: 2 683 ms/spørsmål over 200
// forsøk). Signert per-spørsmål-stempel ble vurdert og BEVISST forkastet:
// serveren ser aldri når svaret avgis (alt leveres samlet i submit), så et
// stempel gir kun en ØVRE grense på svartiden — juksen er å rapportere for
// LAVT, og enhver lav verdi er konsistent med enhver øvre grense. I stedet:
// et kalibrert gulv på den rapporterte SUMMEN, med veggklokke-substitusjon
// (aldri avvisning) som utfall. En feilklassifisering skal koste en dårligere
// tid, aldri et tapt forsøk.
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
// Gulvet under er derfor ABSOLUTT (per spørsmål), helt uavhengig av forløpt
// tid — en pause, en gjenopptakelse etter nettbrudd eller en "Prøv igjen"
// endrer aldri den rapporterte summen, og kan derfor aldri utløse det.
// I tillegg: for GJESTER oppretter start-attempt en NY attempt-rad ved
// gjenopptakelse, så `elapsedMs` kan dekke bare slutten av quizen mens
// svarene dekker hele. `sum_over_elapsed` er derfor KUN logging og må aldri
// promoteres til straff.

/** Gulv per besvart spørsmål. Under dette har ingen rukket å lese noe. */
export const MIN_ANSWER_MS = 400

/**
 * Gulv for SNITTET av rapportert tid per spørsmål. Under dette erstattes
 * totalen med veggklokke-utledet tid (se `applyAnswerTimeIntegrity`).
 *
 * Kalibrering (målt mot prod 2. august 2026, 200 nyeste leverte forsøk):
 * raskeste ekte snitt var 2 683 ms/spørsmål, p1 = 3 007 ms. 1 500 ms gir 44 %
 * margin ned til dagens raskeste — valgt over 2 000 ms (25 % margin) fordi
 * brukerbasen skal vokse 5–10x, og halen da strekker seg nedover. Merk at
 * snittet av 15 svar konsentrerer seg langt over raskeste ENKELTsvar (p1 for
 * enkeltsvar var 1 815 ms): en spiller må ligge under 1 500 ms på så godt som
 * hvert eneste spørsmål for å treffe gulvet.
 */
export const FLOOR_AVG_MS = 1_500

/**
 * Gulvets andel av spørsmålets egen tidsgrense. Gulvet per spørsmål er
 * `min(FLOOR_AVG_MS, tidsgrense * FLOOR_LIMIT_RATIO)` — for standardgrensen
 * (15 s) er de to identiske (1 500 ms), så taket biter kun på quizer med
 * KORTE tidsgrenser. Uten dette ville en fremtidig hurtigquiz med f.eks. 3 s
 * per spørsmål fått ærlige spillere (som MÅ svare raskt) under et fast gulv,
 * og substitusjonen ville rammet nøyaktig feil part. Målt referanse: raskeste
 * ekte snitt lå på 18 % av tidsgrensen — 10 % gir god margin under det.
 */
export const FLOOR_LIMIT_RATIO = 0.1

/**
 * Observasjonsbånd: snitt under dette (men over gulvet) logges UTEN noen
 * korrigering. Satt rett under det raskeste ekte snittet som er målt
 * (2 683 ms), slik at loggen fanger "raskere enn alt vi har sett ekte" før
 * vi eventuelt strammer inn. Kun data-innsamling — juks er hittil hypotetisk.
 */
export const SUSPICIOUS_AVG_MS = 2_500

/** Observasjonsbåndets andel av tidsgrensen — samme konstruksjon som gulvet. */
export const SUSPICIOUS_LIMIT_RATIO = 1 / 6

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
  /**
   * Korrigerte tider per svar, samme rekkefølge som input. Skrives til
   * attempt_answers.time_ms. Substitueres BEVISST IKKE — radene bevarer det
   * (gulv-korrigerte) klienten faktisk rapporterte, som forensisk spor.
   */
  times: number[]
  /**
   * Det som skrives til `attempts.total_time_ms`. Lik summen av `times` i
   * normaltilfellet; ved substitusjon (se `substituted`) den veggklokke-
   * utledede tiden i stedet.
   */
  totalMs: number
  /** Sum slik klienten rapporterte den (etter clamp OPP mot tidsgrensen). */
  rawTotalMs: number
  /** Antall spørsmål der per-svar-gulvet måtte løfte tiden. */
  clampedCount: number
  /** Sann når totalen ble erstattet med veggklokke-utledet tid. */
  substituted: boolean
  /** Sann når noe er verdt å logge, uavhengig av utfall. */
  suspicious: boolean
  /** Maskinlesbare grunner, for loggen og for et framtidig varslingssystem. */
  reasons: string[]
}

/**
 * Korrigerer og vurderer klientrapporterte svartider.
 *
 * Per svar er rekkefølgen bevisst: først tak (tidsgrensen), så gulv. Gulvet
 * legges ALDRI over spørsmålets egen tidsgrense — et spørsmål med 0,2 sekunders
 * grense skal ikke kunne få 0,4 sekunder registrert.
 *
 * På totalen: er den rapporterte summen under gulvet (Σ per-spørsmåls-gulv,
 * se FLOOR_AVG_MS/FLOOR_LIMIT_RATIO), tror vi ikke lenger på den rapporterte
 * tiden i det hele tatt. Da settes totalen til veggklokke-utledet tid:
 *
 *   max(gulv-terskelen, min(elapsedMs, Σ tidsgrenser), Σ korrigerte tider)
 *
 * - `min(elapsedMs, Σ tidsgrenser)`: faktisk forløpt tid, men aldri mer enn
 *   det en spiller som gikk ut på tid på ALT ville fått registrert.
 * - `max(gulv-terskelen, …)`: et script som også leverer lynraskt (lav
 *   elapsedMs) skal ikke kunne bruke substitusjonen som snarvei UNDER gulvet.
 * - `max(…, Σ korrigerte tider)`: substitusjonen kan aldri gi BEDRE tid enn
 *   den korrigerte summen — lavere tid gir bedre plassering, så alt annet
 *   ville belønnet trikset.
 *
 * Ingen ekte spiller kan havne i substitusjonsgrenen: rapportert sum påvirkes
 * ikke av pauser, gjenopptakelse eller retry (se filtoppen), og gulvet ligger
 * 44 % under det raskeste ekte snittet som er målt.
 *
 * `elapsedMs` brukes ellers kun til logging (`sum_over_elapsed`).
 */
export function applyAnswerTimeIntegrity(
  answers: ReportedAnswer[],
  elapsedMs: number,
): TimeIntegrityResult {
  const times: number[] = []
  let rawTotalMs = 0
  let clampedCount = 0
  let floorThresholdMs = 0
  let suspiciousThresholdMs = 0
  let limitSumMs = 0

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

    limitSumMs += limit
    floorThresholdMs += Math.min(FLOOR_AVG_MS, limit * FLOOR_LIMIT_RATIO)
    suspiciousThresholdMs += Math.min(SUSPICIOUS_AVG_MS, limit * SUSPICIOUS_LIMIT_RATIO)
  }

  const reasons: string[] = []
  const correctedSumMs = times.reduce((sum, t) => sum + t, 0)

  // Substitusjon: leses fra det klienten faktisk PÅSTO (rawTotalMs), ikke den
  // korrigerte summen — ellers ville per-svar-gulvet skjult signalet for sin
  // egen sjekk. Terskelen er summen av per-spørsmåls-gulv, så den skalerer
  // riktig både med antall spørsmål og med hver enkelt tidsgrense.
  const substituted = answers.length > 0 && rawTotalMs < floorThresholdMs
  if (substituted) {
    reasons.push('below_floor_substituted')
  } else if (answers.length > 0 && rawTotalMs < suspiciousThresholdMs) {
    // Observasjonsbåndet: raskere enn alt vi har målt ekte, men over gulvet.
    // KUN logging — ingen korrigering, ingen straff.
    reasons.push('suspicious_low_avg')
  }

  if (clampedCount > 0) reasons.push('floor_clamped')

  // Rapportert sum større enn forløpt tid er fysisk umulig for et sammenhengende
  // forsøk — men IKKE for en gjest som gjenopptar (ny attempt-rad, elapsedMs
  // dekker bare slutten). Vi korrigerer den bevisst IKKE ned: en lavere tid gir
  // bedre plassering, så en nedjustering ville belønnet overrapportering. Og vi
  // straffer den aldri — kun logging.
  if (rawTotalMs > elapsedMs + CLOCK_SKEW_SLACK_MS) reasons.push('sum_over_elapsed')

  const totalMs = substituted
    ? Math.max(floorThresholdMs, Math.min(Math.max(elapsedMs, 0), limitSumMs), correctedSumMs)
    : correctedSumMs

  return {
    times,
    totalMs: Math.round(totalMs),
    rawTotalMs,
    clampedCount,
    substituted,
    suspicious: reasons.length > 0,
    reasons,
  }
}
