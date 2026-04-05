-- ============================================================
-- ranking_snapshots — cachet rangeringsbilde per spørsmål
-- Kjør i Supabase SQL Editor eller via supabase db push.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ranking_snapshots (
  id             uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id        uuid         NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_index integer      NOT NULL,
  snapshot       jsonb        NOT NULL,  -- array av { player_name, rank, correct_answers, total_time_ms, correct_streak }
  created_at     timestamptz  DEFAULT now(),
  UNIQUE(quiz_id, question_index)
);

ALTER TABLE public.ranking_snapshots ENABLE ROW LEVEL SECURITY;

-- Alle kan lese (quiz er offentlig)
DROP POLICY IF EXISTS "ranking_snapshots_select_public" ON public.ranking_snapshots;
CREATE POLICY "ranking_snapshots_select_public"
  ON public.ranking_snapshots FOR SELECT
  USING (true);

-- Kun service role kan skrive (INSERT/UPDATE håndteres av API-ruten via supabaseAdmin)
-- Ingen eksplisitt INSERT/UPDATE-policy = kun service role har tilgang

-- Indeks for rask oppslag på (quiz_id, question_index)
CREATE INDEX IF NOT EXISTS ranking_snapshots_quiz_question_idx
  ON public.ranking_snapshots (quiz_id, question_index);
