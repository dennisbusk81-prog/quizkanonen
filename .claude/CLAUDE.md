# Quizkanonen — Claude Code kontekst
Sist oppdatert: 26. juli 2026

## PROSJEKT
Solo-gründer bygger Quizkanonen (quizkanonen.no) — en ukentlig quiz-plattform
som skal erstatte Kahoot for en etablert Facebook-gruppe (400 medlemmer).
Nordisk marked. Budsjett nær null i startfasen.

---

## TEKNISK STACK — IKKE ENDRE
- **Frontend + backend:** Next.js (App Router, TypeScript) — aldri Pages Router
- **Database + auth:** Supabase (PostgreSQL, RLS aktivert) — databasen ligger i
  **eu-west-1 (Irland)**. Ikke forveksle med Vercel-hostingen, som kjører i
  Frankfurt (fra1) — det er to ulike regioner hos to ulike leverandører.
- **Hosting:** Vercel (auto-deploy fra GitHub)
- **Betaling:** Stripe — **LIVE MODE** siden ~23. juni 2026. Ekte kort, ekte penger.
  Ikke bytt tilbake til test-modus, og ikke rør live-nøklene, uten eksplisitt beskjed.
- **Styling:** Ingen Tailwind — inline CSS via konstantobjekter

Arbeidsflyt: Claude Code pusher til git → Vercel deployer automatisk.

---

## DESIGNSYSTEM — FØLG NØYAKTIG
Les `app/quiz/[id]/page.tsx` som referanse før du starter ny feature.

### Farger
| Rolle | Verdi |
|---|---|
| Bakgrunn | `#1a1c23` |
| Kort | `#21242e` |
| Border | `#2a2d38` |
| Gull | `#c9a84c` |
| Titler | `#ffffff` |
| Brødtekst | `#e8e4dd` |
| Hint/meta | `#918f8a` |
| **FORBUDT** | `#7a7873` (for lav kontrast), `#9a9590`, `#6a6860`, `#8a8fa8` |

Hint-fargen ble hevet fra `#7a7873` til `#918f8a` 1. august 2026 av
tilgjengelighetshensyn. `#7a7873` ga 3,86:1 mot bakgrunnen og bare 3,51:1 mot
kort-bakgrunnen `#21242e` — under WCAG AA-kravet på 4,5:1, og konkret vanskelig
å lese på mobil i sterkt lys. `#918f8a` er den minste hevingen som klarer 4,5:1
mot ALLE tre mørke flatene: bakgrunn 5,27:1, kort 4,79:1, hover `#262930`
4,51:1. Velg aldri en ny hint-tone uten å regne mot `#21242e` — kortet, ikke
sidebakgrunnen, er den strengeste flaten hint-tekst faktisk ligger på.

### Typografi
- Titler: `Libre Baskerville` (serif)
- Brødtekst: `Instrument Sans`

### Knapper
- Primær (gul fylt): `background #c9a84c`, `color #1a1c23`, `padding 10px 28px`, `width auto`
- Aldri to gule elementer (knapp ELLER tekstlenke) på samme skjerm
- Sekundær: outline, transparent bakgrunn
- Founders-knapp: hvit outline (`border: 1px solid #e8e4dd`, `color: #e8e4dd`) — ikke gull

### Border-radius
- Kort: `16px`
- Knapper: `10px`

### Luft og padding
- Kort padding: minimum `24px 20px`, gjerne `28px`
- Mer luft er alltid bedre enn tettere

### Lenker
- Lenker som ikke er primærhandlinger: `#e8e4dd` — aldri `#918f8a`
- Unntak: hint-tekst og metadata som ikke krever klikk kan være `#918f8a`

### Regler
- Ingen Tailwind
- Ingen emoji i UI — SVG der nødvendig (unntak: medalje-emoji på leaderboard)
- Ingen hardkodede farger utenfor systemet ovenfor

### Tabellformat for én-quiz-resultater (ResultsTable)
`components/ResultsTable.tsx` er standardvisningen for lister der hver rad er
**én brukers resultat på én quiz**: kolonner `#/Navn/Riktige/Tid`, gull på topp
3. Brukt av admin/results, org-admin, `leaderboard/[id]` og SeasonLeaderboard
sin "Siste quiz"-fane (etablert gjennom `3f5a518`, `40cd3fe`, `195ed8c`,
20.–26. juli 2026).

Periodevisningene (måned/kvartal/år/all-time i `SeasonLeaderboard.tsx`)
beholder BEVISST det gamle kort-/radformatet — ikke fordi de er
"enkeltøyeblikk", men fordi kolonnebehovet faktisk er annerledes: poeng er
akkumulert over mange quizer, det finnes ingen tid-kolonne, og `quizCount`
— ikke tid — er den relevante andrelinjen. ResultsTable sine faste
Riktige/Tid-kolonner passer rett og slett ikke der.

**Regelen:** ny visning av person-per-quiz-resultater skal gå via
ResultsTable, ikke en fjerde kopi av samme tabell. Periodevisninger med
akkumulerte poeng er det eneste unntaket, og unntaket er begrunnet i
kolonnebehov — ikke i en generell "liste vs. øyeblikk"-regel.

Merk: Dennis synes forskjellen i praksis kan virke litt rar for en bruker
som bytter fane (tabell → kort → tabell), og skal hente tilbakemelding fra
folk på kontoret. Dette er altså en bevisst, begrunnet designbeslutning per
26. juli 2026 — men ikke hugget i stein. Den kan bli revurdert.

---

## ARKITEKTUR OG MØNSTRE

### Auth
- Supabase auth med Google OAuth + magic link + **passord** (se under)
- `lib/auth.ts` for signIn, signOut, getSession, getProfile
- `lib/supabase-admin.ts` er server-only (service role)
- Admin-auth: se egen seksjon under (rate-limitet + signert token, ikke lenger
  klartekst-passord i sessionStorage — endret 19. juli)
