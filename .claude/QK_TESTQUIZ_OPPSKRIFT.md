# QK — Testquiz-oppskrift (opprett og rydd)

Opprettet 5. august 2026. Kjørt og verifisert på nytt 24. august 2026 (hele
runden: opprettelse, forhåndstelling, sletting, kontrolltelling — alle tall
matchet). Seksjon 3 og 5 ble rettet samme dag; se de to merkelappene der.

Gjenbrukbar SQL for å opprette en testquiz i databasen, spille den gjennom i
nettleseren (browser-verifisering), og rydde den bort igjen etterpå uten å
etterlate rader.

**Hvorfor dette dokumentet finnes:** mangelen på en testquiz har blokkert
browser-verifisering to ganger — senest N1 (finishQuiz-timeout, 5. august).
SQL-en ble skrevet ad hoc begge ganger, og ryddespørringen feilet den andre
gangen fordi `played_log` manglet i slettesekvensen:

```
ERROR: 23503: update or delete on table "quizzes" violates foreign key
constraint "played_log_quiz_id_fkey" on table "played_log"
```

---

## 1. Fremmednøkler mot `quizzes.id` — komplett liste

Kartlagt 5. august 2026 mot **prod**, ikke mot migrasjonsfilene. Grunnen:
bare tre av de seks tabellene er opprettet via en migrasjon i
`supabase/migrations/` (`ranking_snapshots`, `season_scores`,
`quiz_notification_log`) — resten ble opprettet direkte i Supabase-dashbordet
og finnes ikke i noen `.sql`-fil i repoet. Et grep etter
`REFERENCES public.quizzes` finner altså bare halvparten, og det var nettopp
den halvparten som manglet i den feilende ryddespørringen.

Kilden som faktisk er komplett er PostgREST sin OpenAPI-rot
(`GET /rest/v1/` med `Accept: application/openapi+json`), som annoterer hver
kolonne med `<fk table='...' column='...'/>`. Samme teknikk som ble brukt til
å lese `organizations`-skjemaet 4. august.

### Direkte fremmednøkkel til `quizzes.id` — 6 tabeller

| Tabell | Kolonne |
|---|---|
| `attempts` | `quiz_id` |
| `played_log` | `quiz_id` |
| `questions` | `quiz_id` |
| `quiz_notification_log` | `quiz_id` |
| `ranking_snapshots` | `quiz_id` |
| `season_scores` | `quiz_id` |

### Indirekte — må slettes FØR de to den henger på

| Tabell | Kolonner |
|---|---|
| `attempt_answers` | `attempt_id → attempts.id`, `question_id → questions.id` |

`attempt_answers` har ingen `quiz_id` i det hele tatt. Den henger på BEGGE de
to tabellene som har det, og må derfor slettes først uansett hvilken rekkefølge
man ellers velger.

### Myk referanse — ingen fremmednøkkel, men holder likevel en quiz-id

| Tabell | Kolonne |
|---|---|
| `quiz_notifications` | `notified_quiz_id` |

**Denne blokkerer ikke slettingen**, fordi det ikke finnes noen
fremmednøkkelbeskrankning på kolonnen. Den blir stående og peke på en quiz som
ikke lenger finnes. Uskadelig i praksis (feltet brukes kun til å hindre at
samme e-postadresse varsles to ganger om samme quiz), men verdt å vite: et
`DELETE FROM quizzes` gir deg ikke en garanti om at ingen rad noe sted nevner
id-en. Oppskriften under nullstiller den eksplisitt.

**Ikke stol på ON DELETE CASCADE.** De tre migrasjonsdefinerte tabellene har
`ON DELETE CASCADE`, men `played_log` beviselig ikke — det var hele feilen over.
Slett alle sju barnetabellene eksplisitt, i rekkefølgen under. Da spiller det
ingen rolle hva den enkelte beskrankningen er satt til.

---

## 2. Opprettelse

Kjøres i Supabase SQL Editor (service_role — RLS gjelder ikke der).

Alt henger på markøren `is_test = true` OG tittelprefikset `[TEST]`.
Ryddespørringen i del 3 finner quizen på nøyaktig de to feltene, så du slipper
å lime inn en UUID åtte steder — og en skrivefeil kan ikke treffe en ekte quiz.

