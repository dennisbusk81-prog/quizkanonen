-- ============================================================
-- attempts — dokumentasjon av eksisterende UPDATE- og DELETE-policyer
--
-- Disse to policyene finnes allerede i produksjon (lest fra pg_policies)
-- og forklarer hvorfor finishQuiz sin UPDATE (app/quiz/[id]/page.tsx)
-- fungerer selv om RLS er aktivert. Filen dokumenterer dem slik de
-- FAKTISK er — idempotent (DROP POLICY IF EXISTS + CREATE).
--
-- ⚠️ SIKKERHETSADVARSEL — disse policyene er svært vide:
--   • UPDATE: USING true / WITH CHECK true → enhver klient (også anon med
--     anon-nøkkelen) kan oppdatere HVILKEN SOM HELST attempt-rad. En
--     konkurranseinnstilt bruker kan i prinsippet sette egen
--     correct_answers/total_time_ms til hva som helst (juks), eller endre
--     andres rader.
--   • DELETE: USING true → enhver klient kan slette hvilken som helst
--     attempt-rad (kan tømme leaderboards).
-- Denne filen ENDRER ikke på dette (den dokumenterer kun dagens tilstand).
-- Innstramming bør vurderes separat — se egen anbefaling.
-- ============================================================

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

-- #3 — UPDATE: PERMISSIVE, roller {public}, USING true, WITH CHECK true
DROP POLICY IF EXISTS "Alle kan oppdatere attempts" ON public.attempts;
CREATE POLICY "Alle kan oppdatere attempts"
  ON public.attempts FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- #4 — DELETE: PERMISSIVE, roller {public}, USING true (DELETE har ingen WITH CHECK)
DROP POLICY IF EXISTS "Alle kan slette attempts" ON public.attempts;
CREATE POLICY "Alle kan slette attempts"
  ON public.attempts FOR DELETE
  TO public
  USING (true);
