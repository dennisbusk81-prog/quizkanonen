-- ============================================================
-- quizzes — push_sent_at
--
-- Settes av /api/cron/send-push når push-varsel for en quiz er sendt,
-- slik at samme quiz ikke varsles to ganger. NULL = ikke varslet.
-- ============================================================

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;
