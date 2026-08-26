# QK SVEIP — Hva må tåle NULL i quizzes.opens_at / closes_at
Vindu: NONNULL-SVEIP, 26. august 2026. Ren kartlegging — ingen kodeendringer.
Forutsetning: arkivsaken (QK_KARTLEGGING_ARKIV_KOPIRUTE_26AUG.md, 731b383) vil
trenge migrasjonen `ALTER COLUMN opens_at/closes_at DROP NOT NULL`. Dette
dokumentet er sveipet den migrasjonen krever FØR den kan skrives.

Metode: `opens_at|closes_at` grep-et over hele repoet (136 filer traff; docs,
testfiler og `scripts/archive/` holdt utenfor som ikke-runtime), deretter
manuell lesing av hvert kallsted som gjør noe med verdien i JavaScript.
`organizations.org_quiz_opens_at/closes_at` (TIME-kolonnene) er en ANNEN
kolonnefamilie, allerede nullable, og er kun nevnt der de krysser quiz-datoene.

---

## HOVEDKONKLUSJON

**Ingen STOPP-situasjon.** Spillestien (start-attempt, questions, submit,
quiz-siden) håndterer NULL eksplisitt allerede, og SAMTLIGE cron-lesere
(publish-quiz, award-season-points, alle tre varslingsrutene, dødsone-vakten,
weekly-report) ekskluderer NULL-rader av ren SQL-semantikk. Kategori B-funnene
ligger alle på visnings-/leseflater utenfor spillestien og utenfor cron.

Fem funn må håndteres i samme runde som migrasjonen (B1–B5 under), pluss én
produktkonsekvens (B6) og én typeløgn (C1). Resten av kodebasen — over 40
kallsteder — er trygg av seg selv eller allerede NULL-bevisst.

**Den viktige JS-fella som går igjen:** Supabase leverer SQL NULL som `null`,
og `new Date(null)` er IKKE «Invalid Date» — det er epoch,
1970-01-01T00:00:00Z (`null` koerseres til 0; det er `undefined` som gir
Invalid Date). Enhver uguardet `new Date(quiz.closes_at)` tolker altså NULL
som «stengte 1. januar 1970»: `< now` blir sann, `> now` blir usann, og
formatering viser «01.01.1970». Ingen krasj noe sted — feilene er stille
feiltolkninger, i én bestemt retning: NULL ∼ «stengt for lenge siden», som er
det MOTSATTE av den kanoniske lesningen `isQuizClosed()` (lib/standings-cache:
NULL = stenger aldri = åpen).

---

## SPØRSMÅL 1 — Kan en NULL-rad bli «neste quiz» eller «siste quiz»?

**Nei. Begge flater har DOBBELT forsvar, og begge lag holder uavhengig av
hverandre.**

Forsiden (`app/page.tsx`, alle tre oppslagene i `computeSharedHomeData`):
- Aktiv quiz ([app/page.tsx:230](../app/page.tsx)): `.lte('opens_at', nowIso)`
  — `NULL <= now` evaluerer til NULL i SQL, ikke TRUE, så raden filtreres bort.
- Kommende quiz ([app/page.tsx:238](../app/page.tsx)): `.gt('opens_at', nowIso)`
  — samme semantikk; kommentaren på linje 211–213 dokumenterer det eksplisitt.
- Siste stengte ([app/page.tsx:186–187](../app/page.tsx)): `.lt('closes_at', …)`
  + `.not('closes_at', 'is', null)` — belte og bukser i samme spørring.
- Lag to: alle tre er pakket i `onlyRealQuizzes()` (quiz_type-hvitelisten
  `['weekly','bonus']`) — en arkivquiz holdes ute UANSETT hvilke datoer den
  har. Kommentaren i app/page.tsx:215–223 sier det selv: hvitelisten, ikke
  fraværet av tidsstempler, er forsvaret.

/toppliste («siste quiz» — ÉN definisjon siden b195480):
- [lib/last-quiz.ts:93](../lib/last-quiz.ts): `.lt('closes_at', nowIso)` — NULL
  kan ikke tilfredsstille `lt`. Filens egen kommentar (linje 46–51) dokumenterer
  at nettopp dette lukket NULLS-FIRST-hullet der en quiz uten stengetid vant
  `order('closes_at', desc)`.
