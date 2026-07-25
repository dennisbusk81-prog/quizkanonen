-- ============================================================
-- attempt_answer_stats_by_attempts / attempt_answer_option_counts /
-- count_active_players_since — RPC-basert aggregering for å fjerne PostgREST
-- sin stille 1000-rads-grense fra spørringer som bare skal TELLE, ikke hente
-- rader. Kjør i Supabase SQL Editor. Speiler mønsteret fra
-- season_leaderboard_rpc/quiz_leaderboard_rpc (20260614000014/15).
--
-- Bakgrunn: attempt_answers-tabellen kan lett passere 1000 rader for en
-- ENKELT quiz (bekreftet mot prod 26. juli 2026: den mest spilte quizen har
-- 1437 attempt_answers-rader på 75 forsøk — et upaginert
-- .select().in('attempt_id', ids) returnerte kun 1000 av dem, uten feil).
-- Seks steder i koden hentet alle enkeltrader til Node for å telle
-- riktig/galt per spørsmål — flyttet nå til GROUP BY i databasen i stedet.
--
-- Rutene har automatisk JS-fallback (paginert range()-henting, ikke den
-- gamle uparginerte varianten) hvis disse funksjonene ikke finnes ennå —
-- trygt å deploye FØR migrasjonen kjøres.
-- ============================================================

-- 1) Per-spørsmål total/riktig-telling for et gitt sett av attempt-id-er.
--    Brukt der populasjonen (hvilke attempts som telles) allerede er bestemt
--    utenfor RPC-en — f.eks. en rangert/deduplisert snapshot-liste — slik at
--    denne funksjonen ikke risikerer å endre HVILKE forsøk som telles, kun
--    HVORDAN de telles.
CREATE OR REPLACE FUNCTION public.attempt_answer_stats_by_attempts(
  p_attempt_ids uuid[]
)
RETURNS TABLE (
  question_id uuid,
  total       bigint,
  correct     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    aa.question_id,
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE aa.is_correct)::bigint AS correct
  FROM public.attempt_answers aa
  WHERE aa.attempt_id = ANY(p_attempt_ids)
  GROUP BY aa.question_id;
$$;

-- 2) Per-spørsmål antall svar PER alternativ (A/B/C/D), for et gitt sett av
--    question-id-er (brukt til svarfordelingen spillerne ser etter at en
--    quiz stenger).
CREATE OR REPLACE FUNCTION public.attempt_answer_option_counts(
  p_question_ids uuid[]
)
RETURNS TABLE (
  question_id     uuid,
  selected_answer text,
  cnt             bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    aa.question_id,
    aa.selected_answer,
    COUNT(*)::bigint AS cnt
  FROM public.attempt_answers aa
  WHERE aa.question_id = ANY(p_question_ids)
    AND aa.selected_answer IS NOT NULL
  GROUP BY aa.question_id, aa.selected_answer;
$$;

-- 3) Antall DISTINKTE spillere (user_id) med minst ett individuelt,
--    innlogget forsøk siden et gitt tidspunkt. Brukt av forsidens
--    "X aktive spillere siste 12 uker" — mer presist enn dagens
--    Set(user_id)-tilnærming i JS, som i tillegg til å være upaginert også
--    ville undertelle unike brukere hvis en fremtidig paginert henting
--    stoppet midt i en brukers rekke av forsøk.
CREATE OR REPLACE FUNCTION public.count_active_players_since(
  p_since timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(DISTINCT a.user_id)::bigint
  FROM public.attempts a
  WHERE a.is_team = false
    AND a.user_id IS NOT NULL
    AND a.completed_at >= p_since;
$$;

-- Eksekverings-rettigheter. service_role (brukt av API-rutene) kaller disse.
-- REVOKE først — Postgres gir automatisk EXECUTE til PUBLIC ved oppretting.
REVOKE EXECUTE ON FUNCTION public.attempt_answer_stats_by_attempts(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.attempt_answer_option_counts(uuid[])     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_active_players_since(timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.attempt_answer_stats_by_attempts(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.attempt_answer_option_counts(uuid[])     TO service_role;
GRANT EXECUTE ON FUNCTION public.count_active_players_since(timestamptz) TO service_role;
