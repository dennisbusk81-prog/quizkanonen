# scripts/

Denne katalogen ble triagert 29. juli 2026. Den hadde vokst til 32 filer, nesten
alle engangs-script fra tidligere hendelser, og det var ikke mulig å se hvilke
som fortsatt betyr noe.

**Reglen nå: alt som ligger direkte i `scripts/` er der fordi noe annet i
kodebasen peker på det. Alt annet ligger i `scripts/archive/`.**

Skal du legge til et nytt engangs-script, legg det i `scripts/archive/` med en
gang. Da slipper vi denne opprydningen på nytt.

---

## ⛔ IKKE SLETT ELLER FLYTT DISSE

Hver av de sju filene i `scripts/` er navngitt fra et sted utenfor katalogen.
Flytter du dem, går referansen i stykker — og for de fire første merkes det
ikke før det er for sent.

### `ts-node-resolve.mjs` — mest kritisk

Referert fra **`package.json`**, i selve `test`-kommandoen:

```json
"test": "node --disable-warning=ExperimentalWarning --experimental-test-module-mocks --import ./scripts/ts-node-resolve.mjs --test \"lib/**/*.test.ts\""
```

**Sletter eller flytter du denne, kjører ikke `npm test` lenger.** Ikke «noen
tester feiler» — hele suiten (460 tester) nekter å starte, fordi loaderen som
lar Node kjøre TypeScript-filene direkte er borte. Det er ingen fallback.

Nevnt i tillegg fra `lib/answer-key-correction.test.ts`,
`lib/season-resync-plan.test.ts` og `lib/ranking.ts`.

### `check-unique-constraint-blockers.mjs`

Navngitt inne i en **`RAISE EXCEPTION`-melding** i
`supabase/migrations/20260728000000_attempt_answers_unique.sql`:

> `Kan ikke opprette UNIQUE-indeksen: % nokler har duplikater (…). Rydd dem forst — se scripts/check-unique-constraint-blockers.mjs.`

Migrasjonen er kjørt i prod, men meldingen er en levende feilsti: kjøres
migrasjonen mot et nytt miljø og det finnes duplikater, er dette scriptet den
eneste anvisningen den som står fast får. Flyttes filen, peker feilmeldingen i
tomme luften.

### `fix-order-index-anomalies.mjs`

Samme situasjon, i
`supabase/migrations/20260729000000_questions_order_index_unique.sql`:

> `Kan ikke opprette UNIQUE-indeksen: % nokler har duplikat order_index (…). Rett dem forst — se scripts/fix-order-index-anomalies.mjs.`

Nevnt også to steder til i samme migrasjon.

### `inspect-order-index-9.mjs`

Referert fra **produksjonskode** — to ruter forklarer en reell datafeil ved å
peke på dette scriptet:

- `app/api/admin/quizzes/[id]/questions/route.ts:17`
- `app/api/quiz/[id]/questions/route.ts:206`

samt `supabase/migrations/20260729000000_questions_order_index_unique.sql:20`.
Kommentarene er den eneste forklaringen på hvorfor rutene sorterer som de gjør.

### `verify-timeout-backfill.mjs`

Referert fra `supabase/migrations/20260728000000_attempt_answers_unique.sql:41`
som mønsteret for hvordan en backfill etterkontrolleres.

Merk: scriptet den etterkontrollerer, `backfill-timeout-answers.mjs`, ligger nå
i `archive/` — backfillen er utført. Snapshot-filen den bruker
(`scripts/.timeout-backfill-snapshot.json`) er cwd-relativ, ikke relativ til
scriptet, så flyttingen endret ingenting.

### `verify-question-order-swap.mjs`

Referert fra `lib/question-order-swap.test.ts:17`.

Presist: dette er en **kommentar**, ikke en kjørbar avhengighet — testen kjører
uten scriptet. Den beholdes likevel i `scripts/` fordi en testfil aktivt peker
på den som stedet der den empiriske verifiseringen mot ekte database ligger, og
en død peker fra en test er verre enn en fil for mye.

### `backfill-personal-subscription-id.mjs`

Den ene som beholdes fordi jobben **ikke er gjort ennå**, ikke fordi kode kaller
den. `.claude/CLAUDE.md:292` og
`supabase/migrations/20260733000000_premium_state.sql:104` sier begge at
eksisterende rader fortsatt trenger denne backfillen (dry-run som standard,
`--apply` skriver).

Når backfillen faktisk er kjørt i prod: flytt den til `archive/` og fjern
merknaden i CLAUDE.md.

---

## `.deleted-duplicate-answers-backup.json`

93 KB ekte `attempt_answers`-rader som ble slettet fra prod 25. juli 2026 av
`cleanup-identical-duplicate-answers.mjs` (nå i `archive/`). Dette er
sikkerhetskopien av slettede produksjonsdata — **ikke slett den.**

Den ligger igjen i `scripts/` og ikke i `archive/` fordi scriptet skriver til
den hardkodede stien `scripts/.deleted-duplicate-answers-backup.json`. Skulle
noen kjøre scriptet fra arkivet på nytt, treffer den fortsatt riktig fil.

---

## `archive/`

25 engangs-script fra hendelser som er ferdig håndtert: Founders-forlengelser,
duplikat-opprydding, order_index-anomalier, timeout-backfill, og en rekke
`verify-*`/`check-*`-diagnoser skrevet for å bekrefte én konkret ting mot
prod-data.

**De er arkivert, ikke slettet, med vilje.** Flere av dem er den eneste
dokumentasjonen på hva som faktisk ble kjørt mot produksjonsdata, hvilke rader
det traff og hvilke vakter som var på plass da. Ved en fremtidig
dataintegritets-diskusjon er det den historikken som avgjør spørsmålet.

Referansene mellom dem er intakte fordi de ble flyttet samlet — f.eks.
`grant-founders-subscription.mjs` → `fix-martin-founders-subscription.mjs` →
`founders-extend-trials.mjs`.

Nesten alle tar `--apply` for å skrive og er dry-run som standard. **Kjør ikke
et arkivert script mot prod uten å lese det først** — de ble skrevet for en
databasetilstand som ikke finnes lenger.