- I tillegg: `.eq('quiz_type', 'weekly')` + `onlyRealQuizzes()` — arkivtypen
  er ute før datofilteret i det hele tatt vurderes.
- Historikkruten (app/api/toppliste/history) SPØR `fetchLastQuiz` og har sitt
  eget `.lt('closes_at', now)` ([route.ts:103](../app/api/toppliste/history/route.ts))
  — samme dobbeltforsvar.

Merk presiseringen: det er HVITELISTEN som også dekker feilmodusen «arkivquiz
opprettet med ekte datoer» (f.eks. via import-defaultene). NULL-semantikken
dekker feilmodusen «quiz av lovlig type mister datoene». De to lagene fanger
altså hver sin feilklasse — det er derfor begge skal bestå.

---

## SPØRSMÅL 2 — Kan en NULL-rad treffe varslingsvinduet?

**Nei — bevist av spørringsformen, i alle fire oppslagene på hendelsen «en
quiz har åpnet».**

Alle tre varslingsrutene (`notify-subscribers`, `send-reminders`, `send-push`)
går gjennom det DELTE oppslaget `findOpenedQuizToNotify` (verifisert ved
import-grep: [notify-subscribers/route.ts:10](../app/api/cron/notify-subscribers/route.ts),
[send-reminders/route.ts:11](../app/api/cron/send-reminders/route.ts),
[send-push/route.ts:7](../app/api/cron/send-push/route.ts)). Vinduet bor i
[lib/opened-quiz-lookup.ts:187–196](../lib/opened-quiz-lookup.ts):

```
.lte('opens_at', nowIso)        -- opens_at <= now
.gte('opens_at', windowStart)   -- opens_at >= now - 60 min (NOTIFY_WINDOW_MS)
```

I SQL evaluerer `NULL <= x` og `NULL >= x` begge til NULL, og en WHERE-rad
beholdes kun når predikatet er TRUE. En NULL-rad felles altså av BEGGE
predikatene uavhengig av hverandre — det holder at ett av dem finnes. Den kan
heller ikke overleve via `.or(closes_at.is.null, …)`-leddet på linje 194: det
gjelder kun `closes_at` og er en TILLEGGSbetingelse (åpen fortsatt), ikke en
alternativ vei forbi opens_at-vinduet. `order('opens_at', desc)` skjer etter
filtreringen og kan ikke gjeninnføre raden.

Samme form gjelder de to søsteroppslagene på samme hendelse:
- Dødsone-vakten [lib/notify-dead-zone.ts:181–182](../lib/notify-dead-zone.ts):
  `.gte('opens_at', eldsteIso).lt('opens_at', yngsteIso)` — NULL felles av
  begge. Vakten kan altså aldri Sentry-varsle om en arkivquiz, og
  `Date.parse(quiz.opens_at)` på linje 226 ser aldri NULL.
- Org-stengevarsel-grenen i [send-reminders/route.ts:218–219](../app/api/cron/send-reminders/route.ts):
  `.lte('opens_at', now)` + `.gte('closes_at', now)` — NULL felles i begge
  kolonner. Typene `opens_at: string` i disse filene
  (opened-quiz-lookup.ts:48, notify-dead-zone.ts:193, send-reminders:267) er
  dermed sanne BY CONSTRUCTION — se C2.

---

## KATEGORI B — MÅ HÅNDTERE NULL (fiks i samme runde som migrasjonen)

### B1. /leaderboard/[id]-SIDEN — NULL blir «stengt siden 1970», og klient/server spriker
[app/leaderboard/[id]/page.tsx](../app/leaderboard/[id]/page.tsx), tre steder,
alle uguardede fordi `Quiz`-typen (C1) sier feltene alltid finnes:
- Linje 707: `const closed = new Date(quiz.closes_at) < new Date()` — NULL →
  epoch → `closed = true` → podium-animasjonen fyrer på en quiz som aldri
  stenger.
