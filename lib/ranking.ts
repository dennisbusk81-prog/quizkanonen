import { Attempt } from './supabase'

export type RankedAttempt = Attempt & {
  rank: number
  isTied: boolean
}

// Beregn lengste streak av riktige svar på rad
// Krever attempt_answers-data — for MVP bruker vi lagret verdi
export function calculateStreak(answers: { is_correct: boolean }[]): number {
  let maxStreak = 0
  let currentStreak = 0
  for (const answer of answers) {
    if (answer.is_correct) {
      currentStreak++
      maxStreak = Math.max(maxStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  }
  return maxStreak
}

// Rangeringslogikk:
// 1. Flest riktige svar (høyest)
// 2. Raskest total tid (lavest)
// 3. Flest riktige på rad (høyest)
// 4. Delt plassering
export function rankAttempts(attempts: Attempt[]): RankedAttempt[] {
  const sorted = [...attempts].sort((a, b) => {
    // 1. Flest riktige
    if (b.correct_answers !== a.correct_answers) {
      return b.correct_answers - a.correct_answers
    }
    // 2. Raskest tid
    if (a.total_time_ms !== b.total_time_ms) {
      return a.total_time_ms - b.total_time_ms
    }
    // 3. Flest riktige på rad
    const aStreak = (a as any).correct_streak || 0
    const bStreak = (b as any).correct_streak || 0
    if (bStreak !== aStreak) {
      return bStreak - aStreak
    }
    // 4. Delt plassering — rekkefølge spiller ingen rolle
    return 0
  })

  let rank = 1
  return sorted.map((attempt, index) => {
    if (index > 0) {
      const prev = sorted[index - 1]
      const isSame =
        attempt.correct_answers === prev.correct_answers &&
        attempt.total_time_ms === prev.total_time_ms &&
        ((attempt as any).correct_streak || 0) === ((prev as any).correct_streak || 0)
      if (!isSame) rank = index + 1
    }
    const next = sorted[index + 1]
    const isTied = next
      ? attempt.correct_answers === next.correct_answers &&
        attempt.total_time_ms === next.total_time_ms &&
        ((attempt as any).correct_streak || 0) === ((next as any).correct_streak || 0)
      : false

    return { ...attempt, rank, isTied }
  })
}

// ── Delt rangerings-helper for quiz-resultater ───────────────────────────────
// Brukes av Topp 3, quiz-leaderboard, toppliste (last_quiz) og resultatskjermen
// for å garantere IDENTISK #1 overalt. Tidligere divergerte de tre flatene på
// filter, dedup-nøkkel og tiebreak, noe som ga ulik vinner og duplikate rader.
//
// Regler:
//  1. Filter: kun innsendte forsøk (submitted_at IS NOT NULL) når requireSubmitted.
//  2. Dedup: beste forsøk per spiller. Nøkkel = user_id hvis satt, ellers
//     `name:<player_name>` for gjester.
//  3. Gjester: inkluderes når includeGuests (Topp 3 + leaderboard), ekskluderes
//     ellers (toppliste/sesong, der kun innloggede teller).
//  4. Tiebreak (4 nøkler, total ordning — ingen delte plasseringer):
//     correct_answers DESC, total_time_ms ASC, correct_streak DESC, id ASC.

export interface RankableAttempt {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
  submitted_at?: string | null
}

export interface RankQuizOptions {
  /** Inkluder gjester (user_id = null). Default true. */
  includeGuests?: boolean
  /** Krev submitted_at IS NOT NULL. Default true. */
  requireSubmitted?: boolean
}

// Total ordning: returnerer < 0 hvis a skal rangeres foran b.
export function compareAttempts(a: RankableAttempt, b: RankableAttempt): number {
  if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
  if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
  const sd = (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  if (sd !== 0) return sd
  return a.id.localeCompare(b.id)
}

export function rankQuizAttempts<T extends RankableAttempt>(
  attempts: T[],
  options: RankQuizOptions = {},
): Array<T & { rank: number }> {
  const { includeGuests = true, requireSubmitted = true } = options

  // 1 + 3. Filtrer
  const filtered = attempts.filter(a => {
    if (requireSubmitted && a.submitted_at == null) return false
    if (!includeGuests && a.user_id == null) return false
    return true
  })

  // 2. Dedup — behold beste forsøk per spiller
  const bestByKey = new Map<string, T>()
  for (const a of filtered) {
    const key = a.user_id ?? `name:${a.player_name}`
    const existing = bestByKey.get(key)
    if (!existing || compareAttempts(a, existing) < 0) bestByKey.set(key, a)
  }

  // 4. Sorter + tildel plassering (1-basert, total ordning)
  return [...bestByKey.values()]
    .sort(compareAttempts)
    .map((a, i) => ({ ...a, rank: i + 1 }))
}

export function getMedal(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `${rank}.`
}