```sql
-- ── Opprett testquiz ────────────────────────────────────────────────────────
insert into public.quizzes (
  title, description,
  opens_at, closes_at,
  is_test, quiz_type, season_points_awarded, is_active,
  num_options, time_limit_seconds,
  show_leaderboard, hide_leaderboard_until_closed, show_live_placement
) values (
  '[TEST] Browserverifisering', 'Midlertidig testquiz. Slettes etter bruk.',
  now() - interval '1 hour',
  now() + interval '7 days',
  true, 'test', true, true,
  4, 15,
  true, false, true
);

-- ── Spørsmål ────────────────────────────────────────────────────────────────
-- order_index er 1-basert og har en UNIQUE-indeks per quiz
-- (20260729000000_questions_order_index_unique.sql) — ikke gjenbruk et tall.
insert into public.questions (
  quiz_id, question_text,
  option_a, option_b, option_c, option_d,
  correct_answer, correct_answers,
  order_index, category, time_limit_seconds, explanation
)
select
  z.id, v.question_text,
  v.option_a, v.option_b, v.option_c, v.option_d,
  v.correct_answer, v.correct_answers,
  v.order_index, 'Allmennkunnskap', 15, v.explanation
from public.quizzes z
cross join (values
  ('Hva er hovedstaden i Norge?',
   'Bergen','Oslo','Trondheim','Stavanger',
   'B', null::text[], 1, 'Oslo har vært hovedstad siden 1814.'),
  -- Multi-svar: BEGGE fasitkolonnene settes. Se avsnittet under.
  ('Hvilke av disse er primtall?',
   '9','11','15','13',
   'B', array['B','D'], 2, 'Både 11 og 13 er primtall. 9 = 3x3 og 15 = 3x5.'),
  ('Hvor mange kontinenter finnes det?',
   'Fem','Seks','Sju','Åtte',
   'C', null::text[], 3, 'Sju etter den vanligste inndelingen.')
) as v(question_text, option_a, option_b, option_c, option_d,
       correct_answer, correct_answers, order_index, explanation)
where z.title = '[TEST] Browserverifisering' and z.is_test = true;
```

**Tidsgrensen kan settes opp når testen krever manuelle steg underveis.**
`time_limit_seconds` over (15 s, både på quizen og per spørsmål) er kalibrert
for en vanlig gjennomspilling. Skal du rekke å åpne DevTools, lime inn en
snutt eller endre noe i basen mens et spørsmål står på skjermen, er 15 sekunder
for kort — sett 120 i begge feltene i stedet. Det påvirker ingenting annet:
`applyAnswerTimeIntegrity` bruker grensen kun som TAK per svar.

Hent id-en til bruk i URL-en (`/quiz/<id>`):

```sql
select id, title, opens_at, closes_at
from public.quizzes
where title = '[TEST] Browserverifisering' and is_test = true;
```

### Multi-svar-spørsmål

Skal du teste et spørsmål med flere riktige svar, settes BEGGE kolonnene
sammen — aldri én av dem alene:

```sql
correct_answer  = 'B',            -- første riktige svar
correct_answers = array['B','D']  -- hele fasiten
```

Dette er samme invariant som `lib/answer-key-correction.ts` (`readStoredKey`)
og fasit-regelen i `.claude/CLAUDE.md`: `correct_answers[]` vinner når den har
innhold, ellers faller alt tilbake på enkeltkolonnen. Setter du bare arrayet,
er `correct_answer` NOT NULL-brutt; setter du bare enkeltkolonnen, blir det
et vanlig enkeltsvars-spørsmål.

Merk at prod per 5. august 2026 har **0 av 195 spørsmål** med mer enn ett
riktig svar (talt direkte mot databasen samme dag) — en testquiz er eneste
måten å faktisk se multi-svar-stiene i nettleseren.

---

## 3. Hvorfor hvert felt er satt som det er

Fire felt er ikke kosmetikk. Hvert av dem holder testquizen unna én konkret
kodesti som ellers ville behandlet den som en ekte fredagsquiz.

### `is_test = true` — holder varslings-cronene unna