- Linje 759 (`isOpen`): `new Date(q.closes_at) >= now` — NULL → epoch → false
  → `isOpen` alltid usann. Brukt på linje 826:
  `isHidden = hide_leaderboard_until_closed && isOpen(quiz) && …` → klienten
  konkluderer «ikke skjult».
- Linje 1128: `isClosed = new Date(quiz.closes_at) < new Date()` — NULL → true.

Konsekvensen er et PARITETSBRUDD (samme klasse som admin-sesjonsregelen i
CLAUDE.md): serverruten [app/api/leaderboard/[id]/route.ts:314](../app/api/leaderboard/[id]/route.ts)
bruker `isQuizClosed(NULL) = åpen` og TØMMER entries når
`hide_leaderboard_until_closed` er satt — mens klienten samtidig mener quizen
er stengt og derfor IKKE viser «kommer når quizen stenger»-meldingen. Utfallet
er en tom liste uten forklaring. Ingen krasj, ingen Invalid Date — bare to
flater som tolker samme felt motsatt. Kilden er `.select('*')` typet som
`Quiz` (linje 407), så TypeScript varsler ingenting i dag og vil ikke gjøre
det etter migrasjonen heller før C1 rettes.

### B2. /api/quiz/[id]/answer-distribution — NULL tolkes som STENGT, motsatt av isQuizClosed
[route.ts:78](../app/api/quiz/[id]/answer-distribution/route.ts):
`if (new Date(quiz.closes_at) > new Date())` avviser med «Quiz er ikke stengt
ennå». NULL → epoch → betingelsen usann → **fordelingen serveres**. For en
arkivquiz er det trolig ØNSKET utfall (fasitgjennomgang etter eget spill), men
det er et uhell av epoch-koersjonen, ikke et vedtak: enhver framtidig
NULL-quiz som IKKE er arkiv får hele svarfordelingen (inkl. fasit per
spørsmål) eksponert for Premium-brukere fra første sekund, mens quizen «aldri
stenger». Ruten er den ENESTE i repoet der epoch-fella peker i
eksponerings-retning — den må ta et eksplisitt standpunkt til NULL i stedet
for å arve det av koersjonen. (Ikke spillestien: ruten er
fasit-/analyse-lesing bak Premium-gate, ikke start/questions/submit — derfor
ingen STOPP, se vurderingen nederst.)

### B3. /admin/quizzes — «01.01.1970, 01:00» i lista
[app/admin/quizzes/page.tsx](../app/admin/quizzes/page.tsx), importerer
`Quiz`-typen (C1):
- Linje 515 `formatDate = (d: string) => new Date(d).toLocaleString(…)` kalt
  uguardet på linje 697–698 → NULL vises som «01.01.1970, 01:00» i begge
  datokolonnene.
- Linje 512 `isOpen`: NULL → epoch → aldri «åpen» → inline closes_at-editoren
  (linje 704, «kun for åpne quizer») vises ikke for en NULL-quiz. Det betyr
  også at admin IKKE kan sette en stengetid på en arkivquiz fra lista — greit
  eller ikke, det bør være et valg.
- Linje 544/712/723 (`toDatetimeParts`) er derimot trygge: `if (!iso)` fanger
  null. Linje 777 er guardet med `quiz.closes_at &&`.
Kun admin-flate, ingen krasj — men det er visningen Dennis selv bruker.

### B4. /quizer — populasjonen har ingen quiz_type-vakt, og NULL-status er 'åpen'
[app/quizer/page.tsx:218–223](../app/quizer/page.tsx): filtrene er KUN
`is_active=true` + `is_test=false` — ingen `quiz_type`-hviteliste, i motsetning
til forsiden. `getQuizStatus(null, null)` (linje 211–215) er null-trygg og
returnerer **'åpen'** (begge guardene korte ut på falsy). Sorteringen har
eksplisitt `nullsFirst: false`, så NULL-rader legger seg NEDERST. Nettoutfall:
en arkivquiz som ender med `is_active=true` og `is_test=false` LISTES på
/quizer som en åpen quiz uten datolinje, nederst i lista. Ingen krasj — men om
arkivquizer skal på /quizer i det hele tatt er en populasjonsbeslutning som
henger på `is_active`-saken (egen sak, ikke rørt her). Migrasjonsrunden må
enten legge på quiz_type-vakt her eller vedta at visningen er ønsket.

