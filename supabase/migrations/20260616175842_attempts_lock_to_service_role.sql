-- ============================================================
-- attempts — lås INSERT/UPDATE/DELETE til service_role
--
-- BAKGRUNN:
-- Policyen "Alle kan oppdatere attempts" (UPDATE, USING true / WITH CHECK true)
-- lot hvem som helst med anon-nøkkelen overskrive score-verdier direkte i
-- databasen, uten å gå via server-rutene. Det undergravde server-side scoring
-- (submit/route.ts) og gjorde sesong-leaderboard manipulerbar.
--
-- ETTER DENNE MIGRASJONEN:
--   • INSERT: kun service_role (via /api/quiz/start-attempt)
--   • UPDATE: kun service_role (via /api/quiz/[id]/submit)
--   • DELETE: ingen policy = kun service_role (allerede tilfellet etter
--             20260614000012, beholdes uendret)
--   • SELECT: uendret (håndteres i Brief 2)
--
-- SUSPENSJON:
-- Sperren for suspenderte brukere ble tidligere håndhevet av INSERT-policyen
-- "Suspenderte brukere kan ikke spille". service_role omgår RLS, så den sjekken
-- gjøres nå eksplisitt i /api/quiz/start-attempt. Policyen fjernes her.
--
-- ⚠️ KJØR DENNE MANUELT I SUPABASE SQL EDITOR FØRST ETTER at koden er deployet
--    og quiz-registrering er verifisert i prod. Feil rekkefølge bryter
--    registreringsflyten (klienten skriver ikke lenger til attempts direkte).
--
-- Idempotent: DROP POLICY IF EXISTS før CREATE.
-- ============================================================

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

-- Fjern den åpne UPDATE-policyen
DROP POLICY IF EXISTS "Alle kan oppdatere attempts" ON public.attempts;

-- Fjern de åpne INSERT-policyene (begge navnevarianter)
DROP POLICY IF EXISTS "Suspenderte brukere kan ikke spille" ON public.attempts;
DROP POLICY IF EXISTS "attempts_insert_all" ON public.attempts;
DROP POLICY IF EXISTS "Alle kan sette inn attempts" ON public.attempts;

-- Ny INSERT: kun service-role (via server-ruter)
DROP POLICY IF EXISTS "Service role kan sette inn attempts" ON public.attempts;
CREATE POLICY "Service role kan sette inn attempts"
  ON public.attempts FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Ny UPDATE: kun service-role (submit/route.ts bruker allerede supabaseAdmin)
DROP POLICY IF EXISTS "Service role kan oppdatere attempts" ON public.attempts;
CREATE POLICY "Service role kan oppdatere attempts"
  ON public.attempts FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
