-- ============================================================
-- delete_question_and_renumber — sletter ett spørsmål og renummererer
-- resten til 1..N, ATOMISK, i én transaksjon.
--
-- Kjør i Supabase SQL Editor. Idempotent (CREATE OR REPLACE), ikke
-- destruktiv, rører ingen data ved oppretting.
-- MÅ kjøres i prod FØR koden som kaller den deployes — den gamle
-- DELETE-koden fungerer uendret så lenge bare migrasjonen er kjørt.
--
-- BAKGRUNN (A16-oppfølging, 24. august 2026):
-- Sletting skjedde i to lag som begge var gale hver for seg:
--   1. API-ruten telte spørsmål og slettet i TO kall — to samtidige
--      slettinger på en quiz med to spørsmål kunne begge se count=2 og
--      tømme quizen (hullet var dokumentert som ÆRLIG HULL i ruten).
--   2. Klienten renummererte etterpå med N kall. De var parallelle fram
--      til 24. august (kolliderte innbyrdes under UNIQUE-indeksen),
--      deretter sekvensielle (korrekt, men N rundturer og uten
--      transaksjon med slettingen). Spørsmålsoversikten renummererte
--      ALDRI — hull som [1..14,16] på Fredagsquiz 07.08.2026 er sporet
--      hit, og dens «legg til med order_index = antall + 1» kolliderte
--      da med raden på N+1.
-- Denne funksjonen gjør telling, sletting og renummerering i SAMME
-- transaksjon: enten skjer alt, eller ingenting.
--
-- HVORFOR TO-FASE OG IKKE ÉN UPDATE RETT TIL 1..N:
-- questions_quiz_order_index_unique er en vanlig UNIQUE INDEX, ikke
-- DEFERRABLE — Postgres sjekker den PER RAD mens UPDATE-en kjører, og
-- radrekkefølgen i én UPDATE er uspesifisert. En direkte tildeling av
-- 1..N kan derfor treffe en gammel verdi som ennå ikke er flyttet.
-- Fase 1 parkerer ALLE gjenværende rader på order_index + MAX(order_index)
-- (garantert ledig sone: alle uflyttede verdier er ≤ MAX, alle flyttede er
-- parvis ulike, og alt er positivt — overlever en eventuell
-- CHECK (order_index > 0)). Fase 2 tildeler 1..N — hver ny verdi er ≤ N
-- ≤ MAX og kan aldri kollidere med en parkert verdi (> MAX) eller en
-- annen nytildelt (parvis ulike). Samme teknikk som sentinelen i
-- public.swap_question_order (20260731000000), utvidet fra én rad til alle.
--
-- REKKEFØLGEN BEVARES: fase 2 sorterer på (order_index, id) — samme
-- tiebreaker som GET-ruten — så renummereringen er en ren kompaktering.
-- Relativ rekkefølge er urørt, og den heler også historiske hull.
--
-- VAKT: question_played — REGEL fra Dennis 24. august 2026:
-- «Å endre rekkefølgen på spørsmålene i en quiz skal ALDRI endre
-- resultatet av den quizen.» Et spørsmål med attempt_answers-rader er en
-- del av et fastlåst resultat: sletting ville endret hva lagrede
-- correct_answers BETYR, og en senere fasitretting (som rekalkulerer
-- totaler fra gjenværende svarrader) ville endret poeng og plasseringer.
-- Vakten bor hos SKRIVEREN — samme prinsipp som 409 answer_key_locked i
-- PATCH-ruten. Feil spørsmål på en spilt quiz rettes med
-- /api/admin/correct-answer, aldri med sletting.
--
-- Radlåsing: ALLE quizens rader låses FØR lesing, sortert på id — samme
-- deterministiske rekkefølge som swap_question_order, så de to
-- funksjonene kan aldri deadlocke mot hverandre på samme quiz.
--
-- search_path = '' settes INLINE her (CREATE OR REPLACE nullstiller
-- attributter — et frittstående ALTER hadde forsvunnet ved neste
-- replace). Kroppen er fullkvalifisert (public.*).
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_question_and_renumber(
  p_quiz_id     uuid,
  p_question_id uuid
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
  v_total integer;
  v_max   integer;
BEGIN
  -- Lås alle radene i quizen i deterministisk rekkefølge. Tellingen under
  -- kan da ikke endres av en samtidig sletting/innsetting/bytte før vi er
  -- ferdige — det var nettopp telle/slette-racet i den gamle ruten.
  PERFORM 1
  FROM   public.questions
  WHERE  quiz_id = p_quiz_id
  ORDER  BY id
  FOR    UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.questions
    WHERE id = p_question_id AND quiz_id = p_quiz_id
  ) THEN
    -- Fanger både «finnes ikke» og «hører til en annen quiz» — uten denne
    -- ville en feil id gitt en stille no-op-renummerering.
    RAISE EXCEPTION 'question_not_found: spørsmål % finnes ikke i quiz %',
      p_question_id, p_quiz_id;
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM   public.questions
  WHERE  quiz_id = p_quiz_id;

  IF v_total <= 1 THEN
    RAISE EXCEPTION 'last_question: en quiz må beholde minst ett spørsmål (quiz=%)',
      p_quiz_id;
  END IF;

  -- Aliaset er PÅKREVD: uten det er «question_id» tvetydig mellom kolonnen
  -- og funksjonens egen OUT-parameter med samme navn — plpgsql feiler da i
  -- kjøretid, ikke ved oppretting.
  IF EXISTS (
    SELECT 1 FROM public.attempt_answers aa WHERE aa.question_id = p_question_id
  ) THEN
    RAISE EXCEPTION 'question_played: spørsmål % har registrerte besvarelser — '
      'resultater er urørlige. Bruk «Rett svar» for feil fasit; sletting er sperret.',
      p_question_id;
  END IF;

  DELETE FROM public.questions
  WHERE  id = p_question_id AND quiz_id = p_quiz_id;

  -- Fase 1: parker alle gjenværende rader i en garantert ledig sone.
  SELECT COALESCE(MAX(q.order_index), 0) INTO v_max
  FROM   public.questions q
  WHERE  q.quiz_id = p_quiz_id;

  UPDATE public.questions
  SET    order_index = order_index + v_max
  WHERE  quiz_id = p_quiz_id;

  -- Fase 2: tildel 1..N i bevart relativ rekkefølge (order_index, id —
  -- samme tiebreaker som GET-ruten bruker ved lesing).
  UPDATE public.questions q
  SET    order_index = r.rn
  FROM (
    SELECT id, (ROW_NUMBER() OVER (ORDER BY order_index, id))::integer AS rn
    FROM   public.questions
    WHERE  quiz_id = p_quiz_id
  ) r
  WHERE  q.id = r.id;

  RETURN QUERY
  SELECT q.id, q.order_index
  FROM   public.questions q
  WHERE  q.quiz_id = p_quiz_id
  ORDER  BY q.order_index;
END;
$$;

-- Eksekverings-rettigheter. Kun service_role (API-ruten via supabaseAdmin)
-- skal kunne slette og renummerere — aldri anon eller en innlogget spiller.
-- REVOKE må navngi authenticated eksplisitt: Postgres gir authenticated en
-- egen EXECUTE-grant som IKKE fjernes av en revoke fra PUBLIC alene
-- (regelen fra RPC-gjennomgangen 30. juli 2026).
REVOKE EXECUTE ON FUNCTION public.delete_question_and_renumber(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_question_and_renumber(uuid, uuid) TO service_role;
