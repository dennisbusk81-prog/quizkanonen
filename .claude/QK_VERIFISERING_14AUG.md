# Verifisering av åpne saker — 14. august 2026

Ren verifiseringsrunde mot de seks QK-filene i `qk-docs-temp/`.
**Ingen kode er endret, ingenting staget eller committet.** Alt under er lesing,
`grep`, `git log` og én `npm run lint`.

HEAD ved kjøring: `8440924`. Dokumentene er datert 13. august (sen kveld), altså
én dag før denne runden.

`qk-docs-temp/` er lagt i `.gitignore` (linje 52) — arbeidskopier som lastes ned
daglig hører ikke i git.

Filliste bekreftet før start: seks QK-filer, alle datert 14. august 09:33, ingen
på 0 byte.

| Dokument | Åpne saker vurdert |
|---|---|
| QK_4_Neste_steg_og_Backlog-1.txt | 45 |
| QK_1_Prosjekt_og_Stack-1.txt | 6 |
| QK_3_Strategi_og_Produkt.txt | 3 |
| QK_Founders_avslutning_beslutninger.txt | 1 |
| QK_2_Hva_er_bygget-1.txt | 0 — ingen åpne markører |
| QK_5_Feedback_og_Innsikt-3.txt | 0 — lærdommer, ikke oppgaver |

---

## QK_4_Neste_steg_og_Backlog-1.txt

### LIVE-FLATENE — GJENSTÅENDE ARBEID

```
[FORTSATT ÅPEN] Punkt 3 — RIVAL: rival + suggestions + leaderName ikke gatet
      Bevis: app/api/quiz/rival/route.ts:61 — suggestions returnerer fortsatt rå
             userId; null treff på getPublicSnapshot i filen

[FORTSATT ÅPEN] Punkt 4 — LIVE-RANKING: leser snapshoten ugatet
      Bevis: app/api/quiz/live-ranking/route.ts:35-36 — nøkkelen er fortsatt
             live-ranking:${ip}:${quizId}, rateLimit (in-memory) 30/60 s.
             Forutsetningen «ikke migrer telleren» er dermed intakt

[FORTSATT ÅPEN] ranking-snapshot har INGEN rate-limit i det hele tatt
      Bevis: app/api/quiz/[id]/ranking-snapshot/route.ts — null treff på
             rateLimit/rateLimitShared

[FORTSATT ÅPEN] social-proof teller PÅBEGYNTE forsøk mens andre flater teller leverte
      Bevis: app/api/quiz/social-proof/route.ts:17 — kommentaren sier det selv;
             :110-111 filtrerer på completed_at, ikke submitted_at
```

### NYTT 13. AUGUST — ÅPNE SAKER

```
[FORTSATT ÅPEN] T4/T5 — mellomskjermen når du er alene i feltet
      Bevis: app/quiz/[id]/page.tsx:2084 (spanRanking.total > 1);
             components/QuizInterlude.tsx:359 (liveRanking.totalPlayers >= 2)

[FORTSATT ÅPEN] Mellomskjermens terskel på tre besvarte — arkitektur-blokkeringen
      Bevis: app/api/quiz/[id]/submit/route.ts:282 — attempt_answers skrives
             fortsatt i ÉN batch ved innsending

[FORTSATT ÅPEN] computePlacement har ingen direkte enhetstest
      Bevis: funksjonen bor i lib/ranking-snapshot.ts; kun
             lib/standings-cache.test.ts og lib/standings-route-blocked.test.ts
             nevner den

[FORTSATT ÅPEN] /api/historikk gater på premium_status, ikke isUserPremium()
      Bevis: app/api/historikk/route.ts:23 (!profile?.premium_status);
             app/api/historikk/[attemptId]/route.ts:65 (!profile.premium_status)

[FORTSATT ÅPEN] /admin/classics er død kode
      Bevis: ingen Link/href peker til siden — alle treff på «admin/classics» i
             app/ gjelder API-ruten /api/admin/classics/copy eller kommentarer

[FORTSATT ÅPEN] Testquiz-oppskriften inneholder en linje som aldri kan kjøre
      Bevis: supabase/migrations/20260614000002_quiz_notifications.sql:18 —
             notified_quiz_id er text, mens :14 gjør quizzes-id-en uuid.
             Oppskriftens UPDATE står fortsatt i
             .claude/QK_TESTQUIZ_OPPSKRIFT.md:318-319

[FORTSATT ÅPEN] N14 — oppskriften advarer ikke om tom topp-3
      Bevis: .claude/QK_TESTQUIZ_OPPSKRIFT.md har null treff på «tom topp-3»,
             «blokkert» eller «globally-blocked»

[KAN IKKE VERIFISERES] Spørsmålsbanken: «Kun klassikere» gir garantert tom liste (is_classic = 0 rader)
      Krever Supabase: select count(*) from questions where is_classic = true

[FORTSATT ÅPEN] «Beste plassering» velger laveste RÅ rank
      Bevis: dokumentet merker den selv BESLUTTET beholdt — ført her fordi den
             står i listen, ikke som en oppgave

[FORTSATT ÅPEN] Underteksten i 45-grenen brekker med to ord på linje to
      Krever nettleser for det visuelle; teksten finnes, brekkpunktet kan ikke
      måles fra kode
```

