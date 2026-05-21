-- ============================================================
-- Legg til quiz_type på quizzes
-- Verdier: 'weekly' (fredagsquiz) | 'bonus' (bonusquiz)
-- Alle eksisterende quizer er ukentlige — settes til 'weekly'.
-- ============================================================

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS quiz_type text NOT NULL DEFAULT 'weekly';

-- Trygg oppdatering av eksisterende rader (DEFAULT dekker nye)
UPDATE public.quizzes SET quiz_type = 'weekly' WHERE quiz_type IS NULL;
