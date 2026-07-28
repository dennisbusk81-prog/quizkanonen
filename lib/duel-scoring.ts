// ── Duell-poeng per kalendermåned ───────────────────────────────────────────
// Bakgrunn (kartlegging 28. juli 2026, FUNN 4.3 — kritisk):
//
// /api/rivalries/my bygget ÉN poengtabell fra quizene i INNEVÆRENDE måned, og
// brukte den for alle rader — også avsluttede dueller fra tidligere måneder.
// To følgefeil:
//
//   1. En avsluttet duell viste tall fra en helt annen måned enn den duellen
//      faktisk gikk i. Bekreftet i prod: en juni-duell som endte 11–2 vises i
//      dag som 17–15, fordi tallene kom fra juli-quizene.
//   2. Brukerens egen score var IDENTISK på hver eneste historikk-rad (det var
//      samme oppslag i samme tabell), og endret seg hver uke etter hvert som
//      brukeren spilte nye quizer. En avsluttet duell er et resultat og skal
//      ligge fast.
//
// Løsningen er å regne poeng per MÅNED og slå opp med duellens egen måned.
// Poengmodellen selv er uendret og deles fortsatt med season_scores via
// lib/season-points.
//
// VALGT LØSNING — beregning ved lesing, ikke lagret sluttresultat:
// Alternativet var å fryse sluttsummen på rivalry-raden når måneden er over.
// Det ble valgt bort fordi en fasitendring (/api/admin/correct-answer) regraderer
// attempts og synkroniserer season_scores i ettertid — en frossen duell-score
// ville da blitt stående i strid med den korrigerte sesongtabellen. Beregnet
// fra attempts er duellresultatet alltid enig med resten av systemet, og en
// forgangen måneds attempts endrer seg ikke av seg selv.

import {
  getSeasonPoints,
  bestSeasonAttemptsByUser,
  rankSeasonAttempts,
  type SeasonAttempt,
} from './season-points'

/** 'YYYY-MM' i UTC — nøkkelen en duell og en quiz møtes på. */
export function monthKeyOf(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export type ScoredAttempt = SeasonAttempt & { quiz_id: string }

/**
 * Poeng per (månedsnøkkel → bruker-id → poeng).
 *
 * Rangeringen skjer mot HELE feltet i hver quiz, ikke bare de involverte
 * brukerne — plassering, og dermed poeng, ville ellers blitt feil. Kun de
 * involverte akkumuleres i resultatet.
 */
export function computePointsByMonth(
  attempts: ScoredAttempt[],
  monthByQuizId: Map<string, string>,
  involved: Set<string>,
): Map<string, Map<string, number>> {
  const byQuiz = new Map<string, ScoredAttempt[]>()
  for (const a of attempts) {
    const list = byQuiz.get(a.quiz_id)
    if (list) list.push(a)
    else byQuiz.set(a.quiz_id, [a])
  }

  const result = new Map<string, Map<string, number>>()

  for (const [quizId, quizAttempts] of byQuiz) {
    const monthKey = monthByQuizId.get(quizId)
    if (!monthKey) continue

    let bucket = result.get(monthKey)
    if (!bucket) {
      bucket = new Map<string, number>()
      result.set(monthKey, bucket)
    }

    const bestByUser = bestSeasonAttemptsByUser(quizAttempts)
    for (const { userId, rank } of rankSeasonAttempts(bestByUser)) {
      if (!involved.has(userId)) continue
      bucket.set(userId, (bucket.get(userId) ?? 0) + getSeasonPoints(rank))
    }
  }

  return result
}

/** Poeng for én bruker i den måneden duellen faktisk gikk. 0 hvis ingenting. */
export function pointsForDuel(
  pointsByMonth: Map<string, Map<string, number>>,
  duelCreatedAt: string,
  userId: string,
): number {
  return pointsByMonth.get(monthKeyOf(duelCreatedAt))?.get(userId) ?? 0
}