### B5. hide_leaderboard_until_closed + NULL = skjult FOR ALLTID
[app/api/leaderboard/[id]/route.ts:314](../app/api/leaderboard/[id]/route.ts)
(og backstopen i [app/api/toppliste/route.ts:533](../app/api/toppliste/route.ts),
som arkiv riktignok aldri når pga. hvitelisten): `isQuizClosed(NULL) = åpen`
betyr at en NULL-quiz med `hide_leaderboard_until_closed=true` får stillingen
skjult PERMANENT (kun premium-og-har-spilt-unntaket slipper gjennom). Korrekt
per definisjonen «stenger aldri» — men kopieringsruten i arkivsaken må da
eksplisitt sette `hide_leaderboard_until_closed=false` på arkivkopier (eller
la være å kopiere flagget), ellers arver en kopi av en fredagsquiz med flagget
en evig stengt leaderboard-side. Dette er en regel for SKRIVEREN som må inn i
arkivrutens feltliste-beslutning.

### B6. PRODUKTKONSEKVENS — arkivspill blir usynlige i /historikk og statistikk
[lib/history.ts:384–385](../lib/history.ts): tidslinjen bygges av
`.not('opens_at', 'is', null)` + `.lte('opens_at', now)` — bevisst form (delt
med org my-placement, [route.ts:86–87](../app/api/org/[slug]/my-placement/route.ts)).
En NULL-datert arkivquiz faller dermed HELT ut av /historikk, og av
retention-/streak-flatene som bygger på samme filtrerte oppslag
([lib/retention.ts:105](../lib/retention.ts)). Mekanisk er dette kategori A
(ingen feil skjer) — men produktmessig betyr det at et arkivforsøk aldri vises
i spillerens egen historikk. Om det er ønsket («arkivet er lek, ikke
statistikk») eller et hull, er en Dennis-beslutning som hører til arkivsaken.
Udokumentert ville den blitt oppdaget som en «forsvunnet» spilling.

---

## KATEGORI C — TYPESYSTEMET LYVER (etter migrasjonen)

### C1. lib/supabase.ts — DEN typen som må endres
[lib/supabase.ts:40–41](../lib/supabase.ts): `Quiz.opens_at: string` og
`closes_at: string` — ikke nullable. Typen ble utvidet tidligere i kveld
(74256b1, la til `is_test`/`quiz_type`), men datofeltene står som non-null og
blir USANNE i samme sekund migrasjonen kjører. Importører som faktisk BRUKER
datofeltene (grep på `import …Quiz…from '@/lib/supabase'`):
- [app/leaderboard/[id]/page.tsx](../app/leaderboard/[id]/page.tsx) — uguardet
  bruk, se B1. Typen er grunnen til at kompilatoren ikke protesterer.
- [app/admin/quizzes/page.tsx](../app/admin/quizzes/page.tsx) — uguardet
  formatering, se B3.
- [app/quiz/[id]/page.tsx](../app/quiz/[id]/page.tsx) — bruken er reelt gated
  (se A-listen: `new Date(quiz!.opens_at)` på linje 3028/3236 kan kun nås i
  'not-open-yet'-tilstanden, som NULL aldri produserer siden `NaN > now` er
  false i [lib/quiz-availability.ts:56–62](../lib/quiz-availability.ts)) — men
  typen er det ENESTE som lar `new Date(quiz.opens_at)` stå der uten `?`; blir
  typen `string | null`, tvinger kompilatoren fram guardene og dokumenterer
  gatingen.
- [app/admin/quizzes/[id]/analytics/page.tsx:705](../app/admin/quizzes/[id]/analytics/page.tsx)
  — allerede guardet med `quiz?.closes_at &&` (NULL = ikke stengt, samme
  retning som isQuizClosed).
