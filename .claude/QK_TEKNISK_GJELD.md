# QK — Teknisk gjeld (backlog)

Levende oversikt over teknisk gjeld. Speiles inn i det eksterne
QK_4-lanseringsdokumentet ved behov.

---

## LØST

- **~~Next.js rute-konflikt: `app/api/org/[id]/` vs `app/api/org/[slug]/`~~ — LØST 14. juni 2026.**
  `next dev` / `next start` krasjet med "You cannot use different slug names for the same dynamic path".
  De fem `[id]`-rutene (`reset-season`, `members-activity`, `send-invite`, `send-reminder`, `quiz-insights`)
  tok org-UUID som URL-segment, mens `[slug]`-rutene tok org-slug. Løst ved å flytte alle fem inn i
  `app/api/org/[slug]/` og endre destrukturering fra `{ id }` til `{ slug }` (med kommentar om at
  verdien fortsatt er UUID). Ingen frontend-endringer nødvendig. Verifisert: `next start` starter
  uten feil, UUID-rutene svarer 401 uten token.

- **~~/leaderboard/[id] lastet opptil 2000 attempts-rader klient-side~~ — LØST 14. juni 2026 (Fase 2).**
  Rangering + paginering + søk flyttet til Postgres window-funksjoner (ROW_NUMBER)
  via RPC `quiz_leaderboard_ranked`/`_user_stats`/`_better_count` (migrasjon
  20260614000015) bak ny rute `app/api/leaderboard/[id]`. "Alle"- og "Lag"-fanene
  henter nå topp 50 server-side; Premium får paginering (20/side), navnesøk (ILIKE
  m/ global rang) og "gå til min plassering". Automatisk JS-fallback hvis RPC ikke
  er deployet. Gratis-visning (topp-10 + estimert spenn) uendret — estimatet
  beregnes nå fra server-rang.
  **NB:** "Blant venner"-fanen er bevisst fortsatt klient-side (filtrerer mot de
  lastede topp-50 radene). Lavt radantall (≤6 ligavenner), så ikke prioritert å
  flytte server-side. Ligavenner rangert utenfor topp 50 vises ikke i den fanen.

- **~~season_scores-query i /api/toppliste mangler .limit()~~ — LØST 14. juni 2026.**
  Aggregering + rangering flyttet til Postgres window-funksjoner (ROW_NUMBER)
  via RPC `season_leaderboard_ranked` (migrasjon 20260614000014). Ruten henter
  nå kun den forespurte siden (LIMIT/OFFSET) i stedet for alle rader. Har
  automatisk JS-fallback hvis RPC ikke er deployet. Premium får paginering
  (20/side), navnesøk (ILIKE m/ rang) og "gå til min plassering" i
  `SeasonLeaderboard.tsx`. Gratis-visning (topp-10) uendret.

---

## MEDIUM

- **/toppliste er full klient-side rendering med session-check-waterfall
  før API-kall. Strukturell RSC-migrasjon vurdert, men utsatt pga
  auth/hydration-risiko rett før lansering.**

- **UPDATE-policy på attempts tillater klient-side score-manipulasjon
  — NY RUTE BYGGET 14. juni 2026, RLS-FIKS VENTER PÅ MANUELL KJØRING.**
  Scoreberegning er flyttet fra klienten til service-role-ruten
  [POST /api/quiz/[id]/submit](../app/api/quiz/%5Bid%5D/submit/route.ts):
  klienten sender nå kun rå svar (`selectedAnswer` + `timeMs` per spørsmål),
  serveren slår opp fasiten og beregner `correct_answers`/`correct_streak`/
  `total_time_ms` selv (med tid-clamping mot `time_limit_seconds`). Dobbel-
  scoring hindres via ny kolonne `attempts.submitted_at` (migrasjon
  20260614000017). finishQuiz ([app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx))
  kaller ruten og viser server-beregnet score.
  **GJENSTÅR:** kjør migrasjon `20260614000017_attempts_submitted_at.sql`
  (legger til kolonnen — MÅ kjøres FØR/samtidig som deploy, ellers feiler
  submit i prod), og deretter RLS-innstrammingen som fjerner den permissive
  UPDATE-policyen "Alle kan oppdatere attempts" for `public` (kun
  `service_role` skal kunne UPDATE-e). Begge SQL-blokker er vist for manuell
  kjøring i Supabase SQL Editor.

- **Fasit eksponeres til klienten under quiz (`select('*')` på questions
  inkluderer `correct_answer`/`correct_answers`) — HØY prioritet.**
  Spørsmålshentingen i [app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx)
  (`questions.select('*')`) laster ned riktige svar til nettleseren. Selv etter
  at scoringen er flyttet server-side (submit-ruten) kan en jukser lese fasiten
  i devtools mens quizen pågår, og dermed svare riktig — server-scoringen ser
  da et legitimt riktig svar. Krever egen arkitekturdiskusjon fordi fasiten
  i dag brukes klient-side av flere ting: QuizInterlude/mellomskjerm (viser
  riktig svar + forklaringstekst etter hvert spørsmål), live-plassering, og
  rival/percentil-snapshot. Mulige grep: utelat fasit fra question-SELECT og
  flytt riktig-svar-avsløring til en egen verifiserings-rute per svar. Ikke
  triviell — påvirker flere komponenter og UX.
