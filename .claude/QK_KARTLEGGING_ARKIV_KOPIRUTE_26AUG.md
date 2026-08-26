# QK KARTLEGGING — Arkivets kopieringsrute
Vindu: ARKIV-KOPI, 26. august 2026. Ren kartlegging — ingen kodeendringer
utover ÉN karakteriseringstest (`lib/compute-placement.test.ts`, se del 3).

Skjemapåstander i dette dokumentet er verifisert READ-ONLY mot prod
26. august 2026 via PostgREST sin OpenAPI-spesifikasjon
(`GET {SUPABASE_URL}/rest/v1/` med service-nøkkel — `required`-listen per
tabell er NOT NULL-kolonnene, FK-er står i kolonnebeskrivelsene). Ingen
skriving mot prod.

---

## HOVEDKONKLUSJONER (prioritert)

1. **Premisset i bestillingens punkt 1c holder IKKE mot skjemaet:
   `quizzes.opens_at` og `closes_at` er NOT NULL i prod.** «Sett eksplisitt
   til NULL» krever en migrasjon (`ALTER COLUMN ... DROP NOT NULL`) FØR
   kopieringsruten kan bygges slik den er tenkt. NULL er ellers riktig valg:
   PostgREST-/SQL-filtre på `opens_at`/`closes_at` (forsiden, varslingsrutene,
   dødsone-vakten, «kommende quiz») ekskluderer NULL-rader av ren
   sammenlignings-semantikk — arkivquizer faller da STILLE ut av alle
   tidsstyrte flater uten at én leser må endres. Beslutning for Dennis, se
   «Åpne beslutninger» nederst.

2. **Kopiering av spørsmålsrader er OBLIGATORISK — referanser er umulig med
   dagens modell.** `questions.quiz_id` er én enkelt FK mot `quizzes.id`
   (én-til-mange); ingen koblingstabell finnes. Samme spørsmålsrad kan aldri
   tilhøre to quizer. Designvalget «liste med spørsmåls-id-er» er fullt
   mulig (del 5), men betyr alltid: nye rader.

3. **Spilling skriver ALDRI `usage_count`/`last_used_at` — forurensningen
   ligger i KOPIERINGSSTEGET og i den avledede `hit_rate`.**
   `usage_count`/`last_used_at` har nøyaktig tre skrivesteder, alle
   admin-INSERT-veier (del 2). Arkivspilling rører dem ikke. MEN: gjenbrukes
   `classics/copy`-semantikken (kildebump per kopi) i arkivruten, bumper hver
   «spill quiz 47 på nytt» femten kilderader — «minst brukt»-sorteringen ved
   5000 spørsmål ødelegges av populariteten til arkivet. Og `hit_rate` i
   spørsmålsbanken er IKKE en kolonne — den avledes ved lesing fra
   `attempt_answers` matchet på `question_text`, så arkivsvar teller med
   uansett hvor radene peker. Gate-plassering i del 2.

4. **`computePlacement` er ren og har INGEN tom-tilstand: et tomt felt gir
   «nr. 1 av 1».** «Ingen plassering finnes» kan ikke uttrykkes av funksjonen
   — den førsteklasses-tilstanden må bo hos KALLEREN (ikke kall funksjonen /
   ikke vis resultatet). Felt med karakteriseringstest + to mutasjoner (del 3).

5. **Invarianten er holdbar med dagens datamodell** gitt gatene i del 2 og
   NULL-migrasjonen i punkt 1 — ingen STOPP-situasjon. To beslutninger er
   likevel Dennis' (se nederst).

---

## 1. DAGENS KOPIERINGSMEKANIKK

### 1a. `app/api/admin/classics/copy` — BEKREFTET
[app/api/admin/classics/copy/route.ts](../app/api/admin/classics/copy/route.ts)
- Tar `question_id` + `target_quiz_id`, ETT spørsmål per kall (linje 15–18).
- Kopierer feltlisten på linje 22: `question_text, option_a..d,
  correct_answer, correct_answers, explanation, category,
  time_limit_seconds, shuffle_options` (+ leser kildens `usage_count`).
