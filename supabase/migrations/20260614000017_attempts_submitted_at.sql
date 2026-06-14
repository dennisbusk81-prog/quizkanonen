-- ============================================================
-- attempts.submitted_at — markør for at en attempt er scoret ferdig.
--
-- Brukes av POST /api/quiz/[id]/submit (service-role-rute) for å hindre
-- at samme attempt scores to ganger. INSERT i startQuiz setter den IKKE
-- (forblir NULL til submit-ruten kjører). Når submit lykkes settes den
-- til now().
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE public.attempts ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
