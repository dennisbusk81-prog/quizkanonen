-- ============================================================
-- swap_question_order — bytter order_index på to spørsmål ATOMISK.
--
-- Kjør i Supabase SQL Editor. Idempotent (CREATE OR REPLACE), ikke
-- destruktiv, rører ingen data ved oppretting.
--
-- BAKGRUNN OG ROTÅRSAK (funnet 26. juli 2026):
-- moveQuestion() i app/admin/quizzes/[id]/questions/page.tsx byttet
-- rekkefølge ved å sende TO separate PATCH-kall, der hver satte én rad til
-- den ANDRE radens nåværende verdi. Etter at
-- 20260729000000_questions_order_index_unique.sql la på
-- UNIQUE (quiz_id, order_index), kan det aldri lykkes: den første
-- skrivingen treffer alltid en verdi som fortsatt er opptatt av den andre
-- raden. Bekreftet 100 % reproduserbart i prod — også ved ETT rolig klikk,
-- ikke bare ved rask klikking. Feilen var dessuten usynlig for admin, siden
-- klienten aldri sjekket res.ok.
--
-- HVORFOR TRE STEG OG IKKE ÉN UPDATE MED CASE:
-- questions_quiz_order_index_unique er en vanlig UNIQUE INDEX, ikke en
-- DEFERRABLE constraint. Postgres sjekker den PER RAD mens UPDATE-en kjører,
-- ikke ved slutten av setningen — den andre radens gamle verdi er fortsatt
-- en levende (MVCC-synlig) indeksoppføring i samme transaksjon. Et direkte
-- bytte kolliderer derfor uansett hvordan det skrives, også som én setning
-- med CASE. Vi parkerer derfor A på en midlertidig verdi først.
--
-- Sentinelen er MAX(order_index) + 1 for DENNE quizen: garantert ledig, og
-- garantert POSITIV — så den overlever også en eventuell
-- CHECK (order_index > 0) som vi ikke har verifisert at ikke finnes.
--
-- Atomisiteten kommer av at hele funksjonskroppen kjører i én transaksjon:
-- enten commits alle tre stegene, eller ingen. Sentinelen kan derfor aldri
-- bli synlig for andre lesere eller bli stående igjen ved en feil.
--
-- search_path = '' : funksjonen er SECURITY DEFINER, så stien fastsettes her
-- og arves aldri fra kalleren (nøytraliserer search_path-injection). Tom, ikke
-- 'public', fordi kroppen er fullkvalifisert (public.questions). Samme
-- herding som public.is_league_member i
-- 20260723000000_fix_league_members_rls_recursion.sql.
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
  -- (sortert på id). To samtidige bytter som deler en rad kan da ikke låse
  -- hverandre i motsatt rekkefølge og gå i deadlock — og verdiene vi leser
  -- under kan ikke endres av en annen transaksjon før vi er ferdige.
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

-- Eksekverings-rettigheter. Kun service_role (API-ruten via supabaseAdmin)
-- skal kunne omrokere spørsmål — aldri anon eller en innlogget spiller.
-- REVOKE først: Postgres gir automatisk EXECUTE til PUBLIC ved oppretting.
REVOKE EXECUTE ON FUNCTION public.swap_question_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.swap_question_order(uuid, uuid, uuid) TO service_role;
