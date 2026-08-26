# QK-KARTLEGGING: RANGERINGSFLATENE

**Dato:** 26. august 2026
**Type:** REN KARTLEGGING — ingen kodeendringer gjort, ingen anbefalinger gitt
**Kartlagt mot:** `9450d9f` (HEAD == `origin/main` ved kartleggingens start)
**Bestilling:** ett ark før noe bygges. Beslutninger tas i chat etterpå.

> **Sikkerhetsstopp: IKKE utløst.** Bestillingen ba om stopp hvis en flate
> sender eksakt plassering eller hele deltakerlisten til noen som ikke skal ha
> den. Alle seks serverrutene som kan gjøre det ble kontrollert
> (`/api/toppliste`, `/api/leaderboard/[id]`, `/api/quiz/[id]/standings`,
> `/api/quiz/[id]/ranking-snapshot`, `/api/org/[slug]/my-placement`,
> `/api/leagues/[id]/leaderboard`). Gatene er på plass server-side i alle
> seks. Detaljer i § 2.7.

---

## 1. STATUSVERIFISERING

### 1a. ORG-SCOPE-TIDSGRENSEN — **URØRT**

Briefen: `.claude/QK_OPPDATERING_ORG_SCOPE_TIDSGRENSE_19AUG.md`, lagt inn av
commit `a688d57` («doc: brief for org-scope-tidsgrensen — blokkert av DATO,
ikke av prioritet»).

| Commit | `git merge-base --is-ancestor <sha> origin/main` |
|---|---|
| `a688d57` (briefen selv) | **ancestor: JA** |
| `fb6eb5a` (tidsgrensen innført) | **ancestor: JA** |
| `986779e` (servedOrgSlug) | **ancestor: JA** |
| `be0603c` (måleskript) | **ancestor: JA** |

De tre siste er FORARBEID som briefen selv omtaler som «allerede ute» — de
beviser ikke at fiksen er bygget.

**Punkt for punkt mot koden:**

| Briefens element | Funn | Sted |
|---|---|---|
| Ventegrense 1500 → **2500 ms** | **IKKE gjort.** Står fortsatt 1500. | `app/leaderboard/[id]/page.tsx:28` — `const SESSION_CHECK_MS = 1500`, brukt på `:319` (`fetchData`) og `:445` (`loadSession`) |
| `decideOrgScopeNotice` / `lib/org-scope-notice.ts` | **FINNES** (forarbeid, `986779e`) | `lib/org-scope-notice.ts`, kalt `app/leaderboard/[id]/page.tsx:1099` |
| `servedOrgSlug` | **FINNES** (forarbeid, `986779e`) | `app/leaderboard/[id]/page.tsx:172` |
| Knapp «Vi fant bedriften din — vis kollegene» | **FINNES IKKE.** Søk etter «vis kolleg», «Vis kolleg», «fant bedriften» over `app/`, `components/`, `lib/` gir NULL treff. | — |
| `TOKEN_REFRESHED` via `onAuthStateChange` som utløser for knappen | **IKKE bygget for dette formålet.** Abonnementet finnes, men kaller kun `loadSession()` når `getSessionIdentity` har endret seg. Ingen kobling til org-scope-gjenoppretting. | `app/leaderboard/[id]/page.tsx:563-567` |

Degraderingslinja som faktisk står i koden er briefens **steg 3** (uendret
ordlyd), med en `window.location.reload()`-knapp merket **«Prøv igjen»** —
altså den varianten briefen eksplisitt plasserte under «Ikke i denne saken».
Se `app/leaderboard/[id]/page.tsx:1136-1148`.

**Konklusjon 1a: URØRT.** Ingen av briefens seks skisse-steg er implementert.
Infrastrukturen briefen hviler på (`servedOrgSlug` + `decideOrgScopeNotice`)
var ute FØR briefen ble skrevet og teller ikke som gjennomføring.

Briefen skrev selv: *«Står den fortsatt åpen mandag 24. august uten at noen har
rørt den, er det en forglemmelse — ikke en nedprioritering.»* I dag er det
26. august, og utløseren (fredagsquizen 21. august gjort opp) har inntruffet.

---

### 1b. RATE-LIMITER-MIGRERINGEN — **QK_1 har rett, QK_0 er utdatert**

De to påstandene:

- **QK_0** (`QK_OPPDATERING_QK0_FULLVERSJON_19AUG_KVELD.md`), datert 19. august:
  - `[S-4]`, linje 134–144: «FEM TUNGE ANONYME RUTER UTEN RATE-LIMIT …
    ranking-snapshot, standings, rival, social-proof har 0 rateLimit-treff.
    Kun live-ranking har (30/60s, in-memory). BLOKKERT AV NØKKELDESIGN.»
  - `[L-5]`, linje 321–327: «live-ranking/route.ts:42,
    rateLimit(rlKey, 30, 60_000), in-memory, IP+quizId … Re-nøkling
    IP→user_id er FORUTSETNING, ikke oppfølging.»
- **QK_1** sier saken ble løst 22. august via `c29d56b`, `8daf475`, `e0f5d97`,
  `32d8b36`.

**Ancestor-test mot `origin/main`:**

| Commit | Melding | Ancestor |
|---|---|---|
| `c29d56b` | fix(rate-limit): nøkle spillestien på bruker-id, ikke IP-adresse | **JA** |
| `8daf475` | live-ranking: rate-limit nøkles på attempt-token, ikke IP (steg 1+2) | **JA** |
| `e0f5d97` | ranking-snapshot: rutens første rate-limit — 60/60s per attempt-token (steg 3) | **JA** |
| `32d8b36` | live-ruter: delt teller i Upstash for live-ranking + ranking-snapshot (steg 4) | **JA** |

**Bekreftelse på de to rutene bestillingen navngir:**

| Rute | Delt teller? | Attempt-nøklet? | Bevis |
|---|---|---|---|
| `/api/quiz/live-ranking` | **JA** — `rateLimitShared` | **JA** — `liveRateLimitKey('live-ranking', {ip, quizId, attemptId, token})` | `app/api/quiz/live-ranking/route.ts:2,4,82-84` |
| `/api/quiz/[id]/ranking-snapshot` | **JA** — `rateLimitShared` | **JA** — `liveRateLimitKey('ranking-snapshot', …)` | `app/api/quiz/[id]/ranking-snapshot/route.ts:2,4,101-103` |

Nøkkelformen: gyldig token → `<rute>:attempt:<attemptId>`, ellers
`<rute>:anon:<ip>` (`lib/live-rate-limit.ts:84-95`). Grenser: live-ranking
30/60 s, ranking-snapshot 60/60 s (`lib/live-rate-limit.ts:43,70`).

**Konklusjon 1b:** QK_0 sine `[S-4]`/`[L-5]` er ikke feil om 19. august — de er
**utdaterte**. Arbeidet ble gjort 22. august og ligger på main. QK_0 er
statusdokumentet som må rettes.

#### Kallstedsliste — én linje per rute

**Lag 2 — delt teller (`lib/rate-limit-shared.ts`), 14 produksjonskallsteder:**

