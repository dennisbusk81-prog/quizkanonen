# Lastmåling før annonsering — Quizkanonen

**Dato:** 5. august 2026
**Oppdrag:** Krav 3 av 3 for «klar til å invitere folk» (Sentry ✓, delt rate-limiting ✓, lastmåling ← denne)
**Mål å dimensjonere for:** ~300 samtidige spillere, annonsering til ~1000 Facebook + ~1500 LinkedIn
**Omfang:** Ren kartlegging. Ingen kodeendringer. Ingen kunstig last mot prod.

---

## 0. FØRST: premisset i oppdraget er feil, og det endrer svaret

Oppdraget sier «målt tåleevne i dag er 63 samtidige spillere». Det stemmer ikke.
**63 var totalt antall deltakere over et 10-timers vindu — ikke samtidige.**

Jeg regnet ut faktisk samtidighet for alle sju ekte quizer i prod (sveipelinje
over `attempts.completed_at` → `submitted_at`):

| Quiz | Deltakere | **Maks samtidige** | Maks starter/min | Median spilletid | Spredning |
|---|---|---|---|---|---|
| 31.07 | 63 | **3** | 2 | 149 s | 9,7 t |
| 24.07 | 54 | **3** | 2 | 135 s | 9,8 t |
| 17.07 | 51 | **4** | 3 | 153 s | 9,8 t |
| 10.07 | 55 | **3** | 3 | 156 s | 9,8 t |
| 03.07 | 71 | **4** | 3 | 146 s | 9,8 t |
| 26.06 | 56 | **4** | 2 | 141 s | 9,9 t |
| 19.06 | 75 | **4** | 4 | 145 s | 10,4 t |

Ankomstformen er stabil: **22–30 % starter i første time etter åpning**, resten
drypper jevnt over hele vinduet. Median spilletid er 2,5 minutt.

Det bekrefter kartleggingen fra 28. juli, og det betyr at «300 samtidige» og
«300 deltakere» er to helt ulike tall:

- **300 deltakere med dagens ankomstform** → topp ~8–12 samtidige.
- **300 deltakere konsentrert over 30 minutter** (annonseringsscenarioet, som
  ikke finnes i historikken) → ~10 starter/min × 2,5 min spilletid ≈ **25
  samtidige, topp kanskje 40**.

Selv det høye anslaget er beskjedent. **Konklusjonen for hele rapporten:
databasen og samtidigheten er ikke det som brekker ved 300. Det som brekker er
(a) rate-grenser per IP, og (b) tallriktighet etter hvert som quizene hoper seg
opp.**

---

## 1. Rangert liste — hva brekker først

### 🔴 F1 — Rate-grensene per IP gir hard 429 for folk bak delt IP-adresse
**Dette er den mest sannsynlige feilen på annonseringsdagen, og den ble
innført i dag.**

`/api/quiz/start-attempt` og `/api/quiz/[id]/submit` har begge
**20 forespørsler per 10 minutter per IP-adresse** — og etter dagens
utrulling deles telleren via Upstash på tvers av alle serverløse instanser.

Før i dag var telleren en `Map` per instans. Effektiv grense var altså
20 × antall instanser man traff, som under en trafikktopp er mange.
**Endringen som ble gjort for å forberede annonseringen er dermed selve
tingen som mest sannsynlig ryker under den.** Det er ikke et argument for å
rulle tilbake — den delte telleren er riktig — men grensen er nå satt for
en verden der 20 per IP var uendelig i praksis.

Verre: én spiller bruker **mer enn én** av de 20.
- Sidelast på nytt midt i quizen → `start-attempt` kalles igjen (gjenbruk-stien,
  `reused: true`) og teller på nytt.
- Timeout på innsending → «Prøv igjen»-knappen (`retryFinishQuiz`) kaller
  `/submit` på nytt og teller på nytt.

Realistisk forbruk er 1–3 kall per spiller på hver av de to tellerne. **Reell
grense er derfor 7–20 spillere per IP per 10 minutter, ikke 20.**