- `lib/session-identity.ts` (`getSessionIdentity()`, fra 22. juli 2026): gir en
  stabil identitet (`'unchecked' | 'anon' | userId`) å sammenligne mot i stedet
  for hele Supabase-session-objektet, som skifter referanse ved hver
  `TOKEN_REFRESHED`. Brukt i `app/leaderboard/[id]/page.tsx` og
  `app/org/[slug]/admin/page.tsx` for å unngå en flash/re-last-bug ved
  fane-fokus.

### ProfileProvider (delt profil-/premium-/org-context)
- `components/ProfileProvider.tsx` sitter i `app/layout.tsx` (root layout) og
  wrapper hele appen. Eksponeres via `useProfile()`.
- Sentraliserer `userId`, `displayName`, `isPremium`, `hasStripeCustomer`,
  `premiumSource` og `myOrgs` bak ÉN delt `onAuthStateChange`-subscription,
  i stedet for at hver side/komponent lyttet og hentet separat.
- Erstattet en tidligere tilstand med 5–14 duplikate kall til
  `/api/profile/premium-status` per sideinnlasting (én dedupe-vakt per
  bruker-id i stedet).
- `refreshProfile()` tvinger en fersk server-sjekk og oppdaterer contexten
  null-safe (nedgraderer aldri på transient feil). Dette er ruten for de
  bevisste re-sjekk-punktene på quiz-siden (quiz-start/-innsending) og
  leaderboard-siden (fane-fokus) — disse re-sjekkene skal IKKE fjernes eller
  endres, kun rutes gjennom `refreshProfile()` i stedet for egne kall.
- `myOrgs` fra denne contexten er nå bekreftet supersett av
  `/api/org/my-admin-orgs` (admin-orgs utledes med et `.filter(o => o.isAdmin)`
  i `UserMenu.tsx` i stedet for et eget kall). `my-admin-orgs`-ruten kalles
  ikke lenger fra klienten og skal ikke nevnes som et aktivt endepunkt.

### Navigasjon
- Én delt komponent, `components/SiteNav.tsx`, brukes på tvers av alle sider
  — ikke flere separate nav-implementasjoner. `components/NavAuth.tsx` er et
  internt underelement av `SiteNav.tsx`, ikke en egen side-nav.
- `/slik-fungerer-det` manglet tidligere nav helt — lagt til 23. juli 2026.

### Innlogging — delt AuthForm-komponent (identifier-first erstattet 20. juli 2026)
- `components/AuthForm.tsx` er DET ene innloggingsskjemaet — brukt av BÅDE
  `/login` (`variant="page"`) og `AuthModal.tsx` (`variant="modal"`, toppnav
  m.fl.). Ikke to separate flyter lenger. E-post, passord og Google vises alle
  samtidig fra start; magic link er en tredje, likestilt synlig knapp under
  Google-knappen (ikke lenger gjemt bak «Glemt passord?»)
- Erstatter det tidligere identifier-first-mønsteret (bruker skrev e-post
  først, siden avslørte deretter kun de metodene som gjaldt akkurat den
  kontoen). Det mønsteret gjorde også at modalen ikke hadde passordfelt i det
  hele tatt — en bruker som hadde satt passord kunne ikke bruke det fra
  toppnavigasjonen, kun fra `/login`
- `POST /api/auth/check-email` finnes fortsatt, men har byttet rolle: styrer
  ikke lenger hva som vises FØR et forsøk, kun HVORFOR en passordinnlogging
  feilet i ettertid (feil passord vs. en Google-/magic link-konto som aldri
  har hatt passord — `diagnoseLoginFailure()` i `AuthForm.tsx`), samt
  duplikat-sperren ved signup (`pre-signup`/`post-signup`-fasene, uendret siden
  før 20. juli)
- **«Har konto passord?» er AVLEDET, ikke lagret (4. august 2026).** Sannheten
  leses fra `auth.users.encrypted_password` via `public.auth_has_password(uuid)`
  — service_role-only, samme mønster som `auth_email_lookup` (som nå bruker
  samme kilde). Tre lesere: `/api/auth/check-email` (→ `/login`),
  `GET /api/profile/has-password` (→ `/profil`) og `/api/admin/users/[id]`.
  Kolonnen `profiles.has_password` er død og skal ikke leses.
  **Regel: ikke gjeninnfør en rute som SETTER dette feltet.** Forgjengeren
  `POST /api/auth/mark-password` tok `userId` fra body uten noen auth-sjekk, så
  hvem som helst kunne merke en vilkårlig konto som «har passord» og dermed
  frata en Google-bruker beskjeden om at kontoen ikke har noe passord. Den
  måtte være uautentisert for å virke i det hele tatt, siden passord-signup
  ikke har sesjon ennå — det er nettopp derfor lagring var feil form.
  `lib/has-password-route.test.ts` feller både ruten og et kall til den.
- `components/PasswordInput.tsx` — passordfelt med vis/skjul-ikon, delt av
  signup, innlogging og passord-bytte
- `/sett-passord` — side for å sette passord første gang (etter passord-signup)
- Endring av passord er tilgjengelig fra profilsiden for innloggede brukere

### Navnepolicy
- display_name er påkrevd for innloggede brukere
- Regex: `/^[\p{L}\s\-']{2,40}$/u`
- Google-navn settes automatisk som default ved OAuth (AuthListener.tsx)
- NameRequiredModal.tsx blokkerer ved manglende/ugyldig navn
- Validering håndheves i `/api/profile/upsert/route.ts`

### Lag og sesong
- leader_display_name (TEXT, nullable) på attempts-tabellen
- Laglederens user_id registreres på season_scores
- Hint-tekst på quiz-startsiden: "Sesong-poeng registreres på deg som er innlogget."

### Database-tabeller (eksisterende)
`quizzes`, `questions`, `attempts` (+ leader_display_name),
`attempt_answers`, `played_log`, `access_codes` (+ `code_type`, 26. juli),
`access_code_redemptions` (ny 26. juli — se «Verdikoder» under),
`admin_users`, `site_settings`, `profiles`, `organizations`,
`organization_members`, `organization_invites`, `leagues`, `league_members`,
`ranking_snapshots`, `season_scores`, `admin_actions`, `excluded_members`