- app/admin/quizzes/[id]/questions/page.tsx — importerer typen, rører aldri
  datofeltene.

### C2. Typer som er sanne BY CONSTRUCTION — ingen endring, men kontrakten bor i spørringen
Disse deklarerer `string` (non-null) og har RETT, fordi spørringen som mater
dem ekskluderer NULL. De skal IKKE endres i migrasjonsrunden — men flyttes
eller mykes filteret, lyver typen fra det øyeblikket:
- [lib/last-quiz.ts:66](../lib/last-quiz.ts) `LastQuiz.closes_at: string` ←
  `.lt('closes_at', nowIso)` (linje 93).
- [lib/weekly-report.ts:36](../lib/weekly-report.ts) ← `.lt` + `.not null`
  (linje 50–51).
- [lib/award-season-points.ts:28](../lib/award-season-points.ts)
  `closes_at: string` ← begge kallerne filtrerer `.lt('closes_at', now)`
  ([publish-quiz:117](../app/api/cron/publish-quiz/route.ts),
  [award-season-points:67](../app/api/cron/award-season-points/route.ts)).
  Verdien skrives videre inn i `season_scores.closes_at`, som er **NOT NULL i
  SQL** (migrasjon 20260419) — kjeden holder fordi arkivquizer aldri gjøres
  opp (se A-listen).
- [lib/opened-quiz-lookup.ts:48](../lib/opened-quiz-lookup.ts)
  `opens_at: string` ← vinduets doble opens_at-predikat (spørsmål 2);
  `closes_at` er allerede `string | null` der.
- [lib/notify-dead-zone.ts:193](../lib/notify-dead-zone.ts) ← gte/lt-vinduet.
- Cast-ene i [toppliste/route.ts:696/819](../app/api/toppliste/route.ts),
  [toppliste/history/route.ts:132/214](../app/api/toppliste/history/route.ts),
  [publish-quiz/route.ts:127/183](../app/api/cron/publish-quiz/route.ts),
  [award-season-points/route.ts:91](../app/api/cron/award-season-points/route.ts),
  [send-reminders/route.ts:267](../app/api/cron/send-reminders/route.ts),
  [rivalries/my/route.ts:144](../app/api/rivalries/my/route.ts) — alle bak
  gte/lt/not-null-filtre i samme fil.

### C3. Allerede riktig typet (`string | null`) — ingen endring
app/page.tsx:41–42 (HomeQuiz), app/quizer/page.tsx:16–17,
app/admin/page.tsx:401, lib/retention.ts:23–24,
app/api/leaderboard/[id]/route.ts:310, app/api/admin/quiz-results-text:43,
app/api/admin/users/[id]:7, app/admin/quizzes/[id]/results/page.tsx:30,
components/SeasonLeaderboard.tsx:114–115, lib/quiz-availability.ts:28,
lib/standings-cache.ts:65. Disse viser at halve kodebasen allerede behandler
feltene som nullable — migrasjonen gjør typene SANNE her, ikke usanne.

---

## KATEGORI A — TRYGT AV SEG SELV (vurdert, ingen endring nødvendig)

### A-i. SQL-filtre som feller NULL av sammenlignings-semantikk
(`.lt/.gt/.lte/.gte(kolonne, verdi)` beholder kun rader der predikatet er
TRUE; NULL-sammenligning gir NULL → raden felles.)

