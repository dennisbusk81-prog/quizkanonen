-- ============================================================
-- attempts — unik constraint per (user_id, quiz_id) for innloggede
--
-- BAKGRUNN:
-- Replay-sperren ble knekt av 20260616190001_attempts_hide_user_id.sql:
-- klienten kunne ikke lenger se egne uferdige attempts, så start-attempt
-- opprettet en ny rad ved hver reload. Resultat: massevis av duplikate
-- uferdige rader (0/15, 0s) per bruker per quiz (Line: 26, Magnus: 13, ...).
--
-- Server-koden er nå fikset (start-attempt gjenbruker uferdig rad, mount-sperren
-- gikk server-side). Denne migrasjonen legger på en DB-garanti mot fremtidige
-- duplikater.
--
-- ⚠️ VIKTIG — DENNE MIGRASJONEN SLETTER DATA:
-- Det finnes allerede duplikater i prod, så CREATE UNIQUE INDEX vil FEILE uten
-- opprydding først. Steg 1 sletter derfor duplikate rader og beholder ÉN rad per
-- (user_id, quiz_id):
--   - prioriterer et INNSENDT forsøk (submitted_at IS NOT NULL),
--   - deretter høyest correct_answers, raskest tid,
--   - ellers (kun uferdige) den nyest opprettede.
-- De slettede radene er uferdige junk-rader (0 poeng, ingen attempt_answers,
-- ingen season_scores knyttet til seg), så slettingen er trygg.
--
-- ⚠️ KJØR MANUELT I SUPABASE SQL EDITOR, og gjerne kjør SELECT-varianten av
--    steg 1 først for å se hvor mange rader som slettes:
--      SELECT count(*) FROM attempts a
--      WHERE user_id IS NOT NULL AND EXISTS (
--        SELECT 1 FROM (
--          SELECT id, row_number() OVER (
--            PARTITION BY user_id, quiz_id
--            ORDER BY (submitted_at IS NOT NULL) DESC, correct_answers DESC,
--                     total_time_ms ASC, created_at DESC
--          ) rn FROM attempts WHERE user_id IS NOT NULL
--        ) r WHERE r.id = a.id AND r.rn > 1
--      );
--
-- Idempotent (kan kjøres flere ganger).
-- ============================================================

-- Steg 1 — fjern duplikate rader, behold den "beste" per (user_id, quiz_id).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, quiz_id
      ORDER BY
        (submitted_at IS NOT NULL) DESC,  -- innsendt foran uferdig
        correct_answers DESC,             -- høyest score
        total_time_ms ASC,                -- raskest tid
        created_at DESC                   -- ellers nyeste
    ) AS rn
  FROM public.attempts
  WHERE user_id IS NOT NULL
)
DELETE FROM public.attempts a
USING ranked r
WHERE a.id = r.id
  AND r.rn > 1;

-- Steg 2 — unik partial index: maks én rad per innlogget bruker per quiz.
-- Anonyme forsøk (user_id IS NULL) er ikke omfattet.
CREATE UNIQUE INDEX IF NOT EXISTS attempts_user_quiz_unique
  ON public.attempts (user_id, quiz_id)
  WHERE user_id IS NOT NULL;
