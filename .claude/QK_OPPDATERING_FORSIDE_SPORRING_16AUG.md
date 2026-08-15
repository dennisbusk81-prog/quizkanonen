# QK_4-oppdatering: forsidens tyngste spørring + org-innsikt — tre punkter lukket

**Dato:** 16. august 2026
**Commit:** `5cbf976` (`perf(innsikt): eksistenssjekk uten full aggregering + is_test-vakt i org-innsikt`)

Kartleggingen 16. august (read-only, mot pg_stat_statements og prod) fant at
forsidens tyngste spørring (42 kall, 248 ms snitt, 1399 ms max) og en tyngre
søstervariant (4 kall, 753 ms snitt, 2127 ms max) var to kallsteder med samme
nøstede PostgREST-embed brukt som ren eksistenssjekk. Alle tre punktene under
er nå lukket.

## 1. Forsidens computePageInsights: EXISTS i stedet for full aggregering (LUKKET)

`app/page.tsx` (computePageInsights, «Ukens fakta»-kortet) valgte siste
stengte quiz med minst ett svar via
`attempts!inner(id, attempt_answers!inner(id))` — som aggregerte hele
undertreet til vinnende quiz: ~1100 UUID-er / 54,5 kB JSON som koden kastet
(den leser kun `quizzes.id`). Målt mot prod 16. august.

Fiks: `.limit(1, { referencedTable: 'attempts' })` +
`.limit(1, { referencedTable: 'attempts.attempt_answers' })`. Responsen er nå
176 bytes. INNER JOIN-semantikken (hvilken quiz som velges) er uendret —
verifisert mot prod: samme quiz-id (`94409bbb…`, Fredagsquiz 14.08.2026) før
og etter.

## 2. Org-adminpanelets quiz-innsikt: samme fiks (LUKKET)

`app/api/org/[slug]/quiz-insights/route.ts` hadde identisk embed-form
(dette var den tyngre varianten — ucachet, kalles per panelbesøk med kalde
buffere). Samme limit-fiks, samme verifisering: samme quiz-id før og etter,
209 bytes respons.

## 3. Søskenfunn: manglende is_test-filter i org-innsikt (LUKKET)

Org-ruten manglet `.eq('is_test', false)` i quiz-oppslaget — en stengt
testquiz kunne blitt valgt som «siste stengte quiz» og vist testdata i
bedriftspanelet (Elkjøp). Forsidens variant hadde filteret allerede.

Verifisert i BEGGE retninger med en midlertidig testquiz i prod (opprettet
etter oppskriften i QK_TESTQUIZ_OPPSKRIFT.md, slettet umiddelbart etterpå,
kontrolltelling tom):
- Uten filter (gammel form): testquizen ble valgt — buggen var reell.
- Med filter (ny form): den ekte quizen (Fredagsquiz 14.08.2026) velges.

`is_active` filtreres BEVISST IKKE, etter presedensen fra
award-season-points (QK_2 punkt E): å skjule en quiz i admin skal ikke
fjerne resultater folk allerede har spilt. Kun `is_test` ble lagt til.

## Mønsteret er nå konsekvent på alle fire kallsteder

`attempts!inner`-embeds brukt som eksistenssjekk skal ha
`.limit(1, { referencedTable: ... })` på hvert embed-nivå. Per 16. august
2026 gjelder det alle fire stedene som har formen:

| Kallsted | Nivåer |
|---|---|
| `app/api/toppliste/route.ts` (last_quiz) | attempts |
| `app/api/org/[slug]/quiz-scores/route.ts` | attempts |
| `app/page.tsx` (computePageInsights) | attempts + attempt_answers |
| `app/api/org/[slug]/quiz-insights/route.ts` | attempts + attempt_answers |

Neste person som skriver en slik embed: limit-formen er standarden her.
En embed uten limit aggregerer hele undertreet i json_agg selv når
resultatet kastes.

## Kontekst og restsaker

- Cache-laget rundt punkt 1 (`unstable_cache` 60 s + betinget purge fra
  publish-quiz) ble strammet i `b7d53a2` (15. august) — den saken handlet om
  HVOR OFTE spørringen kjører, denne om hva den koster per kjøring.
- Kartleggingen målte også at spørringen med varme buffere nå tar ~20–40 ms
  serverside; snittene på 248/753 ms i pg_stat_statements inkluderer
  minnepress-perioden 13.–14. august (Nano-instansen swappet). Maks-utslagene
  på 1–2 s adresseres primært av Micro-oppgraderingen som allerede er
  anbefalt (14. august) — denne fiksen fjerner det strukturelle sløseriet.
- `SELECT name FROM pg_timezone_names` (5 kall, 1465 ms snitt) kommer IKKE
  fra appen — 1196 rader per kall er hele tidssonekatalogen, og spørringen
  finnes ingen steder i repoet. Det er Supabase-dashbordets egne
  tidssonevelgere. Ingenting å fikse.
