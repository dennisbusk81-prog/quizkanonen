// Server-only — never import this in 'use client' components.
import { supabaseAdmin } from './supabase-admin'

// ─── Exported types ──────────────────────────────────────────────────────────

export type HistoryAttempt = {
  id: string
  quiz_id: string
  quiz_title: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  completed_at: string
  rank: number | null
  total_players: number | null
}

export type Progresjon =
  | { type: 'first'; diff: number }
  | { type: 'early'; diff: number }
  | { type: 'trend'; diff: number }

export type PlayerStats = {
  total_attempts: number
  total_correct: number
  total_questions: number
  best_streak: number
  avg_score_pct: number
  beste_plassering: number | null
  bedre_enn_prosent: number | null
  raskere_enn_prosent: number | null
  progresjon: Progresjon | null
  // NOTE: 'category' does not exist on the questions table (it is on quizzes).
  // These fields are always null until a category column is added to questions.
  sterkeste_kategori: string | null
  svakeste_kategori: string | null
}

export type AttemptAnswerDetail = {
  question_id: string
  question_text: string
  selected_answer: string | null       // letter code: 'A' | 'B' | 'C' | 'D' | null
  selected_answer_text: string | null  // option text, null if no answer given
  is_correct: boolean
  correct_answer: string               // letter code: 'A' | 'B' | 'C' | 'D'
  correct_answer_text: string          // option text for the correct answer
  time_ms: number
}

export type AttemptDetail = {
  attempt_id: string
  quiz_id: string
  quiz_title: string
  completed_at: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  rank: number | null
  total_players: number | null
  answers: AttemptAnswerDetail[]
}

export type PlayerHistoryResult = {
  history: HistoryAttempt[]
  stats: PlayerStats
}

// ─── Internal types ───────────────────────────────────────────────────────────

type RawAttemptForRank = {
  id: string
  quiz_id: string
  correct_answers: number
  total_time_ms: number
}