| Sted | Filterform | Merknad |
|---|---|---|
| [app/page.tsx:186–188, 230, 238, 426–428, 535–536](../app/page.tsx) | lt/lte/gt + not-null + hviteliste | Spørsmål 1; dobbelt forsvar |
| [lib/last-quiz.ts:93](../lib/last-quiz.ts) | `.lt('closes_at')` | Spørsmål 1; NULLS-FIRST-hullet alt lukket |
| [app/api/toppliste/route.ts:616–619, 646–647, 824–825](../app/api/toppliste/route.ts) | gt/gte/lt | sort/localeCompare (697, 903) kjører på det filtrerte settet |
| [app/api/toppliste/history/route.ts:103, 241](../app/api/toppliste/history/route.ts) | lt | 241 leser dessuten season_scores (NOT NULL-kolonne) |
| [lib/history.ts:384–386](../lib/history.ts) | not-null + lte | mekanisk trygg — men se B6 |
| [lib/retention.ts:105–108](../lib/retention.ts) | not-null + lte | mater retention/streak; typen alt nullable |
| [lib/weekly-report.ts:50–53](../lib/weekly-report.ts) | lt + not-null | weekly-report/route.ts:75 arver garantien |
| [app/api/cron/publish-quiz/route.ts:86–87, 117, 171–172](../app/api/cron/publish-quiz/route.ts) | lte(opens)/lt+gte(closes) | arkivquizer PURGES aldri og GJØRES ALDRI OPP — sesongpoeng kan ikke lekke inn |
| [app/api/cron/award-season-points/route.ts:67](../app/api/cron/award-season-points/route.ts) | lt | samme garanti som over |
| [lib/opened-quiz-lookup.ts:192–194](../lib/opened-quiz-lookup.ts) | lte+gte(opens_at) | Spørsmål 2 |
| [lib/notify-dead-zone.ts:181–183](../lib/notify-dead-zone.ts) | gte+lt(opens_at) | Spørsmål 2; Date.parse på 226 ser aldri NULL |
| [app/api/cron/send-reminders/route.ts:218–220](../app/api/cron/send-reminders/route.ts) | lte(opens)+gte(closes) | org-grenen; 261–264 har i tillegg egen ugyldig-vakt |
| [app/api/quiz/active/route.ts:19–21](../app/api/quiz/active/route.ts) | lte(opens_at)+or(closes) | arkiv kan aldri bli «aktiv quiz» |
| [app/api/rivalries/my/route.ts:79–81](../app/api/rivalries/my/route.ts) | gte/lt/lte | |
| [lib/league-card-data.ts:41–42](../lib/league-card-data.ts), [lib/monthly-standings.ts:35–36](../lib/monthly-standings.ts) | gte/lt | |
| org-flatene: [season-summary:45–46](../app/api/org/[slug]/season-summary/route.ts), [members-activity:140](../app/api/org/[slug]/members-activity/route.ts), [leagues members-activity:141](../app/api/leagues/[id]/members-activity/route.ts), [admin-data:115–116](../app/api/org/[slug]/admin-data/route.ts), [org admin page:418–419](../app/org/[slug]/admin/page.tsx) | gte/lt | |
| [app/api/org/[slug]/quiz-insights/route.ts:74–76](../app/api/org/[slug]/quiz-insights/route.ts) | lt + not-null | |
| [app/api/admin/dashboard/route.ts:62–64](../app/api/admin/dashboard/route.ts) | not-null + lt | |
| [app/api/org/[slug]/my-placement/route.ts:86–87](../app/api/org/[slug]/my-placement/route.ts) | not-null + lte | delt form med lib/history |
| [app/api/leaderboard/[id]/prev-rank/route.ts:83, 98](../app/api/leaderboard/[id]/prev-rank/route.ts) | guard + `.lt` mot non-null verdi | `if (!current?.closes_at) return` — eksplisitt |
| [app/api/org/[slug]/quiz-scores/route.ts:66–72](../app/api/org/[slug]/quiz-scores/route.ts) | quiz_type='weekly' + hviteliste | RESIDUAL: `order('closes_at', desc)` uten datofilter — DESC er NULLS FIRST i Postgres, så en NULL-datert **weekly/bonus** ville vunnet. Arkivtypen holdes ute av hvitelisten; hullet åpnes kun hvis en hvitelistet type får NULL-datoer |
| [app/org/[slug]/velkommen/page.tsx:210–219](../app/org/[slug]/velkommen/page.tsx) | quiz_type='weekly' + guard 219 | samme residual som over; guarden gjør utfallet «vinduet vises ikke», ikke krasj |

