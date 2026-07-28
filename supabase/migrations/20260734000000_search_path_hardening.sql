-- ============================================================
-- search_path-herding for 5 gjenværende RPC-er.
--
-- Kjør i Supabase SQL Editor. Ikke destruktiv, idempotent — endrer kun
-- funksjonenes SET-konfigurasjon, ikke body, signatur eller rettigheter.
--
-- BAKGRUNN: alle fem er SECURITY DEFINER-funksjoner (20260727000000_attempt_
-- answer_stats_rpc.sql og 20260730000000_dashboard_rpcs.sql) opprettet uten
-- SET search_path, i motsetning til det etablerte mønsteret fra samme uke
-- (public.is_league_member i 20260723000000, public.swap_question_order i
-- 20260731000000). Uten en fastsatt sti arver en SECURITY DEFINER-funksjon
-- kallerens search_path — en angriper med skrivetilgang til et skjema tidlig
-- i stien kunne i teorien plassere en funksjon/tabell med samme navn som en
-- ukvalifisert referanse og få den kjørt med definer-rettigheter. Alle fem
-- kropper er allerede fullkvalifisert (public.attempt_answers, public.attempts,
-- public.league_members), så SET search_path = '' (tom, ikke 'public') er
-- trygt — ingenting resolves implisitt utover pg_catalog, som alltid er først.
--
-- ALTER FUNCTION i stedet for CREATE OR REPLACE: trenger ikke gjenta body,
-- og endrer garantert ingenting annet enn search_path-konfigurasjonen.
-- ============================================================

ALTER FUNCTION public.attempt_answer_stats_by_attempts(uuid[])   SET search_path = '';
ALTER FUNCTION public.attempt_answer_option_counts(uuid[])       SET search_path = '';
ALTER FUNCTION public.count_active_players_since(timestamptz)    SET search_path = '';

ALTER FUNCTION public.weekly_active_players(integer)             SET search_path = '';
ALTER FUNCTION public.count_active_leagues()                     SET search_path = '';

-- ── Verifiser i SQL Editor etter kjøring (proconfig skal vise search_path=""):
--    SELECT proname, proconfig FROM pg_proc
--    WHERE proname IN (
--      'attempt_answer_stats_by_attempts', 'attempt_answer_option_counts',
--      'count_active_players_since', 'weekly_active_players', 'count_active_leagues'
--    );