profiles-tabellen har IKKE avatar_url, member_number-relaterte bilde-URLer,
eller lignende bildefelt — kun avatar_color (fargevalg for initial-sirkel).
Ingen bildeopplasting er bygget eller planlagt. Bekreftet empirisk mot prod
24. juli 2026 (400 42703 column does not exist).

### Testquiz for browser-verifisering
`.claude/QK_TESTQUIZ_OPPSKRIFT.md` — ferdig opprettelses- og ryddespørring,
med begrunnelse for hvert felt (`is_test`, `quiz_type='test'`,
`season_points_awarded=true`, og hvorfor `is_active=true` er PÅKREVD for at
anon-lesingen i spillsiden skal se quizen i det hele tatt). Skriv den ikke på
nytt ad hoc — sju barnetabeller henger på `quizzes.id`, og `played_log`
cascader ikke.

### Sesong-leaderboard-arkitektur
- `season_scores`: scope_type IN ('global', 'league', 'organization')
- Global: scope_type='global', scope_id=NULL
- Poeng skrives av `/api/cron/award-season-points` hvert 5. minutt
- `SeasonLeaderboard.tsx` er delt komponent — brukes av /toppliste, /liga/[slug], /org/[slug]
- Forsiden viser månedens globale topp 3 fra season_scores (ikke fra attempts)

### Fasit-endring — ÉN kodesti (etablert 25. juli 2026)
**Invariant:** Kun `app/api/admin/correct-answer/route.ts` kan endre fasit
(`is_correct`) på et spørsmål som allerede er spilt (har `attempt_answers`-
rader). Ingen annen kodesti skal noensinne regradere `is_correct` stille.

**Kun `/api/admin/correct-answer` kan endre fasiten på et spørsmål som
allerede har besvarelser.** Ingen annen kodesti — hverken PATCH på
`questions/[qid]`, en annen API-rute, eller direkte skriving mot databasen —
skal noensinne regradere `attempt_answers` eller oppdatere `season_scores`
som følge av en fasitendring.

- Ruten regraderer svarrader, rekalkulerer `attempts.correct_answers` og
  `correct_streak`, og synkroniserer `season_scores` — alt synkront, i samme
  forespørsel. Deler den er avhengig av: `lib/answer-key-correction.ts`
  (ren logikk, testdekket) og `lib/resync-season-scores.ts` (I/O)
- Fasiten er to kolonner som alltid skrives sammen:
  `{ correct_answer: <første>, correct_answers: <array hvis >1, ellers NULL> }`.
  Scoringen i `submit` faller tilbake på enkelt-kolonnen når arrayet er tomt —
  ikke skriv én av dem alene
- PATCH på `questions/[qid]` skiller tre tilfeller via `decideAnswerKeyPatch`:
  uendret fasit → fasit-kolonnene droppes (vanlig redigering går uendret
  gjennom, også på en spilt quiz); ingen svarrader → skrives direkte (quiz
  under bygging er upåvirket); endret + spilt → `409 answer_key_locked`
- Admin-UI-et henter antall besvarelser på forhånd og viser en inline
  bekreftelse på stedet. 409-en er en backstop for andre kallere, ikke
  normalflyten

Bakgrunn: fram til 25. juli hadde PATCH-ruten sin egen, udokumenterte
regradering. Den så kun på `correct_answer` (én bokstav), så en ordinær
lagring — f.eks. en rettet skrivefeil i spørsmålsteksten — kollapset
multi-svar stille og satte riktige svar til feil, uten å røre `attempts`
eller `season_scores`. Regelen over finnes for at den feilklassen ikke skal
kunne oppstå på nytt gjennom en ny inngang.

### ranking_snapshots-arkitektur (endret 19. juli 2026)
- Cache for live-plassering under spilling, delt av `/api/quiz/[id]/standings`,
  `/api/quiz/[id]/ranking-snapshot` og `/api/quiz/live-ranking` via den felles
  `getOrBuildSnapshot()`-funksjonen i `lib/ranking-snapshot.ts`
- **Én cache-rad PER QUIZ** — ikke lenger én rad per (quiz_id, question_index).
  Fram til 19. juli var nøkkelen per spørsmål, noe som delte trafikken på like
  mange nøkler som quizen har spørsmål og gjorde at cachen i praksis aldri
  traff (Disk IO-hovedårsak, funnet og rettet 19. juli)
- TTL: 10 sekunder
- Ved `ensureAttemptId`-tvungede rebuilds (rett etter at en spiller leverer og
  ikke er i den cachede snapshoten ennå) beregnes en fersk snapshot og
  returneres i responsen, men den skrives **ikke** til DB — kun ordinære,
  TTL-utløste rebuilds skriver. Dette hindrer at mange samtidige innsendinger
  ved quiz-stenging hver trigger en full JSONB-UPDATE

**NY REGEL for denne filen (ranking_snapshots) spesifikt:** kartlegging og
lesing av denne kodestien er alltid tillatt uten å spørre først — kun faktiske
PUSH-endringer krever eksplisitt godkjenning fra Dennis før de gjøres.
Bakgrunn: filen sto tidligere under «skal ikke røres uten eksplisitt beskjed»,
noe som gjorde at en ytelsesgjennomgang filtrerte den bort og lot en reell
Disk IO-bug vokse ukjent i flere uker før den ble funnet.

### Premium — autoritativ kildemodell (lib/premium-state.ts, 26. juli 2026)
**Problemet:** Premium kan komme fra fire kilder samtidig — verdikode,
Founders-trial, personlig Stripe-abonnement, org-medlemskap — men
`profiles.premium_source` lagret bare ÉN. En bruker kan reelt ha flere
samtidig. Konsekvensene var konkrete: en kunde kunne bli belastet for en
periode de samtidig fikk gratis via kode, og en cron kunne slå av Premium
for en betalende kunde fordi den ikke visste om en annen kilde dekket dem.