### A-ii. Eksplisitt NULL-håndtering i JS — spillestien er alt NULL-klar
- [app/api/quiz/start-attempt/route.ts:186–201, 253](../app/api/quiz/start-attempt/route.ts):
  `opensAt/closesAt = quiz.x ? … : null`; `null` = «har åpnet» / «stenger
  aldri» (`afterClose` krever `closesAt !== null`). En NULL-quiz er spillbar.
- [app/api/quiz/[id]/questions/route.ts:133–155](../app/api/quiz/[id]/questions/route.ts):
  samme form; NULL passerer aldri stenge-grenen (`closesAt !== null &&`).
- [app/api/quiz/[id]/submit/route.ts:287–298](../app/api/quiz/[id]/submit/route.ts):
  `closesAtMs === null` → hele frist-blokken hoppes over — innsending alltid
  mottatt. Nettopp riktig for «stenger aldri».
- [lib/quiz-availability.ts:53–63](../lib/quiz-availability.ts): NULL → NaN →
  alle sammenligninger usanne → **'open'**, dokumentert som bevisst
  slepphendt paritet med rutene. `lateSubmitDeadline(null)` → null.
  Konsekvens for gatingen: NULL kan ALDRI gi 'not-open-yet' (NaN > now er
  false), så `new Date(quiz!.opens_at)`-visningene i
  [app/quiz/[id]/page.tsx:3028 og 3236](../app/quiz/[id]/page.tsx) (begge kun
  nåbare i 'not-open-yet'-grener, verifisert: 3009/3210) er uoppnåelige for en
  NULL-rad. Øvrige bruk på spillsiden er guardet (2719, 3354–3377) eller
  null-trygge (1428).
- [lib/late-play-window.ts:55–57](../lib/late-play-window.ts):
  `isWithinGrace(null, …)` → false by design, dokumentert («closesAt === null
  betyr at quizen aldri stenger»).
- [lib/standings-cache.ts:65–83](../lib/standings-cache.ts): `isQuizClosed` —
  DEN kanoniske lesningen: NULL/uparsebar = ÅPEN, fail-safe dokumentert.
  Brukt av [standings/route.ts:116](../app/api/quiz/[id]/standings/route.ts)
  (typet `string | null`), [leaderboard-ruten:314](../app/api/leaderboard/[id]/route.ts)
  og [toppliste:533](../app/api/toppliste/route.ts).
- [app/api/admin/quizzes/[id]/results/route.ts:64–68](../app/api/admin/quizzes/[id]/results/route.ts):
  `null` = ingen grense — eksplisitt riktig form.
- [app/api/quiz/social-proof/route.ts:116–117](../app/api/quiz/social-proof/route.ts):
  guardede `if`-er; NULL → attempts-vinduet ubegrenset (kosmetisk: telleren
  omfatter alle forsøk noensinne — for en arkivquiz sannsynligvis riktig).
- [app/api/org/my-quiz-times/route.ts:41–44](../app/api/org/my-quiz-times/route.ts):
  eksplisitt guard MED kommentar om at closes_at er nullable — retur tom.
- [app/api/admin/quiz-results-text/route.ts:149](../app/api/admin/quiz-results-text/route.ts):
  `quiz.closes_at ? … : new Date()` — fallback nå.
- [app/api/admin/users/[id]/route.ts:7, 118](../app/api/admin/users/[id]/route.ts):
  nullable type + `?? null`.
- [app/admin/page.tsx:401, 767–768](../app/admin/page.tsx): nullable type +
  ternary-guards.
- [app/admin/quizzes/[id]/analytics/page.tsx:705](../app/admin/quizzes/[id]/analytics/page.tsx):
  `quiz?.closes_at && new Date(…) < now` — NULL = ikke stengt (riktig
  retning); blokken (resultat-lenken) vises da ikke.
- [components/SeasonLeaderboard.tsx:923, 1112, 1234](../components/SeasonLeaderboard.tsx):
  props typet `string | null` og `&&`-guardet; kildene (toppliste-ruten) er
  dessuten non-null by construction.
- [app/quizer/page.tsx:211–215, 223, 308–311](../app/quizer/page.tsx): koden
  selv er null-trygg (guards + `nullsFirst: false`) — det er POPULASJONEN som
  er B4.
