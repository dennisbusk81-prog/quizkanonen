-- Kildekobling for arkivkopier: quizzes.source_quiz_id (27. august 2026)
--
-- ── HVORFOR KOLONNEN MÅ FINNES ─────────────────────────────────────────────
-- Arkivet skal vise «slik ville du havnet den uken»: spillerens arkivscore
-- målt mot det ORIGINALE feltet fra den fredagen. Feltet hentes fra `attempts`
-- på ORIGINALQUIZEN — og fram til nå fantes det ingen vei fra en arkivkopi
-- tilbake dit. `questions.quiz_id` er én enkelt FK uten koblingstabell, så
-- kopieringsruten MÅ kopiere spørsmålsradene (kartlagt 26. august, 731b383);
-- kopien bærer derfor ingen spor av hvor den kom fra.
--
-- Alternativene som ble forkastet 27. august (Dennis' valg): å legge
-- koblingen i `admin_actions.details` (revisjonstabell som funksjonell
-- lagring, og kvote-bokføringen er best-effort — feiler den, mister quizen
-- koblingen permanent), og å la KLIENTEN sende original-id-en (en påstand,
-- ikke et faktum, og klienten måtte båret paret gjennom hele flyten).
--
-- ── SEMANTIKKEN ER SMALERE ENN «hvor kom spørsmålene fra» ──────────────────
-- Kolonnen settes KUN når arkivquizen er en FULL REPRISE av nøyaktig én ekte
-- quiz: alle spørsmålene har samme forelder, forelderen er en ekte quiz
-- (lib/real-quiz-population.ts sin hviteliste), og kopien dekker HELE den
-- quizen. En delvis kopi (5 av 15 spørsmål) får NULL med vilje: feltets
-- `correct_answers` gjelder 15 spørsmål, spillerens 5, og en rangering på
-- tvers av de to er tull. En generert quiz (spørsmål fra flere quizer) får
-- NULL av samme grunn.
--
-- NULL er altså en FØRSTEKLASSES TILSTAND, ikke en mangel: den betyr «denne
-- arkivquizen har aldri hatt et felt», og er normalen for genererte quizer.
-- Beslutningen bor i lib/archive-source-quiz.ts (ren, testdekket).
--
-- ── ON DELETE SET NULL, IKKE CASCADE ───────────────────────────────────────
-- Arkivkopien er et selvstendig, komplett radsett (egne spørsmålsrader, egne
-- attempts). Slettes originalquizen, skal kopien overleve — den mister bare
-- spøkelsesplasseringen sin og faller til «ingen plassering finnes», som er
-- en tilstand flaten allerede håndterer. CASCADE ville slettet spillernes
-- arkivforsøk som bieffekt av en admin-opprydding i gamle quizer.
--
-- Ingen indeks: oppslaget går ALLTID på arkivquizens egen primærnøkkel
-- (`select source_quiz_id where id = <arkiv-id>`), aldri motsatt vei.

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS source_quiz_id uuid
    REFERENCES public.quizzes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.quizzes.source_quiz_id IS
  'Kun for quiz_type=''archive'': originalquizen kopien er en FULL reprise av. '
  'NULL betyr «ingen frosset felt finnes» — generert quiz, delvis kopi, eller '
  'kilde som ikke er en ekte quiz. Settes av POST /api/arkiv via '
  'lib/archive-source-quiz.ts; leses av GET /api/arkiv/[id]/plassering.';
