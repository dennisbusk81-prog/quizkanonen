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

export function getMedal(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `${rank}.`
}