**Rettet 24. august 2026.** Her sto det tidligere at `send-reminders` og
`send-push` filtrerer «hver for seg» på oppgitte linjenumre, og
`notify-subscribers` var ikke nevnt i det hele tatt — nettopp ruten som
5. august sendte «Ukens quiz er klar — [TEST – ikke ekte] …» til
påmeldingslisten. Begge deler er nå feil beskrivelse av koden.

Filteret ligger ikke lenger inline i noen av rutene. Det bor i ÉN delt helper,
`findOpenedQuizToNotify` i `lib/opened-quiz-lookup.ts` (linje 187–196), som har
begge vaktene:

```
.eq('is_test', false)
.eq('is_active', true)
```

**Alle tre varslingsrutene kaller den**, og gjør ingen egen quiz-spørring for
åpningsvarselet:

| Rute | Kallsted |
|---|---|
| `notify-subscribers` | route.ts:57 |
| `send-push` | route.ts:54 |
| `send-reminders` | route.ts:88 |

Vakten er plassert i helperen med vilje, ikke hos kallerne — kommentaren der
sier det rett ut: et nytt kallsted skal ikke kunne glemme den. Samme
sink-prinsipp som escapingen i `lib/email-templates.ts`.

**`send-reminders` har et ANDRE quiz-oppslag** (route.ts:213–222), til
org-stengepåminnelsen. Det er en helt egen spørring — aktiv nå, sortert
`closes_at` stigende — med sitt eget `.eq('is_test', false)` og
`.eq('is_active', true)`. Den er den skarpeste kanten i hele oppsettet: en
testquiz opprettet etter oppskriften er åpen i sju dager, altså nøyaktig en rad
den spørringen plukker, og en testquiz som stenger FØR den ekte quizen ville
vunnet sorteringen. Filteret står der, men et framtidig oppslag med samme form
må huske det.

Uten dette flagget ville en testquiz utløst **ekte e-post og push til ekte
abonnenter**. Dette er det ene feltet der en glipp er synlig for kunder.

### `quiz_type = 'test'` — holder quizen ute av toppliste-forsiden

`app/api/toppliste/route.ts` sin `last_quiz`-modus (linje 216–218) velger
nyeste quiz slik:

```
.from('quizzes').select(...).eq('quiz_type', 'weekly').order('closes_at', desc)
```

Den filtrerer på `quiz_type`, **ikke** på `is_test`. En testquiz med
`quiz_type='weekly'` og en `closes_at` nyere enn forrige ekte fredagsquiz ville
altså overtatt «Siste quiz»-fanen på topplista for alle besøkende. `'test'` er
det som faktisk holder den ute — `is_test` gjør ingenting her.

### `season_points_awarded = true` — holder sesong-cronen unna

`app/api/cron/award-season-points/route.ts` (linje 18–21) henter ubehandlede
quizer slik:

```
.from('quizzes').select(...).lt('closes_at', now).eq('season_points_awarded', false)
```

**Rettet 24. august 2026:** her sto «Ingen `is_test`-filter her heller». Det er
ikke lenger sant — ruten har nå `.eq('is_test', false)`
(`app/api/cron/award-season-points/route.ts:43`), med en kommentar som viser
tilbake til varslingsrutene. Se «Hull 2» i seksjon 5.

Flagget beholdes likevel, av to grunner. Det er billig, og det gjør quizen
merket som «allerede gjort opp» uansett hvilken kodesti som en dag måtte se på
den. Historikken det beskyttet mot: uten `is_test`-filteret ville cronen i det
øyeblikk testquizens `closes_at` passerte skrevet **ekte sesongpoeng inn i
`season_scores`** — inkludert global scope, altså den offentlige
månedstopplista.

Merk at `publish-quiz`-cronen gjør opp i praksis før `award-season-points`
rekker det (den kjører hvert minutt og gjør opp i `waitUntil` rett etter
stenging). Den har `is_test=false` tre steder.

### `is_active = true` — NØDVENDIG, ikke valgfritt

Dette er det motsatte av de tre over: det er ikke en sperre, det er et krav.

RLS-policyen på `quizzes` (`supabase/migrations/20260401000001_rls_policies.sql`)
er:

```sql
create policy "quizzes_select_active" on public.quizzes
  for select using (is_active = true);
```

og den offentlige `questions_public`-viewet
(`20260616190000_questions_hide_answer_key.sql`) har samme krav i sin
`WHERE EXISTS`-klausul.

