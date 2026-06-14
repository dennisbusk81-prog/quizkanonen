-- ============================================================
-- attempts — fjern duplikat SELECT-policy
--
-- Dokumenterer fjerning kjørt og verifisert mot produksjon.
-- Idempotent: DROP POLICY IF EXISTS (trygg å kjøre flere ganger).
--
-- Prod hadde to identiske permissive SELECT-policyer på attempts:
--   • "Alle kan lese forsøk"  (USING true)  ← beholdt
--   • "attempts_select_all"   (USING true)  ← fjernet (duplikat)
--
-- Permissive policyer for samme kommando kombineres med OR, så to
-- identiske USING true-policyer er funksjonelt én. Ingen endring i
-- tilgangsnivå — kun opprydding.
-- ============================================================

DROP POLICY IF EXISTS "attempts_select_all" ON public.attempts;
