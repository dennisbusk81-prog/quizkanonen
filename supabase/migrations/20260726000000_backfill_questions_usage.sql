-- ============================================================
-- Engangs-backfill: usage_count/last_used_at/created_at for spørsmål
-- opprettet FØR spørsmålsbank-migrasjonen (20260725000000_questions_usage_tracking.sql).
-- Kjøres manuelt én gang i Supabase SQL Editor — ikke en del av den
-- automatiske migrasjonskjeden.
--
-- Bug: 20260725000000 satte usage_count=0/last_used_at=NULL på alle 184
-- eksisterende spørsmål (kun DEFAULT, ingen backfill), så de vises som
-- "Brukt 0 ganger"/"Aldri brukt" i /admin/sporsmal selv om kortet tydelig
-- viser hvilken quiz de kommer fra.
--
-- Betingelse: kun rader med usage_count=0 røres. Spørsmål lagt til via
-- "Legg til i quiz"-modalen (POST /api/admin/classics/copy) eller vanlig
-- lagring i editoren (POST .../questions) ETTER 20260725000000 har allerede
-- fått usage_count=1 fra applikasjonskoden — de har usage_count>=1 og
-- matcher derfor aldri denne WHERE-klausulen. Trygt og idempotent uansett
-- når den kjøres.
--
-- Verdi for last_used_at/created_at: quizzes.created_at (tidspunktet quizen
-- — og dermed spørsmålsraden — ble opprettet i admin), IKKE opens_at/closes_at
-- (spilleperiode, ikke forfatter-tidspunkt). Dette speiler forward-logikken
-- i koden: usage_count/last_used_at telles ved INSERT av spørsmålsraden
-- (når den legges inn i en quiz), ikke ved faktisk spilling av quizen.
--
-- questions.created_at settes til samme verdi her fordi ALTER TABLE i
-- 20260725000000 ga ALLE eksisterende rader created_at=NOW() (migrasjons-
-- kjøretidspunktet, ikke spørsmålets reelle alder) — det gjør "Sorter etter
-- nyeste" i /admin/sporsmal meningsløst for disse radene før denne rettes.
--
-- Bekreftet mot prod 26. juli 2026: 0 spørsmål har quiz_id som peker på en
-- slettet/manglende quiz (INNER JOIN-semantikken pga. FROM+WHERE under
-- dekker uansett "faktisk koblet til en quiz" automatisk, selv om det
-- skulle endre seg).

UPDATE public.questions q
SET
  usage_count  = 1,
  last_used_at = qz.created_at,
  created_at   = qz.created_at
FROM public.quizzes qz
WHERE q.quiz_id = qz.id
  AND q.usage_count = 0;
