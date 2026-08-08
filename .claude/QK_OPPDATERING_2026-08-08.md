# QK — Oppdatering 8. august 2026

Verifiseringsrunde mot faktisk kode. Bakgrunn: backlogen i QK_4 og
`QK_TEKNISK_GJELD.md` inneholdt punkter som var løst underveis uten at
dokumentene ble oppdatert — timer-saken (10s → 15s) sto som åpen selv om den
ble gjennomført 31. juli. Denne runden gikk gjennom resten.

**Ingen kode er endret.** Alt under er lesing, `grep` og `npm run lint`.

Metode og forbehold:

- Alle verdikter under er verifisert mot kode i repoet på HEAD `8fc0cec`.
- Punkter merket «LØST i prod» hviler på den opprinnelige dokumentasjonens
  egen empiriske verifisering, ikke på min — jeg har ikke hatt
  databasetilgang i denne runden. Der det gjelder, står det eksplisitt.
- Linjenumre er fra 8. august 2026 og drifter.

Speiles inn i det eksterne QK_4 og inn i `QK_TEKNISK_GJELD.md` ved behov.

---

## 1. LØST — kan strykes

### 1.1 Fasit for flervalgsspørsmål med flere riktige svar

Både datakilden og visningen håndterer arrayet. Verifisert hele veien til
skjerm, ikke bare i API-laget:

- [lib/history.ts](../lib/history.ts) linje 646 — `readStoredKey(q)`
- [app/api/quiz/[id]/answer-distribution/route.ts](../app/api/quiz/%5Bid%5D/answer-distribution/route.ts)
  linje 95 og 124 — samme funksjon
- **Visning:** [app/historikk/[attemptId]/page.tsx](../app/historikk/%5BattemptId%5D/page.tsx)
  linje 125 — `correct_answer_texts.join(' / ')`
- **Visning:** [app/leaderboard/[id]/page.tsx](../app/leaderboard/%5Bid%5D/page.tsx)
  linje 1463 — `q.correctAnswers.includes(d.option)` merker hvert riktig
  alternativ i svarfordelingen

### 1.2 Hint-fargen `#7a7873`

Null forekomster i `app/`, `components/`, `lib/`. Eneste treff er en
forklarende kommentar i [lib/welcome-styles.ts](../lib/welcome-styles.ts)
linje 53 om hvorfor den ikke skal brukes.

Sidefunn, ikke et brudd: `#9a9590` finnes 39 ganger, alle i
[lib/email-templates.ts](../lib/email-templates.ts) — e-postbunntekst. Annet
medium og annen bakgrunn enn de mørke flatene kontrastkravet er regnet mot.

### 1.3 Lint

`npm run lint` gir **0 errors, 15 warnings**. De 43 preeksisterende
errorene er borte.

Merk: `next lint` finnes ikke lenger i Next 16 — lint-scriptet i
`package.json` er nå rett `eslint`, så kommandoen er `npm run lint`.

### 1.4 Rute-konflikt `app/api/org/[id]/` vs `app/api/org/[slug]/`

Ingen `[id]`-katalog finnes. Alle fem rutene (`reset-season`,
`members-activity`, `send-invite`, `send-reminder`, `quiz-insights`) ligger
under `app/api/org/[slug]/`.

### 1.5 `season_scores`-spørring i `/api/toppliste` uten `.limit()`

[app/api/toppliste/route.ts](../app/api/toppliste/route.ts) linje 530 bruker
RPC `season_leaderboard_ranked` med LIMIT/OFFSET. JS-fallback finnes fortsatt
(linje 634) hvis RPC-en ikke er deployet.

### 1.6 UPDATE/DELETE-policy på `attempts`

Låst til `service_role` av
`supabase/migrations/20260616175842_attempts_lock_to_service_role.sql`
linje 32.

**Korreksjon til den gamle oppføringen:** teksten tilskrev fjerningen
`20260614000012`. Den migrasjonen dropper INSERT-policyen og DELETE-policyen,
men **ikke** den åpne UPDATE-policyen — den ble opprettet i `20260614000011`
og først droppet i `20260616175842`, en fil med et annet tidsstempelformat.
Resultatet er riktig; henvisningen var det ikke.

### 1.7 Terminologi «Toppliste»

Konsistent: «Sesongtoppliste» for `/toppliste`
([components/NavAuth.tsx](../components/NavAuth.tsx) linje 152, 201, 284,
363), «Ukens resultater» for `/leaderboard/[id]`
([app/quizer/page.tsx](../app/quizer/page.tsx) linje 337 m.fl.).