- [app/admin/quizzes/new/page.tsx:981–986, 1059–1060](../app/admin/quizzes/new/page.tsx):
  alle bruk bak truthiness-guards (redigerings-/opprettelsesskjema).

### A-iii. SQL-siden
- `season_scores.closes_at` er en EGEN kolonne, **NOT NULL** (migrasjon
  `20260419_season_scores.sql:18`), og skrives kun av `processQuiz()` for
  quizer som alt har passert `.lt('closes_at', now)`-filtrene. Alle
  RPC-ene i `20260614000014_season_leaderboard_rpc.sql` leser
  `ss.closes_at` (season_scores), aldri `quizzes` — migrasjonen på quizzes
  rører dem ikke.
- `20260825000000_rpc_real_quiz_population.sql` (weekly_active_players,
  count_active_players_since): grep gir NULL treff på opens_at/closes_at —
  de teller på spillaktivitet + quiz_type, ikke på datofeltene.
- Partial-indeksen `(season_points_awarded, closes_at)` (20260419:73) er
  uproblematisk — NULL-rader indekseres bare aldri opp mot lt-filtrene.
- `scripts/verify-*.mjs` og `scripts/archive/` er engangs-serviceverktøy med
  service-nøkkel, ikke runtime — holdt utenfor kategoriseringen.

---

## STOPP-VURDERING (kriteriet fra bestillingen)

Kriteriet var: kategori B i SPILLESTIEN eller i en FREDAGS-CRON → stopp og
spør. Ingen av delene inntraff:
- Spillestien (start-attempt, questions, submit, quiz-siden,
  quiz-availability, late-play-window) håndterer NULL eksplisitt og riktig —
  hele familien er kategori A-ii. En NULL-quiz er spillbar og leverbar uten
  én endring.
- Alle cron-lesere (publish-quiz, award-season-points, notify-subscribers,
  send-reminders, send-push, weekly-report, dødsone-vakten) er kategori A-i —
  NULL-rader kan ikke nå dem, bevist av spørringsformene i spørsmål 2 og
  A-tabellen.
- B2 (answer-distribution) er nærmest grensen: den ligger i quiz-OPPLEVELSEN
  (fasitgjennomgang), men ikke i spillestien slik den er definert i repoet
  (start/questions/submit), den krasjer ikke, og feilretningen for
  arkiv-tilfellet sammenfaller med ønsket oppførsel. Vurdert som
  dokumentasjonssak → inn i migrasjonsrunden, ikke chat-stopp.

## HVA MIGRASJONSRUNDEN MÅ INNEHOLDE (oppsummert, ikke designet)
1. `ALTER COLUMN ... DROP NOT NULL` (selve migrasjonen — Dennis-beslutning 1
   fra arkivkartleggingen).
2. C1: `lib/supabase.ts` → `string | null` på begge feltene, og fikse
   kompilatorfeilene det utløser (som ER B1/B3-stedene — typen tvinger fram
   guardene).
3. B1: leaderboard-siden over på `isQuizClosed`-semantikk (NULL = åpen), i
   paritet med serverruten.
4. B2: answer-distribution tar eksplisitt standpunkt til NULL.
5. B3: admin-lista viser «—» (el.l.) i stedet for epoch, og et bevisst valg
   for isOpen/redigering.
6. B4: quiz_type-vakt på /quizer, eller vedtak om at arkiv skal listes der.
7. B5: regel i arkiv-KOPIERINGSRUTEN: `hide_leaderboard_until_closed` skal
   ikke arves som true på NULL-daterte kopier.
8. B6: Dennis-beslutning: skal arkivspill synes i /historikk? (I dag: nei,
   automatisk.)

## UTENFOR OPPDRAGET — ikke rørt
Migrasjonen selv; detaljerte kodeendringer; `is_active`-saken (B4 peker på
den, men saken står urørt); andre arkivspørsmål. De ucommitede filene fra
KARTLEGGING-vinduet (.claude/launch.json, next.config.ts, seks
QK_FULLVERSJON-filer) er ikke rørt.