| Kallsted | Nøkkel / grense |
|---|---|
| `lib/admin-actions.ts` (`verifyAdminPassword`) | `admin-login:<ip>`, 5/15 min |
| `app/api/auth/bekreft/route.ts` | IP, 60/60 s (`lib/auth-rate-limit.ts`) |
| `app/auth/callback/route.ts` | IP, 60/60 s |
| `app/api/notifications/subscribe/route.ts` | IP |
| `app/api/org/[slug]/send-reminder/route.ts` | IP |
| `app/api/org/join/[token]/route.ts` | IP |
| `app/api/stripe/checkout/route.ts` | IP |
| `app/api/stripe/org-checkout/route.ts` | IP |
| `app/api/stripe/founders-activate/route.ts` | IP |
| `app/api/stripe/org-founders-activate/route.ts` | IP |
| `app/api/quiz/start-attempt/route.ts` | `playRateLimitKey` → `user:<id>` / `anon:<ip>`, 20/10 min |
| `app/api/quiz/[id]/submit/route.ts` | `playRateLimitKey`, 20/10 min |
| `app/api/quiz/live-ranking/route.ts` | `liveRateLimitKey` → `attempt:<id>` / `anon:<ip>`, 30/60 s |
| `app/api/quiz/[id]/ranking-snapshot/route.ts` | `liveRateLimitKey`, 60/60 s |

(`lib/money-path-alert.ts` og `lib/resend-budget.ts` bruker også
`rateLimitShared`, men som varslings-/budsjettbrems, ikke som rutegate.)

**Lag 1 — per instans (`lib/rate-limit.ts`), 41 produksjonskallsteder:**

`app/api/auth/check-email` · `app/api/codes/redeem` · `app/api/leagues` ·
`app/api/leagues/join` · `app/api/leagues/[id]` ·
`app/api/leagues/[id]/leaderboard` · `app/api/leagues/[id]/members-activity` ·
`app/api/leagues/[id]/reset` · `app/api/leagues/[id]/reset-season` ·
`app/api/org/[slug]/admin-data` · `app/api/org/[slug]/change-plan` ·
`app/api/org/[slug]/dashboard` · `app/api/org/[slug]/delete` ·
`app/api/org/[slug]/league-preference` · `app/api/org/[slug]/leave` ·
`app/api/org/[slug]/reset-season` · `app/api/org/[slug]/send-invite` ·
`app/api/org/[slug]/settings` · `app/api/org/[slug]/weekly-summary` ·
`app/api/org/invites` · `app/api/org/invites/[id]/deactivate` ·
`app/api/org/members/[id]/remove` · `app/api/org/members/[id]/schedule-removal` ·
`app/api/org/my-quiz-times` · `app/api/org/trial-code/validate` ·
`app/api/premium/trial-offer` · `app/api/profile/delete` ·
`app/api/profile/founders-farewell-seen` · `app/api/profile/has-password` ·
`app/api/profile/preferences` · `app/api/profile/premium-status` ·
`app/api/profile/upsert` · `app/api/push/subscribe` · `app/api/push/unsubscribe` ·
`app/api/quiz/[id]/answer-distribution` · `app/api/rivalries` ·
`app/api/rivalries/[id]` · `app/api/stripe/portal` · `app/api/stripe/org-portal` ·
`app/api/stripe/verify-session`

— pluss **`start-attempt`** og **`submit`**, som bruker BEGGE lag
(`PLAY_PRE_AUTH_BURST` 120/60 s in-memory som burst-brems før token-oppslaget,
deretter delt teller).

**Lag 3 — autoritativ telling i `admin_actions` (uendret, overlever kalde
starter):** `lib/redeem-throttle.ts`, `lib/check-email-throttle.ts`,
`lib/org-trial-code-throttle.ts`, `lib/duel-quota.ts`, `lib/invite-quota.ts`.

**Fortsatt uten noen rate-limit:** `/api/quiz/[id]/standings` — bevisst
(1,3 kall/spiller, CDN-forsvar). Merk at QK_0 `[S-4]` også nevnte `rival` og
`social-proof`; de er ikke migrert.

---

## 2. RANGERINGSFLATENE — ÉN RAD PER FLATE

Ni flater rendrer en rangert liste. **Fem ulike radformer** er i bruk:
`ResultsTable` (delt tabell), `qk-top3-row` (delt CSS-klasse på forsiden),
en inline flex-rad uten delt klasse (også forsiden), `OrgCard` sin egen
flex-rad, og kort-per-rad på quiz-resultatskjermen. `SeasonLeaderboard` har i
tillegg to interne radformer i historikk-accordionen.

---

### 2.1 Forsiden — «Månedens toppliste» (topp 3)

| | |
|---|---|
| **Filsti** | `app/page.tsx:1685-1702` (innlogget) og `app/page.tsx:2244-2261` (uinnlogget) |
| **Komponent som rendrer raden** | Ingen — inline `<div>` med rene inline-stiler. Duplisert kode: de to blokkene er tegn-for-tegn like bortsett fra variabelnavnet (`monthlyTop3` vs. `anonMonthlyTop3`). |
| **Datakilde** | `getMonthlyGlobalStandings()` i `lib/monthly-standings.ts` → `season_scores` WHERE `scope_type='global'` AND `scope_id IS NULL`, `closes_at` innenfor inneværende kalendermåned. Paginert via `fetchAllRows`. Aggregert per bruker i JS, sortert DESC på poeng, `.slice(0,3)`. |
| **HVA EN RAD VISER** | `{i+1}.` (løpenummer, ikke rank fra basen) · navn (`truncateName`) · `{totalPoints} p` |
| **Tallformat** | Poeng med suffikset **` p`** (liten p, mellomrom). Ingen quiz-antall, ingen tid. |
| **Plasseringsmarkør** | Løpenummer `1.` `2.` `3.` i `#918f8a`, `fontWeight 600`, `width: 16`. Ingen gullfarge på topp 3, ingen medalje. |
| **Tellepille** | Nei. |
| **Premium-tilstander** | **Ingen.** Samme tre rader for uinnlogget, gratis og Premium. Kortet er offentlig topp-3. |
| **Scopes** | Kun **nasjonalt** (global). Ingen org-/liga-variant av dette kortet. |
| **Paginering** | Ingen — `.slice(0, 3)`. |
| **Tom tilstand** | Seksjonen skjules helt (`monthlyTop3.length > 0 &&`). Ved lesefeil returnerer helperen tom liste og feilen logges (`app/page.tsx:286-289`) — seksjonen forsvinner uten melding. |

---

### 2.2 Forsiden — «Forrige uke — hvem vant?» (topp 3)

| | |
|---|---|
| **Filsti** | `app/page.tsx:2368-2422` |
| **Komponent** | Ingen egen komponent, men bruker de DELTE CSS-klassene `qk-top3-rows` / `qk-top3-row` / `qk-top3-left` / `qk-top3-name` / `qk-top3-right`, definert i `app/page.tsx:830-870`. Samme klasser som `LeagueCard`. |
| **Datakilde** | `getLastQuizTop3()` i `lib/home-top3.ts` → hele attempts-feltet for quizen (paginert), blokkert-gate via `getGloballyBlockedSet`, deretter `rankQuizAttempts({includeGuests:true, requireSubmitted:true})`, `.slice(0,3)`. |
| **HVA EN RAD VISER** | `{i+1}.` · navn — **med kallenavn-avsløring:** har spilleren `nickname`, vises kallenavnet på linje 1 og det ekte navnet i `#918f8a` på linje 2 · `{correct_answers}/{totalQ}` · ` · {sek}s` |
| **Tallformat** | Riktige som brøk `11/15` (ingen mellomrom), tid som `42.3s` (`toFixed(1)` — desimal-PUNKTUM). Nevneren faller til `'?'` hvis spørsmålstellingen mangler. |
| **Plasseringsmarkør** | Løpenummer `1.` i `#918f8a`, **`width: 18`** (merk: 18, mens månedslisten over bruker 16). |
| **Tellepille** | Nei. |
| **Premium-tilstander** | **Ingen.** Vises likt til alle, også uinnlogget. |
| **Scopes** | Kun nasjonalt. |
| **Paginering** | Ingen — `.slice(0, 3)`. HELE feltet hentes før filtrering og slicing (bevisst: en `.limit(3)` før blokkert-gaten ville gitt to navn). |
| **Tom tilstand** | Seksjonen skjules. Lesefeil → `catch` logger og lar lista være tom (`app/page.tsx:345-352`). |
| **Lenke ut** | «Se full toppliste →» → `/leaderboard/{lastQuiz.id}` |

