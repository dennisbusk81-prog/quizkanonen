// Plassering fra AUTORITATIV kilde: `season_scores.rank` i global scope,
// frosset ved oppgjør. Ren logikk, testdekket i frozen-rank.test.ts.
//
// HVA DETTE ERSTATTER (13. august 2026):
// `computeRanks()` i lib/history.ts regnet rangering LIVE over `attempts` hver
// gang historikken ble lest. Det ga et tall som så autoritativt ut, men som
// ikke var det samme topplista viser, og som oppsto også for spillere som ikke
// har noen global plassering i det hele tatt: 17 av 488 forsøk fordelt på 7
// brukere, hvorav seks er Elkjøp-ansatte som har meldt seg ut av den åpne
// konkurransen. De hadde valgt seg vekk, og fikk likevel en plassering i den
// vist på sin egen historikkside.
//
// ── DEN VIKTIGE ASYMMETRIEN ──────────────────────────────────────────────────
// `rank` er beregnet over ALLE som spilte quizen. Rader i `season_scores`
// finnes derimot KUN for dem som ikke har meldt seg ut. De to tallene har
// altså ulike populasjoner, og feltstørrelsen kan IKKE utledes ved å telle
// rader.
//
// Målt mot prod 13. august 2026 — maxRank mot antall globale rader:
//     31.07:  59 rader, høyeste rank 63
//     07.08:  60 rader, høyeste rank 63
//     10.07:  52 rader, høyeste rank 55
//     26.06:  55 rader, høyeste rank 56
//
// Hadde nevneren vært radantallet, ville spillere fått se «#63 av 59».
// NEVNEREN ER ANTALL FORSØK PÅ QUIZEN — samme populasjon ranken ble regnet i.
//
// Merk også at ranks kan gå igjen: 19.06 har 75 forsøk fordelt på 72 unike
// ranks, altså delte plasseringer. Det er riktig og skal ikke «rettes».

export type SeasonRankRow = {
  user_id: string
  quiz_id: string
  rank: number | null
}

export type AttemptFieldRow = {
  quiz_id: string
}

export type FrozenRank = {
  rank: number
  total_players: number
}

/**
 * Antall spillere per quiz — nevneren i «#12 av 63».
 *
 * Telles fra FORSØK, ikke fra season_scores-rader. Se filhodet: de to har
 * ulike populasjoner, og bare forsøkene er den populasjonen ranken faktisk ble
 * beregnet i.
 */
export function countPlayersByQuiz(rows: readonly AttemptFieldRow[]): Record<string, number> {
  const ut: Record<string, number> = {}
  for (const r of rows) {
    if (!r || typeof r.quiz_id !== 'string') continue
    ut[r.quiz_id] = (ut[r.quiz_id] ?? 0) + 1
  }
  return ut
}

/**
 * Brukerens frosne plassering per quiz.
 *
 * Returnerer INGEN oppføring når:
 *   • brukeren ikke har en global season_scores-rad for quizen (meldt seg ut,
 *     ekskludert, eller quizen er ikke gjort opp ennå),
 *   • raden finnes, men `rank` er null,
 *   • feltstørrelsen mangler, eller
 *   • ranken er større enn feltstørrelsen.
 *
 * Det siste er en usammenhengende tilstand som ikke skal kunne oppstå — men
 * skjer den, er «#63 av 59» verre enn ingen plassering. Kalleren utelater
 * linjen helt; det er ALDRI en fallback til en live-beregnet rangering, og
 * heller ingen «ukjent»-tekst. Raden viser da score og tid, som er sant.
 */
export function buildFrozenRanks(
  seasonRows: readonly SeasonRankRow[],
  playersByQuiz: Record<string, number>,
  userId: string,
): Record<string, FrozenRank> {
  const ut: Record<string, FrozenRank> = {}

  for (const row of seasonRows) {
    if (!row || row.user_id !== userId) continue
    if (typeof row.rank !== 'number' || !Number.isFinite(row.rank) || row.rank < 1) continue

    const players = playersByQuiz[row.quiz_id]
    if (typeof players !== 'number' || players < 1) continue
    if (row.rank > players) continue

    ut[row.quiz_id] = { rank: row.rank, total_players: players }
  }

  return ut
}

// ── Beste plassering ─────────────────────────────────────────────────────────

export type BestePlassering = {
  rank: number
  total_players: number
  quiz_title: string
}

export type PlasseringKandidat = {
  quiz_id: string
  quiz_title: string
  completed_at: string
}

/**
 * Laveste (beste) frosne plassering på tvers av spillerens quizer.
 *
 * Uavgjort brytes på NYESTE, samme regel som `pickBesteResultat` i
 * lib/historikk-oversikt.ts: raden er en personlig rekord, ikke en rangering,
 * og blant like plasseringer er den ferskeste den som fortsatt gjelder.
 *
 * Quizer uten frossen plassering er usynlige her — de kan hverken vinne eller
 * tape. En spiller som har meldt seg ut av den åpne konkurransen får dermed
 * ingen «beste plassering» i det hele tatt, som er det riktige svaret for
 * noen som ikke deltar i den.
 */
export function pickBestePlassering(
  kandidater: readonly PlasseringKandidat[],
  frosne: Record<string, FrozenRank>,
): BestePlassering | null {
  let beste: { k: PlasseringKandidat; f: FrozenRank } | null = null

  for (const k of kandidater) {
    if (!k || typeof k.quiz_id !== 'string') continue
    const f = frosne[k.quiz_id]
    if (!f) continue

    if (beste === null || f.rank < beste.f.rank) {
      beste = { k, f }
      continue
    }
    if (
      f.rank === beste.f.rank &&
      new Date(k.completed_at).getTime() > new Date(beste.k.completed_at).getTime()
    ) {
      beste = { k, f }
    }
  }

  if (beste === null) return null
  return {
    rank: beste.f.rank,
    total_players: beste.f.total_players,
    quiz_title: beste.k.quiz_title,
  }
}
