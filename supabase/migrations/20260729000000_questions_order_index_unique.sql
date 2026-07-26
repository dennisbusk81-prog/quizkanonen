-- ============================================================
-- questions — UNIQUE (quiz_id, order_index)
--
-- FORMÅL:
-- Siste forsvar mot duplikat/udefinert spørsmålsrekkefølge, uavhengig av
-- applikasjonslogikk. Hver quiz skal ha nøyaktig ett spørsmål per posisjon.
--
-- BAKGRUNN OG ROTÅRSAK (funnet 25. juli 2026):
-- app/api/admin/classics/copy/route.ts beregnet order_index med et
-- ikke-atomisk lese-så-skriv-mønster: `SELECT COUNT(*) ...` etterfulgt av
-- `INSERT ... order_index = count + 1`. De tre admin-sidene som kaller denne
-- ruten (app/admin/classics/page.tsx, app/admin/quizzes/new/page.tsx,
-- app/admin/sporsmal/page.tsx) hadde "laster"-tilstand scopet PER SPØRSMÅL,
-- ikke globalt — et raskt klikk på to-tre ulike klassiske spørsmål sendte
-- derfor flere samtidige POST-kall. Leste to kall samme telling FØR noen av
-- innsettingene hadde committet, beregnet begge samme order_index.
--
-- Bekreftet forekommet tre ganger:
--   - Fredagsquiz 03.07.2026 (order_index=9 duplisert) — allerede rettet av
--     en tidligere økt, se scripts/inspect-order-index-9.mjs.
--   - Fredagsquiz 26.06.2026 (order_index=2 duplisert, ingen har 1) — rettet
--     25. juli 2026 (scripts/fix-order-index-anomalies.mjs).
--   - Fredagsquiz 07.08.2026 (order_index 14/15 hver duplisert 3 ganger,
--     ikke spilt ennå) — rettet samtidig.
--
-- Selve rotårsaken er nå rettet i to lag:
--   1. Klient: alle tre admin-sidene har fått en synkron sperre (useRef,
--      samme mønster som answeredRef i app/quiz/[id]/page.tsx) som hindrer
--      et nytt legg-til-kall mens ett allerede er underveis mot samme quiz.
--   2. Server: classics/copy/route.ts reforsøker ÉN gang med en fersk telling
--      hvis innsettingen feiler på denne constraint-en (23505) — dekker
--      tilfeller sperren i punkt 1 ikke fanger (to ulike faner/enheter).
--
-- Denne migrasjonen er tredje og siste lag: gjør det umulig for en fjerde,
-- ukjent vei inn å skape et nytt duplikat — databasen avviser det uansett
-- hvilken kode som skriver.
--
-- ⚠️ FORUTSETNING: begge de kjente anomaliene (26.06 og 07.08) må være rettet
-- FØR denne kjøres. Kjør et read-only anomali-søk over alle quizer først
-- (se scripts/fix-order-index-anomalies.mjs sin isolasjonssjekk, eller
-- gjenta søket manuelt) for et ferskt tall.
--
-- Idempotent, og trygg å kjøre: steg 1 stopper med en tydelig feilmelding
-- hvis det fortsatt finnes duplikater, i stedet for å feile halvveis.
-- ============================================================

-- Steg 1 — forhåndssjekk. Stopper med en lesbar melding hvis noen quiz
-- fortsatt har duplikat order_index, slik at feilen ikke blir en rå 23505.
DO $$
DECLARE
  dupe_keys   bigint;
  excess_rows bigint;
BEGIN
  SELECT count(*), coalesce(sum(n - 1), 0)
    INTO dupe_keys, excess_rows
  FROM (
    SELECT count(*) AS n
    FROM public.questions
    GROUP BY quiz_id, order_index
    HAVING count(*) > 1
  ) d;

  IF dupe_keys > 0 THEN
    RAISE EXCEPTION
      'Kan ikke opprette UNIQUE-indeksen: % nokler har duplikat order_index (% overskytende rader). Rett dem forst — se scripts/fix-order-index-anomalies.mjs.',
      dupe_keys, excess_rows;
  END IF;
END $$;

-- Steg 2 — unik indeks. Ett spørsmål per (quiz, posisjon).
CREATE UNIQUE INDEX IF NOT EXISTS questions_quiz_order_index_unique
  ON public.questions (quiz_id, order_index);