### 12. AUGUST KVELD — S-SAKENE

```
[FORTSATT ÅPEN] S1-rest — /api/toppliste sin anonym-så-autentisert-sekvens
      Bevis: components/SeasonLeaderboard.tsx:526 — scopedFetchReady, med
             kommentaren på :520 om at global bevisst ikke venter på sessionChecked

[FORTSATT ÅPEN] S1-rest — mulig kappløp i leaderboard/[id] sin loadSession
      Bevis: app/leaderboard/[id]/page.tsx:353 — lastSessionIdentityRef settes
             etter await getSession(). Om det faktisk utløses krever innlogget måling

[FORTSATT ÅPEN] S2 — server-side redirect() gir ikke ekte 3xx
      Bevis: app/loading.tsx finnes fortsatt (880 byte), så Suspense-grensen står.
             Regelen er tatt i bruk der det gjaldt: next.config.ts:30-34 bruker
             redirects() for /founders → /premium

[FORTSATT ÅPEN] S4 — dag 15 for de nye prøveperiodene
      Bevis: app/api/stripe/founders-activate/route.ts har null treff på
             trial_settings; kun trial_period_days (:258). Til sammenligning setter
             app/api/stripe/org-founders-activate/route.ts:168
             end_behavior.missing_payment_method: 'cancel'

[LUKKET] S5 — verdikode mot en bruker med aktivt abonnement, UKARTLAGT
      Bevis: kartlagt og besvart i samme dokument som S10, og rad G er bygget
             (081e5f8). S5 og S10 er samme sak, to ganger i dokumentet

[KAN IKKE VERIFISERES] S6 — varslingsdekningen er 4 av 26
      Krever Supabase: select count(*) from profiles where email_reminders = true

[FORTSATT ÅPEN] S6-relatert — quiz_notifications er nøklet på e-poststreng, ingen user_id
      Bevis: supabase/migrations/20260614000002_quiz_notifications.sql:13-18 —
             kolonnene er id, email, created_at, notified_at, notified_quiz_id

[FORTSATT ÅPEN] S7 — velkomst-e-posten bruker e-postadresse som navn
      Bevis: lib/auth-post-login.ts:85 —
             (initialDisplayName ?? user.email.split('@')[0]).split(' ')[0]

[FORTSATT ÅPEN] S9-rest punkt 1 — loadError-mønsteret til de tolv gjenstående admin-sidene
      Bevis: loadError finnes kun i app/admin/quizzes/page.tsx:264,
             app/admin/users/page.tsx og app/admin/users/[id]/page.tsx. Null treff i
             codes, org-trial-codes, dashboard, analytics, questions, results,
             retention, sporsmal, classics, new

[FORTSATT ÅPEN] S9-rest punkt 2 — showFeedback sletter seg selv etter 3 sekunder
      Bevis: app/admin/codes/page.tsx:341-344 — setTimeout(… , 3000) uten å skille
             'success' fra 'error'

[FORTSATT ÅPEN] S12 — /bedrift/success har ingen tilbakeknapp
      Bevis: app/bedrift/success/page.tsx — null treff på «Tilbake» eller href="/"

[FORTSATT ÅPEN] S12 — /org/[slug]/velkommen har ingen vei ut
      Bevis: app/org/[slug]/velkommen/page.tsx — null treff på «Tilbake»,
             «Hopp over» eller href="/"

[FORTSATT ÅPEN] S12 — radioknappene er ikke forhåndsvalgt ved gjensyn
      Bevis: app/org/[slug]/velkommen/page.tsx — null treff på checked= eller
             defaultChecked; onboarding_completed_at nevnes kun på :260 (stempling)

[FORTSATT ÅPEN] S13 — quizspilling tilpasser seg ikke store skjermer
      Bevis: components/QuizInterlude.tsx:229 — maxWidth: 360 hardkodet.
             Spørsmålsvisningen er fortsatt ikke kartlagt

[KAN IKKE VERIFISERES] S14 — trial-reminders er slått av med vilje
      Krever cron-job.org-dashbordet for å se om jobben fortsatt er inaktiv

[FORTSATT ÅPEN] S8 — to gull-elementer på /premium
      Bevis: app/premium/page.tsx:317 (2px solid #c9a84c på pris-kortet), :326
             (gull pristekst) og :414 (gullfylt knapp) på samme skjerm

[KAN IKKE VERIFISERES] S8 — «Founders Access» er fortsatt produktnavnet i Stripe
      Krever Stripe-dashbordet

[FORTSATT ÅPEN] S8 — BOM i .env.local linje 1
      Bevis: kan ikke leses uten å åpne .env-filen, som er utenfor mandatet her.
             .env.prod-tellingen under bekrefter samme klasse
```

