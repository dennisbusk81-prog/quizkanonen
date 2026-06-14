-- ============================================================
-- quiz_leaderboard — SQL-basert rangering, paginering og søk for
-- ukens quiz (/leaderboard/[id]). Kjør i Supabase SQL Editor.
--
-- Mønster: speiler season_leaderboard_* (20260614000014). Forskjellen er
-- at vi her rangerer RÅ attempt-rader (INGEN dedup per bruker) — slik at
-- resultatet matcher dagens rankAttempts() i lib/ranking.ts, der hvert
-- forsøk får sin egen rad.
--
-- Tiebreak (eksakt som rankAttempts): correct_answers DESC,
-- total_time_ms ASC, correct_streak DESC. Lagt til id ASC som siste,
-- deterministisk nøkkel slik at paginering er stabil mellom kall.
--
-- Separate rangeringsrom via p_is_team (false = "Alle", true = "Lag").
--
-- Eksisterende indeks (quiz_id, correct_answers DESC, total_time_ms ASC)
-- dekker WHERE + ORDER BY — ingen ny indeks nødvendig.
--
-- Ruten har automatisk JS-fallback hvis disse funksjonene ikke finnes
-- enda — trygg å deploye FØR migrasjonen kjøres.
-- ============================================================

-- 1) Paginert/søkbar rangert liste + totalt antall (for sidenavigasjon)
CREATE OR REPLACE FUNCTION public.quiz_leaderboard_ranked(
  p_quiz_id   uuid,
  p_is_team   boolean,
  p_page      int,
  p_page_size int,
  p_search    text
)
RETURNS TABLE (
  id                  uuid,
  user_id             uuid,
  player_name         text,
  correct_answers     int,
  total_questions     int,
  total_time_ms       bigint,
  correct_streak      int,
  is_team             boolean,
  team_size           int,
  leader_display_name text,
  rank                bigint,
  total_count         bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH ranked AS (
    SELECT
      a.id,
      a.user_id,
      a.player_name,
      a.correct_answers,
      a.total_questions,
      a.total_time_ms,
      a.correct_streak,
      a.is_team,
      a.team_size,
      a.leader_display_name,
      ROW_NUMBER() OVER (
        ORDER BY a.correct_answers DESC,
                 a.total_time_ms ASC,
                 COALESCE(a.correct_streak, 0) DESC,
                 a.id ASC
      ) AS rank
    FROM public.attempts a
    WHERE a.quiz_id = p_quiz_id
      AND a.is_team = p_is_team
  ),
  filtered AS (
    SELECT *
    FROM ranked
    WHERE p_search IS NULL
       OR p_search = ''
       OR player_name ILIKE '%' || p_search || '%'
  )
  SELECT
    f.id,
    f.user_id,
    f.player_name,
    f.correct_answers,
    f.total_questions,
    f.total_time_ms::bigint,
    f.correct_streak,
    f.is_team,
    f.team_size,
    f.leader_display_name,
    f.rank::bigint,
    (SELECT COUNT(*) FROM filtered)::bigint AS total_count
  FROM filtered f
  ORDER BY f.rank ASC
  LIMIT  GREATEST(COALESCE(p_page_size, 20), 1)
  OFFSET GREATEST((COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 20), 0);
$$;

-- 2) Én brukers beste plassering i rommet (laveste rank av brukerens forsøk).
--    Identisk ordning som funksjon 1 slik at rank er konsistent.
CREATE OR REPLACE FUNCTION public.quiz_leaderboard_user_stats(
  p_quiz_id uuid,
  p_is_team boolean,
  p_user_id uuid
)
RETURNS TABLE (
  id                  uuid,
  rank                bigint,
  correct_answers     int,
  total_questions     int,
  total_time_ms       bigint,
  correct_streak      int,
  player_name         text,
  leader_display_name text,
  team_size           int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH ranked AS (
    SELECT
      a.id,
      a.user_id,
      a.player_name,
      a.correct_answers,
      a.total_questions,
      a.total_time_ms,
      a.correct_streak,
      a.leader_display_name,
      a.team_size,
      ROW_NUMBER() OVER (
        ORDER BY a.correct_answers DESC,
                 a.total_time_ms ASC,
                 COALESCE(a.correct_streak, 0) DESC,
                 a.id ASC
      ) AS rank
    FROM public.attempts a
    WHERE a.quiz_id = p_quiz_id
      AND a.is_team = p_is_team
  )
  SELECT
    r.id,
    r.rank::bigint,
    r.correct_answers,
    r.total_questions,
    r.total_time_ms::bigint,
    r.correct_streak,
    r.player_name,
    r.leader_display_name,
    r.team_size
  FROM ranked r
  WHERE r.user_id = p_user_id
  ORDER BY r.rank ASC
  LIMIT 1;
$$;

-- 3) Antall forsøk i rommet som slår en gitt score (for gjest-estimat:
--    "et sted mellom plass X og Y"). Bevarer dagens betre-enn-logikk.
CREATE OR REPLACE FUNCTION public.quiz_leaderboard_better_count(
  p_quiz_id uuid,
  p_is_team boolean,
  p_correct int,
  p_time_ms bigint
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::bigint
  FROM public.attempts a
  WHERE a.quiz_id = p_quiz_id
    AND a.is_team = p_is_team
    AND ( a.correct_answers > p_correct
          OR (a.correct_answers = p_correct AND a.total_time_ms < p_time_ms) );
$$;

-- Eksekverings-rettigheter. service_role (brukt av API-ruten) kaller disse.
GRANT EXECUTE ON FUNCTION public.quiz_leaderboard_ranked(uuid, boolean, int, int, text)      TO service_role;
GRANT EXECUTE ON FUNCTION public.quiz_leaderboard_user_stats(uuid, boolean, uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION public.quiz_leaderboard_better_count(uuid, boolean, int, bigint)    TO service_role;
