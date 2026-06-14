-- ============================================================
-- season_leaderboard — SQL-basert rangering, paginering og søk
-- Kjør i Supabase SQL Editor før (eller rett etter) deploy av den
-- oppdaterte /api/toppliste-ruten.
--
-- Bakgrunn: ruten aggregerte tidligere ALLE season_scores-rader for
-- perioden i JS (potensielt 20 000+ rader for All-time ved skalering).
-- Disse funksjonene flytter aggregering + rangering inn i Postgres med
-- window-funksjoner, og returnerer kun den forespurte siden.
--
-- Ruten har en automatisk JS-fallback hvis disse funksjonene ikke finnes
-- enda — den er derfor trygg å deploye FØR migrasjonen kjøres. Etter at
-- migrasjonen er kjørt brukes den raske SQL-stien automatisk.
--
-- Rangering bruker ROW_NUMBER() (sekvensiell, hver bruker unik plass) med
-- determinert tiebreak (points DESC, quiz_count ASC, user_id ASC) — samme
-- ordning i alle tre funksjonene slik at userRank stemmer med listevisning.
-- ============================================================

-- 1) Paginert/søkbar rangert liste + totalt antall (for sidenavigasjon)
CREATE OR REPLACE FUNCTION public.season_leaderboard_ranked(
  p_scope        text,
  p_scope_id     uuid,
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_excluded_ids uuid[],
  p_page         int,
  p_page_size    int,
  p_search       text
)
RETURNS TABLE (
  user_id      uuid,
  display_name text,
  points       bigint,
  quiz_count   bigint,
  rank         bigint,
  total_count  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH agg AS (
    SELECT
      ss.user_id                 AS user_id,
      SUM(ss.points)             AS points,
      COUNT(DISTINCT ss.quiz_id) AS quiz_count
    FROM public.season_scores ss
    WHERE ss.scope_type = p_scope
      AND (
        (p_scope_id IS NULL AND ss.scope_id IS NULL)
        OR ss.scope_id = p_scope_id
      )
      AND ss.closes_at >= p_period_start
      AND (p_period_end IS NULL OR ss.closes_at < p_period_end)
      AND NOT (ss.user_id = ANY (COALESCE(p_excluded_ids, ARRAY[]::uuid[])))
    GROUP BY ss.user_id
  ),
  ranked AS (
    SELECT
      a.user_id,
      p.display_name,
      a.points,
      a.quiz_count,
      ROW_NUMBER() OVER (
        ORDER BY a.points DESC, a.quiz_count ASC, a.user_id ASC
      ) AS rank
    FROM agg a
    JOIN public.profiles p ON p.id = a.user_id
  ),
  filtered AS (
    SELECT *
    FROM ranked
    WHERE p_search IS NULL
       OR p_search = ''
       OR display_name ILIKE '%' || p_search || '%'
  )
  SELECT
    f.user_id,
    f.display_name,
    f.points::bigint,
    f.quiz_count::bigint,
    f.rank::bigint,
    (SELECT COUNT(*) FROM filtered)::bigint AS total_count
  FROM filtered f
  ORDER BY f.rank ASC
  LIMIT  GREATEST(COALESCE(p_page_size, 20), 1)
  OFFSET GREATEST((COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 20), 0);
$$;

-- 2) Én brukers plassering (rank/points/quiz_count) — uavhengig av side/søk.
--    Identisk ordning som funksjon 1 slik at rank er konsistent.
CREATE OR REPLACE FUNCTION public.season_leaderboard_user_stats(
  p_scope        text,
  p_scope_id     uuid,
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_excluded_ids uuid[],
  p_user_id      uuid
)
RETURNS TABLE (
  points     bigint,
  quiz_count bigint,
  rank       bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH agg AS (
    SELECT
      ss.user_id                 AS user_id,
      SUM(ss.points)             AS points,
      COUNT(DISTINCT ss.quiz_id) AS quiz_count
    FROM public.season_scores ss
    WHERE ss.scope_type = p_scope
      AND (
        (p_scope_id IS NULL AND ss.scope_id IS NULL)
        OR ss.scope_id = p_scope_id
      )
      AND ss.closes_at >= p_period_start
      AND (p_period_end IS NULL OR ss.closes_at < p_period_end)
      AND NOT (ss.user_id = ANY (COALESCE(p_excluded_ids, ARRAY[]::uuid[])))
    GROUP BY ss.user_id
  ),
  ranked AS (
    SELECT
      a.user_id,
      a.points,
      a.quiz_count,
      ROW_NUMBER() OVER (
        ORDER BY a.points DESC, a.quiz_count ASC, a.user_id ASC
      ) AS rank
    FROM agg a
  )
  SELECT r.points::bigint, r.quiz_count::bigint, r.rank::bigint
  FROM ranked r
  WHERE r.user_id = p_user_id;
$$;

-- 3) Distinkte quizer i perioden (tidslinje for streak-beregning i topp-10).
--    Bundet av antall quizer (ikke antall brukere).
CREATE OR REPLACE FUNCTION public.season_leaderboard_period_quizzes(
  p_scope        text,
  p_scope_id     uuid,
  p_period_start timestamptz,
  p_period_end   timestamptz
)
RETURNS TABLE (
  quiz_id   uuid,
  closes_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT ss.quiz_id, ss.closes_at
  FROM public.season_scores ss
  WHERE ss.scope_type = p_scope
    AND (
      (p_scope_id IS NULL AND ss.scope_id IS NULL)
      OR ss.scope_id = p_scope_id
    )
    AND ss.closes_at >= p_period_start
    AND (p_period_end IS NULL OR ss.closes_at < p_period_end)
  ORDER BY ss.closes_at ASC;
$$;

-- Eksekverings-rettigheter. service_role (brukt av API-ruten) kaller disse.
GRANT EXECUTE ON FUNCTION public.season_leaderboard_ranked(text, uuid, timestamptz, timestamptz, uuid[], int, int, text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.season_leaderboard_user_stats(text, uuid, timestamptz, timestamptz, uuid[], uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION public.season_leaderboard_period_quizzes(text, uuid, timestamptz, timestamptz)                        TO service_role;