### N-BACKLOGEN

```
[FORTSATT ÅPEN] N1 — next_quiz_at er en manuell felle
      Bevis: app/quiz/[id]/page.tsx:2607-2610 (allerede-spilt) leser nextQuizAt
             rått, uten vakten if (d > new Date()) og uten timeZone 'Europe/Oslo'.
             Resultatskjermen :3882-3885 har BEGGE. Linjene har flyttet seg fra
             :2534 og :3737, innholdet er uendret

[LUKKET] N2 — «30s per spørsmål» på startskjermen er feil
      Bevis: 4941c10 — app/quiz/[id]/page.tsx:2873 rendrer nå
             `${label} per spørsmål` fra describeQuestionTimeLimit
             (lib/quiz-time-limit.ts), altså den faktiske grensen

[FORTSATT ÅPEN] N3 — /api/toppliste har ingen gate på ?page= eller ?search=
      Bevis: app/api/toppliste/route.ts:232 setter isPaginated, og kommentaren
             :227-229 sier eksplisitt at den «styrer kun hvor mye ekstraarbeid
             ruten gjør». userIsPremium leses (:162, :325) og returneres (:403),
             men brukes ikke til å begrense

[FORTSATT ÅPEN] N3 — /api/leaderboard/[id] har ugatet ?limit=
      Bevis: app/api/leaderboard/[id]/route.ts:100 — Math.min(200, …), og :301
             pageSize = isBrowse ? 20 : classicLimit. isUserPremium (:5) gater
             browse, ikke classicLimit

[FORTSATT ÅPEN] N3 — guestRank gir uinnlogget eksakt rank
      Bevis: app/api/leaderboard/[id]/route.ts:359 — guestRank = better + 1

[FORTSATT ÅPEN] N3 — /standings gir eksakt rank ugatet
      Bevis: app/api/quiz/[id]/standings/route.ts:13-14 — «Tilgjengelig for alle.
             Klienten avgjør visning»

[FORTSATT ÅPEN] N3 — /prev-rank ugatet uten ?org=
      Bevis: app/api/leaderboard/[id]/prev-rank/route.ts:26-30 — medlemskaps-gaten
             gjelder KUN når orgSlug er satt; :57 .limit(500)

[FORTSATT ÅPEN] N7 — velkomstsiden kan miste varselvalget stille
      Bevis: components/WelcomeScreen.tsx:178-179 — begge kallene hoppes over når
             token er null. Null treff på captureMessage/Sentry i filen

[FORTSATT ÅPEN] N9 — /login sier «Logg inn» også i registreringsmodus
      Bevis: app/login/page.tsx:97-98 — h1 «Logg inn» og undertittel «Logg inn,
             eller opprett en konto» er statiske; AuthForm bytter kun knapp og
             hjelpetekst på isSignup (components/AuthForm.tsx:372)

[FORTSATT ÅPEN] N13 — /api/quiz/active og forsiden mangler is_active-filter
      Bevis: app/api/quiz/active/route.ts:12 har kun .eq('is_test', false);
             app/page.tsx:152 samme

[ENDRET FORM] N15 — retry-lenken gir ingen tilbakemelding
      Bevis: components/ProfileProvider.tsx:180 — setMyOrgsError(false) kalles
             fortsatt umiddelbart før forsøket
      Merknad: Mekanismen er uendret, men den er nå et dokumentert valg, ikke en
               forglemmelse: kommentaren på :178-179 sier at siden skal vise
               LASTESKJERMEN i stedet for feilskjermen mens forsøket pågår, «uten
               at den trenger egen retry-state». Dokumentets premiss — «Ser ut som
               ingenting skjedde» — forutsetter at ingen lastetilstand rendres.
               Om flatene faktisk viser den krever nettleser

[FORTSATT ÅPEN] N16 — /leaderboard/[id]?org= kan bli evig spinner
      Bevis: app/leaderboard/[id]/page.tsx:274 — await getSession() uten
             tidsgrense, linjenummeret er uendret

[FORTSATT ÅPEN] N17 — duell-knapp kan bli stående i «Godtar…»
      Bevis: components/RivalryCard.tsx:89 — getSession() ligger utenfor try-en
             som åpner på :92 (flyttet fra :88)

[FORTSATT ÅPEN] N18 — topp 3 på resultatskjermen vs. skjult leaderboard
      Bevis: app/api/quiz/[id]/standings/route.ts — null treff på
             hide_leaderboard_until_closed eller show_leaderboard

[FORTSATT ÅPEN] N19 — forsidens topp 3 mangler blokkert-filter og dedup
      Bevis: app/page.tsx:247-254 — leser attempts direkte med .eq('quiz_id'),
             .eq('is_team', false), order + limit(3). Ingen getGloballyBlockedSet,
             ingen rankQuizAttempts, ingen submitted_at. Linjene har flyttet seg
             fra :224-231

[LUKKET] N20 — intern plassering forsøkes bare én gang
      Bevis: 30d8bf9. Dokumentet fører den selv i LUKKET-listen 13. august

[FORTSATT ÅPEN] N21 — to quiz-oppslag i /api/toppliste mangler is_test/is_active
      Bevis: app/api/toppliste/route.ts:251-252 (siste quiz) og :437-443 (ventende
             quiz i emptyResponse) — begge har kun .eq('quiz_type', 'weekly')

[KAN IKKE VERIFISERES] N22 — ekstern tilgjengelighet, Fortinet-kategorisering
      Krever tilbakemelding fra Elkjøp-brukeren fredag 14. august, som dokumentet
      selv setter som verifiseringspunkt

[FORTSATT ÅPEN] N23 — migrasjonsdrift, to sikkerhetsfikser lever kun i prod
      Bevis: alle 11 funksjonene revokerer fortsatt kun FROM PUBLIC, anon —
             supabase/migrations/20260614000016_quiz_leaderboard_rpc_restrict.sql:18-29,
             20260727000000_attempt_answer_stats_rpc.sql:94-96,
             20260730000000_dashboard_rpcs.sql:112-113. Ingen migrasjon definerer
             noen policy på access_codes; 20260401000001_rls_policies.sql:87 slår
             kun på RLS

[FORTSATT ÅPEN] N24 — paginerings-TODO skjult under et punkt merket LØST
      Bevis: app/api/leaderboard/[id]/route.ts:132-135 — TODO(paginering) står

[FORTSATT ÅPEN] N24-bifunn — to foreldreløse RPC-funksjoner
      Bevis: quiz_leaderboard_ranked og quiz_leaderboard_better_count har null
             kallsteder; quiz_leaderboard_user_stats brukes fra
             app/api/admin/users/[id]/route.ts:76

[ENDRET FORM] N25 — localStorage uten TTL og uten versjon
      Bevis: qk_progress_ (app/quiz/[id]/page.tsx:1418 skriv, :1253 les) og
             qk_result_ (:2257) er fortsatt uversjonerte og uten TTL
      Merknad: KONTRASTEN dokumentet bygger på er borte. qk_attempt_ FIKK
               versjonering (3fecab6) — alle fire stedene bruker nå
               qk_attempt_v2_ (app/historikk/page.tsx:437,463 og
               app/historikk/[attemptId]/page.tsx:150,172), og CACHE_VERSION er
               hevet fra 'v2' til 'v4' (app/historikk/page.tsx:176). Selve funnet
               om de to localStorage-nøklene står uendret

[FORTSATT ÅPEN] N26 — to stille stier i stripe_customer_id-kjeden
      Bevis: app/api/stripe/checkout/route.ts:40 — if (!storedId) return null,
             fortsatt uten logg; app/api/stripe/founders-activate/route.ts:180-199
             logger kun på feilgrenen (:197). 081e5f8 rørte ingen av filene

[FORTSATT ÅPEN] N27 — org-checkout mangler gyldighetssjekk på kunde-id
      Bevis: app/api/stripe/org-checkout/route.ts:60-62 bruker
             org.stripe_customer_id direkte; null treff på customers.retrieve
```