Spillsiden henter quiz-raden **client-side med anon-nøkkelen**
(`app/quiz/[id]/page.tsx:1194`, `supabaseData.from('quizzes').select('*')`),
altså under RLS. Med `is_active = false` finnes quizen i databasen, men
returnerer 0 rader til nettleseren — siden viser «ikke funnet» og du kan ikke
verifisere noe som helst. Det er akkurat den feilen som er lett å gjøre når man
tenker «test = skal være skjult».

`opens_at`/`closes_at` må dessuten omslutte nåtid for at quizen skal være
spillbar.

---

## 4. Rydding

Kjør SELECT-en først. Den viser nøyaktig hva DELETE-ene kommer til å ta.

```sql
-- ── STEG 1: SE HVA SOM BLIR SLETTET (kjør denne alene først) ────────────────
with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
select 'quizzes'               as tabell, count(*) from public.quizzes            where id      in (select id from t)
union all select 'questions',              count(*) from public.questions              where quiz_id in (select id from t)
union all select 'attempts',               count(*) from public.attempts               where quiz_id in (select id from t)
union all select 'attempt_answers',        count(*) from public.attempt_answers        where attempt_id in (select id from public.attempts where quiz_id in (select id from t))
union all select 'played_log',             count(*) from public.played_log             where quiz_id in (select id from t)
union all select 'ranking_snapshots',      count(*) from public.ranking_snapshots      where quiz_id in (select id from t)
union all select 'season_scores',          count(*) from public.season_scores          where quiz_id in (select id from t)
union all select 'quiz_notification_log',  count(*) from public.quiz_notification_log  where quiz_id in (select id from t)
union all select 'quiz_notifications (myk ref)', count(*) from public.quiz_notifications where notified_quiz_id in (select id from t);
```

**Sjekk at `quizzes`-raden viser nøyaktig 1.** Viser den 0, traff ikke
filteret (feil tittel). Viser den mer enn 1, har du flere testquizer med samme
tittel liggende — rydd dem én om gangen, eller bekreft at alle skal bort.

**`season_scores` skal normalt vise 0.** Gjør den ikke det, har
sesong-cronen rukket å gjøre opp quizen, og `season_points_awarded=true` ble
ikke satt ved opprettelse. Slettingen rydder det opp, men da er poengene
allerede vist på topplista en periode.

```sql
-- ── STEG 2: SLETT (rekkefølgen betyr noe) ──────────────────────────────────
begin;

with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
delete from public.attempt_answers
where attempt_id in (select id from public.attempts where quiz_id in (select id from t));

with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
delete from public.attempts where quiz_id in (select id from t);

with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
delete from public.questions where quiz_id in (select id from t);

with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
delete from public.played_log where quiz_id in (select id from t);

with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
delete from public.ranking_snapshots where quiz_id in (select id from t);

with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
delete from public.season_scores where quiz_id in (select id from t);

with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
delete from public.quiz_notification_log where quiz_id in (select id from t);

-- Myk referanse uten fremmednøkkel — blokkerer ikke, men ryddes likevel.
with t as (
  select id from public.quizzes
  where title = '[TEST] Browserverifisering' and is_test = true
)
update public.quiz_notifications set notified_quiz_id = null
where notified_quiz_id in (select id from t);

delete from public.quizzes
where title = '[TEST] Browserverifisering' and is_test = true;

commit;
```

Rekkefølgen er: `attempt_answers` → `attempts` + `questions` → de fire
resterende barnetabellene → `quizzes`. Bare det første steget har en reell
avhengighet innad i sekvensen; resten kan i prinsippet stå i vilkårlig
rekkefølge, men er listet slik at feilmeldingen blir entydig hvis en av dem
skulle mangle.

Hvert eneste steg bærer `is_test = true`-vakten. En feilskrevet tittel gir
0 slettede rader, aldri en ekte quiz.

