-- ============================================================
-- swap_question_order — NY VAKT: quiz_played. Bytte av rekkefølge er
-- sperret på enhver quiz som har registrerte besvarelser.
--
-- Kjør i Supabase SQL Editor. Idempotent (CREATE OR REPLACE + IF NOT
-- EXISTS), ikke destruktiv. Rekkefølgen mot deploy er MYK: kjøres
-- migrasjonen først, gir et bytte på en spilt quiz en rå 500 med
-- quiz_played i meldingen til koden som oversetter til 409 deployes;
-- deployes koden først, er bytte bare usperret som før. Ingen av delene
-- knekker noe — men kjør migrasjonen først, så vaktens vindu er lukket.
--
-- REGELEN (Dennis, 24. august 2026): «Å endre rekkefølgen på spørsmålene
-- i en quiz skal ALDRI endre resultatet av den quizen.» Sletting av
-- besvarte spørsmål ble sperret i 20260824000000 (question_played).
-- Bytte har en egen, mer indirekte vei til samme brudd:
--
--   correct_streak (tiebreaker nr. 3 i all rangering) REKONSTRUERES fra
--   order_index-rekkefølgen når en fasitretting kjøres
--   (/api/admin/correct-answer → planAttemptTotals i
--   lib/answer-key-correction.ts — attempts.question_order er NULL for
--   alle rader i prod, så order_index ER spillerens faktiske rekkefølge).
--   Byttes to spørsmål ETTER at noen har svart, regner en SENERE
--   fasitretting streak i en rekkefølge spillerne aldri så — poeng og
--   plasseringer kan da endres av noe som skulle vært en visningsdetalj.
--
-- VAKTEN ER QUIZ-NIVÅ, ikke per spørsmål som i delete-vakten, og det er
-- ikke et avvik men en presisjon: submit skriver en svarrad for HVERT
-- spørsmål i quizen (timeout = rad med selected_answer NULL), så i en
-- spilt quiz er hvert spørsmål spillerne så besvart — et «ubesvart»
-- spørsmål finnes der bare hvis det ble lagt til i etterkant, og selv da
-- flytter et bytte som involverer det de besvarte spørsmålenes posisjoner
-- i streak-gjennomgangen. Per-par-analyse kjøper ingenting; quiz-nivå er
-- den ærlige grensen. Delete-vakten er per spørsmål fordi kompaktering
-- bevarer relativ rekkefølge — der er det kun amputasjon av selve
-- svarradene som truer.
--
-- Grensen «har besvarelser» = attempt_answers finnes. Startede, ikke
-- innsendte forsøk har ingen svarrader (de skrives ved innsending), så
-- redigering FØR første innsending er fortsatt fri — det er innsendte
-- resultater regelen freder.
--
-- Resten av funksjonen er UENDRET fra 20260731000000 (tre-stegs bytte
-- med sentinel, deterministisk radlåsing sortert på id). Hele kroppen
-- restates fordi CREATE OR REPLACE nullstiller attributter — search_path
-- må settes INLINE her, ellers forsvinner herdingen stille.
-- ============================================================

CREATE OR REPLACE FUNCTION public.swap_question_order(
  p_quiz_id    uuid,
  p_question_a uuid,
  p_question_b uuid
)
RETURNS TABLE (
  question_id     uuid,
  new_order_index integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_a  integer;
  v_order_b  integer;
  v_sentinel integer;
BEGIN
  IF p_question_a = p_question_b THEN
    RAISE EXCEPTION 'Kan ikke bytte et spørsmål med seg selv (id=%)', p_question_a;
  END IF;

  -- Lås begge radene FØR vi leser verdiene, i deterministisk rekkefølge
  -- (sortert på id) — samme globale låserekkefølge som
  -- delete_question_and_renumber, så de to kan aldri deadlocke mot
  -- hverandre på samme quiz.
  PERFORM 1
  FROM   public.questions
  WHERE  quiz_id = p_quiz_id
    AND  id IN (p_question_a, p_question_b)
  ORDER  BY id
  FOR    UPDATE;

  SELECT q.order_index INTO v_order_a
  FROM   public.questions q
  WHERE  q.id = p_question_a AND q.quiz_id = p_quiz_id;

  SELECT q.order_index INTO v_order_b
  FROM   public.questions q
  WHERE  q.id = p_question_b AND q.quiz_id = p_quiz_id;

  -- Fanger både "finnes ikke" og "hører til en annen quiz". Uten denne ville
  -- en feil id gitt en stille no-op i stedet for en tydelig feil.
  IF v_order_a IS NULL OR v_order_b IS NULL THEN
    RAISE EXCEPTION
      'Fant ikke begge spørsmålene i quiz % (a=%, b=%)',
      p_quiz_id, p_question_a, p_question_b;
  END IF;

  -- NY VAKT: quiz-nivå. Aliasene er PÅKREVD — «question_id» er ellers
  -- tvetydig mellom kolonnen og funksjonens OUT-parameter med samme navn.
  IF EXISTS (
    SELECT 1
    FROM   public.attempt_answers aa
    JOIN   public.questions q ON q.id = aa.question_id
    WHERE  q.quiz_id = p_quiz_id
  ) THEN
    RAISE EXCEPTION 'quiz_played: quiz % har registrerte besvarelser — '
      'rekkefølgen er låst fordi den avgjør streak-rekalkulering ved fasitretting.',
      p_quiz_id;
  END IF;

  SELECT COALESCE(MAX(q.order_index), 0) + 1 INTO v_sentinel
  FROM   public.questions q
  WHERE  q.quiz_id = p_quiz_id;

  UPDATE public.questions SET order_index = v_sentinel WHERE id = p_question_a;
  UPDATE public.questions SET order_index = v_order_a  WHERE id = p_question_b;
  UPDATE public.questions SET order_index = v_order_b  WHERE id = p_question_a;

  RETURN QUERY
  SELECT q.id, q.order_index
  FROM   public.questions q
  WHERE  q.id IN (p_question_a, p_question_b)
  ORDER  BY q.order_index;
END;
$$;

-- Rettighetene restates for sikkerhets skyld (idempotent). REVOKE må navngi
-- authenticated eksplisitt — regelen fra RPC-gjennomgangen 30. juli 2026.
REVOKE EXECUTE ON FUNCTION public.swap_question_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.swap_question_order(uuid, uuid, uuid) TO service_role;

-- ── Indeks for spilt-vaktene ─────────────────────────────────────────────────
-- Både quiz_played (her) og question_played (delete_question_and_renumber)
-- prober attempt_answers på question_id. Eneste eksisterende indekser er
-- (attempt_id) og UNIQUE (attempt_id, question_id) — ingen av dem dekker et
-- question_id-oppslag, så vaktene ville lest hele tabellen (9 255 rader
-- 24. august 2026, vokser med ~1 500 per uke). Dekker også
-- attempt_answer-statistikkens gruppering på question_id.
CREATE INDEX IF NOT EXISTS idx_attempt_answers_question_id
  ON public.attempt_answers (question_id);