### UENDRET FRA 5. AUGUST — M-SAKENE

```
[KAN IKKE VERIFISERES] M1 — Resend Pro, døgngrensen på 100
      Krever Resend-dashbordet (resend.com/settings/billing)

[FORTSATT ÅPEN] M2 — Tier B rate-limiting (~18 ruter), bevisst utsatt
      Bevis: lib/rate-limit-shared.ts brukes fortsatt av de 12 Tier A-kallstedene
             som CLAUDE.md lister; ingen utvidelse til Tier B

[FORTSATT ÅPEN] M3 — live-ranking, fallgruve ikke oppgave
      Bevis: app/api/quiz/live-ranking/route.ts:35-36 — uendret nøkkel og teller

[FORTSATT ÅPEN] M4 — CAPTCHA ikke bygget
      Bevis: null treff på captcha, turnstile, hcaptcha, recaptcha eller altcha i
             app/, lib/, components/ eller package.json

[FORTSATT ÅPEN] M6 — analytics «Endre svar» kollapser multi-fasit
      Bevis: app/admin/quizzes/[id]/analytics/page.tsx:537 — PATCH
             { correct_answer: newAnswer }, kalt fra :857

[FORTSATT ÅPEN] M7 — cache-demping ved F2-feil
      Bevis: lib/globally-blocked-set.ts:230 — feilgrenen skjuler nå ALLE
             («skjuler alle»), altså den aksepterte prisen står

[LUKKET] LINT — 43 pre-eksisterende feil
      Bevis: npm run lint gir 15 problems, 0 errors, 15 warnings. Dokumentet fører
             den selv som «ikke lenger en backlog-sak»
```