**Løsningen:** `lib/premium-state.ts` (ren logikk, mutasjonstestet) +
`lib/premium-state-io.ts` (I/O) utleder full tilstand fra alle kildene.
`decidePremiumState()` er beslutningstabellen, rad A–F:

| Rad | Situasjon | Utfall |
|---|---|---|
| A | Ingen dekning + kode | Starter nå |
| B | Founders-trial + kode | Stables på trial-slutt, abonnementet pauses |
| C | Kode aktiv + ny kode | Avvises med dato |
| D | Betalt abonnement + kode | Stables etter betalt periode, pauses derfra |
| E | Kode aktiv + nytt kjøp | Checkout får `subscription_data.trial_end` |
| F | Org-medlemskap + kode | Avvises, koden bevares, org-navnet hentes |

B og D er bevisst ÉN regel: begge stabler fra slutten av eksisterende
dekning og pauser innkrevingen fram til kodens slutt — via Stripes
`pause_collection` (`resumes_at`), **aldri kansellering**.

**Invariant:** `profiles.premium_status`/`premium_source`/`premium_expires_at`
er kun en CACHE for raske spørringer (skrevet av `syncPremiumCache()`).
Autoritative beslutninger — innløsning, utløp, pause — skal alltid gå mot
`decidePremiumState()`, aldri lese cache-feltene direkte og anta. De 6
stedene som slår AV Premium (4 i `app/api/stripe/webhook/route.ts`, begge
cron-jobbene `expire-code-premium` og `expire-grace-periods`) rekalkulerer nå
i stedet for å anta — et fremtidig nedgraderingssted skal følge samme mønster.

Samme prinsipp som «gate aldri på `subscription_status` alene» (se SIKKERHET)
gjenbrukes her: `LIVE_STRIPE_STATUSES = ['active', 'trialing']` — et
`trialing`-abonnement (som Elkjøp Nordic reelt står i) regnes som levende
dekning, ikke som «ikke betalende».

Nye databaseobjekter (migrasjon `20260732000000` + `20260733000000`, begge
allerede kjørt i prod): tabellen `access_code_redemptions` (én rad per
konto+kode-innløsning, UNIQUE på `(code_id, user_id)`, autoritativ
`expires_at` for kode-perioden) og kolonnen `access_codes.code_type`. Se
også "Verdikoder" under. `profiles.personal_stripe_subscription_id` er en
eksisterende kolonne som tidligere KUN ble satt av Founders-flyten — brukt
fire steder (begge cron-ene, begge org-grace-stedene) som om NULL betydde
«har ikke eget abonnement», noe som var feil for enhver vanlig betalende
B2C-kunde. Webhooken skriver den nå også ved `checkout.session.completed`;
eksisterende rader trenger backfill via `scripts/backfill-personal-subscription-id.mjs`
(dry-run som standard).

### Verdikoder — to sikkerhetsmodeller (lib/access-code.ts, 26. juli 2026)
En kode ment for bred deling og en kode ment for én mottaker har ulike
trusselbilder:
- **Delt kode** (`code_type='shared'`) — f.eks. en belønning til hele
  Facebook-gruppa. Lesbart kodeord, MEN `max_uses` og `valid_until` er nå
  OBLIGATORISKE. Gjettbarhet er ikke forsvaret — koden er per definisjon
  kjent av mange. Bruksgrensene er forsvaret.
- **Privat kode** (`code_type='personal'`) — f.eks. premie til én
  konkurransevinner. Alltid generert (aldri fritekst), 12 tegn med
  forkastningsutvalg (~59,5 bits, unngår modulo-skjevhet), låst til
  `max_uses=1`.
- Én innløsning per konto håndheves av en UNIQUE-indeks i databasen
  (`access_code_redemptions (code_id, user_id)`) — uten den kunne én bruker
  spise flere plasser på en gruppekode etter hvert som kode-premium utløp.
- `POST /api/admin/codes` gjorde tidligere `insert(body)` rått (mass
  assignment). Går nå via `buildAccessCode()` (ren, testdekket) i stedet.
- `org-trial-codes` gjenbruker samme generator — fjerner en tidligere
  modulo-skjevhet i en lokal 8-tegns-variant.

### Miljøvariabler (ligger i Vercel — ikke hardkod)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SITE_URL`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`,
`RESEND_API_KEY`, `ANTHROPIC_API_KEY`,
`STRIPE_PRICE_FOUNDERS`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`STRIPE_ORG_STARTER_PRICE_ID`, `STRIPE_ORG_STANDARD_PRICE_ID`, `STRIPE_ORG_PRO_PRICE_ID`,
`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`,
`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`,
`KV_URL`, `REDIS_URL`

KV-/REDIS-variablene er lagt inn av Upstash-integrasjonen i Vercel
Marketplace og bruker det gamle Vercel KV-navnemønsteret — ikke `UPSTASH_*`.
De ligger på **Production og Preview, ikke Development**, og Vercel har
markert dem som **sensitive**: de kan ikke leses tilbake med
`vercel env pull` (verdien kommer ut som `[SENSITIVE]`). To konsekvenser:
lokal `npm run dev` kjører uten delt lagring (som er meningen), og en av dem
kan ikke endres «midlertidig» og settes tilbake etterpå — den opprinnelige
verdien er ikke gjenopprettbar uten Upstash-dashbordet.

### Feilovervåkning — Sentry (5. august 2026)
`@sentry/nextjs` etter standardmønsteret for App Router: `instrumentation.ts`
(laster runtime-riktig init + `onRequestError`), `instrumentation-client.ts`,
`sentry.server.config.ts`, `sentry.edge.config.ts`, `app/global-error.tsx`,
og `withSentryConfig`-innpakning i `next.config.ts`.

