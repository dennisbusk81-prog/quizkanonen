-- ============================================================
-- attempts — skjul user_id fra anon/authenticated + stram rad-tilgang
--
-- BAKGRUNN (#3):
-- Policyen "attempts_select_all" (SELECT USING true) lot hvem som helst med
-- anon-nøkkelen dumpe hele attempts-tabellen med player_name, score OG user_id.
--
-- ETTER DENNE MIGRASJONEN:
--   • SELECT-rad-policy strammes til kun innsendte + ferdig scorede forsøk.
--   • Kolonne-lås: anon/authenticated mister SELECT på user_id (re-grant av alle
--     øvrige kolonner). user_id er dermed ikke lenger offentlig lesbar.
--   • De tre klient-lesene som trengte user_id er flyttet til service_role-ruter:
--       - /api/leaderboard/[id]/prev-rank   (pil opp-trendmerket)
--       - /api/org/[slug]/quiz-scores       (org quiz-leaderboard + streaks)
--   • Server-ruter (supabaseAdmin/service_role) er upåvirket — de leverer fortsatt
--     user_id der det trengs (sesong-poeng, historikk, leaderboard-rangering).
--
-- ⚠️ KJØR MANUELT I SUPABASE SQL EDITOR FØRST ETTER at koden er deployet og de
--    nye server-rutene er verifisert i prod. Kjøres migrasjonen før koden er live,
--    slutter leaderboard-trendmerket og org-admin-tabellene å vise data.
--
-- NB KOLONNELISTE: attempts ble opprettet utenfor migrasjonene. Listen under er
-- utledet fra Attempt-typen + observerte selects. Verifiser mot faktisk skjema
-- før kjøring — en manglende kolonne her brekker en anon/auth-lese.
--
-- Idempotent.
-- ============================================================

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

-- Strammere rad-policy: kun innsendte + ferdig scorede forsøk er offentlig synlige.
DROP POLICY IF EXISTS "attempts_select_all" ON public.attempts;
DROP POLICY IF EXISTS "Alle kan se attempts" ON public.attempts;
DROP POLICY IF EXISTS "Offentlig kan se innsendte attempts" ON public.attempts;
CREATE POLICY "Offentlig kan se innsendte attempts"
  ON public.attempts FOR SELECT
  TO public
  USING (submitted_at IS NOT NULL AND correct_streak IS NOT NULL);

-- Kolonne-lås: fjern user_id fra anon/authenticated SELECT ved å re-grante alle
-- øvrige kolonner (PostgreSQL har ingen «alle unntatt»-syntaks).
REVOKE SELECT ON public.attempts FROM anon, authenticated;
GRANT SELECT (
  id, quiz_id, player_name, correct_answers, total_questions, total_time_ms,
  correct_streak, is_team, team_size, submitted_at, leader_display_name,
  completed_at, created_at
) ON public.attempts TO anon, authenticated;

-- Offentlig leaderboard-view uten user_id (for ev. fremtidig direkte bruk).
DROP VIEW IF EXISTS public.attempts_public;
CREATE VIEW public.attempts_public AS
  SELECT id, quiz_id, player_name, correct_answers, total_time_ms, correct_streak,
         is_team, team_size, submitted_at, leader_display_name
  FROM public.attempts
  WHERE submitted_at IS NOT NULL AND correct_streak IS NOT NULL;

GRANT SELECT ON public.attempts_public TO anon, authenticated;
