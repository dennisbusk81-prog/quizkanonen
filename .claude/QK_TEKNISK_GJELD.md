# QK — Teknisk gjeld (backlog)

Levende oversikt over teknisk gjeld. Speiles inn i det eksterne
QK_4-lanseringsdokumentet ved behov.

---

## LØST

- **~~RPC-funksjoner kallbare direkte av `authenticated`, forbi API-rutenes
  Premium-gating~~ — LØST 30. juli 2026.**
  11 SECURITY DEFINER-funksjoner (`season_leaderboard_ranked/user_stats/
  period_quizzes`, `quiz_leaderboard_ranked/user_stats/better_count`,
  `attempt_answer_option_counts`, `attempt_answer_stats_by_attempts`,
  `weekly_active_players`, `count_active_players_since`,
  `count_active_leagues`) hadde kun `REVOKE EXECUTE FROM PUBLIC, anon` —
  ikke `authenticated`. Rotårsak: Postgres gir `authenticated` en egen,
  eksplisitt EXECUTE-grant som IKKE fjernes av en revoke fra PUBLIC alene.
  Empirisk bekreftet mot prod med en fixture-gratisbruker (eget JWT + anon-
  nøkkel, direkte mot `/rest/v1/rpc/`, utenom alle API-ruter): alle 11
  svarte 200 med reelle data, inkludert andre brukeres eksakte plassering
  og full svarfordeling. Rettet med eksplisitt
  `REVOKE ... FROM authenticated, anon, PUBLIC`, verifisert i
  `pg_proc.proacl`. `is_league_member` BEVISST IKKE revokert — kalles av
  RLS-policyen på `league_members`, evaluerer kun kallerens egen
  `auth.uid()`, lekker ingenting. `redeem_access_code` fikk samtidig
  `SET search_path=''` + fullt kvalifiserte `public.`-navn (manglet begge
  deler fra før), funksjonelt reverifisert mot ekte kodeinnløsning i prod.
  **Ny regel for framtidige service_role-only SECURITY DEFINER-funksjoner:
  REVOKE må navngi `authenticated` eksplisitt — `FROM PUBLIC, anon` er
  ikke nok.** Full detalj: `QK_OPPDATERING_RPC_SIKKERHET_30JULI.md`.

- **~~`access_codes`-tabellen offentlig lesbar uten innlogging~~ — LØST
  30. juli 2026.** Egen sårbarhetsklasse fra punktet over (åpen
  RLS-policy på en tabell, ikke manglende EXECUTE-revoke på en funksjon)
  — oppdaget ved samme gjennomgang, ikke del av selve RPC-bestillingen.
  En helt åpen SELECT-policy ga ren anon-nøkkel (ingen Authorization-
  header) lesetilgang til samtlige koder i klartekst: kodeord, `max_uses`,
  `used_count`, `is_active`, `valid_until`. Opphevet hele entropi-modellen
  fra 26. juli for `personal`-koder. Ingen skade i dag — kun 2 koder i
  prod, begge `shared`, én inaktiv og én oppbrukt 1/1 — men ville smelt
  den dagen en `personal`-premiekode opprettes. Policyen droppet, RLS
  slått på. Appens eneste tilgang er via `service_role`, upåvirket.

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

- **`/api/toppliste` `last_quiz`-modus mangler `is_test`-filter — skjermet av
  en KONVENSJON, ikke av en guard (notert 5. august 2026).**
  Quiz-oppslaget i `last_quiz`-grenen
  ([app/api/toppliste/route.ts](../app/api/toppliste/route.ts), ca. linje 216)
  filtrerer på `quiz_type = 'weekly'` og krever minst én attempt via
  `attempts!inner(id)`. Det holder testquizer unna **så lenge de opprettes
  etter oppskriften**, som setter `quiz_type='test'`. En testquiz som lages ad
  hoc med `quiz_type='weekly'` — og som noen faktisk spiller, slik at
  INNER JOIN-en er tilfredsstilt — vil vises som «siste quiz» på topplisten
  for alle.
  `is_test` er det autoritative feltet og bør stå i spørringen ved siden av
  `quiz_type`. Samme guard som `send-reminders`, `send-push` og (siden
  `7c81c0a`) `notify-subscribers` har.
  **Beslektet feilklasse:** `notify-subscribers` var «skjermet» på nøyaktig
  samme måte — av et tidsvindu i stedet for en guard — helt til en etterlatt
  testquiz åpnet 5. august og ble annonsert til påmeldingslisten. En guard som
  avhenger av at alle følger en oppskrift, er en konvensjon.
  Dokumentert også i `.claude/QK_TESTQUIZ_OPPSKRIFT.md`; står her fordi
  gjeldslisten er stedet man leter.