### 1.8 «Aktiv»-definisjonen i liga-varianten

Liga- og org-rutene er nå identiske. Begge utleder AKTIV av `attempts` med
`submitted_at >= nå − 30 dager` og `is_team = false` — rullerende vindu:

- [app/api/org/[slug]/members-activity/route.ts](../app/api/org/%5Bslug%5D/members-activity/route.ts) linje 169
- [app/api/leagues/[id]/members-activity/route.ts](../app/api/leagues/%5Bid%5D/members-activity/route.ts) linje 168

Notatet om at «liga-varianten har FORTSATT buggen» er utdatert og bør fjernes.

De to andre feltene i samme payload brukes bevisst til noe annet:
`hasPeriodScore` (fra `season_scores`, følger periodefanen) styrer kun
sortering, og `lastActiveAt` (`profiles.last_seen_at`) rører ikke merket.

---

## 2. FORELDET — beskriver et problem i en form som ikke lenger finnes

### 2.1 «Fasit eksponeres til klienten via `select('*')` på questions»

*Sto som HØY prioritet, og som egen seksjon «PROBLEM B — akseptert risiko».*

**Hva som faktisk gjelder nå:** `questions.select('*')` på linje 854-860 i
quiz-siden finnes ikke. Spørsmål hentes ett om gangen via
[app/api/quiz/[id]/questions/route.ts](../app/api/quiz/%5Bid%5D/questions/route.ts),
som kun sender fasiten for spørsmålet spilleren står på. Eneste gjenværende
`select('*')` i filen er på `quizzes`, ikke `questions`
([app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx) linje 1213).

**Restrisiko:** gjeldende spørsmåls fasit sendes fortsatt før spilleren har
svart — bevisst, for at korrekthets-animasjonen skal kunne fyre umiddelbart
([app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx) linje 1760). Den
autoritative scoringen skjer uansett server-side.

Hele «Når dette bør revurderes»- og «Hvis/når det tas opp igjen»-seksjonen er
skrevet mot et problem i en form som ikke lenger finnes. Anbefalt løsning i
dokumentet (B — per-spørsmål server-roundtrip) er i praksis allerede
implementert.

### 2.2 «`/leaderboard/[id]` lastet opptil 2000 attempts-rader klient-side»

*Sto under LØST, kreditert Postgres window-funksjoner via RPC
`quiz_leaderboard_ranked`/`_user_stats`/`_better_count`.*

**Hva som faktisk gjelder nå:** RPC-stien er **bevisst fjernet**.
[app/api/leaderboard/[id]/route.ts](../app/api/leaderboard/%5Bid%5D/route.ts)
linje 13-14:

> `RPC-stien er fjernet bevisst — den dedup'et ikke og ga duplikate rader +
> ulik vinner.`

Rangeringen går nå via `rankQuizAttempts` fra
[lib/ranking.ts](../lib/ranking.ts). Det opprinnelige problemet — 2000 rader
til nettleseren — er fortsatt løst, men ikke av mekanismen dokumentet
beskriver.

Konsekvensen er ikke kosmetisk: se punkt 4.2 under.

---

## 3. ÅPNE — uendret

### 3.1 `/api/toppliste` `last_quiz`-modus mangler `is_test`-filter

[app/api/toppliste/route.ts](../app/api/toppliste/route.ts) linje 250-256 har
`.eq('quiz_type', 'weekly')`, men verken `.eq('is_test', false)` eller
`.eq('is_active', true)`. Linjenummeret har flyttet seg fra ~216 til ~250;
innholdet er uendret.

Bekreftet at den er den eneste avvikeren — alle tre søsterrutene som fyrer på
samme hendelse har begge guardene:

| Rute | Linje |
|---|---|
| `cron/notify-subscribers` | 78-79 |
| `cron/send-reminders` | 104-105, og igjen 229-230 for org-grenen |
| `cron/send-push` | 64-65 |

### 3.2 Analytics-sidens «Endre svar» kollapser multi-fasit

[app/admin/quizzes/[id]/analytics/page.tsx](../app/admin/quizzes/%5Bid%5D/analytics/page.tsx)
linje 532 sender fortsatt `PATCH { correct_answer: <én bokstav> }`, kalt fra
linje 857. Feilmeldingen er fortsatt den generiske «Kunne ikke oppdatere
riktig svar.» — 409-blindveien står uendret.