### ÅPNE SAKER FRA 12. AUGUST — IKKE BESLUTTET

```
[FORTSATT ÅPEN] Admin-felter som lover kontroll de ikke har
      Bevis: app/admin/page.tsx:422-423 skriver fortsatt founders_days_free og
             founders_trial_days; app/api/admin/founders-settings/route.ts:30-32
             lagrer dem. founders_new_trial_days finnes ikke i ruten.
             founders_max_slots er fortsatt i reell bruk (app/admin/page.tsx:365)

[FORTSATT ÅPEN] /api/admin/founders-settings skriver tilbake gjettede verdier
      Bevis: app/api/admin/founders-settings/route.ts:18-20 — GET-fallback
             ?? 250 / ?? 30 / ?? 7, og PUT (:30-32) kan skrive dem tilbake

[FORTSATT ÅPEN] Levningskolonnene på site_settings
      Bevis: supabase/migrations/20260611000001*.sql:3-5 — de tre kolonnene med
             DEFAULT 250/30/7 er ikke droppet

[FORTSATT ÅPEN] app/bedrift/registrer/page.tsx:416 — hardkodet «14 dager»
      Bevis: linjenummeret er uendret — «Prøv gratis i 14 dager»

[LUKKET] /founders inviterer fortsatt til et program som avvikles
      Bevis: 526b9dc — app/founders/ inneholder nå kun success/; siden er borte, og
             next.config.ts:32 gir { source: '/founders', destination: '/premium',
             permanent: true }, altså ekte 308

[FORTSATT ÅPEN] 15 placeholdere i .env.prod
      Bevis: grep -c SENSITIVE .env.prod = 15 — tallet stemmer eksakt
```

