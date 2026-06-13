-- ============================================================
-- rivalries — seen_at
--
-- Tidspunkt for når mottakeren sist så duell-relasjonen, brukt for
-- å markere innkommende utfordringer som lest. NULL = ikke sett ennå.
-- ============================================================

ALTER TABLE public.rivalries
  ADD COLUMN IF NOT EXISTS seen_at timestamptz;