**Hvem deler IP-adresse:**
- **Elkjøp Nordic — 29 medlemmer bak ett kontornett.** Spiller mer enn ~15–20
  av dem i samme lunsjpause, blir resten avvist. Dette er den ene betalende
  B2B-kunden.
- Norsk mobil (Telenor/Telia) bruker CGNAT på IPv4 — mange abonnenter deler
  én offentlig adresse.
- Skoler, universiteter, arbeidsplasser.

**Symptomet spilleren ser:** «For mange forsøk. Vent litt og prøv igjen.»
Det leses som at siden er ødelagt, ikke som at man er bremset.

**Bryter ved:** ~7–20 spillere fra samme IP innenfor 10 minutter. Ved 300
deltakere er dette ikke sannsynlig — det er nesten sikkert.

**Arbeid:** Lite, 1–2 timer. Nøkle på `user_id` når spilleren er innlogget og
falle tilbake på IP kun for gjester, og/eller heve grensen kraftig. Misbruket
grensen beskytter mot er allerede dekket av andre mekanismer: `attempts_user_quiz_unique`
hindrer at en bruker spiller samme quiz to ganger, og `submitted_at`-vakten i
`/submit` hindrer dobbeltscoring.

**MÅ gjøres før annonsering.**

---

### 🔴 F2 — `.in()`-taket ved ~390 id-er slår ut org-skjuling under åpen quiz
`lib/globally-blocked-set.ts` sin live-gren (quiz ikke gjort opp ennå — altså
nøyaktig mens quizen er åpen) gjør:

```
.from('organization_members').select(...).in('user_id', attemptUserIds)
```

`attemptUserIds` er alle spillere som har levert. Målt grense for `.in()` er
~390 id-er før URL-en sprenger (se `lib/paginate.ts`). Feilen sjekkes ikke —
`data` blir `null`, blokkert-settet blir tomt, og ruten faller åpent.

**Konsekvens:** ansatte i bedrifter som har valgt «hold resultatene internt»
blir synlige på den offentlige topplisten og på resultatskjermen. Samme
kodemønster i `app/api/leaderboard/[id]/route.ts`.

**Bryter ved:** ~390 leverte forsøk på én quiz. Over målet på 300, men godt
innenfor rekkevidde av 2500 inviterte.

**Arbeid:** Lite, 1–2 timer. Bytt til `fetchAllRowsChunked`, eller enda bedre:
spør `organization_members` per organisasjon i stedet for per brukerliste.

**Bør gjøres før annonsering** — den er billig, og feilen er en
personvernlekkasje mot en betalende kunde, ikke bare et tall som blir feil.

---

### 🟠 F3 — Stille 1000-radersavkutting: vokser med ANTALL QUIZER, ikke spillere
PostgREST kutter stille ved 1000 rader (`db-max-rows=1000`). Fire steder er
allerede kjent og merket `TODO(paginering)`, men ikke fikset. Under
lastperspektiv rangerer de helt ulikt:

| Sted | Bryter når | Ved 300 spillere/quiz |
|---|---|---|
| `lib/history.ts` → `computeRanks` | 1000 forsøk **på tvers av quizene i én historikkside** | **~3 quizer** ⚠️ |
| `lib/history.ts` → `getPlayerStats` 90-dagerssveip | 1000 forsøk siste 90 dager | **~2 quizer** ⚠️ |
| `app/api/leaderboard/[id]` | 1000 forsøk på ÉN quiz | ~1000 spillere |
| `app/api/toppliste` → `getLastQuizAttempts` | 1000 forsøk på ÉN quiz | ~1000 spillere |
| `app/api/quiz/social-proof` (ikke tidligere flagget) | 1000 forsøk på ÉN quiz | ~1000 spillere |

**De to historikk-stedene er de akutte.** `computeRanks` henter alle forsøk for
opptil 50 quizer i én sidevisning. I dag er `attempts` 425 rader totalt — helt
trygt. Etter to–tre annonseringsstore quizer (300 hver) passeres 1000, og da:

- `computeRanks` får bare de ~3 første quizene med i svaret.
- For alle eldre quizer blir `byQuiz.get(quiz_id)` tom → **rank = 1,
  total_players = 0**. Historikken viser «nr. 1 av 0».
- `getPlayerStats` regner snitt på en avkuttet delmengde → alle
  gjennomsnittstall blir feil, uten feilmelding.

Merk at den tidligere anslåtte fristen (~7. oktober) bygget på dagens vekst på
~60 forsøk i uka. **Ved 300 i uka flyttes den til to–tre uker etter første
store quiz.**

De tre per-quiz-stedene nås ikke ved 300 og haster ikke.

**Arbeid:** `fetchAllRows` er allerede bygget og testet. 2–4 timer for alle fem
inkludert tester.

**Kan vente til rett etter første store quiz** — men ikke lenger. Sett en
påminnelse, ikke en intensjon.

---

### 🟠 F4 — `notify-subscribers` sender duplikat-e-post til alle når listen vokser
`app/api/cron/notify-subscribers/route.ts`:
- Har **ingen `export const maxDuration`** → standard funksjonsbudsjett
  (15 s på Vercel Pro). Til sammenligning har `send-reminders` og
  `publish-quiz` satt 60.
- Løkken sender 8 om gangen, sekvensielt, uten pacing mellom batchene.
- **`notified_at`-stemplingen skjer ÉN gang, etter hele løkken.**

Blir funksjonen drept midt i løkken, stemples **ingen**. Dedup-sjekken øverst
(`notified_quiz_id = quiz.id`) finner da fortsatt ingenting, og neste kjøring
sender til alle på nytt — fra begynnelsen. Gjentatte ganger.

Kodens egen kommentar i `lib/email-batch.ts` sier dessuten at
`EMAIL_BATCH_SIZE = 8` begrenser *samtidighet*, ikke *gjennomstrømning*: vedvarende
rate blir ~32/s, over Resends grense på 10/s. Feilede sendinger stemples heller
ikke.

**Bryter ved:** grovt anslag ~800 abonnenter for tidsavbruddet; Resend-grensen
treffes langt tidligere. **I dag: 1 abonnent.** (`push_subscriptions`: 3,
`email_reminders=true`: 12 av 145 profiler.)

Dette haster altså ikke nå — men annonseringen er nøyaktig det som fyller
tabellen.

**Arbeid:** 2–3 timer. Stemple per batch i stedet for til slutt, sette
`maxDuration = 60`, legge inn pacing.

**Kan vente — men legg inn en tripwire** (varsle når `quiz_notifications`
passerer f.eks. 200 rader).

---

## 2. Hva som blir TREGT, men ikke brekker

### S1 — Kaldstart er den dominerende latenskostnaden, og en trafikktopp gjør den verre
Målt 28. juli: `/standings` 1656 ms kald vs. 366 ms varm (4,5×), `social-proof`
843 ms → 55 ms (15×).

En annonseringstopp betyr mange nye instanser samtidig, altså mange kaldstarter
samtidig. Hver kald instans betaler nå i tillegg et kaldt TLS-håndtrykk mot
Upstash på sin første beskyttede forespørsel (fristen er 1000 ms, normalen
~9 ms — den skal ikke slå inn, men den legger til rundtur).

Dette er ikke et brudd, og det skalerer ikke verre med flere brukere — snarere
tvert imot: mer trafikk holder instansene varme. **Paradokset er at dagens lave
trafikk gir verre kaldstart enn 300 deltakere vil gi.**

### S2 — En quiz-sidelast koster ~10 API-kall før spilleren svarer på noe
`premium-status`, `founders/count`, `org/my-quiz-times`, `social-proof`,
`quizzes` (direkte fra nettleser til Supabase), `my-attempt`, `standings` (×1–2),
`leagues`, `rivalries/my`, `org/[slug]/season-summary`.