**Invariant: alt som sendes til Sentry går gjennom `scrubEvent()` i
`lib/sentry-scrub.ts`.** Skrubbingen ligger ved SINKET (kalles fra
`beforeSend`/`beforeSendTransaction` i alle tre initene), ikke hos kallerne —
samme mønster som escapingen i `lib/email-templates.ts`. Da kan ingen
framtidig `Sentry.captureException(...)` et sted i koden glemme den. Fjerner
e-post, JWT/Bearer, Stripe-nøkler, de bokstavelige verdiene av
server-hemmelighetene i `process.env`, sensitive headere (`authorization`,
`cookie`, `x-admin-token`, `x-attempt-token`, `stripe-signature`,
`x-forwarded-for`) og invitasjons-token som ligger i STIEN
(`/api/org/join/<token>`). `user.id` beholdes bevisst — sporbarhet uten
personopplysning. `sendDefaultPii` er eksplisitt `false` alle tre stedene.

Andre bevisste valg: `tracesSampleRate` 0,15 (gjelder KUN ytelses-transaksjoner
— exceptions sendes alltid 100 %); Session Replay bevisst IKKE på; `ignoreErrors`
holdt kort, og «Failed to fetch»/`AbortError` er med vilje IKKE filtrert bort
fordi de er signalet fra timeout-vaktene i `lib/with-timeout.ts`; av lokalt med
mindre `NEXT_PUBLIC_SENTRY_ENABLE_IN_DEV=1`; source maps slettes etter
opplasting så serverkoden ikke serveres offentlig.

Alt er inert uten `NEXT_PUBLIC_SENTRY_DSN` — `enabled` er da `false` og SDK-en
sender ingenting.

### Rate-limiting — to lag, og hvem som bruker hvilket (5. august 2026)
Det finnes TRE mekanismer, og de er ikke alternativer til hverandre:

1. **`lib/rate-limit.ts`** — Map på modulnivå, altså én teller PER
   serverless-instans. Uendret og fortsatt riktig for de fleste kallsteder.
2. **`lib/rate-limit-shared.ts`** (+ ren `lib/rate-limit-protocol.ts`) — delt
   teller i Upstash Redis over REST. Brukt av de 12 kallstedene der lag 1 var
   eneste forsvar OG konsekvensen er reell.
3. **Autoritativ telling i `admin_actions`** — `lib/redeem-throttle.ts`,
   `lib/check-email-throttle.ts`, `lib/org-trial-code-throttle.ts`,
   `lib/duel-quota.ts`, `lib/invite-quota.ts`. Overlever kalde starter, og var
   svaret på dette problemet lenge før Upstash fantes.

**Migrert til delt teller (lag 2):** admin-innlogging, `stripe/checkout`,
`stripe/org-checkout`, `stripe/founders-activate`,
`stripe/org-founders-activate`, `api/auth/bekreft`, `auth/callback`,
`api/notifications/subscribe`, `org/[slug]/send-reminder`,
`org/join/[token]`, `quiz/start-attempt`, `quiz/[id]/submit`.

**Bevisst IKKE migrert:** flatene med lag 3 (de har allerede en teller som
overlever), og alle rene lese-ruter — der er grensen kostnadsdemping, og
instans-spredning er harmløs. Ikke migrer noe «for konsistensens skyld»;
hver rundtur koster latency og en Upstash-kommando.

### Hva telleren nøkles PÅ (5. august 2026 — like viktig som hvor den bor)

**Spillestien (`quiz/start-attempt`, `quiz/[id]/submit`) nøkles på BRUKER-ID,
ikke IP.** Se `lib/play-rate-limit.ts`. To lag:
1. `rateLimit` (in-memory) `<rute>:pre:<ip>`, 120/min — grov burst-brems FØR
   token-oppslaget, så et søppel-token ikke gir et gratis GoTrue-kall.
2. `rateLimitShared` `<rute>:user:<id>` for innloggede, `<rute>:anon:<ip>`
   ellers. 20/10 min, uendret tall.

`auth.getUser` er FLYTTET øverst i begge rutene for å kunne nøkle på bruker —
det er samme ene oppslag som lå lenger nede, ikke et nytt. Ikke flytt det
tilbake ned; da blir `userId` alltid null og alle havner i anon-bøtta.

Bakgrunn: 20/IP var reelt 7–20 spillere per nett (én spiller bruker flere
kall — sidelast kaller `start-attempt` på nytt via gjenbruk-stien, «Prøv
igjen» kaller `submit` på nytt). Elkjøp Nordic har 29 medlemmer bak ett
kontornett. Feilen var usynlig så lenge telleren lå per instans; den delte
telleren gjorde den reell. **Å gjøre en mekanisme korrekt kan avdekke at
parameteren aldri var det.**

**De uautentiserte innloggingsrutene KAN ikke nøkles slik.** `/auth/callback`
og `/api/auth/bekreft` har per definisjon ingen verifisert bruker ennå. Der
er IP-grensen i stedet dimensjonert opp: 20 → **60 per 60 s**, felles
konstant i `lib/auth-rate-limit.ts`. Trygt fordi grensen er sekundær
polstring — begge rutene krever en OAuth-kode bundet til en PKCE-verifier
eller et `token_hash` fra Supabase, og uten den er et forsøk verdiløst
uansett hvor mange ganger det gjentas.

**FALLGRUVE — `/api/quiz/live-ranking` er fortsatt nøklet `<ip>:<quizId>`,
30 per 60 s, in-memory.** Den kalles ÉN GANG PER SPØRSMÅL av Premium-spillere
(`goToNext` → `fetchLiveRankingFull`), altså `N-3` ganger per quiz — det
eneste stedet i spillestien der forbruket skalerer med antall spørsmål. Med
målt spilletid gir det ~5 kall/min per spiller, så grensen tilsvarer ca. **6
samtidige Premium-spillere bak samme IP**. At det ikke biter i dag skyldes
utelukkende at telleren er per instans.

Migrerer du den til delt teller uten å nøkle den på bruker først, gjenskaper
du F1 — denne gangen på en flate der symptomet er STILLE: et 429 gir
`fetchLiveRankingFull` → null, og mellomskjermen vises uten plassering.
Premium-funksjonen forsvinner uten feilmelding, uten Sentry-hendelse og uten
loggspor. Re-nøkle FØR du flytter den, ikke etter.

