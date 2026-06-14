-- ============================================================
-- attempts — fjern redundante/usikre policyer
--
-- Dokumenterer to fjerninger som er kjørt og verifisert mot produksjon.
-- Idempotent: DROP POLICY IF EXISTS (trygg å kjøre flere ganger).
--
-- 1) "Alle kan lage forsøk" (INSERT, WITH CHECK true)
--    Permissive INSERT-policyer kombineres med OR. Denne var alltid sann
--    og OR-overstyrte derfor "Suspenderte brukere kan ikke spille"
--    (20260614000009) — suspensjonssperren blokkerte i praksis ingenting.
--    Etter fjerning er sistnevnte den eneste INSERT-policyen, og sperren
--    har faktisk effekt. Anonym spilling (user_id NULL) og vanlige
--    innloggede brukere er fortsatt tillatt via suspensjonspolicyen.
--
-- 2) "Alle kan slette attempts" (DELETE, USING true)
--    Lot hvilken som helst klient (også anon) slette hvilken som helst
--    attempt-rad — kunne tømme leaderboards. Ingen kode i appen sletter
--    attempts klient-side, så policyen var ubrukt og usikker. Fjernet.
--    Uten DELETE-policy er DELETE nå service-role-only (omgår RLS).
-- ============================================================

DROP POLICY IF EXISTS "Alle kan lage forsøk"     ON public.attempts;
DROP POLICY IF EXISTS "Alle kan slette attempts" ON public.attempts;