---

## QK_1_Prosjekt_og_Stack-1.txt

```
[FORTSATT ÅPEN] Auth-flyter uten app-nivå rate-limiting (CAPTCHA vurdert, ikke bygget)
      Bevis: samme som M4 — null treff på noen CAPTCHA-leverandør

[KAN IKKE VERIFISERES] Andre GET-ruter som skriver
      Saken er ikke avgrenset til navngitte ruter i dokumentet; en fullstendig
      gjennomgang av alle GET-handlere er en egen kartlegging, ikke en verifisering

[KAN IKKE VERIFISERES] Funn B — distribuert falsk innsending via engangskontoer
      Krever prod-data for å avgjøre om det skjer; koden har ingen ny sperre

[FORTSATT ÅPEN] Grace-inkonsistens i /api/historikk
      Bevis: app/api/historikk/route.ts:23 og [attemptId]/route.ts:65 — samme sak
             som 13. august-oppføringen over

[FORTSATT ÅPEN] profiles_select_all USING(true)
      Bevis: supabase/migrations/20260401000000_create_auth_tables.sql:12 definerer
             policyen, og 20260804000000_derive_has_password.sql:157 omtaler
             profiles som «offentlig lesbar (profiles_select_all)». Prod-tilstand
             er fortsatt ikke verifisert, som dokumentet selv sier

[FORTSATT ÅPEN] /api/org/welcome-email har ingen rollesjekk
      Bevis: app/api/org/welcome-email/route.ts:33-42 krever MEDLEMSKAP (403 hvis
             !member), men ingen admin-/rollesjekk

[ENDRET FORM] 17 gjenstående lint-advarsler (10 exhaustive-deps + 4 <img> + 3 dødkode)
      Bevis: npm run lint gir nå 15 warnings, 0 errors
      Merknad: Sammensetningen er en annen. De 3 dødkode-funksjonene er FJERNET
               (50fb881 — deactivateInvite, saveSettings, handleGoToMyPlacement),
               mens tre NYE advarsler kommer fra lib/supabase-realtime-stub.ts
               (:13, :15, :28 — ubrukte parametre), som er en UKOMMITTERT fil. På
               committet tre er tallet 12, ikke 15 eller 17
```

---

## QK_3_Strategi_og_Produkt.txt

```
[FORTSATT ÅPEN] Skal en ANSATT kunne melde seg PÅ selv om bedriften har sagt nei?
      Ren produktbeslutning; dokumentet fører den som ikke avvist. Ingen
      kodeendring kan avgjøre den

[FORTSATT ÅPEN] GJENSTÅR: guestRank for uinnloggede, /standings sin eksakte rank, grace-inkonsistensen
      Bevis: alle tre bekreftet over — app/api/leaderboard/[id]/route.ts:359,
             app/api/quiz/[id]/standings/route.ts:13-14, app/api/historikk/route.ts:23

[FORTSATT ÅPEN] Konfetti ved streak >= 5 — IKKE BYGGET
      Bevis: dokumentet merker den selv som ønsket, ikke bygget. Ingen
             streak-betinget konfetti finnes i spillestien
```

---

## QK_Founders_avslutning_beslutninger.txt

```
[FORTSATT ÅPEN] Av punkt 5 gjenstår «ETT TYDELIG ØYEBLIKK»
      Bevis: flaten som møter de 72 ved første innlogging etter utløp finnes ikke i
             app/. Dokumentet noterer selv at den først kan TESTES etter
             15. august, siden ingen har tilstanden «hadde Premium, mistet den» før da
```

---

## QK_2_Hva_er_bygget-1.txt og QK_5_Feedback_og_Innsikt-3.txt

