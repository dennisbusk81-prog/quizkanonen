-- ============================================================
-- attempt_answers — UNIQUE (attempt_id, question_id)
--
-- FORMÅL:
-- Siste forsvar mot duplikate svarrader, uavhengig av applikasjonslogikk.
-- Ett forsøk skal ha nøyaktig én rad per spørsmål.
--
-- BAKGRUNN:
-- To ulike feil har historisk skapt duplikater:
--   1. Hele svarsettet satt inn på nytt (submit-ruten kjørte gjennom flere
--      ganger for samme forsøk). Kun observert på Fredagsquiz 19.06.2026;
--      opphørte etter 0d59e03 (20. juni 2026).
--   2. Ett enkelt spørsmål dobbeltregistrert på klienten før den synkrone
--      answeredRef-guarden i 2f697d9 (19. juli 2026). Siste tilfelle 17. juli.
-- I tillegg er selve race-hullet i submit-ruten tettet: UPDATE-en sjekker nå at
-- den faktisk traff en rad før attempt_answers-INSERT kjører.
--
-- Denne migrasjonen gjør det umulig for en fjerde, ukjent vei inn å skape
-- duplikater — databasen avviser dem uansett hvilken kode som skriver.
--
-- ⚠️ KAN IKKE KJØRES ENNÅ (status 25. juli 2026)
-- Tabellen inneholder allerede duplikater, så CREATE UNIQUE INDEX ville feilet
-- med 23505. Målt mot prod samme dag:
--     102 nøkler med mer enn én rad
--     387 overskytende rader
--     15 berørte forsøk
-- Av de 15 har 9 helt IDENTISKE duplikater (trygt å beholde en vilkårlig rad),
-- mens 6 har ULIKE rader — forskjellig svar og/eller tid på samme spørsmål,
-- altså to reelle svarregistreringer. Hvilken av dem som skal gjelde er et
-- produktspørsmål (påvirker correct_answers og dermed plassering og
-- sesongpoeng), ikke et teknisk. Derfor rydder denne migrasjonen bevisst
-- INGEN data automatisk — i motsetning til 20260620000000, som slettet
-- duplikate attempts-rader fordi de var verdiløse tomme rader.
--
-- Kjør scripts/check-unique-constraint-blockers.mjs (read-only) for et ferskt
-- tall før du forsøker.
--
-- FREMGANGSMÅTE:
--   1. Bestem hvordan de 6 uenige duplikatene skal ryddes
--   2. Rydd dem (eget skript, med før/etter-verifisering av plasseringer —
--      se scripts/verify-timeout-backfill.mjs for mønsteret)
--   3. Kjør denne migrasjonen
--
-- Idempotent, og trygg å kjøre: steg 1 stopper med en tydelig feilmelding
-- hvis det fortsatt finnes duplikater, i stedet for å feile halvveis.
-- ============================================================

-- Steg 1 — forhåndssjekk. Stopper med en lesbar melding hvis tabellen
-- fortsatt inneholder duplikater, slik at feilen ikke blir en rå 23505.
DO $$
DECLARE
  dupe_keys   bigint;
  excess_rows bigint;
BEGIN
  SELECT count(*), coalesce(sum(n - 1), 0)
    INTO dupe_keys, excess_rows
  FROM (
    SELECT count(*) AS n
    FROM public.attempt_answers
    GROUP BY attempt_id, question_id
    HAVING count(*) > 1
  ) d;

  IF dupe_keys > 0 THEN
    RAISE EXCEPTION
      'Kan ikke opprette UNIQUE-indeksen: % nokler har duplikater (% overskytende rader). Rydd dem forst — se scripts/check-unique-constraint-blockers.mjs.',
      dupe_keys, excess_rows;
  END IF;
END $$;

-- Steg 2 — unik indeks. Én rad per (forsøk, spørsmål).
CREATE UNIQUE INDEX IF NOT EXISTS attempt_answers_attempt_question_unique
  ON public.attempt_answers (attempt_id, question_id);