**Invariant — teller og TTL settes i SAMME transaksjon:**
`SET <k> 0 PX <ms> NX` + `INCR <k>` via `/multi-exec`. IKKE `INCR` +
`PEXPIRE`: med INCR først finnes et vindu der nøkkelen mangler utløpstid, og
feiler den andre kommandoen der, blir sperren PERMANENT. `PEXPIRE ... NX`
ville også løst det, men krever Redis 7.0+; `SET` med `PX`/`NX` er støttet
siden 2.6.12. TTL skal heller ALDRI fornyes per kall — et glidende vindu ville
låst ute en bruker som fortsetter å prøve, siden vinduet aldri utløper så
lenge trafikken pågår. Fast vindu, samme semantikk som lag 1.

Andre bevisste valg: **fail-open** ved timeout/feil (1000 ms frist — kortere
ville falt åpent nettopp når instanser churner og TLS-håndtrykket er kaldt);
in-memory sjekkes FØRST og kortslutter uten rundtur, gyldig fordi en
instans-teller aldri kan være høyere enn den delte; Sentry-varsel ved
fail-open, bremset til 1/minutt per instans, og kun med nøkkelPREFIKSET —
resten av nøkkelen er IP eller bruker-id, som `sentry-scrub` ikke fanger i
`extra`.

Inert uten `KV_REST_API_URL`/`KV_REST_API_TOKEN` — env-variabelen ER
funksjonsbryteren, så utrullingen kan slås av uten ny deploy.

**Merk at Preview og Production deler samme Upstash-database og samme
nøkkelrom.** En preview-deploy bruker altså av samme teller som prod for
samme IP. Det er uproblematisk for rate-limiting, men greit å vite før man
tester grenser mot en preview.

Verifisert i preview 5. august 2026, ikke antatt: 429 griper på nøyaktig
grense+1; telleren overlevde en HELT NY deploy (bevis på at den ligger i
Upstash og ikke i minnet); en nøkkel med kortere vindu slapp igjennom igjen
etter at vinduet gikk ut (bevis på at TTL faktisk settes); og med Upstash
pekt mot en uårbar vert svarte ruten 400/429 som normalt — aldri 500 — med
~1040 ms per kall, altså timeout-fristen som slår inn og faller åpent.
Målt kostnad ved normal drift: ~9 ms median.

---

## PAYWALL-LOGIKK
| Feature | Gratis | Innlogget | Premium |
|---|---|---|---|
| Spille quiz | ✓ | ✓ | ✓ |
| Nøyaktig plassering | — | — | ✓ |
| Historikk og statistikk | — | — | ✓ |
| Private ligaer | — | — | ✓ |
| Sesong-leaderboard (egen plass) | — | — | ✓ |

Premium: kr 49/mnd. Stripe i **live mode** siden ~23. juni 2026.

---

## FORSIDE — STRUKTUR (app/page.tsx)
Rekkefølge ovenfra:
1. Nav (SiteNav.tsx) — "Toppliste" synlig på desktop, skjult på mobil
2. Hero — tittel, undertittel, gul knapp, statuslinje
3. Sitat-linje — kursiv, #918f8a
4. Fakta-ikoner — tre SVG (kalender, person, stjerne)
5. Divider
6. Quiz-kort — eyebrow, tittel, tagline, månedlig leaderboard, outline-knapp
7. Lenker under kortet — sesong-toppliste + alle quizer
8. Accordion — tre items
9. Bedrifts-seksjon — #1e1a0e bakgrunn, gull-border
10. Founders-seksjon — uendret, hvit outline-knapp

Månedlig leaderboard i quiz-kortet:
- Henter fra season_scores WHERE scope_type='global' AND scope_id IS NULL
- Filtrert på inneværende kalender-måned (closes_at)
- Aggregeres i JS på serveren, sortert DESC på total_points
- Vises kun hvis minst 1 rad finnes med gyldig display_name

---

## STRIPE — VIKTIG
- **Live mode** siden ~23. juni 2026 — ekte kort, ekte penger. Ikke test-kort lenger.
- Kun Premium månedlig kr 49 — ukespass er fjernet
- Founders Access: gratis trial (30 dager, eller fast dato 15. august 2026 for
  nye B2C-signups under det forlengede tilbudet), ingen kortinfo
- Founders-knapp: hvit outline — ikke gull (to-gule-regel)
- Webhook håndterer: `checkout.session.completed`, `subscription.deleted`,
  `subscription.updated`, `invoice.payment_succeeded`, `invoice.payment_failed`,
  `charge.refunded`
- Idempotens: `stripe_events`-tabellen stempler behandlede event-id-er
  (aktivert 19. juli 2026 — se Sikkerhet-seksjonen)
- **Robusthetsmønster, ikke ennå gjennomført alle steder (23. juli 2026):**
  i `app/api/stripe/subscription/route.ts` er `new Stripe(...)` flyttet inn i
  try-blokken, slik at en manglende/ugyldig `STRIPE_SECRET_KEY` gir en ren,
  logget JSON-feilrespons i stedet for en rå uhåndtert 500. De fleste andre
  Stripe-rutene (`checkout`, `webhook`, `verify-session`, `portal`,
  `org-portal`, `org-checkout`, `founders-activate`, `profile/delete`,
  `admin/users/[id]`) instansierer fortsatt Stripe som første linje i
  handleren, UTENFOR try — samme sårbarhet er ikke rettet der. Vurder samme
  mønster ved neste gjennomgang av disse rutene.

---

## HVA SOM IKKE SKAL RØRES UTEN EKSPLISITT BESKJED
- Stripe live-nøkler (er i **live mode** — ekte penger, ikke bytt til test uten beskjed)
- RLS-policies i Supabase
- `lib/supabase-admin.ts` (server-only, ikke eksporter til klient)
- `FOUNDERS_ACTIVE`-konstanten i `app/quiz/[id]/page.tsx`
- Autentiseringsflyt og OAuth callback (`app/auth/callback/route.ts`)

`ranking_snapshots` har et EGET, mer presist unntak — se
«ranking_snapshots-arkitektur» under ARKITEKTUR OG MØNSTRE: lesing/kartlegging
er alltid greit uten å spørre, kun push krever godkjenning.