- Ny rad får `quiz_id=target`, `order_index = COUNT+1` (ikke-atomisk, med
  ÉN retry på 23505 mot `UNIQUE(quiz_id, order_index)` — linje 31–57),
  `is_classic: false`, `usage_count: 1`, `last_used_at: now` (linje 44–51).
- BUMPER kildens `usage_count` (+1) og `last_used_at` (linje 60–63). Bekreftet.

### 1b. Ingen ikke-admin quiz-opprettelse — BEKREFTET
Kun to steder i hele repoet oppretter en quiz, begge bak `verifyAdminRequest`:
- [app/api/admin/quizzes/route.ts:38](../app/api/admin/quizzes/route.ts)
  (POST, gate på linje 36)
- [app/api/admin/quizzes/import/route.ts:42](../app/api/admin/quizzes/import/route.ts)
  (gate på linje 22)

Ingen SQL-funksjon i `supabase/migrations/` gjør `INSERT INTO quizzes`
(grep 26. aug: null treff). `scripts/verify-*.mjs` setter inn quizer, men med
service-nøkkel utenfor appen. **Arkivruten blir altså den FØRSTE
ikke-admin-opprettelsen og har ingen gate å arve** — den må selv bygge:
innlogget bruker + premium-sjekk + kvote (del 4).

### 1c. Import-defaults og rå insert — BEKREFTET, med skjerpelse
- Import defaulter `opens_at = nå + 1 t` og `closes_at = nå + 7 d` når body
  utelater dem ([import/route.ts:39–40](../app/api/admin/quizzes/import/route.ts)).
  Den setter dessuten `is_active: true` (linje 51) og
  `quiz_type: body ?? 'weekly'` (linje 59).
- `quizzes/route.ts:38` gjør `insert(body)` RÅTT (mass assignment — samme
  form som `POST /api/admin/codes` hadde før `buildAccessCode()`).
  **Arkivruten skal ikke arve noen av delene**: eksplisitt kolonneliste,
  aldri klientstyrte quiz-felter.
- SKJERPELSE av konsekvensen: «opens_at/closes_at = NULL» er i dag UMULIG —
  begge er NOT NULL (hovedkonklusjon 1). En arkivquiz laget via importveien
  ville ikke bare landet som «Kommende quiz» på forsiden; med `opens_at` i
  varslingsvinduet ville den også blitt plukket av varslingstrappa —
  dødsone-/varslingsoppslagene filtrerer `is_test`/`is_active`, men IKKE
  `quiz_type` ([lib/notify-dead-zone.ts:179–183](../lib/notify-dead-zone.ts);
  kjent åpent punkt fra 25. aug-økten). Med NULL faller den ut av
  `gte/lt(opens_at, …)`-filtrene automatisk.

### 1d. `questions.quiz_id` er NULLBAR — men det endrer ingenting
OpenAPI `required` for `questions`:
`["id","question_text","option_a","option_b","correct_answer","order_index","shuffle_options","usage_count","created_at"]`
— `quiz_id` står IKKE der, altså nullbar. En quiz-løs spørsmålsrad KAN
teknisk eksistere, men ingen kodesti lager en i dag (alle tre INSERT-veiene
setter `quiz_id`), og en slik rad er usynlig overalt utenom bank-GET-en
(`quiz_title: null`). Siden koblingen quiz→spørsmål KUN er `questions.quiz_id`
(ingen mange-til-mange), betyr kopiering uansett NYE spørsmålsrader —
nullbarheten gir ingen referanse-vei.

---

## 2. USAGE_COUNT / LAST_USED_AT / HIT_RATE — hvem skriver hva

