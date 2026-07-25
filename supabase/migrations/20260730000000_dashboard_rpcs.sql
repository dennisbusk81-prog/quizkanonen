-- ============================================================
-- weekly_active_players / count_active_leagues — aggregering for
-- admin-dashboardet (/admin/dashboard).
--
-- Kjør i Supabase SQL Editor. Speiler mønsteret fra
-- 20260727000000_attempt_answer_stats_rpc.sql: SECURITY DEFINER,
-- REVOKE fra PUBLIC/anon, GRANT kun til service_role.
--
-- Kun DISSE to trengte SQL. De øvrige dashboard-tallene er rene
-- COUNT-spørringer (`count: 'exact', head: true`), som ikke returnerer
-- rader og derfor aldri rammes av PostgREST sin stille 1000-rads-grense.
-- Retention beregnes i lib/retention.ts, delt med /api/admin/retention,
-- slik at de to sidene ikke kan drifte fra hverandre.
-- ============================================================

-- 1) Ukentlig antall DISTINKTE aktive spillere, for grafen på dashboardet.
--
--    Hvorfor ikke count_active_players_since (20260727000000): den teller
--    kumulativt FRA et tidspunkt, ikke per uke. Tolv kall ville gitt tolv
--    kumulative tall, ikke tolv ukesbøtter.
--
--    MERK — to bevisste avvik fra count_active_players_since:
--      * submitted_at, ikke completed_at. completed_at settes av DB-defaulten
--        now() når forsøket OPPRETTES og er altså starttidspunktet (se
--        CLAUDE.md, avsnittet om attempt-token). En spiller som startet men
--        aldri leverte er ikke «aktiv». submitted_at er dessuten samme
--        definisjon som retention-beregningen bruker, så grafens to serier
--        måler samme populasjon.
--      * Ukene er Europe/Oslo, ikke UTC. Fredagsquizen ligger langt fra
--        ukeskillet, men eksplisitt tidssone gjør at en sen søndagskveld
--        ikke havner i feil uke.
--
--    Uker uten spillere kommer med som 0 (generate_series + LEFT JOIN), slik
--    at grafen viser et hull i aktiviteten i stedet for å skjule det ved å
--    trekke sammen x-aksen.
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
    FROM public.attempts a, bounds b
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

-- 2) Antall ligaer med minst ett medlem.
--
--    leagues-tabellen har ingen status-/aktiv-kolonne, så «aktiv» må utledes.
--    Definisjonen er avtalt: en liga teller når den har minst ett medlem i
--    league_members — en opprettet, men aldri befolket liga er ikke aktiv.
--
--    COUNT(DISTINCT …) i databasen framfor en paginert henting av alle
--    league_members-rader til Node: tabellen vokser med hver innmelding, og
--    et upaginert .select() ville stille kuttet ved 1000 rader og
--    UNDERRAPPORTERT antall ligaer etter hvert som produktet vokser.
CREATE OR REPLACE FUNCTION public.count_active_leagues()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(DISTINCT lm.league_id)::bigint
  FROM public.league_members lm;
$$;

-- 3) Delvis indeks på submitted_at.
--
--    weekly_active_players filtrerer på submitted_at ved hver dashboard-last.
--    attempts har i dag kun indekser på quiz_id (20260401000002), så spørringen
--    ville gjort full tabellskanning. Delvis (WHERE submitted_at IS NOT NULL)
--    fordi ustartede/uleverte forsøk aldri er med i noen av disse spørringene.
CREATE INDEX IF NOT EXISTS idx_attempts_submitted_at
  ON public.attempts (submitted_at)
  WHERE submitted_at IS NOT NULL;

-- Eksekverings-rettigheter. service_role (brukt av API-rutene) kaller disse.
-- REVOKE først — Postgres gir automatisk EXECUTE til PUBLIC ved oppretting.
REVOKE EXECUTE ON FUNCTION public.weekly_active_players(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_active_leagues()         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.weekly_active_players(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_active_leagues()         TO service_role;