---

## SIKKERHET
Status per 20. juli 2026, etter to runder sikkerhetsgjennomgang og retting:

- **Generell invariant — gate ALDRI på `subscription_status` alene, noe sted
  i kodebasen:** Elkjøp Nordic står som `trialing` i prod selv om de er en
  reell, betalende B2B-kunde — en regel som krever `status === 'active'` for
  å telle som «ekte kunde» rammer den ene bedriftskunden vi faktisk har.
  Bruk i stedet signaler som er dyre å forfalske (alder på kontoen, faktisk
  medlemsantall, om noen dekning i det hele tatt er levende). Denne regelen
  er nå bekreftet nødvendig to uavhengige steder: `lib/invite-quota.ts`
  (se e-post-relé-avsnittet under) og `lib/premium-state.ts` sin
  `LIVE_STRIPE_STATUSES = ['active', 'trialing']` (se ARKITEKTUR OG MØNSTRE
  → «Premium — autoritativ kildemodell»).
- **Quiz-integritet — signert attempt-token (20. juli):** `/api/quiz/[id]/questions`
  leverte tidligere fasiten til hvem som helst som kjente quiz-id + en attempt-id,
  så et script kunne hente hele fasiten på forhånd (ett kall per index) uten å
  spille. `/submit` hadde ingen kobling mellom den som startet og den som leverte.
  Nå utsteder `start-attempt` et HMAC-signert token (`lib/attempt-token.ts`,
  speiler `lib/admin-token.ts`) over `(attemptId, quizId, utstedt)`. Både
  `questions` og `submit` krever `x-attempt-token`, verifisert mot forespørselens
  `(attemptId, quizId)` — tokenet kan ikke flyttes til et annet forsøk/quiz.
  `questions` avviser dessuten attempts der `submitted_at` er satt (ingen
  fasit-uthenting etter innsending), og gir aldri spørsmålsdata ved avvisning.
  `submit` har fått rate-limit (10/10min/IP) og tidsvalidering mot server-klokka:
  hard `403` under 2 sek totalt, `console.warn` under 1 sek/spørsmål i snitt.
  Nøkkel: `QUIZ_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY` (ingen ny env-variabel
  kreves i Vercel). Merk: tidsvalideringen måler mot `attempts.completed_at` —
  tabellen har INGEN `created_at`-kolonne; `completed_at` settes av DB-defaulten
  `now()` ved opprettelse og overskrives aldri, så den er forsøkets
  starttidspunkt.
- **`organizations`-tabellen:** RLS strammet til kun `service_role` 19. juli.
  Var offentlig lesbar (inkl. `stripe_customer_id`/`stripe_subscription_id` for
  alle bedriftskunder) via den åpne `organizations_select_all`-policyen siden
  tabellen ble opprettet 1. april — aldri strammet inn før nå.
- **Admin-innlogging:** rate-limitet (5 forsøk / 15 min per IP) og bruker et
  signert, tidsbegrenset sesjonstoken i stedet for å lagre selve
  `ADMIN_PASSWORD` i klartekst i `sessionStorage`. Endret 19. juli.
- **Webhook-idempotens:** `stripe_events`-tabellen (stempler behandlede
  Stripe event-id-er) opprettet og aktivert 19. juli. Var tidligere fraværende,
  så idempotens-sjekken i webhooken feilet stille og gjorde ingenting.
- **E-post-relé og HTML-injeksjon i e-post (26. juli):** en angriper kunne
  registrere gratis konto → opprette org med gratis trial uten kort → bli
  org-admin automatisk → sende 50 e-poster per kall til vilkårlige adresser fra
  ekte `hei@quizkanonen.no`, med angriper-skrevet HTML limt rått inn i malen.
  Tre innstramminger:
  - **Escaping ved sinket.** `lib/html-escape.ts` (`escapeHtml`) brukes INNE i
    `lib/email-templates.ts`, ikke hos kallerne — da kan ingen framtidig kaller
    glemme det. Alle brukerstyrte felt escapes: `senderName`, `orgName`,
    `firstName`, `challengerName`, `quizTitle` og spillernavnene i
    `weeklyReportEmail`. Nye maler skal følge samme mønster: ta parameteren som
    `xRaw` og lag en escapet lokal variabel øverst i funksjonen. URL-er vi
    bygger selv (invitasjons- og avmeldingslenker) escapes bevisst IKKE — `&`
    mellom query-parametere skal stå urørt.
    Merk at `attempts.player_name` er fritekst ≤100 tegn uten tegnsett-
    validering, og når profilen mangler `display_name` er det den som havner i
    ukesrapporten (`lib/weekly-report.ts`) — ikke bare det validerte
    profilnavnet.
  - **Sendekvote per org** — `lib/invite-quota.ts` (ren, testdekket).
    `etablert` = aktivt abonnement ELLER (org eldre enn 7 dager OG ≥5
    medlemmer) → 50 per kall, 200 per døgn (uendret oppførsel).
    `ny` = alt annet → 15 per kall, 40 per døgn.
    **Gate ALDRI på `subscription_status` alene:** Elkjøp Nordic står som
    `trialing` i prod, så en «må være aktiv/betalende»-regel ville rammet den
    ene ekte bedriftskunden. Alder + faktiske medlemmer er signalene som er
    dyre for en angriper og gratis for en ekte bedrift.
    Døgnforbruket telles i `admin_actions`
    (`action_type='org_invite_email'`, `scope_type='organization'`) — ingen
    migrasjon, og i motsetning til `lib/rate-limit.ts` (modul-lokal Map, lever
    per serverless-instans) overlever tellingen kalde starter. Avsendernavnet
    utledes server-side fra profilen; body-feltet `senderName` ignoreres.
  - **`validateOrgName` (`lib/org-name.ts`)** håndheves i BEGGE
    org-opprettelsesrutene (`org-checkout` og `org-founders-activate`):
    2–60 tegn, bokstaver/tall/mellomrom og vanlig firmanavn-tegnsetting.
    Hindrer at markup i det hele tatt kommer inn i `organizations.name`.

  Selve Founders-/trial-forretningslogikken er uendret — gratis prøve uten kort
  fungerer som før for legitime bedrifter.