---

### 2.3 Forsiden — `LeagueCard` (liga-topp 3)

| | |
|---|---|
| **Filsti** | `components/LeagueCard.tsx:100-125`, montert `app/page.tsx:1997` |
| **Datakilde** | `getLeagueCardData()` i `lib/league-card-data.ts` — månedens topp 3 fra `season_scores` scope=league; **fallback til rå `attempts`** mens quizen er åpen. |
| **HVA EN RAD VISER** | `{i+1}.` · navn (`truncateName`) · `{value} poeng` — ELLER `{value} riktige` når fallback-grenen er brukt (`selected.fromFallback`) |
| **Tallformat** | Ordet «poeng» skrives helt ut (jf. ` p` på månedslisten). Enheten SKIFTER mellom poeng og riktige avhengig av om quizen er gjort opp. |
| **Plasseringsmarkør** | Løpenummer, `width: 18`. |
| **Tellepille** | Nei. |
| **Premium-tilstander** | Ingen. Liga er lukket rom — kortet vises kun for medlemmer. |
| **Scopes** | Kun **liga**. Ligavelger over kortet når brukeren har flere. |
| **Paginering** | Ingen. |
| **Tom tilstand** | «Ingen har spilt ennå». Ved fallback vises i tillegg hint-linja «Sesongpoeng beregnes når quizen stenger». |

---

### 2.4 Forsiden — `OrgCard` (bedrifts-topp 3 + egen plassering)

| | |
|---|---|
| **Filsti** | `components/OrgCard.tsx:133-172` |
| **Datakilde** | `GET /api/org/[slug]/season-summary` (topp 3, månedens `season_scores` scope=organization) + `GET /api/org/[slug]/my-placement` (egen plassering) |
| **HVA EN RAD VISER** | **Medalje-emoji** 🥇🥈🥉 (`components/OrgCard.tsx:11`) · navn · `{totalPoints} poeng` |
| **Tallformat** | «poeng» skrevet ut, i `#918f8a` (hint-farge). Navnet i `#e8e4dd`. |
| **Plasseringsmarkør** | **Emoji, ikke tall.** Én av to flater i appen som bruker medalje-emoji som markør (den andre er quiz-resultatskjermens topp 3, § 2.9). |
| **Egen plassering** | Egen linje OVER lista: «Du var {rank} av {total} i {quizTitle}» — **eksakt rank, ingen banding**, til alle org-medlemmer uansett Premium. Korrekt per `isClosedRoom`-regelen (org = lukket rom). Rangeringen er scopet til org-medlemmer via `.in('user_id', memberUserIds)` (`app/api/org/[slug]/my-placement/route.ts:97`). |
| **Tellepille** | Nei. |
| **Premium-tilstander** | Ingen paywall. Egen tilstand: **`locked`** (bedriften venter på fornyelse) → hele lista og plasseringslinja skjules, kun teksten «Bedriften venter på fornyelse». |
| **Scopes** | Kun **organisasjon**. |
| **Paginering** | Ingen — `.slice(0,3)` server-side. |

---

### 2.5 `/toppliste` — `SeasonLeaderboard` (scope=global)

| | |
|---|---|
| **Filsti** | `app/toppliste/page.tsx:89` → `components/SeasonLeaderboard.tsx` (1308 linjer) |
| **Komponent som rendrer raden** | **`components/ResultsTable.tsx`** — `components/SeasonLeaderboard.tsx:1250`. Mapperen er `entryToRow()` (`:743`), radlisten bygges av `buildRows()` (`:781`). |
| **API** | `GET /api/toppliste?period=…&scope=…[&scope_id=…][&page=…][&search=…]` |

**Fem faner** (`Period`): `last_quiz` (default) · `month` · `quarter` · `year` ·
`alltime`. Fanevalget ligger i URL-en (`?period=`), ikke i `useState` —
`components/SeasonLeaderboard.tsx:365-371`.

**HVA EN RAD VISER — og formen skifter mellom fanene:**

| | Fanen «Siste quiz» | Fanene måned/kvartal/år/all-time |
|---|---|---|
| Kolonner | `#` · `Navn` · **`Riktige`** · **`Tid`** (4) | `#` · `Navn` · **`Poeng`** · *(ingen tid)* (3) |
| 3. kolonne bærer | `correct_answers` | akkumulert `points` |
| Undertekst i 3. kolonne | ingen | **`{n} quizer`** (`metricSubLabel`, `formatQuizCount`) |
| `showTimeColumn` | `true` | `false` |

Felles for begge former (`entryToRow`): navn = kallenavn hvis satt, ellers
`display_name`; `secondary` = ekte navn når kallenavn brukes; `highlight` når
raden er kalleren; `badge` (krone / flamme / lyn / medalje) fra `assignBadges`;
`clickable` + hint **«Utfordre»** + chevron når duell er mulig;
`trailingLabel: 'Duell sendt!'` etter sending.

**Tallformat:** tid via lokal `formatTime` (`{sek}s`, `toFixed(1)`).
Rank-cellen får klassen `medal` (gull `#c9a84c`, `fontWeight 700`) for rank ≤ 3,
ellers `#918f8a` — `ResultsTable` sin egen regel
(`components/ResultsTable.tsx:262`).

**Tellepille:** **NEI.** `SeasonLeaderboard` sender ikke `title` til
`ResultsTable` og har ingen `sectionCount`-pille over tabellen.

**PREMIUM-TILSTANDER** (bevisst trappemodell, ikke avvik):

