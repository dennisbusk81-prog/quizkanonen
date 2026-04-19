-- ============================================================
-- season_scores — akkumulerte sesongpoeng per bruker per quiz
-- Kjør i Supabase SQL Editor.
--
-- VIKTIG: Bruker UNIQUE NULLS NOT DISTINCT (PostgreSQL 15+)
-- for å håndtere scope_id = NULL korrekt i unik-constraint.
-- Supabase Cloud kjører PostgreSQL 15.x — dette er trygt.
-- ============================================================

CREATE TABLE public.season_scores (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quiz_id         uuid        NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  scope_type      text        NOT NULL CHECK (scope_type IN ('global', 'league', 'organization')),
  scope_id        uuid,                   -- NULL = global scope
  points          int         NOT NULL,
  rank            int         NOT NULL,
  closes_at       timestamptz NOT NULL,   -- kopi fra quizzes.closes_at for enkel periodefiltrering
  awarded_at      timestamptz NOT NULL DEFAULT now(),
  prize_awarded   boolean     NOT NULL DEFAULT false,
  CONSTRAINT season_scores_unique_key
    UNIQUE NULLS NOT DISTINCT (user_id, quiz_id, scope_type, scope_id)
);

-- Indeks for periodefiltrering per scope (brukes av sesong-toppliste)
CREATE INDEX idx_season_scores_scope_closes
  ON public.season_scores (scope_type, scope_id, closes_at DESC);

-- Indeks for å slå opp én brukers historikk
CREATE INDEX idx_season_scores_user_scope
  ON public.season_scores (user_id, scope_type, scope_id);

-- RLS: lesing styres av scope, skriving kun via service role
ALTER TABLE public.season_scores ENABLE ROW LEVEL SECURITY;

-- Global scope: alle innloggede kan lese
CREATE POLICY "read_global_season_scores"
  ON public.season_scores FOR SELECT
  USING (scope_type = 'global' AND auth.role() = 'authenticated');

-- Liga scope: kun medlemmer kan lese sin liga
CREATE POLICY "read_league_season_scores"
  ON public.season_scores FOR SELECT
  USING (
    scope_type = 'league'
    AND EXISTS (
      SELECT 1 FROM public.league_members
      WHERE public.league_members.league_id = public.season_scores.scope_id
        AND public.league_members.user_id = auth.uid()
    )
  );

-- Org scope: kun medlemmer kan lese sin organisasjon
CREATE POLICY "read_org_season_scores"
  ON public.season_scores FOR SELECT
  USING (
    scope_type = 'organization'
    AND EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE public.organization_members.organization_id = public.season_scores.scope_id
        AND public.organization_members.user_id = auth.uid()
    )
  );

-- Ingen INSERT/UPDATE-policies for vanlige brukere — kun service role skriver

-- Flagg på quizzes: satt til true når cron-jobben har behandlet quizen
ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS season_points_awarded boolean DEFAULT false;

-- Partiell indeks: rask oppslag av ubehandlede quizer
CREATE INDEX IF NOT EXISTS idx_quizzes_season_points_awarded
  ON public.quizzes (season_points_awarded, closes_at)
  WHERE season_points_awarded = false;
