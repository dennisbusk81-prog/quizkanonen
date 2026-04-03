// Server-only — never import this in 'use client' components.
import { supabaseAdmin } from './supabase-admin'

export type HistoryAttempt = {
  id: string
  quiz_id: string
  quiz_title: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  completed_at: string
}

export type PlayerStats = {
  total_attempts: number
  total_correct: number
  total_questions: number
  best_streak: number
  avg_score_pct: number
}

export type PlayerHistoryResult = {
  history: HistoryAttempt[]
  stats: PlayerStats
}

const EMPTY_STATS: PlayerStats = {
  total_attempts: 0,
  total_correct: 0,
  total_questions: 0,
  best_streak: 0,
  avg_score_pct: 0,
}

export async function getPlayerHistory(userId: string): Promise<HistoryAttempt[]> {
  const { data, error } = await supabaseAdmin
    .from('attempts')
    .select('id, quiz_id, correct_answers, total_questions, total_time_ms, correct_streak, completed_at, quizzes(title)')
    .eq('user_id', userId)
    .not('correct_streak', 'is', null)   // only completed attempts (streak is set on finish)
    .order('completed_at', { ascending: false })
    .limit(200)

  if (error || !data) return []

  return data.map((row) => {
    const quizzes = row.quizzes as unknown as { title: string } | { title: string }[] | null
    return {
      id: row.id,
      quiz_id: row.quiz_id,
      quiz_title: (Array.isArray(quizzes) ? quizzes[0]?.title : quizzes?.title) ?? 'Ukjent quiz',
      correct_answers: row.correct_answers,
      total_questions: row.total_questions,
      total_time_ms: row.total_time_ms,
      correct_streak: row.correct_streak ?? null,
      completed_at: row.completed_at,
    }
  })
}

export async function getPlayerStats(userId: string): Promise<PlayerStats> {
  const { data, error } = await supabaseAdmin
    .from('attempts')
    .select('correct_answers, total_questions, correct_streak')
    .eq('user_id', userId)
    .not('correct_streak', 'is', null)

  if (error || !data || data.length === 0) return EMPTY_STATS

  const total_attempts = data.length
  const total_correct = data.reduce((sum, r) => sum + (r.correct_answers ?? 0), 0)
  const total_questions = data.reduce((sum, r) => sum + (r.total_questions ?? 0), 0)
  const best_streak = Math.max(0, ...data.map((r) => r.correct_streak ?? 0))
  const avg_score_pct =
    total_questions > 0 ? Math.round((total_correct / total_questions) * 100) : 0

  return { total_attempts, total_correct, total_questions, best_streak, avg_score_pct }
}