```sql
-- ── STEG 3: KONTROLLTELLING (alle skal være 0) ─────────────────────────────
select 'quizzes'              as tabell, count(*) from public.quizzes              where title = '[TEST] Browserverifisering'
union all select 'questions (foreldreløse)',       count(*) from public.questions              q left join public.quizzes z on z.id = q.quiz_id  where z.id is null
union all select 'attempts (foreldreløse)',        count(*) from public.attempts               a left join public.quizzes z on z.id = a.quiz_id  where z.id is null
union all select 'attempt_answers (foreldreløse)', count(*) from public.attempt_answers       aa left join public.attempts  a on a.id = aa.attempt_id where a.id is null
union all select 'played_log (foreldreløse)',      count(*) from public.played_log             p left join public.quizzes z on z.id = p.quiz_id  where z.id is null
union all select 'ranking_snapshots (foreldreløse)', count(*) from public.ranking_snapshots    r left join public.quizzes z on z.id = r.quiz_id  where z.id is null
union all select 'season_scores (foreldreløse)',   count(*) from public.season_scores          s left join public.quizzes z on z.id = s.quiz_id  where z.id is null
union all select 'quiz_notification_log (foreldreløse)', count(*) from public.quiz_notification_log n left join public.quizzes z on z.id = n.quiz_id where z.id is null;
```

Kontrolltellingen leter bevisst etter **foreldreløse rader i hele tabellen**,
ikke bare etter rader knyttet til denne ene quizen. En ryddespørring som glemte
en tabell ville gitt en fremmednøkkelfeil og stoppet — men en tabell som ikke
har fremmednøkkel (som `quiz_notifications`) ville gått stille gjennom. Denne
tellingen fanger begge tilfeller, og fanger dessuten opp restene etter
tidligere ad hoc-rydding.

---

## 5. Backlog — ETT gjenstående manglende `is_test`-filter (av opprinnelig to)

Funnet under kartleggingen 5. august 2026. **Hull 2 er siden LUKKET; Hull 1
står fortsatt åpent** (status verifisert i koden 24. august 2026).

Dokumentert her slik at oppskriftens `quiz_type='test'` og
`season_points_awarded=true` ikke fremstår som vilkårlige.

Begge er samme feilklasse: en kodesti som skal behandle «ekte fredagsquizer»
avgrenser på noe *annet* enn `is_test`, og fungerer i dag bare fordi
oppskriften over kompenserer manuelt.

### Hull 1 — `/api/toppliste`, `last_quiz`-modus

`app/api/toppliste/route.ts:216–218` avgrenser på `quiz_type = 'weekly'` og
ikke på `is_test`. En testquiz opprettet med `quiz_type='weekly'` (som er
kolonnens DEFAULT) og fersk `closes_at` overtar «Siste quiz» på topplista for
alle besøkende.

Merk at DEFAULT-verdien gjør dette til standardoppførselen: glemmer man å sette
`quiz_type` i det hele tatt, blir quizen `'weekly'`.

### ~~Hull 2 — `/api/cron/award-season-points`~~ LUKKET

Ruten avgrenset opprinnelig kun på `season_points_awarded = false` og
`closes_at < now()`. **Filteret finnes nå**
(`app/api/cron/award-season-points/route.ts:43`, `.eq('is_test', false)`),
med en kommentar som viser tilbake til varslingsrutene. Verifisert i koden
24. august 2026.

Merk det bevisste asymmetriske valget der: `is_active` filtreres med vilje
IKKE, fordi en spilt quiz som skjules i admin etter stenging fortsatt skal
gjøres opp — ellers mister spillerne poengene sine. `is_test` og `is_active`
er altså ikke et par som alltid følges ad; her er bare den ene riktig.

### Vurdering (oppdatert 24. august 2026)

Den opprinnelige anbefalingen var å legge `.eq('is_test', false)` på begge
spørringene. Det er nå gjort på den ene (Hull 2). Gjenstår Hull 1 i
`/api/toppliste`, som fortsatt avgrenser på `quiz_type = 'weekly'`.

**Konsekvens for oppskriften:** `quiz_type = 'test'` er fortsatt NØDVENDIG —
det er det eneste som holder en testquiz ute av «Siste quiz» på topplista.
`season_points_awarded = true` er nå strengt tatt overflødig som beskyttelse,
men beholdes: det koster ingenting, og det merker quizen som gjort opp uansett
hvilken kodesti som en dag måtte se på den.

Hull 1 er ikke rettet fordi det er en endring i en produksjonskodesti og hører
hjemme i en egen økt med egen verifisering. Oppskriften over er trygg uten den.
