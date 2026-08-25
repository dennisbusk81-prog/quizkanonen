-- ============================================================
-- weekly_active_players / count_active_players_since — populasjonsgulvet fra
-- lib/real-quiz-population.ts, uttrykt i SQL.
--
-- Kjør i Supabase SQL Editor. Kjøres FØR arkivet slippes.
--
-- BAKGRUNN: begge funksjonene teller distinkte spillere over public.attempts
-- UTEN å se på hva slags quiz forsøket tilhører. Testquizer teller altså med,
-- og etter at arkivet åpner ville arkivspill blåst opp både admin-grafen
-- (weekly_active_players, 20260730000000) og forsidens «X aktive spillere
-- siste 12 uker» (count_active_players_since, 20260727000000) — vekst som
-- ikke er ukentlig deltakelse. BEGGE rettes her; å rette den ene og la
-- søsteren stå er nøyaktig feilklassen ARBEIDSREGELEN i CLAUDE.md beskriver.
--
-- Filteret speiler TS-siden (lib/real-quiz-population.ts):
--   is_test IS NOT TRUE  AND  quiz_type IN ('weekly', 'bonus')
--   * `IS NOT TRUE`, ikke `= false` — is_test er NULLABLE, og `= false`
--     matcher ikke NULL-rader.
--   * Hviteliste, ikke svarteliste — quiz_type er et åpent verdirom, og
--     arkivforsøk får quiz_type = 'archive' som EGEN verdi. De faller ut her
--     uten videre endring, men radene blir liggende urørt og er fullt
--     finnbare for en senere XP-modell.
--   * MERK: utvides REAL_QUIZ_TYPES i lib/real-quiz-population.ts, må
--     IN-listene i DENNE filen endres i en ny migrasjon i samme runde —
--     SQL-siden følger ikke TS-konstanten automatisk.
--
-- ── TO FELLER SOM ER RESPEKTERT ─────────────────────────────────────────────
--
-- 1. CREATE OR REPLACE NULLSTILLER FUNKSJONSATTRIBUTTER. Migrasjon
--    20260734000000_search_path_hardening satte `SET search_path = ''` på
--    begge via ALTER FUNCTION. En REPLACE uten den linjen stripper
--    hardeningen STILLE. Derfor står `SET search_path = ''` INLINE i begge
--    definisjonene under, sammen med de øvrige attributtene funksjonene har i
--    dag: LANGUAGE sql, STABLE, SECURITY DEFINER.
--
-- 2. REPLACE bevarer eier og ACL, men rettighetene re-hevdes likevel nederst,
--    og REVOKE navngir `authenticated` EKSPLISITT — regelen fra 30. juli
--    2026: en revoke fra PUBLIC/anon alene fjerner ikke authenticated sin
--    egen grant.
--
-- ── VERIFISER FØR OG ETTER (samme spørring begge ganger) ────────────────────
--    SELECT p.proname,
--           p.prosecdef  AS security_definer,   -- forventet: true
--           p.provolatile AS volatilitet,       -- forventet: 's' (STABLE)
--           p.proconfig  AS config,             -- forventet: {search_path=}
--           p.proacl     AS acl                 -- forventet: kun service_role
--                                               --  (+ eier/postgres), ikke
--                                               --  anon/authenticated
--    FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('weekly_active_players', 'count_active_players_since');
--
--    FØR og ETTER skal være IDENTISKE. Endringen ligger kun i kroppen
--    (joinen mot public.quizzes) — ikke i noe attributt.
-- ============================================================