- **Analytics-sidens «Endre svar» kan ikke uttrykke multi-fasit — kollapser
  den ved skriving på uspilte quizer (notert 5. august 2026).**
  `saveCorrectAnswer()` i
  [app/admin/quizzes/[id]/analytics/page.tsx](../app/admin/quizzes/%5Bid%5D/analytics/page.tsx)
  (ca. linje 532) sender `PATCH { correct_answer: <én bokstav> }` til
  `questions/[qid]`. Panelet er enkeltvalg og har ingen måte å uttrykke flere
  riktige svar på.
  Ruten selv er korrekt: `decideAnswerKeyPatch` skriver alltid BEGGE
  fasitkolonnene sammen via `answerKeyColumns()`. Nettopp derfor kollapser en
  fasit med flere riktige svar til ett — `answerKeyColumns(['B'])` gir
  `correct_answers = NULL`. Feilen ligger i UI-et, ikke i skrivelogikken.
  To utfall, avhengig av om quizen er spilt:
  - **Spilt quiz** (har `attempt_answers`): ruten svarer `409
    answer_key_locked`, og fasiten er trygg. Men UI-et viser bare «Kunne ikke
    oppdatere riktig svar.» uten å si hvorfor, så admin står i en blindvei
    uten forklaring. Siden analytics per definisjon handler om spilte quizer,
    er dette normaltilfellet.
  - **Uspilt quiz**: skrives direkte, og en multi-fasit kollapser stille.

  Ingen regradering skjer i noen av tilfellene — den kodestien ligger kun i
  `/api/admin/correct-answer`, som tar et array (`newCorrectAnswers`) og er
  det panelet burde brukt. Se «Fasit-endring — ÉN kodesti» i CLAUDE.md.
  **Ikke akutt i dag:** prod har 0 av 199 spørsmål med flere riktige svar.
  Blir akutt første gang et multi-svar-spørsmål lages.

- **Supabase Realtime lastes ubrukt i klientbundelen — 52 KB, fjernbar via
  Turbopack-alias (notert 11. august 2026, bevisst utsatt).**
  Appen bruker ikke Realtime noe sted (verifisert med grep etter `.channel(`,
  `.subscribe(`, `postgres_changes` m.fl. — de eneste subscribe-treffene er
  Web Push), men supabase-js instansierer `RealtimeClient` ubetinget i
  konstruktøren, så koden ligger i den delte Supabase-chunken på hver side.
  Løsningen er bygget og verifisert (build + 1264 tester + nettleser):
  `turbopack.resolveAlias` i `next.config.ts` som peker
  `@supabase/realtime-js` til en lokal stubb der `channel()` kaster med
  vilje. Bevisst IKKE committet: 52 KB er marginal gevinst mot en varig
  vedlikeholdsforpliktelse — **aliaset må revurderes ved hver oppgradering
  av supabase-js** (stubben speiler kallene supabase-js selv gjør, og
  testene kjører mot ekte realtime-js under node, så en fremtidig
  stubb-mismatch fanges ikke av testsuiten). Tas i samme økt som den ekte
  ytelsesjobben etter 21. august (hero-tekst bak sekvensielle Supabase-kall
  er den faktiske LCP-flaskehalsen), slik at effekten kan måles samlet.
  **Tallkorreksjon til kartleggingen 7. august:** «~206 KB» var størrelsen
  på HELE den delte Supabase-chunken (auth/postgrest/storage/functions
  inkludert — alle i bruk), ikke Realtime alene. Realtimes reelle andel er
  52 KB minifisert (chunken målt 204 KB → 152 KB med stubben).

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

- **~~Terminologi-forvirring: "Toppliste" brukes om to forskjellige ting~~ — LØST 14. juni 2026.**
  Konsistent terminologi innført på tvers av NavAuth, forside, quiz-side og leaderboard-side:
  "Ukens resultater" = per-quiz-leaderboard (/leaderboard/[id]);
  "Sesongtoppliste" = sesong-rangering over tid (/toppliste).

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
  **Se egen seksjonen nedenfor: PROBLEM B — Fasit eksponert til klient under quiz.**