### Skrivesteder for `usage_count`/`last_used_at` (KOMPLETT liste)
| Sted | Hva |
|---|---|
| [classics/copy/route.ts:49–50](../app/api/admin/classics/copy/route.ts) | ny rad `usage_count=1`, `last_used_at=now` |
| [classics/copy/route.ts:60–63](../app/api/admin/classics/copy/route.ts) | KILDEBUMP `usage_count+1`, `last_used_at=now` |
| [import/route.ts:85–86](../app/api/admin/quizzes/import/route.ts) | nye rader `usage_count=1`, `last_used_at` |
| [quizzes/[id]/questions/route.ts:53–54](../app/api/admin/quizzes/[id]/questions/route.ts) | ny rad `usage_count=1`, `last_used_at` (kun INSERT-veien; PATCH rører dem aldri — kommentar linje 42–44) |
| Migrasjon `20260726000000_backfill_questions_usage.sql` | engangs-backfill, manuell |

Semantikken er dokumentert i migrasjon `20260725000000`: telles ved INSERT
av spørsmålsRADEN, aldri ved spilling. **Et arkivforsøk med dagens kode
skriver altså IKKE til noen av dem** — spillestien (`start-attempt`/`submit`)
er ikke blant skrivestedene (grep på `usage_count`/`last_used_at` over hele
`app/` + `lib/`: kun filene over).

### `hit_rate` — finnes IKKE som kolonne, avledes ved lesing
[app/api/admin/questions/route.ts:75–113](../app/api/admin/questions/route.ts):
bank-GET-en henter ALLE `attempt_answers` og teller riktig/total per
**`question_text`** — bevisst på tvers av alle radforekomster, fordi hver
gjenbruk lager en ny rad uten slektskap til kilden. `answer_count` samme
kilde. Vises/sorteres i [app/admin/sporsmal/page.tsx](../app/admin/sporsmal/page.tsx)
(`hit_rate_asc`, linje 267–274).

Per-quiz-flatene (`answer-distribution`, admin results/analytics) er nøklet
på quiz-id og påvirkes IKKE av arkivspilling (arkivforsøk har egen quiz-id
og egne spørsmålsrader).

### KONKLUSJON — hvilke steder må gates
1. **Kopieringssteget (vakten bor hos skriveren):** arkivruten må IKKE
   gjenbruke `classics/copy` sin kildebump, og de nye arkivradene bør ikke
   settes med `usage_count=1`-semantikken (de er avspillingskopier, ikke
   «bruk» i bank-forstand). Dette er hele gaten for `usage_count`/
   `last_used_at` — ingen andre skrivesteder finnes, og spilling rører dem
   ikke.
2. **`hit_rate` HAR ingen skriver å gate — den er avledet.** Den reelle
   skriveren er `submit` (setter inn `attempt_answers`), og den KAN ikke la
   være å skrive: spillerens egen fasitgjennomgang trenger radene. Gaten må
   derfor bo hos AVLEDEREN: bank-GET-en må holde arkiv-quizenes
   spørsmålsrader utenfor `idToText`-grunnlaget (svar på arkivkopier faller
   da ut av tekst-statistikken via `if (!text) continue`, linje 98).
3. **Banklisten selv (samme filter løser det):** samme GET returnerer ALLE
   `questions` — hver generert arkivquiz ville ellers lagt N duplikatrader i
   `/admin/sporsmal`. Å filtrere bort spørsmål med `quiz_type='archive'`-
   forelder løser 2 og 3 i én operasjon. (Krever join/oppslag mot `quizzes`
   — quiz-id-listen hentes allerede på linje 58.)

---

## 3. computePlacement — KARAKTERISERINGSTEST (eneste kodeendring)

Funksjon: [lib/ranking-snapshot.ts:172](../lib/ranking-snapshot.ts).
Test: [lib/compute-placement.test.ts](../lib/compute-placement.test.ts) —
7 tester, dokumenterer dagens oppførsel, endrer ingenting i funksjonen.