Fortsatt ikke akutt: prod har ingen spørsmål med flere riktige svar.

### 3.3 «Blant venner»-fanen kan vise brukeren alene

Ingen av de to foreslåtte fiksene er gjort. I
[app/leaderboard/[id]/page.tsx](../app/leaderboard/%5Bid%5D/page.tsx):

- linje 405-420 — `friendNames` samler alle ligamedlemmers `user_id`
  **inkludert brukeren selv**, ingen self-eksklusjon
- linje 646 — `friendAttempts` filtrerer forsøk på de navnene
- linje 648 — `showVennerTab` gater på `friendAttempts.length > 0`, ikke `> 1`

To ting til, som ikke sto i dokumentet:

- Tomtekst-grenen på linje 1381 er praktisk talt uåpnelig — fane-knappen
  krever allerede `length > 0`, og samme betingelse sjekkes på nytt på
  linje 1379.
- Matchingen skjer på `player_name`-**streng**, ikke `user_id`. To brukere
  med likt visningsnavn ville kollidert. Beslektet med det åpne
  `display_name UNIQUE`-funnet.

### 3.4 `/toppliste` full klientside-rendering — DELVIS

Halvparten står, halvparten er adressert.

**Står:** [app/toppliste/page.tsx](../app/toppliste/page.tsx) er fortsatt
`'use client'`. RSC-migrasjonen er ikke gjort.

**Adressert:** premium-waterfallen er borte — status kommer fra delt context
([components/SeasonLeaderboard.tsx](../components/SeasonLeaderboard.tsx)
linje 343, `useProfile()`). Session-ventingen er scope-avhengig (linje 519):

```
const scopedFetchReady = scope === 'global' ? true : sessionChecked
```

Global toppliste — standardstien — fyrer umiddelbart. Kun org/liga venter, og
bevisst (unngår et 401-blaff for ekte medlemmer), med en 1500 ms tidsgrense
lagt til 7. august (linje 406-419).

### 3.5 `qk_attempt_${id}`-cachen mangler version-suffiks

Tre steder uten versjon:
[app/historikk/[attemptId]/page.tsx](../app/historikk/%5BattemptId%5D/page.tsx)
linje 149 og 171, [app/historikk/page.tsx](../app/historikk/page.tsx) linje 337.

Poenget er kontrasten: **søsterkeyen fikk versjonering 4. august** —
`qk_historikk_${CACHE_VERSION}_${uid}`, `CACHE_VERSION = 'v2'`
([app/historikk/page.tsx](../app/historikk/page.tsx) linje 161) — med en
kommentar som forklarer nøyaktig hvorfor. Attempt-keyen i samme filpar ble
ikke tatt med.

Eksponeringen er begrenset av TTL på 10 minutter. Se punkt 4.3 for de to
uten TTL i det hele tatt.

### 3.6 Profilsiden bryter to-gull-regelen — betinget

I hvile er det **ett** gull-element. Bruddet oppstår i én tilstand. I
[app/profil/page.tsx](../app/profil/page.tsx):

- linje 840/842 — `btnOutlineGold`-lenke, én av de to rendres alltid
- linje 871 — `saveBtn` er gullfylt **kun når** `saveBtnDisabled === false`,
  altså når navnet er endret og gyldig

Rediger navnefeltet, og to gull-elementer står på skjermen samtidig.

Lest som knapp/tekstlenke-scoped. Leses regelen bredere, er siden i brudd
uansett tilstand — `sectionLabel`, `badgePremium` og `statsNum` er gull tekst
flere steder.

Sidefunn: `btnGold` (linje 52) er definert og aldri brukt.

### 3.7 Dødkode i org-admin

Begge har null kallsteder, bekreftet uavhengig av lint:

```
599:9  warning  'deactivateInvite' is assigned a value but never used
759:9  warning  'saveSettings' is assigned a value but never used
```

Erstatterne finnes og er i bruk: `renewInvite`
([app/org/[slug]/admin/page.tsx](../app/org/%5Bslug%5D/admin/page.tsx)
linje 625) og `toggleGlobal` (linje 849, auto-lagrer optimistisk).
Kontrollen er at `saveReportTiming` (linje 784) *er* kalt, fra linje 2399.

**Søsken i samme klasse:** `handleGoToMyPlacement` i
[app/leaderboard/[id]/page.tsx](../app/leaderboard/%5Bid%5D/page.tsx)
linje 665 — definert, aldri brukt.