Ingen åpne saker. Begge er null treff på GJENSTÅR, FORTSATT ÅPEN, IKKE BYGGET,
IKKE FIKSET, IKKE LØST og UKARTLAGT. QK_2 er en oppføring av hva som er bygget;
QK_5 er lærdommer og prinsipper, ikke oppgaver.

---

## PRESISERINGER

Fem steder der dommen står, men et støtteargument i dokumentet ikke holder.
Tatt med fordi de kan villede neste leser.

1. **N23** — «null migrasjoner inneholder REVOKE … FROM authenticated» er ikke
   sann som generell påstand: minst
   `20260731000000_swap_question_order_rpc.sql:110`,
   `20260616190001_attempts_hide_user_id.sql:42`,
   `20260719000000_stripe_events.sql:73` og
   `20260719000001_organizations_lock_to_service_role.sql:51` har mønsteret.
   Substansen holder — ingen av de **11** funksjonene saken gjelder har det.

2. **N25** — kontrasten «qk_attempt mangler også versjon» er utdatert. Den fikk
   versjonering i `3fecab6`, og CACHE_VERSION står nå på `'v4'`, ikke `'v2'`.
   Linjehenvisningene i punktet (`historikk/[attemptId]/page.tsx:149, :171`,
   `historikk/page.tsx:337`, `:161`) peker alle på flyttet eller endret kode.

3. **S9-rest punkt 2** — «Seks sider bruker mønsteret» stemmer ikke. `showFeedback`
   finnes i fire filer: `app/admin/codes/page.tsx`,
   `app/admin/org-trial-codes/page.tsx`, `app/admin/quizzes/page.tsx` og
   `app/admin/quizzes/[id]/questions/page.tsx`.

4. **S5 og S10** står som to saker i samme dokument, men er samme spørsmål. S5 er
   ført som «UKARTLAGT», S10 som «KARTLAGT, SVARET ER JA» med rad G bygget
   (`081e5f8`). S5 bør strykes.

5. **QK_4 «LIVE-FLATENE»** sier om rival-ruten at den er «delvis
   submitted-filtrert». Den er filtrert på begge stedene jeg finner —
   `app/api/quiz/rival/route.ts:36` og `:81`. Det som faktisk gjenstår er
   synlighets-gaten (`getPublicSnapshot`) og at `suggestions` bærer rå `userId`
   (`:61`).

---

## OPPSUMMERING

| Dom | Antall |
|---|---|
| FORTSATT ÅPEN | 41 |
| LUKKET | 6 |
| ENDRET FORM | 3 |
| KAN IKKE VERIFISERES | 8 |
| **Sum** | **58** |

Fordelt per dokument:

| Dokument | Åpen | Lukket | Endret form | Kan ikke verifiseres |
|---|---|---|---|---|
| QK_4_Neste_steg_og_Backlog-1.txt | 33 | 5 | 2 | 5 |
| QK_1_Prosjekt_og_Stack-1.txt | 4 | 0 | 1 | 2 |
| QK_3_Strategi_og_Produkt.txt | 3 | 0 | 0 | 0 |
| QK_Founders_avslutning_beslutninger.txt | 1 | 0 | 0 | 0 |
| QK_2_Hva_er_bygget-1.txt | 0 | 0 | 0 | 0 |
| QK_5_Feedback_og_Innsikt-3.txt | 0 | 0 | 0 | 0 |

**De seks lukkede:** N2 (startskjermens tidstekst, `4941c10`), N20 (intern
plassering, `30d8bf9`), `/founders` som inngang (`526b9dc` +
`next.config.ts:32`), S5 (duplikat av S10, besvart), lint-saken, og
qk_attempt-versjoneringen som N25 hviler på (`3fecab6`).

**Verdt å merke seg:** tolv saker har linjehenvisninger som fortsatt peker
NØYAKTIG riktig (N16 `:274`, N26 `checkout:40`, `bedrift/registrer:416`,
`M6 analytics:537`, `S7 auth-post-login:85` m.fl.), mens seks har flyttet seg
uten å endre innhold (T4/T5, N1, N17, N19, N21, N24). Ingen av linjehenvisningene
viste seg å peke på noe annet enn det dokumentet beskrev — men jeg søkte på
uttrykket, ikke på linjen, i alle tilfeller.
