-- ============================================================
-- profiles — hindre at en bruker fjerner sitt eget trial-merke
--
-- ETTERSLEPS-MIGRASJON. Triggeren og funksjonen ble opprettet manuelt i prod
-- 12. august 2026 (commit ce6ccb5) UTEN migrasjonsfil. Denne filen beskriver
-- tilstanden som allerede finnes i prod.
--
-- VERIFISERT MOT PROD 12. august 2026 (pg_get_functiondef + pg_get_triggerdef
-- i SQL Editor). Filen ble først skrevet som en rekonstruksjon — funksjonskropp
-- og triggerdefinisjon kan ikke leses via PostgREST, som bare eksponerer
-- `public`-skjemaets tabeller og RPC-er, ikke pg_catalog. Verifiseringen
-- bekreftet alle tre usikre akser:
--   • kroppen: full tilbakestilling (NEW := OLD) for alt som ikke er
--     service_role — IKKE en enveis-sperre mot true → false
--   • SECURITY DEFINER = true
--   • triggeren: BEFORE UPDATE FOR EACH ROW, uten `OF has_used_trial` og uten
--     WHEN-klausul. tgenabled = 'O'
-- Ingen indeks på kolonnen. Fordeling: 78 true / 74 false / 0 NULL.
--
-- ETT AVVIK BLE FUNNET OG RETTET I PROD samme kveld: funksjonen manglet
-- `SET search_path`. Dennis kjørte
-- `ALTER FUNCTION public.prevent_self_trial_unmark() SET search_path TO ''`,
-- og proconfig viser nå `search_path=""`. Klausulen under beskriver derfor
-- prod slik den er NÅ, etter ALTER-en.
--
-- Klausulen står INLINE i CREATE OR REPLACE, ikke som et eget ALTER FUNCTION.
-- Det er mønsteret for en funksjon filen selv oppretter (se
-- 20260723000000_fix_league_members_rls_recursion.sql og
-- 20260731000000_swap_question_order_rpc.sql); det frittstående
-- ALTER FUNCTION i 20260734000000 var en ETTERMONTERING på funksjoner
-- opprettet andre steder. Inline er dessuten det robuste valget her: en
-- framtidig CREATE OR REPLACE uten klausulen ville stilt fjernet
-- konfigurasjonen igjen, som er nøyaktig avviket over.
--
-- `search_path = ''` (tom, ikke 'public') er riktig fordi kroppen ikke slår opp
-- ETT objekt — den leser bare NEW/OLD og en innebygd funksjon. Da finnes det
-- ingenting et angriperkontrollert skjema tidlig i søkestien kan kapre.
--
-- HVORFOR TRIGGEREN FINNES
-- RLS-policyen profiles_update_own (USING auth.uid() = id) lar en bruker
-- oppdatere sin egen profilrad uten kolonnebegrensning. Uten denne triggeren
-- kunne en bruker sette has_used_trial = false med et rått klient-kall og
-- dermed gi seg selv en ny gratis prøveperiode — nøyaktig hullet
-- engangs-regelen i /api/stripe/founders-activate finnes for å lukke.
-- Lesevakten i ruten er brukeropplevelse; sperren ligger her og i det
-- atomiske claimet.
--
-- Merk at profiles nå har TO BEFORE UPDATE-triggere
-- (prevent_self_trial_unmark_trigger og prevent_self_unsuspend_trigger).
-- De fyrer i alfabetisk navnerekkefølge og rører hver sin kolonne, så de
-- kan ikke overskrive hverandre.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_self_trial_unmark()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  -- Tillat service role (trial-aktiveringsruten, backfill-scriptet) å endre
  -- has_used_trial fritt. Rollback-stien i founders-activate setter den
  -- tilbake til false med vilje når Stripe-opprettelsen feiler.
  IF current_setting('request.jwt.claims', true)::json->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- For alle andre: behold eksisterende has_used_trial. Merk at dette gjelder
  -- BEGGE retninger — en klient kan verken fjerne merket sitt eller sette det.
  NEW.has_used_trial := OLD.has_used_trial;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_self_trial_unmark_trigger ON public.profiles;

CREATE TRIGGER prevent_self_trial_unmark_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_trial_unmark();
