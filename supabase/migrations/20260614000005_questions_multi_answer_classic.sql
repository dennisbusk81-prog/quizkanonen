-- ============================================================
-- questions — flere riktige svar, klassiker-bank, variabel tidslimit
--
-- correct_answers (TEXT[]): NY kolonne på questions for å støtte flere
--   gyldige svar per spørsmål. Faller tilbake til den eksisterende
--   enkelt-kolonnen correct_answer når den er tom/NULL.
--   MERK: dette er IKKE samme kolonne som "correct_answers" på
--   attempts-tabellen (der er det en integer-score, se
--   20260401000002_performance_indexes.sql). Samme navn, ulik tabell
--   og type.
--
-- is_classic (BOOLEAN): markerer spørsmål for gjenbruk i klassiker-banken.
-- time_limit_seconds (INTEGER): valgfri per-spørsmål tidsgrense.
-- ============================================================

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS correct_answers    text[],
  ADD COLUMN IF NOT EXISTS is_classic         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_limit_seconds integer;