Felt oppførsel:
- **Ren: JA.** Ingen I/O (modulen importerer `supabase-admin`, men
  `computePlacement` selv rører den aldri), synkron, muterer ikke feltet
  (testet med frosne fixtures), deterministisk.
- **Tomt felt: `{rank: 1, total: 1, low: 1, high: 1, above: null,
  below: null}`** — uansett `playerInPool`. Funksjonen legger ALLTID
  spilleren til i sitt eget «av N»; en tom-tilstand finnes ikke.
  **Designkonsekvens:** «ingen plassering finnes» for genererte arkivquizer
  må håndteres FØR/UTENOM funksjonen — å sende inn et tomt felt gir en
  positiv påstand («nr. 1 av 1»), ikke fravær.
- **Ett-deltaker-felt:** er spilleren raden → 1 av 1 uten naboer; er
  spilleren IKKE raden → estimeres inn, total 2, den ene som `above`/`below`
  etter resultat.
- **Egen rad trukket ut først (publicSnapshot-mønsteret fra blocked-flyten):**
  `self` finnes ikke → estimat-grenen selv med `playerInPool: true`, og
  `total` teller IKKE spilleren (felt på 2 gjenværende gir «2 av 2», ikke
  «av 3»).
- I definitiv gren leses rank fra spillerens EGEN rad (`self.rank`), ikke
  beregnet på nytt. Tid-tiebreak virker kun når spillerens `time > 0`.

Fixture-regelen fulgt: alle rader har distinkte verdier i `rank`,
`correct_answers` og `total_time_ms`; kun tiebreak-testen deler bevisst
`correct_answers` for å isolere tid-feltet.

**Mutasjonsbevis (kjørt 26. aug, begge revertert med `git checkout`):**
- `rank = strictlyBetter.length + 1` → `strictlyBetter.length`:
  4 av 7 tester røde.
- `self.rank` → hardkodet `1` i definitiv gren: «rank leses fra EGEN
  rad»-testen rød.

Full suite etter revert: 2448 pass / 0 fail / 1 skipped (den gatede
`QK_SLOW_TESTS`-testen).

---

## 4. RATE-LIMIT-MØNSTERET — admin_actions-formen arkivruten skal følge

Malen er `duel-quota` (nyest, mest komplett), med `invite-quota` som
org-nøklet variant:

1. **Ren beslutningsfil** med konstanter + `decide*()`-funksjon uten I/O:
   [lib/duel-quota.ts:38–75](../lib/duel-quota.ts) — `DUEL_SENT_ACTION`
   (action_type-konstanten), vindu (`24 t` RULLERENDE, ikke kalenderdøgn),
   tak, og `decideDuelSenderQuota({sentLastDay})` som returnerer
   `{allowed} | {allowed:false, message}`.
2. **Telling i ruten** — `count: 'exact', head: true` mot `admin_actions`
   filtrert på `action_type` + identitet + `gte('created_at', since)`:
   - per bruker: [app/api/rivalries/route.ts:134–139](../app/api/rivalries/route.ts)
     (`.eq('user_id', user.id)`)
   - per org: [app/api/org/[slug]/send-invite/route.ts:161–167](../app/api/org/[slug]/send-invite/route.ts)
     (`.eq('scope_type','organization').eq('scope_id', orgId)`)
3. **FAIL-CLOSED når tellingen feiler:** 503 — «en DB-feil skal ikke være
   omveien rundt grensen» ([rivalries/route.ts:144–150](../app/api/rivalries/route.ts)).
4. **Bokføring ETTER at operasjonen er bekreftet** (etter race-vakten, så et
   rullet-tilbake forsøk ikke koster kvote), én `admin_actions`-rad per
   hendelse med `action_type`/`scope_type`/`scope_id`/`user_id`
   ([rivalries/route.ts:253–261](../app/api/rivalries/route.ts)). Feiler
   bokføringen er kvoten for SLAPP for neste kall — riktig feilretning, men
   skal `console.error`-logges ([send-invite/route.ts:214–224](../app/api/org/[slug]/send-invite/route.ts)).
