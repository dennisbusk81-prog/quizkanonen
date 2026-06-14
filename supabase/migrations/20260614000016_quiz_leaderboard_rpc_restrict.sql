-- ============================================================
-- Strammer inn EXECUTE-rettigheter på leaderboard-RPC-funksjonene.
--
-- Bakgrunn: Postgres gir automatisk EXECUTE til PUBLIC ved oppretting av
-- en funksjon. Funksjonene i 20260614000014 (season_leaderboard_*) og
-- 20260614000015 (quiz_leaderboard_*) arvet derfor execute til anon/PUBLIC,
-- selv om de kun kalles av API-ruter via service_role.
--
-- Dette er ikke en reell datalekkasje (funksjonene er read-only og
-- eksponerer kun leaderboard-data som allerede er offentlig lesbar via
-- attempts-/season_scores-policyene), men vi strammer inn som
-- defense-in-depth: kun service_role skal kunne kalle dem.
--
-- Idempotent: REVOKE/GRANT kan kjøres flere ganger uten bivirkning.
-- ============================================================

-- ── quiz_leaderboard_* (20260614000015) ──────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.quiz_leaderboard_ranked(uuid, boolean, int, int, text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.quiz_leaderboard_user_stats(uuid, boolean, uuid)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.quiz_leaderboard_better_count(uuid, boolean, int, bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.quiz_leaderboard_ranked(uuid, boolean, int, int, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.quiz_leaderboard_user_stats(uuid, boolean, uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.quiz_leaderboard_better_count(uuid, boolean, int, bigint) TO service_role;

-- ── season_leaderboard_* (20260614000014) ────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.season_leaderboard_ranked(text, uuid, timestamptz, timestamptz, uuid[], int, int, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.season_leaderboard_user_stats(text, uuid, timestamptz, timestamptz, uuid[], uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.season_leaderboard_period_quizzes(text, uuid, timestamptz, timestamptz)                 FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.season_leaderboard_ranked(text, uuid, timestamptz, timestamptz, uuid[], int, int, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.season_leaderboard_user_stats(text, uuid, timestamptz, timestamptz, uuid[], uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.season_leaderboard_period_quizzes(text, uuid, timestamptz, timestamptz)                 TO service_role;
