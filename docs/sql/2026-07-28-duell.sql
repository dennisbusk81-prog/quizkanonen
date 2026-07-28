-- ============================================================================
-- H2H Duell — manuell SQL, 28. juli 2026
--
-- KJØRES AV DENNIS i Supabase SQL Editor. Ikke en migrasjon som kjøres av kode.
--
-- Koden som pushes samtidig fungerer HELT UTEN denne filen:
--   * Dødlåsfiksen (FUNN 2.2) er ren tidslogikk i lib/duel-expiry.
--   * Historikkfiksen (FUNN 4.3) leser kun eksisterende kolonner.
-- Delene under er opprydning og strukturell sikring, ikke forutsetninger.
--
-- Kjør DEL 1 nå. DEL 2 bør vente — se advarselen der.
-- ============================================================================


-- ── DEL 1: tillat status 'expired' ──────────────────────────────────────────
-- Trengs av /api/cron/expire-duels (FUNN 2.1), som markerer ubesvarte
-- utfordringer eldre enn 14 dager. Uten dette feiler jobben synlig med en
-- constraint-feil; appen ellers er upåvirket.
--
-- Steg 1 — se hva som finnes i dag:
SELECT conname, pg_get_constraintdef(oid) AS definisjon
FROM   pg_constraint
WHERE  conrelid = 'public.rivalries'::regclass
AND    contype  = 'c';

-- Steg 2 — kjør denne. Den er idempotent og trygg å kjøre flere ganger.
-- Finnes ingen CHECK-constraint på status, opprettes den med alle fem verdiene.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM   pg_constraint
  WHERE  conrelid = 'public.rivalries'::regclass
  AND    contype = 'c'
  AND    pg_get_constraintdef(oid) ILIKE '%status%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.rivalries DROP CONSTRAINT %I', cname);
  END IF;

  ALTER TABLE public.rivalries
    ADD CONSTRAINT rivalries_status_check
    CHECK (status IN ('pending', 'active', 'declined', 'cancelled', 'expired'));
END $$;

-- Steg 3 — kontroll: skal vise den nye definisjonen med 'expired' i.
SELECT conname, pg_get_constraintdef(oid)
FROM   pg_constraint
WHERE  conrelid = 'public.rivalries'::regclass AND contype = 'c';


-- ============================================================================
-- ── DEL 2: unique-indeks mot samtidige dueller (FUNN 5.4) ───────────────────
--
--  ⚠️  IKKE KJØR DENNE ENNÅ. Les hele avsnittet først.
--
-- Formålet er å gjøre duplikater strukturelt umulige, i stedet for å stole på
-- best-effort-resjekken i app/api/rivalries/route.ts — samme tankegang som
-- UNIQUE(attempt_id, question_id) og UNIQUE(quiz_id, order_index).
--
-- AVHENGIGHET SOM MÅ VÆRE PÅ PLASS FØRST:
-- Indeksen kjenner ikke 14-dagersregelen — den ser bare status. Så lenge det
-- finnes gamle 'pending'-rader som koden regner som utløpte, vil databasen
-- likevel telle dem som levende og avvise en ny, legitim duell. Det ville
-- gjeninnføre nøyaktig dødlåsen fra FUNN 2.2, denne gangen på DB-nivå der
-- koden ikke kan komme seg unna.
--
-- Rekkefølge:
--   1. Kjør DEL 1.
--   2. Sett opp /api/cron/expire-duels og la den kjøre minst ett døgn.
--   3. Kontroller med spørringen under at ingen utløpte 'pending' står igjen.
--   4. Først da: kjør indeksen.
--
-- Kontrollspørring — skal returnere 0 rader før du går videre:
SELECT id, challenger_id, rival_id, created_at, now() - created_at AS alder
FROM   public.rivalries
WHERE  status = 'pending'
AND    created_at < now() - interval '14 days';

-- Selve indeksen. Normalisert par (LEAST/GREATEST) slik at A→B og B→A regnes
-- som samme par. Partiell: gjelder kun levende dueller, så avsluttede,
-- avslåtte og utløpte kan ligge så mange det være vil.
--
-- CREATE UNIQUE INDEX CONCURRENTLY rivalries_one_open_per_pair
--   ON public.rivalries (
--     LEAST(challenger_id, rival_id),
--     GREATEST(challenger_id, rival_id)
--   )
--   WHERE status IN ('pending', 'active');

-- MERK om rekkevidde: denne indeksen hindrer to samtidige dueller mellom SAMME
-- to personer — altså akkurat racet fra FUNN 5.4. Den håndhever IKKE den
-- bredere regelen «én duell per person totalt», som koden også har. Å uttrykke
-- den i databasen krever to separate partielle indekser (én på challenger_id,
-- én på rival_id), og de ville fortsatt ikke fange at A er utfordrer i én duell
-- og utfordret i en annen. Full håndhevelse krever en trigger. Anbefalingen er
-- å ta pair-indeksen nå og la resten ligge i koden — den bredere regelen er en
-- produktregel som godt kan endres, mens duplikat-paret er en ren datafeil.
-- ============================================================================