---

## PROBLEM B — Fasit eksponert til klient under quiz (akseptert risiko)

Dokumentert: 14. juni 2026. Status: IKKE LØST — bevisst nedprioritert.

### Beskrivelse

Initial SELECT på questions-tabellen ([app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx),
~linje 854-860) bruker `select('*')` og inkluderer `correct_answer`,
`correct_answers` og `explanation` for ALLE spørsmål i quizen, hentet i ett
kall ved quiz-start. Disse ligger i klientens React-state (`questions`) gjennom
hele quizøkten.

Verifisert: respons fra Supabase PostgREST viser `correct_answer` for spørsmål
som ikke er besvart ennå. Synlig i Network-fanen i devtools — ingen teknisk
kompetanse utover "åpne devtools" nødvendig.

### Hvorfor det ikke er løst nå

Vurdert løsning: per-spørsmål server-roundtrip (klient sender svar, server
returnerer fasit+forklaring for nettopp det spørsmålet — fasit for spørsmål N
sendes aldri til klient før klient har svart på N).

Kartlagt grundig (to runder, Opus). Konklusjon: teknisk gjennomførbar uten
merkbar UX-regresjon PÅ GOD LINJE (~120ms ekstra per svar, maskeres av en
lock-in-mikroanimasjon). MEN:

1. Krever omstrukturering av `handleAnswer` i
   [app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx) — kjernefilen i hele
   produktet. Korrekthets-spesifikk animasjon (konfetti/shake) må flyttes fra
   "ved klikk" til "ved server-svar".
2. Fjerner dagens offline-robusthet under spilling. I dag: quiz kjører offline
   etter lasting, kun final submit kan feile. Etter endring: hvert svar krever
   nett — nettverksbrudd midt i quiz blir ny feilmodus som krever retry/idempotent
   håndtering (UPSERT attempt_answers ON CONFLICT (attempt_id, question_id)).
3. På dårlig mobilnett (Fast 3G: ~680ms, Slow 3G: ~2,1s per svar) blir
   forsinkelsen merkbar og krever egen venter-UI.

Vurdering: stor regresjonsrisiko i produktets kjerneloop, for et problem som
krever at noen AKTIVT velger å utnytte det (åpne devtools eller skrive et
script). I nåværende fase (nylig lansert, kjent brukerbase ~100 personer) er
sannsynlig utnyttelse lav, og eventuell utnyttelse vil sannsynligvis være synlig
i leaderboard (mistenkelig høy score / 100% riktig konsekvent).

### Når dette bør revurderes

- Hvis leaderboard viser mistenkelige resultater (alltid 100%, unaturlig
  score-mønster for ukjente brukere)
- Hvis premiemodellen (fysiske/økonomiske premier) aktiveres — øker insentiv
  til juks
- Hvis brukerbasen vokser forbi "kjente personer i Facebook-gruppen" til en
  skala der sosial kontroll ikke lenger er en reell brems
- Generelt: revurder ved 500+ aktive brukere ELLER hvis premier innføres,
  hva som inntreffer først

### Hvis/når det tas opp igjen

Full kartlegging er allerede gjort (to Opus-runder, juni 2026) — konklusjonen
og tidslinjen for B er dokumentert i prosjektets chat-historikk. Anbefalt
løsning: **B (per-spørsmål server-roundtrip)**, med:

- `handleAnswer`: fyr `POST /api/quiz/[id]/answer` parallelt ved klikk, vis
  nøytral lock-in-mikroanim (~150ms) mens man venter på respons
- Korrekthets-animasjon flyttes til server-callback
- `getOptionClass` og forklaringsvisning gates på server-respons
- `played_log` skrives fortsatt ved slutt (uendret)
- Klient sender fortsatt `timeMs`, server klamper (uendret fra Problem A-fiksen
  — IKKE bytt til server-tidtaking, da straffer det brukere på dårlig nett
  i rangeringen)
- Migrasjon: unik constraint `(attempt_id, question_id)` på `attempt_answers`
  for idempotens
- Fjern fasit fra initial SELECT SIST, etter at server-stien er verifisert
  i produksjon