-- 1) Ukentlig antall DISTINKTE aktive spillere, for grafen på dashboardet.
--    Kroppen er 20260730000000 sin, ord for ord, med to endringer:
--    joinen mot public.quizzes (populasjonsgulvet) og at komma-joinen
--    «attempts a, bounds b» er skrevet som CROSS JOIN — semantisk identisk,
--    men kan stå sammen med den nye eksplisitte JOIN-en.
CREATE OR REPLACE FUNCTION public.weekly_active_players(
  p_weeks integer DEFAULT 12
)
RETURNS TABLE (
  week_start     date,
  active_players bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''   -- MÅ stå inline: CREATE OR REPLACE nullstiller den ellers
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('week', (now() AT TIME ZONE 'Europe/Oslo')) AS this_week,
      date_trunc('week', (now() AT TIME ZONE 'Europe/Oslo'))
        - ((GREATEST(COALESCE(p_weeks, 12), 1) - 1) * INTERVAL '1 week') AS first_week
  ),
  weeks AS (
    SELECT generate_series(b.first_week, b.this_week, INTERVAL '1 week')::date AS week_start
    FROM bounds b
  ),
  played AS (
    SELECT
      date_trunc('week', a.submitted_at AT TIME ZONE 'Europe/Oslo')::date AS week_start,
      a.user_id
    FROM public.attempts a
    -- NYTT (25. august 2026): kun forsøk på ekte quizer teller. INNER JOIN =
    -- et forsøk uten (ekte) quiz-rad faller ut — samme semantikk som
    -- `quizzes!inner(id)` + onlyRealQuizAttempts() på PostgREST-siden.
    JOIN public.quizzes q
      ON q.id = a.quiz_id
     AND q.is_test IS NOT TRUE
     AND q.quiz_type IN ('weekly', 'bonus')
    CROSS JOIN bounds b
    WHERE a.submitted_at IS NOT NULL
      AND a.is_team = false
      AND a.user_id IS NOT NULL
      -- Konverter ukestarten (lokal timestamp) tilbake til timestamptz før
      -- sammenligning mot submitted_at. Uten dette caster Postgres implisitt
      -- og tolker den lokale ukestarten som UTC — altså to timer feil om
      -- sommeren, som ville flyttet grensetilfeller inn i feil uke.
      AND a.submitted_at >= (b.first_week AT TIME ZONE 'Europe/Oslo')
  )
  SELECT
    w.week_start,
    COUNT(DISTINCT p.user_id)::bigint AS active_players
  FROM weeks w
  LEFT JOIN played p ON p.week_start = w.week_start
  GROUP BY w.week_start
  ORDER BY w.week_start;
$$;

-- 2) Antall DISTINKTE spillere siden et gitt tidspunkt (forsidens
--    «X aktive spillere siste 12 uker»). Kroppen er 20260727000000 sin,
--    ord for ord, med KUN joinen som endring.
--
--    BEVISST BEHOLDT fra originalen: `a.completed_at >= p_since`, og INGEN
--    `submitted_at IS NOT NULL`. completed_at er forsøkets STARTtidspunkt
--    (DB-default now(), overskrives aldri — se CLAUDE.md, attempt-token-
--    avsnittet), så en spiller som startet uten å levere teller i dag som
--    aktiv her. Å bytte til submitted_at ville vært en SEPARAT
--    adferdsendring som flyttet forsidetallet av en annen grunn enn
--    populasjonsfilteret — det tas i så fall som egen, eksplisitt beslutning,
--    ikke som blindpassasjer i denne migrasjonen. (Et tidligere utkast hadde
--    nettopp den feilen; det er forkastet.)
CREATE OR REPLACE FUNCTION public.count_active_players_since(
  p_since timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''   -- MÅ stå inline: CREATE OR REPLACE nullstiller den ellers
AS $$
  SELECT COUNT(DISTINCT a.user_id)::bigint
  FROM public.attempts a
  -- NYTT (25. august 2026): samme populasjonsgulv som over.
  JOIN public.quizzes q
    ON q.id = a.quiz_id
   AND q.is_test IS NOT TRUE
   AND q.quiz_type IN ('weekly', 'bonus')
  WHERE a.is_team = false
    AND a.user_id IS NOT NULL
    AND a.completed_at >= p_since;
$$;

-- Indekshensyn: joinen slår opp på quizzes.id (primærnøkkel, dekket).
-- attempts-siden er dekket av idx_attempts_submitted_at (20260730000000)
-- og idx_attempts_quiz_id (20260401000002). Ingen ny indeks trengs.

-- Eksekverings-rettigheter re-hevdes. REPLACE bevarer ACL, men belte og
-- bukseseler koster ingenting — og REVOKE må navngi authenticated eksplisitt
-- (regelen fra 30. juli 2026).
REVOKE EXECUTE ON FUNCTION public.weekly_active_players(integer)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.count_active_players_since(timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.weekly_active_players(integer)          TO service_role;
GRANT EXECUTE ON FUNCTION public.count_active_players_since(timestamptz) TO service_role;