---

## 4. NYE FUNN — sto ikke i noe dokument fra før

### 4.1 Migrasjonsdrift: to sikkerhetsfikser lever kun i prod

De to fiksene datert 30. juli er begge dokumentert som empirisk verifisert
mot produksjon. Men **ingen av dem finnes i `supabase/migrations/`**:

- **RPC-revokene.** Null migrasjonsfiler inneholder `REVOKE ... FROM
  authenticated`. `20260734000000_search_path_hardening.sql` gjør kun
  `ALTER FUNCTION ... SET search_path = ''`, ikke REVOKE-ene.
- **`access_codes`-policyen.** Ingen migrasjon definerer noen policy på
  tabellen overhodet. `20260401000001_rls_policies.sql` linje 85-87 slår kun
  på RLS med kommentaren «No public access. Service role only.» Den åpne
  policyen som ble funnet og droppet 30. juli finnes ikke i noen fil.

**Konsekvens:** et miljø gjenoppbygget fra `supabase/migrations/` ville
reintrodusert begge sårbarhetene. Migrasjonskatalogen er ikke lenger en
troverdig beskrivelse av prod-skjemaet.

Samme driftklasse som den kjente `questions_public`-saken, bare motsatt vei:
der mangler prod noe migrasjonene har, her mangler migrasjonene noe prod har.

Ikke verifisert mot prod i denne runden — jeg hadde ikke databasetilgang.
Verdiktet gjelder migrasjonsfilene.

### 4.2 Paginerings-TODO skjult under et punkt merket LØST

Erstatningen for den fjernede RPC-stien (se 2.2) har en egenskap RPC-en ikke
hadde. [app/api/leaderboard/[id]/route.ts](../app/api/leaderboard/%5Bid%5D/route.ts)
linje 132-136:

> `PostgREST kutter stille ved 1000 rader (db-max-rows) — det gamle
> .limit(5000) gjorde ingenting, og «alle rader» stemmer kun opp til 1000
> attempts per quiz. Spørringen er IKKE beskyttet mot vekst.
> TODO(paginering): bruk fetchAllRows fra lib/paginate.ts.`

RPC-en ga korrekthet ved vekst gjennom LIMIT/OFFSET i databasen.
Erstatningen henter alt i én ubeskyttet spørring. Problemet er reelt, men
ligger begravd under en overskrift merket LØST — altså nettopp der man ikke
leter.

Hører hjemme i den åpne pagineringssaken sammen med de andre stedene.

### 4.3 `qk_progress_` og `qk_result_`: localStorage uten TTL og uten versjon

Verre variant av 3.5. Begge i
[app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx):

| Nøkkel | Skrives | Leses | Innhold |
|---|---|---|---|
| `qk_progress_${quizId}` | linje 1422 | linje 1268 | `{index, answers, totalTime}` |
| `qk_result_${quizId}` | linje 2261 | — | `{correct_answers, total_time_ms}` |

Forskjellen fra `qk_attempt_`: dette er **localStorage, ikke
sessionStorage**, og det er **ingen TTL**. De overlever altså både
fanelukking og deploys, uten øvre levetid.

Lesingen på linje 1268 har ingen formvalidering ut over `try/catch` rundt
`JSON.parse` — en gammel form som fortsatt er gyldig JSON går rett inn i
`setResumeData`.

Jeg har lest skrive- og lesestedene, men ikke revidert hele resume-logikken.

Versjonerte nøkler til sammenligning: `qk_historikk_${CACHE_VERSION}_${uid}`
og `quizkanonen_consent_v1`. De rene flagg-nøklene (`qk_device_id`,
`qk_admin`, m.fl.) er ikke skjemafølsomme og trenger ingenting.

### 4.4 To foreldreløse RPC-funksjoner

Etter at RPC-stien i `/api/leaderboard/[id]` ble fjernet (2.2), har to av de
tre funksjonene fra `20260614000015_quiz_leaderboard_rpc.sql` null kallsteder
i appen:

- `quiz_leaderboard_ranked` — ingen kallere
- `quiz_leaderboard_better_count` — ingen kallere
- `quiz_leaderboard_user_stats` — **fortsatt i bruk**, fra
  [app/api/admin/users/[id]/route.ts](../app/api/admin/users/%5Bid%5D/route.ts)
  linje 76

