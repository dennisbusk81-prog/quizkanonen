-- ============================================================
-- Performance indexes for quiz tables
-- Safe to re-run: all use CREATE INDEX IF NOT EXISTS.
-- ============================================================

-- ── attempts ─────────────────────────────────────────────────
-- Fetching all attempts for a quiz (leaderboard, analytics, stats)
create index if not exists idx_attempts_quiz_id
  on public.attempts (quiz_id);

-- Leaderboard sort: best score first, then fastest time
-- correct_answers is the score column (no separate "score" column exists)
create index if not exists idx_attempts_quiz_id_score
  on public.attempts (quiz_id, correct_answers desc, total_time_ms asc);


-- ── attempt_answers ──────────────────────────────────────────
-- Loading all answers for a given attempt (analytics detail view)
create index if not exists idx_attempt_answers_attempt_id
  on public.attempt_answers (attempt_id);


-- ── played_log ───────────────────────────────────────────────
-- Checking whether a device has already played a quiz
-- Column is named "identifier" (device fingerprint), not "device_id"
create index if not exists idx_played_log_quiz_identifier
  on public.played_log (quiz_id, identifier);


-- ── quizzes ──────────────────────────────────────────────────
-- Filtering active quizzes (used on home page and quiz fetch)
create index if not exists idx_quizzes_is_active
  on public.quizzes (is_active);