| Tilstand | Utfall | Sted |
|---|---|---|
| Uinnlogget | `entries` kuttet til **topp 3** SERVER-side (`capForAnon`, `ANON_TOP = 3`), kun for `scope=global` | `app/api/toppliste/route.ts:156` |
| Innlogget gratis | Topp 10. `userEntry.rank` **grovmalt til 10-båndets start** (`bandRank`) — plass 14 → 11 | `app/api/toppliste/route.ts:144,476` |
| Innlogget gratis, utenfor topp 10 | Ingen plasseringsrad i tabellen; i stedet paywall-kort: «Du er utenfor topp 10. Med Premium ser du din nøyaktige plassering …» + outline-knapp | `components/SeasonLeaderboard.tsx:895-907` |
| Innlogget gratis, > 10 deltakere | Låst kontrollrad i søkefeltets form: «Søk og bla blant alle {n} deltakere» + gull **Premium**-pille, lenker til `/premium` | `components/SeasonLeaderboard.tsx:1174-1184` |
| Premium | Hele lista, eksakt rank, søk + sidenavigasjon, «Gå til min plassering (#N)», egen rad føyd inn i tabellen med separator **«— Din plassering —»** | `lib/season-period-table.ts:77` (`buildPlacementRow`) |
| **Lukket rom (liga ELLER org)** | Behandles som Premium på ALLE tre punktene — ingen banding, ingen paywall-kort, ingen låst rad. `isClosedRoom(scope)` | `lib/leaderboard-scope.ts` |
| Blokkert fra åpen konkurranse | Eget kort med årsak + «Se topplisten hos {org}». `userEntry` finnes (egne tall), men tegnes aldri i den offentlige lista | `components/SeasonLeaderboard.tsx:846-878` |
| Stilling skjult til stengetid | `entries` tømt SERVER-side. Skjerm: «Stillingen er skjult til quizen stenger» + Premium-veien nevnt i brødteksten | `components/SeasonLeaderboard.tsx:1206-1219` |
| `show_leaderboard = false` | «Resultatene er ikke aktivert for denne quizen» — PERMANENT, ingen Premium-vei nevnt | `components/SeasonLeaderboard.tsx:1194-1204` |

**SCOPES — og hvordan scopet avgjøres:** Scopet er en **prop**, ikke URL-avledet
i komponenten:

| Side | Prop | Scope-id |
|---|---|---|
| `/toppliste` | `scope="global"` | — (`app/toppliste/page.tsx:89`) |
| `/liga/[slug]` | `scope="league"` | `league.id`, + `leagueSlug={slug}` (`app/liga/[slug]/page.tsx:401`) |
| `/org/[slug]` | `scope="organization"` | `org.orgId`, + `orgSlug={slug}` (`app/org/[slug]/page.tsx:218`) |

Server-side gates `scope !== 'global'` på verifisert medlemskap (401/403 uten
gyldig token) — `app/api/toppliste/route.ts:249-280`.

**PAGINERING:** Server-side, `page`-parameter, `TOPPLISTE_PAGE_SIZE = 10`
(`lib/leaderboard-page-size.ts:33`). Sideknappene viser **intervall**, ikke
sidenummer: `1–10`, `11–20`, … med `…`-gap
(`components/SeasonLeaderboard.tsx:1264-1279`). Kun for Premium / lukket rom —
`page`/`search` leses **ikke i det hele tatt** serverside for andre
(`app/api/toppliste/route.ts:336-337`).

**Ekstra listeformer i samme komponent — historikk-accordionen**
(«Tidligere quizer» / «Tidligere måneder …»):

- `last_quiz`-varianten: quiz-tittel + **avatar-sirkel (24 px)** + vinnernavn +
  score + lenke «Se toppliste →» (`components/SeasonLeaderboard.tsx:936-966`)
- periode-varianten: klikkbar rad som ekspanderer til topp 10 med enda et
  radformat: `#{rank}` · navn · `{points} poeng`
  (`components/SeasonLeaderboard.tsx:1000-1006`)

---

### 2.6 `/leaderboard/[id]` — quiz-topplisten

| | |
|---|---|
| **Filsti** | `app/leaderboard/[id]/page.tsx` (1804 linjer) |
| **Komponent som rendrer raden** | **`ResultsTable`** — to instanser: klassisk visning via `renderSection()` (`:912`), og premium browse-modus via `renderBrowseList()` (`:1060`) |
| **To mappere** | `attemptToRow()` (`:809`, klassisk) og `browseEntryToRow()` (`:1016`, browse) |
| **API** | `GET /api/leaderboard/[id]?is_team=…[&org=…][&page=…][&search=…]` |

**HVA EN RAD VISER (klassisk, `attemptToRow`):**
`#` (gull ved rank ≤ 3, `=`-suffiks ved delt plassering) ·
navn (kallenavn foran, `(guest)` limt på navnelinja for gjester) ·
`secondary` = **`#007 · Ekte Navn`** (medlemsnummer når `show_member_number`,
punktum-separert med det ekte navnet) ·
`{correct_answers} / {total_questions}` · `{sek}s` + gull-taggen **«delt»** ved
likhet · badge (krone / pil / flamme / lyn / medalje) · «Utfordre» + chevron.

**HVA EN RAD VISER (browse, `browseEntryToRow`):** samme kolonner, men
**`badge: null`**, **ingen medlemsnummer** i `secondary` (kun kallenavn-linja),
og **ingen `tied`-håndtering**.

**Tallformat:** riktige som `11 / 15` (mellomrom rundt skråstreken — fra
`ResultsTable` sin `` ` / ${totalQuestions}` ``), tid som `{sek}s`.

**Tellepille:** **JA.** `s.sectionCount` over hver tabell (`:914` og `:1058`).
Viser `sectionTotal ?? ranked.length`; for «Enkeltpersoner» sendes serverens
`totalCount` inn nettopp fordi trappen gjør `ranked` kortere enn feltet.

**Faner:** «Alle» og **«Blant venner»** (kun når brukeren har liga) — `:1544-1558`.

**Podium-animasjon:** når quizen er stengt får rad 1/2/3 klassene
`podium-row-1/2/3` med forsinkelse 1000/400/0 ms, resten `podium-rest`
(1400 ms) — `:30-40`. Eneste rangeringsflate med bevegelse.

**PREMIUM-TILSTANDER:**

| Tilstand | Utfall | Sted |
|---|---|---|
| Uinnlogget | `entries` kuttet til **3** (`ANON_TOP`) | `app/api/leaderboard/[id]/route.ts:53,356` |
| Innlogget gratis | Kuttet til **10** (`FREE_TOP`) | `app/api/leaderboard/[id]/route.ts:54,356` |
| Premium | `classicLimit` (default 50, tak 200) | `app/api/leaderboard/[id]/route.ts:125,357` |
| Gratis, egen rad | `userRank` **utelates helt** fra svaret; raden beholdes, men `rank` grovmales til `RANK_BAND = 10`-båndets start | `app/api/leaderboard/[id]/route.ts:375-384` |
| Gjest med lagret resultat | `guestRank` = bandet estimat; klienten viser spenn «mellom plass X og Y», og KUN når `totalCount >= 10` (`showSpan`) | `route.ts:420`, `page.tsx:4209` |
| Gratis, > 10 spillere | Låst kontrollrad: «Søk og bla blant alle {n} spillere» + Premium-pille → `/premium` | `app/leaderboard/[id]/page.tsx:966-976` |
| Premium | Søkefelt, sidenavigasjon, «Gå til min plassering (#N)», egen rad med separator «— Din plassering —» | `page.tsx:900-903, 977-1008` |
| `?org=` (lukket rom) | `tierCap = null` — ingen trapp i det hele tatt | `app/api/leaderboard/[id]/route.ts:356` |
| Skjult til stengetid / `show_leaderboard=false` | `entries` tømt; `userEntry`/`userRank`/`guestRank`/`totalCount` består | `app/api/leaderboard/[id]/route.ts:318-335` |
| «Din plassering»-raden i seksjonen | `if (userOutsideVisible && isPremium)` — **ingen `isClosedRoom`-unntak her**, ulikt `SeasonLeaderboard` | `app/leaderboard/[id]/page.tsx:900` |

**SCOPES — og hvordan scopet avgjøres:** Fra **query-parameter**, ikke prop.

- `?org=<slug>` → org-scope. Krever verifisert medlemskap
  (`resolveOrgMembership`); rangeringen begrenses til org-medlemmer, gjester
  droppes, og rank regnes om internt —
  `app/api/leaderboard/[id]/route.ts:137-190`. Headeren viser «Resultater blant
  kollegene dine» via `decideOrgScopeNotice`.
- `?league=<slug>` → **påvirker IKKE datahentingen.** Slugen leses
  (`app/leaderboard/[id]/page.tsx:142`) og brukes KUN til tilbake-lenken nederst
  (`:1770`). Kommentaren over variabelen sier det eksplisitt. Lista er da den
  nasjonale. `/api/leaderboard/[id]` har ingen liga-parameter.
- Uten parameter → nasjonalt.

**PAGINERING:** To mekanismer på samme side.

1. Klassisk: **klient-side** «Vis 10 til» (`visibleSoloCount`, start 10, +10 per
   klikk) — `page.tsx:173,1607`. Utvider innenfor det serveren allerede sendte.
2. Browse (Premium): **server-side**, `BROWSE_PAGE_SIZE = 20` (`page.tsx:130`),
   intervallknapper `1–20`, `21–40`, … Aktiveres først når `roomTotal > 50`
   eller brukeren søker.

Merk: de to sidestørrelsene er **ulike** — 10 på `/toppliste`, 20 her.

---

### 2.7 Kontroll av premium-gatene server-side (sikkerhetsklausulen)

| Rute | Hva som kunne lekket | Status |
|---|---|---|
| `/api/toppliste` | Full liste + eksakt rank | Gatet: `capForAnon` (3), free 10, `bandRank` på `userEntry`. `page`/`search` leses ikke uten `premiumView`. |
| `/api/leaderboard/[id]` | Full liste + eksakt rank | Gatet: `tierCap` 3/10/null, `userRank` utelatt for gratis, `guestRank` bandet, `isBrowse` krever premium. |
| `/api/quiz/[id]/ranking-snapshot` | Eksakt live-rank | Gatet siden `e0f5d97`/P-2: `attemptIsPremium()` (lokal HMAC) → `gatePlacement()`. `rank` er `null` uten premium-krav i tokenet; `low`/`high` er gratisvisningen. |
| `/api/quiz/[id]/standings` | Eksakt rank + navn over/under | Gatet: `gatePlacement` former svaret; `filterSnapshotToPublic` fjerner blokkerte FØR topp-3 og rank regnes. |
| `/api/org/[slug]/my-placement` | Nasjonal rank i org-drakt | Ikke et hull: `.in('user_id', memberUserIds)` scoper rangeringen til org-medlemmer. |
| `/api/leagues/[id]/leaderboard` | Full ligaliste | Medlemskaps-gatet (401 uten token, 403 uten medlemskap). **Ingen klient kaller ruten** — se § 4.16. |

**Ingen funn som utløser stopp.**

---

### 2.8 `/historikk` — brukerens egen quiz-liste

| | |
|---|---|
| **Filsti** | `app/historikk/page.tsx:918-954` |
| **Komponent** | Ingen delt komponent. Egne `<Link>`-rader med `s.rowBase` / `s.rowHover`. |
| **HVA EN RAD VISER** | Venstre: quiz-tittel + meta (dato · «{n} på rad» ved streak > 1). Høyre, tre linjer: **`#{rank} av {total_players}`** · `{correct} av {total} riktige` · `{pct}% · {tid}` |
| **Tallformat** | Riktige skrevet ut med ordene «av» og «riktige» — IKKE brøk. Plassering som `#12 av 68`. Prosent i tillegg — eneste flate som viser prosent. |
| **Plasseringsmarkør** | `#{rank}` i høyre kolonne, ikke i egen rank-kolonne. Ingen gull på topp 3. |
| **Tellepille** | **JA** — `s.sectionCount` over «Tidligere quizer», og den viser `total - 1` fordi det ferskeste forsøket er løftet ut i et eget kort over lista (`:909-916`). |
| **Premium-tilstander** | Hele siden er Premium-gatet. Gratis får låseskjerm: «Historikk, statistikk og nøyaktig plassering krever …» (`:701`). Uten frossen plassering (`rank === null`, f.eks. utmeldt av åpen konkurranse) utelates rank-linja **helt** — ingen reservetekst. |
| **Scopes** | Ingen. Kun brukerens egne forsøk, med den frosne globale ranken fra `season_scores`. |
| **Paginering** | Server-side, `API_PAGE_SIZE = 50`, knapp **«Last inn flere»** (append, ikke sidebytte) — `:962-970`. |
| **Lenke ut** | Hver rad → `/historikk/{attemptId}`. Kortet øverst har i tillegg «Se leaderboard →» → `/leaderboard/{sisteForsok.quiz_id}`. |

---

### 2.9 Andre flater som viser rangering (ikke lister, men samme informasjon)

**`/historikk/[attemptId]`** — `app/historikk/[attemptId]/page.tsx:360-370`.
Ingen liste. Ett stort tall `#{rank}` med etiketten «Plassering», eller en tom
variant når rank mangler. Lenken «Se leaderboard →» er gatet på
`detail.quiz_is_active && detail.quiz_show_leaderboard` (`:417`).

**Quiz-resultatskjermen — «Topp 3 denne uken»** — `app/quiz/[id]/page.tsx:3907-3939`
(og en nesten identisk kopi på `:3060`). **Femte radformat:** hver rad er et
eget kort (`#21242e`, border, radius 12, padding 16×20) med **medalje-emoji**
🥇🥈🥉 (20 px), `player_name` **rått** (ingen kallenavn-preferanse, ulikt alle
andre flater), og `{n} riktig/riktige · {sek}s` i hint-farge. Egen rad får
gull-tonet border. **Ingen rank-tall.** Vises til alle.

**`QuizInterlude`** — `components/QuizInterlude.tsx`. Ingen liste. Gratis ser
spenn (`#31–35`), Premium ser eksakt tall — server-gatet via `gatePlacement`.

**`/liga/[slug]` medlemsoversikt** — `app/liga/[slug]/page.tsx:457-486`.
Ikke rangert (ingen rank-tall), men viser samme felt: navn +
`{totalPoints} poeng · {n} quizer` + aktivitetsprikk + Ekskluder-knapp. Egen
kortrad, ikke `ResultsTable`.

**Admin-flater som bruker `ResultsTable`** (utenfor bestillingens omfang, tatt
med for fullstendighet): `app/admin/quizzes/[id]/results/page.tsx:495` og
`app/org/[slug]/admin/page.tsx:2028`.

---

## 3. NAVIGASJONSKARTET

### 3.1 Alle lenker til en rangeringsflate

| Kildefil : linje | Lenketekst | Destinasjon |
|---|---|---|
| `components/NavAuth.tsx:152` | «Sesongtoppliste» | `/toppliste` (desktop, skjult på mobil) |
| `components/NavAuth.tsx:197` | «Sesongtoppliste» | `/toppliste` (hamburgermeny) |
| `components/NavAuth.tsx:284` | «Sesongtoppliste» | `/toppliste` — gatet på `!globalHidden` |
| `components/NavAuth.tsx:359` | «Sesongtoppliste» | `/toppliste` (hamburger, innlogget) |
| `components/NavAuth.tsx:296` | org-navn | `/org/{myOrgs[0].orgSlug}` |
| `components/NavAuth.tsx:377` | org-navn | `/org/{myOrgs[0].orgSlug}` (hamburger) |
| `components/UserMenu.tsx:278` | (menyvalg) | `/toppliste` |
| `components/RivalryCard.tsx:461` | — | `/toppliste` |
| `components/SiteNav.tsx:86` | tilbake-lenke | `/org/{orgSlug}{backQuery}` |
| `components/OrgCard.tsx:165` | «Se bedriftens toppliste →» | `/org/{orgSlug}` |
| `components/SeasonLeaderboard.tsx:873` | «Se topplisten hos {org}» | `/org/{internalHome.orgSlug}` (blokkert-kortet) |
| `components/SeasonLeaderboard.tsx:944` | «Se toppliste →» | `buildQuizHref(quizId)` — se § 3.4 |
| `app/page.tsx:1722` | «Se topplisten →» | `/leaderboard/{quiz.id}` (aktiv quiz, allerede spilt) |
| `app/page.tsx:1749` | «Se topplisten» | `singleOrgToplistHref ?? /leaderboard/{lastClosedQuizId}` |
| `app/page.tsx:1763` | «Se topplisten» | samme fallback-kjede |
| `app/page.tsx:1865` | — | `/toppliste` |
| `app/page.tsx:1878` | «Sesongtoppliste» | `/toppliste` (snarveiknapp) |
| `app/page.tsx:2103` | — | `/leaderboard/{lastQuiz.id}` |
| `app/page.tsx:2267` | «Ukens resultater ↗» | `/leaderboard/{activeQuiz.id}` (uinnlogget) |
| `app/page.tsx:2301` | «Se topplisten» | `/leaderboard/{lastQuiz.id}` |
| `app/page.tsx:2414` | «Se full toppliste →» | `/leaderboard/{lastQuiz.id}` |
| `app/quiz/[id]/page.tsx:2982` | — | `/leaderboard/{quizId}` |
| `app/quiz/[id]/page.tsx:3107` | «Se ukens resultater» | `/leaderboard/{quizId}` |
| `app/quiz/[id]/page.tsx:3176` | «Se resultatene» | `/leaderboard/{quizId}` |
| `app/quiz/[id]/page.tsx:4509` | «Se topplisten» | `/leaderboard/{quizId}` |
| `app/quiz/[id]/page.tsx:4600` | — | `/org/{orgBox.orgSlug}` |
| `app/quiz/[id]/page.tsx:4619` | — | `/liga/{ligaBox.slug}` |
| `app/quizer/page.tsx:335` | «Ukens resultater →» | `/leaderboard/{quiz.id}` |
| `app/historikk/page.tsx:781` | «Se leaderboard →» | `/leaderboard/{sisteForsok.quiz_id}` |
| `app/historikk/[attemptId]/page.tsx:418` | «Se leaderboard →» | `/leaderboard/{detail.quiz_id}` |
| `app/liga/page.tsx:314` | liga-navn | `/liga/{league.slug}` |
| `app/profil/page.tsx:980` | org-navn | `/org/{org.orgSlug}` |
| `app/leaderboard/[id]/page.tsx:1766` | «Se bedriftstopplisten →» | `/org/{orgSlug}{?hist=1}` |
| `app/leaderboard/[id]/page.tsx:1770` | «Se liga-topplisten →» | `/liga/{leagueSlug}{?hist=1}` |
| `app/leaderboard/[id]/page.tsx:1774` | «Se sesong-topplisten →» | `/toppliste{?hist=1}` |
| `app/leaderboard/[id]/page.tsx:1788` | «Nasjonal toppliste →» | `/toppliste` (blokken «Se også») |
| `app/leaderboard/[id]/page.tsx:1792` | «{org.orgName} →» | `/org/{org.orgSlug}` (én lenke per org) |
| `app/admin/page.tsx:792` | «Toppliste →» | `/leaderboard/{quiz.id}` |

### 3.2 Merknader til navigasjonen

- **Seks ulike ordlyder for samme destinasjon `/leaderboard/{id}`:**
  «Se topplisten», «Ukens resultater», «Se resultatene», «Se full toppliste»,
  «Toppliste», «Se leaderboard». Blandingen «toppliste» / «leaderboard» finnes
  i lenketekst begge veier.
- **`singleOrgToplistHref`** (`app/page.tsx:1560`) omdirigerer «Se topplisten»
  fra quiz-topplisten til org-siden når brukeren er medlem i **nøyaktig én**
  org. To eller null orger ⇒ quiz-topplisten. Samme knappetekst, to ulike
  destinasjoner avhengig av antall medlemskap.
- **Tilbake-lenken fra `/leaderboard/[id]`** er
  `orgSlug ? org : leagueSlug ? liga : toppliste` — tre destinasjoner bak tre
  ordlyder, valgt av query-parameteren.

### 3.3 «SISTE QUIZ» — MISTANKEN BEKREFTET, OG DET ER **FIRE** DEFINISJONER

| # | Definisjon | Spørring | Hvem bruker den |
|---|---|---|---|
| **A** | Nyeste ekte **weekly**-quiz med **minst ett forsøk**, etter `closes_at` DESC. **Krever IKKE at quizen er stengt** — en pågående quiz vinner sorteringen. | `quizzes` + `onlyRealQuizzes` + `.eq('quiz_type','weekly')` + `attempts!inner` + `order('closes_at', desc).limit(1)` — `app/api/toppliste/route.ts:373-382` | Fanen **«Siste quiz»** på `/toppliste`, `/liga/[slug]`, `/org/[slug]` |
| **B** | Nyeste ekte quiz med **`closes_at < now`** (strengt stengt). Krever ikke forsøk. Tillater `weekly` OG `bonus`. | `quizzes` + `onlyRealQuizzes` + `.lt('closes_at', now)` + `order('closes_at', desc).limit(1)` — `app/page.tsx:181-191` | **Forsiden:** «Forrige uke — hvem vant?», og `lastClosedQuizId` bak «Se topplisten»-knappene |
| **C** | Quiz-id-en i URL-en. Ingen utledning i det hele tatt. | `/leaderboard/{id}` | **`/leaderboard/[id]`** — hele siden |
| **D** | Quizen **brukeren sist spilte** — nyeste av brukerens egne `attempts`. | `sisteForsok` i historikk-datasettet | **`/historikk`** sitt «Din siste quiz»-kort → lenken «Se leaderboard →» (`app/historikk/page.tsx:781`) |

**En femte, avledet definisjon i historikk-accordionen:**
`/api/toppliste/history?period=last_quiz` henter de 21 nyeste **stengte** ekte
quizene (`.lt('closes_at', now)`, `onlyRealQuizzes` — altså `weekly` OG
`bonus`) og gjør `.slice(1)` for å hoppe over «den nyeste, som vises i
hovedfanen» (`app/api/toppliste/history/route.ts:99-112`).

Den `.slice(1)` antar at definisjon **A** og definisjon **B** peker på samme
quiz. De gjør det ikke alltid — A godtar en åpen quiz og krever `weekly`, B
krever stengt og godtar `bonus`. To følger, begge utledet av koden:

1. **Mens en quiz er åpen** viser hovedfanen den åpne quizen (A), mens
   historikklista fjerner den nyeste STENGTE (B) — altså forrige ukes quiz, som
   ingen av de to flatene da viser.
2. **En `bonus`-quiz** kan aldri bli «Siste quiz» i hovedfanen (A krever
   `weekly`), men kan godt være raden `.slice(1)` kaster.

**Oppsummert per kallsted:**

| Kallsted | Definisjon |
|---|---|
| `/toppliste` fanen «Siste quiz» (alle tre scopes) | **A** |
| `/toppliste` accordion «Tidligere quizer» | **B**-varianten, minus rad 0 |
| Forsiden «Forrige uke — hvem vant?» | **B** |
| Forsiden «Se topplisten» når ingen quiz er aktiv | **B** (`lastClosedQuizId`) |
| Forsiden «Se topplisten →» når quiz er aktiv og spilt | quiz-id fra det aktive quiz-kortet (**C**-form) |
| `/leaderboard/[id]` | **C** |
| `/historikk` «Se leaderboard →» | **D** |
| `/historikk/[attemptId]` «Se leaderboard →» | **C** (id-en fra forsøksraden) |
| `OrgCard` «Du var {rank} av {total} i {quizTitle}» | **Egen, sjette variant:** første quiz i `.order('created_at', desc).limit(10)` som har minst ett org-medlemsforsøk (`app/api/org/[slug]/my-placement/route.ts:83-92`) — sortert på `created_at`, ikke `closes_at` |
| `LeagueCard` topp 3 | Ikke «siste quiz» — månedens akkumulerte `season_scores`, med fallback til rå `attempts` for den ÅPNE quizen |

### 3.4 Hvordan scope følger med gjennom navigasjonen

`buildQuizHref()` i `components/SeasonLeaderboard.tsx:662-671` er det ene stedet
scope-kontekst bæres videre inn i `/leaderboard/[id]`:

```
scope === 'organization' && orgSlug    →  ?org=<slug>
scope === 'league'       && leagueSlug →  ?league=<slug>
(alltid)                               →  &hist=1
```

`?org=` scoper faktisk dataene. `?league=` gjør det ikke (§ 2.6). Ingen andre
lenker i tabellen i § 3.1 setter `?org=` eller `?league=`.

---

## 4. AVVIKSLISTE

**Kun designforskjeller.** Premium-tilstandene fra § 2 er trappemodellen fra
23. august og står IKKE her. Der en forskjell handler om tilstand og ikke
design, er den merket eksplisitt (§ 4.14).

### 4.1 Fem ulike radformer for samme informasjon

| Form | Flater | Struktur |
|---|---|---|
| `ResultsTable` (`<table>`) | `/toppliste`, `/liga/[slug]`, `/org/[slug]`, `/leaderboard/[id]`, admin-flatene | 3 eller 4 kolonner, `<thead>` med versal-etiketter |
| `qk-top3-row` (flex) | Forsiden «Forrige uke», `LeagueCard` | `rgba(255,255,255,0.02)`-bakgrunn, radius 8, padding 8×12 |
| Inline flex uten delt klasse | Forsiden «Månedens toppliste» | Ingen radbakgrunn, `gap: 6` |
| Egen flex-rad | `OrgCard` | `justifyContent: space-between`, ingen bakgrunn |
| Kort per rad | Quiz-resultatskjermens «Topp 3» | `#21242e` + border + radius 12 + padding 16×20 |

I tillegg to interne radformer i `SeasonLeaderboard` sin historikk-accordion
(avatar-rad og ekspandert `#rank`-rad).

### 4.2 Plasseringsmarkøren har seks former

| Form | Hvor |
|---|---|
| `#`-kolonne, gull ved rank ≤ 3, `=`-suffiks ved delt plass | `ResultsTable`-flatene |
| Løpenummer `1.` i `#918f8a`, **`width: 16`** | Forsiden «Månedens toppliste» |
| Løpenummer `1.` i `#918f8a`, **`width: 18`** | Forsiden «Forrige uke», `LeagueCard` |
| **Medalje-emoji** 🥇🥈🥉, ingen tall | `OrgCard`, quiz-resultatskjermens «Topp 3» |
| `#{rank} av {total}` som høyrestilt tekstlinje | `/historikk` |
| `#{rank}` som stort tall med etikett «Plassering» | `/historikk/[attemptId]` |

De to løpenummer-variantene skiller seg med **2 px** i kolonnebredde, i to kort
som kan stå på samme skjerm.

### 4.3 Tallformatet for «riktige svar» har fire skrivemåter

| Skrivemåte | Hvor |
|---|---|
| `11 / 15` (mellomrom rundt skråstrek) | `ResultsTable` — `/leaderboard/[id]`, admin |
| `11/15` (uten mellomrom) | Forsiden «Forrige uke» |
| `11` (nakent, ingen nevner) | `/toppliste` fanen «Siste quiz» |
| `11 av 15 riktige` | `/historikk` |

`ResultsTable` viser nevneren kun når `totalQuestions` er sendt inn
(`components/ResultsTable.tsx:208`); `SeasonLeaderboard` sender den ikke
(`:1250-1256`), `/leaderboard/[id]` gjør det (`:914`). **Samme komponent, to
ulike rader.**

### 4.4 Tallformatet for «poeng» har tre skrivemåter

- **`12 p`** — forsiden «Månedens toppliste»
- **`12 poeng`** — `LeagueCard`, `OrgCard`, `SeasonLeaderboard` sine ekspanderte
  historikkrader, `/liga/[slug]` medlemsoversikt
- **`12`** nakent under kolonneoverskriften **`Poeng`** — `SeasonLeaderboard`
  sine periodefaner

`LeagueCard` bytter i tillegg **enhet**, ikke bare format: `{n} riktige` i
fallback-grenen, `{n} poeng` ellers.

### 4.5 Tid: samme format, ulik forekomst

Alle fire stedene bruker `(ms/1000).toFixed(1) + 's'`, altså
**desimal-punktum** (`42.3s`), ikke norsk komma. Konsistent på tvers, men i
utakt med norsk tallnotasjon ellers i UI-et.

Tid finnes **ikke** i periodefanene (bevisst, `showTimeColumn={false}`),
**ikke** i `OrgCard`/`LeagueCard`/«Månedens toppliste», men **finnes** i
«Forrige uke», på quiz-resultatskjermen, i `/historikk` og i `ResultsTable` sin
fjerde kolonne.

### 4.6 Tellepille — brukes på to av ni flater, og teller ulike ting

| Flate | Pille? | Hva tallet er |
|---|---|---|
| `/leaderboard/[id]` | **JA** | Serverens `totalCount` (hele feltet), eller `ranked.length` for «Blant venner» |
| `/historikk` | **JA** | `total - 1` (det ferskeste forsøket er løftet ut) |
| `/toppliste`, `/liga`, `/org` (`SeasonLeaderboard`) | **NEI** | — |
| Forsidens tre kort, `OrgCard`, `LeagueCard` | **NEI** | — |
| Quiz-resultatskjermens «Topp 3» | **NEI** | — |

### 4.7 Navnevisningen er ulik på syv flater

| Flate | Kallenavn | Ekte navn | Medlemsnummer |
|---|---|---|---|
| `/leaderboard/[id]` klassisk | linje 1 | i `secondary` | **JA** — `#007 · Ekte Navn` |
| `/leaderboard/[id]` browse | linje 1 | i `secondary` | **NEI** |
| `/toppliste` (alle faner) | linje 1 | i `secondary` | **NEI** |
| Forsiden «Forrige uke» | linje 1 | linje 2 (`#918f8a`) | **NEI** |
| Forsiden «Månedens toppliste» | — | `displayName` fra `season_scores` | **NEI** |
| Quiz-resultatskjermens «Topp 3» | **ignoreres** | `player_name` rått | **NEI** |
| `OrgCard` / `LeagueCard` | — | `displayName` | **NEI** |

Klassisk og browse-visning på **samme side** viser altså ulikt: medlemsnummeret
forsvinner når en Premium-bruker blar forbi rad 50.

### 4.8 Badges finnes på to flater, mangler på en tredje i samme side

| Flate | Badges |
|---|---|
| `/toppliste` (`entryToRow`) | krone / flamme / lyn / medalje, med forklaringsblokk «Hva betyr badgene?» nederst |
| `/leaderboard/[id]` klassisk (`attemptToRow`) | krone / **pil** / flamme / lyn / medalje — **ingen forklaringsblokk** |
| `/leaderboard/[id]` browse (`browseEntryToRow`) | **`badge: null`** — `app/leaderboard/[id]/page.tsx:1035` |

Merkesettene er også ulike: «pil» (mest forbedret) finnes kun på
`/leaderboard/[id]`; terskelen for flammen er `correct_streak >= 5` der, mens
`/toppliste` sin forklaring sier «minst 3 uker på rad».

### 4.9 Sidestørrelse og pagineringsidiom er ulikt på hver flate

| Flate | Metode | Størrelse | Knappetekst |
|---|---|---|---|
| `/toppliste` m.fl. | Server, `?page=` | **10** | Intervall: `1–10`, `11–20`, `…` |
| `/leaderboard/[id]` klassisk | **Klient**, utvider synlig antall | +10 per klikk | **«Vis 10 til»** |
| `/leaderboard/[id]` browse | Server, `?page=` | **20** | Intervall: `1–20`, `21–40` |
| `/historikk` | Server, offset, **append** | **50** | **«Last inn flere»** |
| Forsidens tre kort, `OrgCard`, `LeagueCard` | Ingen | 3 | — |

Tre ulike knappeidiom (intervall / «Vis N til» / «Last inn flere») og tre ulike
sidestørrelser (10 / 20 / 50).

### 4.10 Tomme tilstander — syv ulike svar på «ingen data»

| Flate | Tom tilstand |
|---|---|
| `/toppliste` | Full tom-skjerm: kortblokk uten ikon, tittel + undertekst + outline-knapp «Se ukens quiz →». **Ti tekstvarianter** avhengig av periode, scope og om en quiz er åpen (`components/SeasonLeaderboard.tsx:322-333, 1186-1248`) |
| `/leaderboard/[id]` | Tom-skjerm **med SVG-ikon** (målstrek-flagg), «Ingen resultater ennå» + «Vær den første til å fullføre denne quizen» + lenke «Spill quizen →» (`:1534-1540`) |
| `/leaderboard/[id]` browse | Ren tekstlinje: «Ingen resultater.» / «Ingen treff på «X».» |
| Forsidens tre kort | **Seksjonen forsvinner sporløst.** Ingen tekst, ingen plassholder |
| `LeagueCard` | Tekstlinje «Ingen har spilt ennå» |
| `OrgCard` | Lista rendres tom (ingen tekst). Egen `locked`-tilstand: «Bedriften venter på fornyelse» |
| `/historikk` | Egen skjerm med gull knapp «Finn en quiz» |

Kun `/leaderboard/[id]` bruker ikon i tom tilstand. Kun forsiden svarer med
ingenting.

### 4.11 Sidebredden er 900 px på tre flater, smalere på resten

`/leaderboard/[id]`, `/liga/[slug]` og `/toppliste` bruker `maxWidth: 900`
nettopp fordi de rendrer `ResultsTable` (`app/liga/[slug]/page.tsx:31-35`
dokumenterer begrunnelsen). `/historikk` og forsidens kort ligger i den smalere
gruppen.

### 4.12 Duell-affordansen finnes på to flater, og bruker to ordlyder

«Utfordre» + chevron + `role="button"` finnes i `/toppliste` og
`/leaderboard/[id]` (begge via `computeDuelAffordance`). Forsidens kort,
`OrgCard`, `LeagueCard`, `/historikk` og quiz-resultatskjermens topp 3 har
ingen klikkbare rader.

`trailingLabel` etter sendt duell er **ulik tekst** på de to:
**«Duell sendt!»** i `SeasonLeaderboard` (`:756`), **«Sendt»** i
`/leaderboard/[id]` (`:841`).

### 4.13 Podium-animasjonen finnes kun på én flate

`/leaderboard/[id]` animerer rad 3 → 2 → 1 inn med 0/400/1000 ms forsinkelse når
quizen er stengt. Ingen annen rangeringsflate har bevegelse.

### 4.14 «Din plassering»-raden gates ulikt på de to tabellflatene — ULIK TILSTAND, IKKE ULIKT DESIGN

| Flate | Betingelse |
|---|---|
| `/toppliste` | `state.isPremium \|\| isClosedRoom(state.scope)` — `lib/season-period-table.ts:47-58` |
| `/leaderboard/[id]` | `userOutsideVisible && isPremium` — **ingen `isClosedRoom`-unntak** — `app/leaderboard/[id]/page.tsx:900` |

Tatt med her fordi bestillingen ba om å skille tydelig: **dette er ulik
TILSTAND, ikke ulikt design**, og det er den eneste tilstandsforskjellen i
denne listen. Den peker samme vei som feilklassen `lib/leaderboard-scope.ts`
ble skrevet for å fjerne (liga glemt på fem steder).

### 4.15 `?league=` scoper ikke `/leaderboard/[id]`

Beskrevet i § 2.6 og § 3.4. Klikker et ligamedlem «Se toppliste →» fra
liga-topplistens historikk-accordion, lander de på den **nasjonale** lista, med
en tilbake-lenke som sier «Se liga-topplisten →». Kommentaren i koden
(`app/leaderboard/[id]/page.tsx:139-141`) sier at det er utenfor omfanget av
fiksen som innførte `?org=`. Fakta, ikke forslag.

### 4.16 `/api/leagues/[id]/leaderboard` har ingen klient

Ruten finnes, er medlemskaps-gatet, paginert og oppdatert så sent som
25. august (`f4d4a07`, populasjonsfilteret). Søk over `app/` og `components/`
etter kall til den gir **null treff** — de eneste referansene er ruten selv,
tester, og kommentaren i `lib/real-quiz-population.ts:4`. Liga-topplisten i
UI-et går via `/api/toppliste?scope=league`.

### 4.17 Månedslisten på forsiden er duplisert kode

`app/page.tsx:1685-1702` og `app/page.tsx:2244-2261` er identiske bortsett fra
variabelnavnet. Begge leser samme `shared.monthlyStandings`. Endres den ene
stilen, driver de fra hverandre.

---

## 5. HVA KARTLEGGINGEN IKKE DEKKER

- **Ingen visuell verifisering.** Alt over er lest ut av koden, ikke sett i
  nettleser. Målte piksler, faktisk kontrast og mobil-brytning er ikke sjekket.
- **Ingen prod-måling.** Ingen SQL kjørt, ingen Vercel-logg lest. Påstandene om
  hvilken quiz definisjon A/B velger i dag er utledet av spørringene, ikke
  observert.
- **Admin-flatene** (`/admin/quizzes/[id]/results`, `/org/[slug]/admin`) er kun
  nevnt, ikke kartlagt — de var ikke i bestillingen.
- **Duell- og rivalflatene** (`/utfordring`, `RivalryCard`) er ikke kartlagt; de
  viser to spillere mot hverandre, ikke en rangert liste.
- **§ 4 rangerer ikke avvikene.** Bestillingen ba om fakta uten anbefalinger, og
  rekkefølgen i lista er tematisk, ikke prioritert.
