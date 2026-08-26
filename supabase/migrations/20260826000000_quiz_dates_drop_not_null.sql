-- ============================================================
-- quizzes — DROP NOT NULL på opens_at og closes_at
--
-- ✅ STATUS: KJØRT I PROD AV DENNIS 26. august 2026, og verifisert etterpå:
--    information_schema viser is_nullable = YES for begge kolonnene, og
--    count ga 13 quizer totalt / 13 med opens_at / 13 med closes_at —
--    ingen eksisterende rad mistet datoen sin.
--
--    Denne fila er skrevet ETTER kjøringen for at migrasjonssporet skal
--    matche prod (samme lærdom som RPC-revokes-saken, der fikser som kun
--    levde i prod ville blitt reintrodusert som hull av et miljø
--    gjenoppbygget fra supabase/migrations/ — samme drift, motsatt vei,
--    skal ikke oppstå her). Fila kjøres ikke av noe; den dokumenterer.
--
-- FORMÅL:
-- Arkivquizer (quiz_type='archive') har ingen tidsgrense. NULL betyr
-- «stenger aldri», ikke «stengt siden 1970». Alle tidsfiltrerte lesere
-- ekskluderer NULL-rader av ren SQL-semantikk; de seks stedene som tolket
-- NULL som epoch ble rettet i ed74dce, og Quiz-typen ble gjort nullable i
-- samme commit slik at kompilatoren feller framtidige uguardede lesere.
--
-- ⚠️ IKKE REVERSIBEL MED NULL-RADER I TABELLEN:
-- Denne migrasjonen kan ikke reverseres så lenge det finnes rader med NULL
-- i kolonnene. Skal NOT NULL settes tilbake, må arkivquizene slettes først.
-- ============================================================

ALTER TABLE quizzes
  ALTER COLUMN opens_at DROP NOT NULL,
  ALTER COLUMN closes_at DROP NOT NULL;
