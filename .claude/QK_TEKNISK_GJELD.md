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

- **~~UPDATE/DELETE-policy på attempts tillater klient-side score-manipulasjon~~ — LØST 14. juni 2026.**
  Scoreberegning er flyttet fra klienten til service-role-ruten
  [POST /api/quiz/[id]/submit](../app/api/quiz/%5Bid%5D/submit/route.ts).
  Klienten sender kun rå svar (`selectedAnswer` + `timeMs`); serveren beregner
  `correct_answers`/`correct_streak`/`total_time_ms` mot fasit med tid-clamping.
  Dobbel-scoring hindres via `attempts.submitted_at` (migrasjon 20260614000017).
  RLS-policyene "Alle kan oppdatere attempts" og "Alle kan slette attempts" er
  fjernet — anon/public kan ikke lenger UPDATE-e eller DELETE-e attempts.
  Verifisert: anon UPDATE/DELETE påvirker ingen rader; INSERT (startQuiz) og
  submit-ruten fungerer normalt.

- **Terminologi-forvirring: "Toppliste" brukes om to forskjellige ting — LAV prioritet, UX.**
  [/leaderboard/[id]](../app/leaderboard/%5Bid%5D/page.tsx) og quiz-resultatskjermen
  viser kun denne ukens quiz-rangering. [/toppliste](../app/toppliste/page.tsx) viser
  sesong-rangering over tid (Siste quiz / Måned / Kvartal / År / All-time). Begge
  presenteres som "toppliste" uten tydelig distinksjon — en ny bruker forstår ikke
  nødvendigvis forskjellen. Vurder tydeligere titler eller forklaringstekst som
  skiller "Ukens resultater" fra "Sesong-toppliste".

- **"Blant venner"-fanen kan vise brukeren alene — LAV prioritet, UX.**
  Hvis en bruker er eneste aktive deltaker i sin liga denne uken, viser
  "Blant venner"-fanen i [/leaderboard/[id]](../app/leaderboard/%5Bid%5D/page.tsx)
  kun brukeren selv. Funksjonelt korrekt, men kan oppleves forvirrende — "blant
  venner" som ikke inneholder noen venner. Vurder å skjule fanen når den kun ville
  vise brukeren selv, eller justere teksten (f.eks. "Ingen venner har spilt denne
  quizen ennå").

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