- **RPC-funksjoner kallbare direkte av `authenticated`, forbi API-rutenes
  Premium-gating (30. juli):** 11 SECURITY DEFINER-funksjoner
  (`season_leaderboard_ranked/user_stats/period_quizzes`,
  `quiz_leaderboard_ranked/user_stats/better_count`,
  `attempt_answer_option_counts`, `attempt_answer_stats_by_attempts`,
  `weekly_active_players`, `count_active_players_since`,
  `count_active_leagues`) hadde kun `REVOKE EXECUTE FROM PUBLIC, anon` —
  ikke `authenticated`. Postgres gir `authenticated` en egen, eksplisitt
  EXECUTE-grant som IKKE fjernes av en revoke fra PUBLIC alene. Empirisk
  bekreftet mot prod: en fixture-gratisbruker kunne kalle alle 11 direkte
  mot `/rest/v1/rpc/`, med eget JWT + anon-nøkkel, utenom appens API-ruter
  — fikk andre brukeres eksakte plassering og full svarfordeling tilbake.
  Rettet med eksplisitt `REVOKE ... FROM authenticated, anon, PUBLIC` på
  alle 11, verifisert i `pg_proc.proacl`. `is_league_member` BEVISST IKKE
  revokert — kalles av RLS-policyen på `league_members` og evaluerer kun
  kallerens egen `auth.uid()`, lekker ingenting uansett hvem som kaller
  den. `redeem_access_code` fikk samtidig `SET search_path=''` + fullt
  kvalifiserte `public.`-navn (manglet begge deler).
  **Regel for framtidige service_role-only SECURITY DEFINER-funksjoner:
  REVOKE må navngi `authenticated` eksplisitt — `FROM PUBLIC, anon` er
  ikke nok.**
- **`access_codes`-tabellen offentlig lesbar uten innlogging (30. juli):**
  egen sårbarhetsklasse fra punktet over (åpen RLS-policy på en tabell,
  ikke manglende funksjonstilgang), funnet ved samme gjennomgang. Ren
  anon-nøkkel uten Authorization-header hadde lesetilgang til samtlige
  koder i klartekst. Opphevet entropi-modellen for `personal`-koder
  (26. juli). Ingen skade i dag (2 koder, begge inaktive/oppbrukte), men
  ville rammet neste premiekode. Policyen droppet, RLS slått på.
- **Fortsatt åpent:** bot-/spam-beskyttelse (CAPTCHA e.l.) er ikke
  implementert — kun planlagt.

## KJENTE IKKE-BUGS (ikke fiks disse)
- Scroll-effekt på forsiden: kun synlig i Claude in Chrome-utvidelsen
- "Laster profil...": isolert til én spesifikk testbruker

## KJENTE BUGS (lav prioritet)
- "Spill nå"-knappen i quiz-kortet på forsiden vises gul fylt istedenfor outline
  Koden er riktig (inline style, transparent bg) men noe overstyrer den
  Tas i dedikert økt — ikke kritisk

---

## STATUS — LANSERT, LIVE DRIFT
Produktet er lansert og kjører i live drift. Stripe er i **live mode** siden
~23. juni 2026. Flere fredagsquizer er gjennomført i live-modus, inkludert en
betalende B2B-kunde (Elkjøp Nordic).

Fullført siden forrige status (15. juni):
- ~~Stripe live-modus~~ — AKTIVERT ~23. juni 2026
- ~~Supabase Pro~~ — AKTIVERT 14. juni 2026
- ~~E-post ved Stripe-hendelser~~ — bygget (9 ulike varsler i webhooken:
  kjøpsbekreftelse, fornyelse, kansellering, betalingsfeil m.fl., både B2C og org)
- ~~Passordinnlogging~~ — bygget og verifisert 18. juli 2026
- ~~organizations-tabellen offentlig lesbar~~ — RLS strammet 19. juli 2026
- ~~Admin-innlogging uten rate-limit / klartekst-passord~~ — rettet 19. juli 2026
- ~~Webhook-idempotens fraværende~~ — `stripe_events` aktivert 19. juli 2026
- ~~Fasit hentbar på forhånd via /questions uten å spille~~ — signert
  attempt-token på questions/submit + tidsvalidering, 20. juli 2026
- ~~Historikk/svarfordeling viste kun ett riktig svar på multi-svar-spørsmål~~
  — begge bruker nå `readStoredKey()` konsistent, 26. juli 2026
- ~~«Siste quiz» viste ulik historikk enn periodevisningene ved endret
  opt-out~~ — utleder nå blokkerte fra `season_scores` for gjorte-opp
  quizer, 26. juli 2026
- ~~E-post-relé / HTML-injeksjon via org-invitasjoner~~ — escaping,
  sendekvote per org, org-navnvalidering, 26. juli 2026
- ~~Premium kun én kilde av gangen i profiles~~ — autoritativ
  kildemodell (`lib/premium-state.ts`) + to sikkerhetsmodeller for
  verdikoder, 26. juli 2026
- ~~RPC-funksjoner kallbare direkte av `authenticated`, forbi
  API-rutenes Premium-gating~~ — eksplisitt REVOKE på 11 funksjoner,
  30. juli 2026
- ~~`access_codes`-tabellen offentlig lesbar uten innlogging~~ — RLS
  strammet, 30. juli 2026
- ~~Rate-limiting kun per serverless-instans på sikkerhetskritiske
  ruter~~ — delt teller i Upstash for 12 kallsteder, 5. august 2026
  (se «Rate-limiting — to lag» under ARKITEKTUR OG MØNSTRE)

Gjenstående/pågående:
1. Forklaringstekst per spørsmål (admin-felt)
2. Mobil-test på ekte enheter
3. Bot-/spam-beskyttelse (kun planlagt, ikke bygget)
