-- Markerer om brukeren har satt et passord på kontoen sin.
--
-- Kolonnen finnes ALLEREDE i produksjonsdatabasen (lagt til direkte i Supabase-
-- dashbordet 18. juli 2026). Denne filen er skrevet i etterkant slik at skjemaet
-- er reproduserbart hvis prosjektet må settes opp på nytt — den skal ikke kjøres
-- mot prod, og er idempotent nettopp derfor.
--
-- Settes kun av vår egen kode, aldri av Supabase Auth selv:
--   /api/auth/mark-password  → true etter passord-signup og etter /sett-passord
--
-- Leses av:
--   /api/auth/check-email    → styrer hvilke innloggingsmetoder /login viser
--   /profil                  → velger "Sett passord" vs "Endre passord"
--
-- false = ingen passord (typisk Google- eller magic link-bruker). Det er derfor
-- riktig default for alle eksisterende rader: ingen hadde passord før dette.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_password boolean NOT NULL DEFAULT false;
