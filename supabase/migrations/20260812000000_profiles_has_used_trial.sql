-- ============================================================
-- profiles.has_used_trial — det varige merket «har hatt gratis prøveperiode»
--
-- ETTERSLEPS-MIGRASJON. Kolonnen ble opprettet manuelt i prod 12. august 2026,
-- samtidig med commit ce6ccb5 (engangs-prøveperiode per konto), UTEN
-- migrasjonsfil. Denne filen beskriver tilstanden som allerede finnes i prod,
-- slik at et nytt miljø bygget fra supabase/migrations får den også.
-- Kjørt mot prod skal den ikke endre noe.
--
-- HVORFOR KOLONNEN FINNES
-- /api/stripe/founders-activate målte tidligere bare NÅ-tilstand
-- (premium_status, personal_stripe_subscription_id). Etter at
-- Founders-trialene stenges 15. august 2026 er begge tomme for hele
-- kohorten, og samtlige vakter åpner seg igjen — kontoene kunne da gi seg
-- selv nye gratisperioder i løkke. Kolonnen er det varige merket som ikke
-- forsvinner når abonnementet gjør det.
--
-- NOT NULL er ikke pynt: det atomiske claimet i ruten er
-- `.update({ has_used_trial: true }).eq('has_used_trial', false)`, og en
-- NULL-rad ville ikke matchet det filteret — den ville falt utenfor
-- engangs-regelen i stedet for å bli fanget av den.
--
-- Kolonnen skrives KUN av service_role (trial-aktiveringsruten og
-- scripts/backfill-has-used-trial.mjs). Klient-skriving stoppes av
-- prevent_self_trial_unmark_trigger — se 20260812000001.
--
-- MÅLT I PROD 12. august 2026 (PostgREST OpenAPI, service role):
--   format=boolean, default=false, NOT NULL=true
--   COMMENT satt (gjengitt ordrett under, inkludert at den er ASCII-only)
--   fordeling: 78 rader true, 74 false, 0 NULL
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + COMMENT (som alltid er en ren
-- overskriving av samme tekst).
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_used_trial boolean NOT NULL DEFAULT false;

-- Ordrett samme streng som står i prod (253 tegn, ingen æøå — kommentaren ble
-- skrevet ASCII-only). Endres den her, endres den i prod ved kjøring.
COMMENT ON COLUMN public.profiles.has_used_trial IS
  'Permanent: brukeren har hatt en gratis proveperiode (Founders eller etterfolgeren). Settes av trial-aktiveringsruten og backfill-scriptet. Nulles ALDRI av cron/webhook/syncPremiumCache. Beskyttet av trigger prevent_self_trial_unmark mot klient-skriving.';