Hele spillerunden er ca. **97 rundturer per spiller per quiz**
(start-attempt ~8, spørsmål 15×3, live-ranking ~13, submit ~9, standings ~12,
sidelast ~10). Ved 300 deltakere: **~29 000 rundturer per quiz**.

- Fordelt over 10 timer: 0,8/s — ingenting.
- Konsentrert over 30 minutter: **~16/s** — fortsatt komfortabelt for PostgREST.

Ikke et problem. Verdt å vite fordi tallet gjør det lett å regne på neste
størrelsesorden.

### S3 — Manglende indekser: et QUIZ-problem, ikke et spiller-problem
Jeg tidsmålte de tyngste spørringene direkte mot prod (6 kall hver, median):

```
  92 ms  BASISLINJE: attempts select id limit 1
  80 ms  attempts WHERE quiz_id                (63 rader)
  79 ms  attempts WHERE user_id
  80 ms  season_scores WHERE quiz_id           (59 rader)
  78 ms  attempts WHERE completed_at >=        (425 rader)
  77 ms  full snapshot-rebuild                 (63 rader)
```

**Alt ligger på basislinjen.** Databasen gjør null målbart arbeid ved dagens
volum — hele kostnaden er nettverksrundturen. Indekser er altså *ikke* et
300-spillere-problem.

De blir et problem når tabellene vokser med antall quizer. Tre hull, utledet
fra migrasjonsfilene:

1. **`attempt_answers` mangler indeks på `question_id` alene.** Det finnes bare
   `(attempt_id)` og unik `(attempt_id, question_id)` — `question_id` er ikke
   ledende kolonne og kan ikke brukes til oppslag på den. RPC-en
   `attempt_answer_option_counts` grupperer nettopp på `question_id`:
   **målt 125–135 ms mot 75 ms basislinje = ~50 ms reelt arbeid på 6 285 rader.**
   Det er signaturen til en full tabellskanning. Ved 300 spillere × 15 spørsmål
   × 52 quizer ≈ 234 000 rader/år → framskrevet **~2 sekunder** per kall.
2. **`season_scores` mangler indeks med `quiz_id` som ledende kolonne.**
   Unikhetsnøkkelen er `(user_id, quiz_id, scope_type, scope_id)` — `user_id`
   først. `getGloballyBlockedSet` filtrerer på `quiz_id` på den varme stien.
3. **`attempts` mangler indeks på `completed_at`.** Brukt av 90-dagerssveipet i
   `getPlayerStats` og av månedsspørringen på forsiden.

**Forbehold:** dette er utledet fra migrasjonsfilene. Jeg kan ikke lese
`pg_indexes` gjennom PostgREST, og EXPLAIN er slått av på denne instansen
(`db-plan-enabled=false`). Er en indeks lagt til for hånd i Supabase-dashbordet,
ser jeg den ikke. Kjør dette i SQL Editor for å bekrefte:

```sql
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('attempts','attempt_answers','season_scores')
order by tablename, indexname;
```

**Arbeid:** tre `CREATE INDEX CONCURRENTLY`, ~30 minutter. Billig nok til at
det bare kan gjøres — men det haster ikke for annonseringen.

---

## 3. Ting jeg trodde kunne være problemet, og som beviselig ikke er det

Skrevet ned med tall så de ikke blir flagget på nytt:

- **`ranking_snapshots` JSONB-skrivinger.** Målt: 198 bytes per spiller
  (12 463 bytes / 63 spillere). Ved 300 spillere blir det **59 KB per skriving**.
  Selv i et 30-minutters burst-scenario blir det ~200–400 skrivinger ≈ 24 MB
  totalt. Dette er *ikke* Disk IO-risikoen fra juli — den kom av at
  cache-nøkkelen var per spørsmål, så cachen aldri traff. Blir relevant igjen
  over ~2000 spillere.