De to første ligger igjen i databasen som død overflate. Ingen kjent
sikkerhetsrisiko — de var blant de 11 som ble revokert fra `authenticated`
30. juli — men de er vedlikeholdsgjeld, og en framtidig leser vil anta at de
brukes.

### 4.5 To stille stier i `stripe_customer_id`-kjeden gjør loggsøk ukonklusivt

Det finnes fem skrivere av `profiles.stripe_customer_id` i appkoden, pluss to
arkiverte skript:

| Sted | Når | Logger? |
|---|---|---|
| `stripe/checkout` linje 71 | lagret id bekreftet ugyldig → ny kunde | **Ja** — linje 48 eller 58 alltid først |
| `stripe/webhook` linje 447 | `checkout.session.completed`-upsert | Nei, men linje 429 fyrer ved endring |
| `stripe/webhook` linje 1081 | `subscription.updated` active/trialing | Nei — men no-op på kolonnen |
| `stripe/webhook` linje 1089 | `subscription.updated`, **fallback** | **Nei** |
| `stripe/founders-activate` linje 77 | kun når lagret er NULL | **Nei** |
| `scripts/archive/grant-founders-subscription.mjs` linje 120 | manuell kjøring | egen konsoll |
| `scripts/archive/fix-martin-founders-subscription.mjs` linje 119 | manuell kjøring | egen konsoll |

Skrivingene på `webhook` linje 339 og `org-founders-activate` linje 190 går
mot `organizations.stripe_customer_id` — annen kolonne, annen tabell.

**Den strukturelle nøkkelen:** `resolveCustomerId` i
[app/api/stripe/checkout/route.ts](../app/api/stripe/checkout/route.ts) har
én stille utgang, linje 40:

```
if (!storedId) return null
```

Ingen logg. Og når den returnerer null, sender checkout `customer_email` i
stedet for `customer` (linje 156-157) — som får **Stripe til å opprette en
helt ny kunde for den sesjonen**.

Alle `[checkout]`-loggene handler altså om en *lagret id som var ugyldig*.
Tilfellet «det fantes ingen lagret id» — det eneste som faktisk lar Stripe
mynte en fersk kunde — er sporløst.

**Hvorfor det gjør loggsøk etter `OVERSKRIVER` ukonklusivt.** Tre kilder kan
gi `OVERSKRIVER` (webhook linje 429) uten en forutgående `[checkout]`-linje:

1. **`webhook` linje 1089 — fallbacken som visker ut beviset.** Kjører kun når
   `!updatedRows?.length`, altså når ingen profil matchet på
   `stripe_customer_id` — som per definisjon betyr at lagret verdi allerede
   avviker fra hendelsens kunde. Den matcher da på
   `personal_stripe_subscription_id` og skriver `stripe_customer_id`
   **uten sammenligning og uten logg**. Det er reparasjonsmekanismen for
   nøyaktig den tilstanden man leter etter, og den etterlater ingenting.
2. **`founders-activate` linje 77 — den andre stille myntingen.** Skriver kun
   når lagret er NULL (linje 65-67), så den kan ikke overskrive noe selv.
   Men den er den andre ruten som oppretter en Stripe-kunde uten et eneste
   loggpunkt på suksess-stien. Fyrer den og checkout mot samme bruker i
   samme vindu — begge oppretter en kunde når lagret er NULL, ingen av dem
   logger — skriver den ene en id, og webhooken for den andres sesjon ser en
   avvikende lagret verdi.
3. **Arkivskriptene.** Direkte `update` mot profiles, utenom hele kjeden.
   Skrevet nettopp for å rette test-modus-kunder fra før 23. juni.

Motsatt har `OVERSKRIVER` en kjent, lokal årsak når `[checkout]` linje 75 står
rett foran: ny kunde opprettet i Stripe, men lagringen i profiles feilet.
Linje 55 er derimot uskyldig — den returnerer `storedId` uendret og oppretter
ingen ny kunde.

**Praktisk konsekvens:** et treff på `OVERSKRIVER` uten `[checkout]` foran
betyr ikke nødvendigvis en ukjent kilde. Det er like sannsynlig den normale
null-stien pluss `webhook` linje 1089 som rydder opp bak seg. Loggsøket kan
per i dag ikke skille de to.

**Backlog:** hvor loggpunkter måtte ligge for å gjøre de to stille stiene
sporbare, er ikke kartlagt i denne runden — bevisst utsatt.
