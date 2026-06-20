// ── Delt season-poengmodell ──────────────────────────────────────────────────
// Én kilde til sannhet for hvordan plassering i en quiz oversettes til
// sesong-poeng. Brukes av:
//   - /api/cron/award-season-points (skriver season_scores)
//   - /api/rivalries/my (beregner duell-stilling direkte fra attempts, slik at
//     den er korrekt også for brukere som har valgt seg ut av global liga)
//
// VIKTIG: Rangerings- og poenglogikken her er flyttet uendret fra
// award-season-points. Endres den, endres season_scores tilsvarende — hold den
// stabil med mindre begge konsumenter skal endre seg samtidig.

export const SEASON_POINTS_TABLE = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]

export function getSeasonPoints(rank: number): number {
  return rank <= 10 ? SEASON_POINTS_TABLE[rank - 1] : 1
}

export type SeasonAttempt = {
  user_id: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
}

// Beste forsøk mellom to: flest riktige, så raskest tid, så lengst streak.
export function pickBestSeasonAttempt<T extends SeasonAttempt>(a: T, b: T): T {
  if (b.correct_answers > a.correct_answers) return b
  if (b.correct_answers === a.correct_answers && b.total_time_ms < a.total_time_ms) return b
  if (
    b.correct_answers === a.correct_answers &&
    b.total_time_ms === a.total_time_ms &&
    (b.correct_streak ?? 0) > (a.correct_streak ?? 0)
  ) return b
  return a
}

// Bygg "beste forsøk per bruker" fra en flat liste forsøk for én quiz.
export function bestSeasonAttemptsByUser<T extends SeasonAttempt>(attempts: T[]): Map<string, T> {
  const bestByUser = new Map<string, T>()
  for (const a of attempts) {
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBestSeasonAttempt(existing, a) : a)
  }
  return bestByUser
}

export type SeasonRanked = { userId: string; rank: number }

// Rangér beste-per-bruker. Delt plassering ved lik correct_answers + total_time_ms
// (streak teller i sorteringen, men ikke i tie-deteksjonen) — identisk med den
// opprinnelige season_scores-logikken.
export function rankSeasonAttempts(bestByUser: Map<string, SeasonAttempt>): SeasonRanked[] {
  const sorted = [...bestByUser.entries()].sort(([, a], [, b]) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
    return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  })
  const result: SeasonRanked[] = []
  for (let i = 0; i < sorted.length; i++) {
    let rank = i + 1
    if (i > 0) {
      const [, prev] = sorted[i - 1]
      const [, cur] = sorted[i]
      if (cur.correct_answers === prev.correct_answers && cur.total_time_ms === prev.total_time_ms) {
        rank = result[i - 1].rank
      }
    }
    result.push({ userId: sorted[i][0], rank })
  }
  return result
}