- **Cache-stampede på 10-sekunders-TTL-en.** Ved 300 deltakere er
  forespørselsraten ≤3/s og en rebuild tar ~80 ms → ~0,2 samtidige rebuilds.
  Ingen stampede. TTL-en er ikke for kort.
- **Connection pooling / samtidige Postgres-tilkoblinger.** Appen åpner aldri en
  Postgres-tilkobling. Alt går via PostgREST over HTTPS (`supabaseAdmin`), som
  har sin egen interne pool. Supavisor-grenser er irrelevante her.
- **`attempt_answers` og 1000-radersgrensen.** Tabellen vokser raskest av alle
  (4 500 rader per quiz ved 300 spillere), men alle spørringene mot den er
  enten per forsøk (indeksert), via RPC med aggregering i databasen, eller
  allerede paginert. Ikke et problem.
- **Middleware.** `/api/*` er bevisst ekskludert fra matcheren, så
  token-oppfriskingen påføres ikke API-rutene.

---

## 4. Konkret hva jeg vil gjøre — i rekkefølge

| # | Tiltak | Arbeid | Før annonsering? |
|---|---|---|---|
| 1 | **F1** — nøkle rate-limit på `user_id` for innloggede, heve IP-grensen | 1–2 t | **JA — kritisk** |
| 2 | **F2** — `fetchAllRowsChunked` (eller org-basert oppslag) i `globally-blocked-set` | 1–2 t | **JA — billig** |
| 3 | **S3** — tre `CREATE INDEX CONCURRENTLY` | 0,5 t | Nei, men billig |
| 4 | **F3** — paginer `computeRanks` + `getPlayerStats` | 2–3 t | Rett etter første store quiz |
| 5 | **F3** — paginer de tre per-quiz-stedene | 1–2 t | Når én quiz nærmer seg 700 |
| 6 | **F4** — stemple per batch + `maxDuration` + pacing i `notify-subscribers` | 2–3 t | Når abonnenter > 200 |

**Minimum for å tørre å annonsere: punkt 1 og 2. Til sammen 2–4 timer.**

---

## 5. Det jeg IKKE kunne svare på herfra

- **Supabase compute-størrelse og Disk IO-budsjett.** Kan ikke leses gjennom
  PostgREST. Sjekk Supabase-dashbordet → Settings → Compute and Disk. Er
  instansen fortsatt **Micro** (1 GB RAM), har den lavt IO-baseline med et
  burst-budsjett som tømmes — det passer med Disk IO-problemet i juli. Et
  oppgraderingssteg til Small er den enkleste forsikringen, men målingene over
  gir ingen grunn til å tro at det trengs ved 300.
- **Vercel-plan og funksjonssamtidighet.** Ikke lest. Ved ~16 forespørsler/s
  er det svært usannsynlig å være bindende.
- **Faktisk oppførsel under ekte last.** Den eneste måten å vite sikkert er å
  generere last — som jeg ikke har gjort, etter avtale. Se under.

---

## 6. Om målemetode (så du vet hva som faktisk ble gjort)

Alt her er **lesing**. Jeg kjørte ca. 60 read-only HTTP-forespørsler mot
PostgREST med service-role-nøkkelen: radtellinger, planforsøk (avvist —
EXPLAIN er av) og latensmålinger med 6 kall per spørring. Ingen skriving,
ingen lastgenerator, ingenting som fyrte mot en prod-*rute*.

**Jeg har ikke generert kunstig last, i tråd med grensen i oppdraget.**

Skal du ha et virkelig tall for tåleevne framfor et utledet, er neste steg en
lasttest — og den bør kjøres mot **preview**, ikke prod. Men merk fra CLAUDE.md:
*Preview og Production deler samme Upstash-database og samme nøkkelrom*, så en
lasttest mot preview vil brenne av prod-tellerne for de IP-ene den bruker. Det
må planlegges, ikke improviseres. Si fra hvis du vil at jeg skal sette det opp —
jeg gjør det ikke uten at du sier ja.