5. **Billig IP-førstelag** (`rateLimit` in-memory) foran DB-arbeidet.

For arkivruten: nøkle på `user_id` (ruten krever innlogget premium),
egen `action_type` (f.eks. `archive_quiz_created`), `scope_type: 'quiz'`,
`scope_id: <ny quiz-id>`. Ingen migrasjon nødvendig — `admin_actions`
finnes.

---

## 5. DESIGNVALGET «liste med spørsmåls-id-er» — MULIG, betyr kopiering

Datamodellen (verifisert mot prod-OpenAPI 26. aug):
- `questions.quiz_id` → FK `quizzes.id`, ÉN verdi per rad. Ingen
  koblingstabell. **En quiz kan ikke peke på eksisterende spørsmål — radene
  MÅ kopieres.**
- Eneste unike indeks på `questions` er `UNIQUE(quiz_id, order_index)`
  (migrasjon `20260729000000`). Ingen unikhet på innhold — kopier
  kolliderer aldri.
- `attempt_answers.question_id` → FK `questions.id`: arkivforsøkenes svar
  peker da på KOPIENE, aldri på originalens rader — originalquizens
  svarfordeling/resultater forblir bit-for-bit urørt. Dette er
  invariant-støtte, ikke en ulempe.

Ruten blir da: ta `question_ids: string[]` → hent radene → sett inn N nye
rader med `quiz_id = <ny arkivquiz>`, `order_index = 1..N` i listens
rekkefølge (batch-INSERT som importveien — count-racen fra `classics/copy`
finnes ikke her, quizen er ny og privat). Feltlisten å kopiere er den samme
som [classics/copy/route.ts:22](../app/api/admin/classics/copy/route.ts)
(husk BEGGE fasitkolonnene `correct_answer` + `correct_answers` — de skrives
alltid sammen, jf. fasit-regelen i CLAUDE.md) — men UTEN usage-bump og uten
`usage_count=1`-stemplingen (del 2).

«Spill quiz 47 på nytt» = `SELECT id FROM questions WHERE quiz_id=47 ORDER BY
order_index` → samme rute. En generert quiz = 15 id-er fra et filter → samme
rute. Bekreftet.

---

## ÅPNE BESLUTNINGER FOR DENNIS (ikke designet rundt)

1. **Migrasjon `quizzes.opens_at`/`closes_at` DROP NOT NULL.** Uten den kan
   arkivquizer ikke få NULL-tidene designet forutsetter. NULL er
   selv-gatende i alle tidsfiltrerte lesere (forside, varsling, dødsone) —
   men leserne som ANTAR non-null (f.eks. `new Date(quiz.opens_at)`) må
   sveipes i samme runde som migrasjonen. Alternativet (sentinel-datoer)
   ville tvert imot LANDE arkivquizer på de flatene og anbefales ikke.
2. **Bank-/hit_rate-filteret** (del 2, punkt 2–3): skal `/admin/sporsmal`
   og tekst-statistikken ekskludere spørsmål som tilhører
   `quiz_type='archive'`? (Uten dette forurenser arkivspilling
   treffprosenten, og hver generert arkivquiz dukker opp som duplikatrader i
   banken.)
3. Fra 25. aug-økten, gjelder også arkivet: varslingsoppslagene filtrerer
   ikke `quiz_type` — løses implisitt av NULL-`opens_at` (beslutning 1),
   men står ellers åpen.

## UTENFOR OPPDRAGET — ikke rørt
Spillestien for arkivet; `lib/history.ts`/`/historikk`-filtrene;
designharmoniseringen (8234ad5); `is_active`-saken fra tidligere i kveld.
De ucommitede filene fra KARTLEGGING-vinduet (`.claude/launch.json`,
`next.config.ts`, seks QK-FULLVERSJON-filer) er ikke rørt.