type AttemptRank = {
  rank: number
  total_players: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

/**
 * For each attempt in userAttempts, compute rank and total_players by fetching
 * all completed attempts for the relevant quiz_ids in one query.
 * Rank = number of attempts that beat this one + 1.
 * Tie-breaking: higher correct_answers wins; equal correct_answers, lower total_time_ms wins.
 */
async function computeRanks(
  userAttempts: RawAttemptForRank[]
): Promise<Map<string, AttemptRank>> {
  if (userAttempts.length === 0) return new Map()

  const quizIds = [...new Set(userAttempts.map((a) => a.quiz_id))]

  const { data } = await supabaseAdmin
    .from('attempts')
    .select('quiz_id, correct_answers, total_time_ms')
    .in('quiz_id', quizIds)
    .not('correct_streak', 'is', null)

  if (!data) return new Map()

  // Group all attempts by quiz_id
  const byQuiz = new Map<string, Array<{ correct_answers: number; total_time_ms: number }>>()
  for (const row of data) {
    const list = byQuiz.get(row.quiz_id) ?? []
    list.push({ correct_answers: row.correct_answers, total_time_ms: row.total_time_ms })
    byQuiz.set(row.quiz_id, list)
  }

  const result = new Map<string, AttemptRank>()
  for (const attempt of userAttempts) {
    const all = byQuiz.get(attempt.quiz_id) ?? []
    const betterCount = all.filter(
      (a) =>
        a.correct_answers > attempt.correct_answers ||
        (a.correct_answers === attempt.correct_answers &&
          a.total_time_ms < attempt.total_time_ms)
    ).length
    result.set(attempt.id, { rank: betterCount + 1, total_players: all.length })
  }

  return result
}

/**
 * Computes score progression based on attempt history:
 * - 'first'  — only 1 attempt played
 * - 'early'  — 2–3 attempts; diff = last score% − first score%
 * - 'trend'  — 4+ attempts; diff = avg score% last 4 weeks − avg score% previous 4 weeks
 *              (falls back to last − first if one period has no data)
 */
function computeProgresjon(
  attempts: Array<{
    correct_answers: number
    total_questions: number
    completed_at: string
  }>
): Progresjon {
  const sorted = [...attempts].sort(
    (a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
  )

  if (sorted.length === 1) {
    return { type: 'first', diff: 0 }
  }

  if (sorted.length <= 3) {
    const firstPct = pct(sorted[0].correct_answers, sorted[0].total_questions)
    const lastPct = pct(
      sorted[sorted.length - 1].correct_answers,
      sorted[sorted.length - 1].total_questions
    )
    return { type: 'early', diff: lastPct - firstPct }
  }

  const nowMs = Date.now()
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000

  const recentAttempts = sorted.filter(
    (a) => nowMs - new Date(a.completed_at).getTime() < fourWeeksMs
  )
  const prevAttempts = sorted.filter((a) => {
    const ageMs = nowMs - new Date(a.completed_at).getTime()
    return ageMs >= fourWeeksMs && ageMs < 2 * fourWeeksMs
  })

  if (recentAttempts.length > 0 && prevAttempts.length > 0) {
    const avgRecent =
      recentAttempts.reduce((sum, a) => sum + pct(a.correct_answers, a.total_questions), 0) /
      recentAttempts.length
    const avgPrev =
      prevAttempts.reduce((sum, a) => sum + pct(a.correct_answers, a.total_questions), 0) /
      prevAttempts.length
    return { type: 'trend', diff: Math.round(avgRecent - avgPrev) }
  }

  // Fallback: last attempt vs first attempt
  const firstPct = pct(sorted[0].correct_answers, sorted[0].total_questions)
  const lastPct = pct(
    sorted[sorted.length - 1].correct_answers,
    sorted[sorted.length - 1].total_questions
  )
  return { type: 'trend', diff: lastPct - firstPct }
}

function resolveTitle(raw: unknown): string {
  const v = raw as { title: string } | { title: string }[] | null
  if (Array.isArray(v)) return v[0]?.title ?? 'Ukjent quiz'
  return v?.title ?? 'Ukjent quiz'
}

type QuestionRow = {
  id: string
  question_text: string
  correct_answer: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
}

function getOptionText(q: QuestionRow, letter: string | null): string | null {
  if (!letter) return null
  const opts: Record<string, string | null | undefined> = {
    A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d,
  }
  return opts[letter.toUpperCase()] ?? letter
}

// ─── Public functions ─────────────────────────────────────────────────────────

export async function getPlayerHistory(userId: string): Promise<HistoryAttempt[]> {
  const { data, error } = await supabaseAdmin
    .from('attempts')
    .select(
      'id, quiz_id, correct_answers, total_questions, total_time_ms, correct_streak, completed_at, quizzes(title)'
    )
    .eq('user_id', userId)
    .not('correct_streak', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(200)

  if (error || !data) return []

  const ranks = await computeRanks(
    data.map((r) => ({
      id: r.id,
      quiz_id: r.quiz_id,
      correct_answers: r.correct_answers,
      total_time_ms: r.total_time_ms,
    }))
  )

  return data.map((row) => {
    const r = ranks.get(row.id)
    return {
      id: row.id,
      quiz_id: row.quiz_id,
      quiz_title: resolveTitle(row.quizzes),
      correct_answers: row.correct_answers,
      total_questions: row.total_questions,
      total_time_ms: row.total_time_ms,
      correct_streak: row.correct_streak ?? null,
      completed_at: row.completed_at,
      rank: r?.rank ?? null,
      total_players: r?.total_players ?? null,
    }
  })
}

export async function getPlayerStats(userId: string): Promise<PlayerStats> {
  const EMPTY: PlayerStats = {
    total_attempts: 0,
    total_correct: 0,
    total_questions: 0,
    best_streak: 0,
    avg_score_pct: 0,
    beste_plassering: null,
    bedre_enn_prosent: null,
    raskere_enn_prosent: null,
    progresjon: null,
    sterkeste_kategori: null,
    svakeste_kategori: null,
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch user attempts and global 90-day attempts in parallel
  const [{ data: userAttempts }, { data: globalAttempts }] = await Promise.all([
    supabaseAdmin
      .from('attempts')
      .select(
        'id, quiz_id, correct_answers, total_questions, total_time_ms, correct_streak, completed_at'
      )
      .eq('user_id', userId)
      .not('correct_streak', 'is', null),
    supabaseAdmin
      .from('attempts')
      .select('correct_answers, total_questions, total_time_ms')
      .not('correct_streak', 'is', null)
      .gte('completed_at', ninetyDaysAgo)
      .limit(10_000),
  ])

  if (!userAttempts || userAttempts.length === 0) return EMPTY

  // Core aggregates
  const total_attempts = userAttempts.length
  const total_correct = userAttempts.reduce((sum, r) => sum + (r.correct_answers ?? 0), 0)
  const total_questions = userAttempts.reduce((sum, r) => sum + (r.total_questions ?? 0), 0)
  const best_streak = Math.max(0, ...userAttempts.map((r) => r.correct_streak ?? 0))
  const avg_score_pct = pct(total_correct, total_questions)

  // Ranks — one extra query to fetch all-quiz attempts
  const ranks = await computeRanks(
    userAttempts.map((a) => ({
      id: a.id,
      quiz_id: a.quiz_id,
      correct_answers: a.correct_answers,
      total_time_ms: a.total_time_ms,
    }))
  )

  const allRankValues = [...ranks.values()].map((r) => r.rank)
  const beste_plassering = allRankValues.length > 0 ? Math.min(...allRankValues) : null

  // Global percentiles vs all attempts in last 90 days
  let bedre_enn_prosent: number | null = null
  let raskere_enn_prosent: number | null = null

  if (globalAttempts && globalAttempts.length > 0) {
    // Score percentile: % of global attempts that the user scores higher than
    const globalScores = globalAttempts.map((a) =>
      pct(a.correct_answers ?? 0, a.total_questions ?? 0)
    )
    const worseCount = globalScores.filter((s) => s < avg_score_pct).length
    bedre_enn_prosent = Math.round((worseCount / globalScores.length) * 100)

    // Speed percentile: % of global attempts that are slower than the user
    const userTotalTime = userAttempts.reduce((sum, a) => sum + (a.total_time_ms ?? 0), 0)
    if (total_questions > 0) {
      const userTimePerQ = userTotalTime / total_questions
      const globalTimesPerQ = globalAttempts
        .filter((a) => (a.total_questions ?? 0) > 0)
        .map((a) => (a.total_time_ms ?? 0) / (a.total_questions as number))
      const slowerCount = globalTimesPerQ.filter((t) => t > userTimePerQ).length
      raskere_enn_prosent =
        globalTimesPerQ.length > 0
          ? Math.round((slowerCount / globalTimesPerQ.length) * 100)
          : null
    }
  }

  // Progression
  const progresjon = computeProgresjon(
    userAttempts.map((a) => ({
      correct_answers: a.correct_answers,
      total_questions: a.total_questions,
      completed_at: a.completed_at,
    }))
  )

  return {
    total_attempts,
    total_correct,
    total_questions,
    best_streak,
    avg_score_pct,
    beste_plassering,
    bedre_enn_prosent,
    raskere_enn_prosent,
    progresjon,
    sterkeste_kategori: null, // category not yet on questions table
    svakeste_kategori: null,  // category not yet on questions table
  }
}

/**
 * Returns full details for a single attempt, including per-question answers.
 * Returns null if the attempt does not exist or does not belong to userId.
 */
export async function getAttemptDetail(
  attemptId: string,
  userId: string
): Promise<AttemptDetail | null> {
  console.time('getAttemptDetail')
  // Fetch attempt — the .eq('user_id', userId) doubles as ownership verification
  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from('attempts')
    .select(
      'id, quiz_id, correct_answers, total_questions, total_time_ms, completed_at, quizzes(title)'
    )
    .eq('id', attemptId)
    .eq('user_id', userId)
    .single()

  if (attemptError || !attempt) {
    console.timeEnd('getAttemptDetail')
    return null
  }

  // Fetch attempt_answers and questions for this quiz in parallel
  const [{ data: answers }, { data: questions }] = await Promise.all([
    supabaseAdmin
      .from('attempt_answers')
      .select('question_id, selected_answer, is_correct, time_ms')
      .eq('attempt_id', attemptId),
    supabaseAdmin
      .from('questions')
      .select('id, question_text, correct_answer, option_a, option_b, option_c, option_d')
      .eq('quiz_id', attempt.quiz_id),
  ])

  // Build a lookup map for questions
  const questionMap = new Map<string, QuestionRow>()
  for (const q of questions ?? []) {
    questionMap.set(q.id, q as QuestionRow)
  }

  // Compute rank
  const ranks = await computeRanks([
    {
      id: attempt.id,
      quiz_id: attempt.quiz_id,
      correct_answers: attempt.correct_answers,
      total_time_ms: attempt.total_time_ms,
    },
  ])
  const rank = ranks.get(attempt.id)

  const mappedAnswers: AttemptAnswerDetail[] = (answers ?? []).map((a) => {
    const q = questionMap.get(a.question_id) ?? null
    const selectedLetter = (a.selected_answer as string | null) ?? null
    const correctLetter = q?.correct_answer ?? ''
    return {
      question_id: a.question_id,
      question_text: q?.question_text ?? '',
      selected_answer: selectedLetter,
      selected_answer_text: q ? getOptionText(q, selectedLetter) : null,
      is_correct: a.is_correct as boolean,
      correct_answer: correctLetter,
      correct_answer_text: q ? (getOptionText(q, correctLetter) ?? correctLetter) : correctLetter,
      time_ms: a.time_ms as number,
    }
  })

  console.timeEnd('getAttemptDetail')
  console.log('getAttemptDetail answers:', mappedAnswers.length, '| total_players for rank:', rank?.total_players ?? 'N/A')

  return {
    attempt_id: attempt.id,
    quiz_id: attempt.quiz_id,
    quiz_title: resolveTitle(attempt.quizzes),
    completed_at: attempt.completed_at,
    correct_answers: attempt.correct_answers,
    total_questions: attempt.total_questions,
    total_time_ms: attempt.total_time_ms,
    rank: rank?.rank ?? null,
    total_players: rank?.total_players ?? null,
    answers: mappedAnswers,
  }
}
