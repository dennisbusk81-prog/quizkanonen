// ── «Ekte quiz» — ÉN definisjon for lesere som rangerer og teller ────────────
//
// BAKGRUNN (25. august 2026)
// Fire lesere avgrenset ikke i det hele tatt på hva slags quiz de leste:
//   • /api/leagues/[id]/leaderboard   — «siste quiz» i ligaen, all-time-snitt
//                                        og beste_plassering
//   • /api/toppliste/history          — de 21 nyeste stengte quizene
//   • /api/leaderboard/[id]/prev-rank — «forrige quiz» for trendmerket
//   • /api/admin/dashboard            — «Deltakere siste quiz»
// En testquiz opprettet etter .claude/QK_TESTQUIZ_OPPSKRIFT.md er stengt og
// fersk, og vinner derfor enhver `order('closes_at', desc)`. Alle fire var
// altså feil ALLEREDE FØR arkivet finnes.
//
// ── HVORFOR EN DELT HELPER, OG IKKE FIRE INLINE-FILTRE ──────────────────────
// De fire rutene deler ikke utløser og ikke formål — i motsetning til de tre
// varslingsrutene bak `findOpenedQuizToNotify`. Det de deler er DEFINISJONEN:
// hva som teller som en quiz det er forsvarlig å rangere folk på. Helperen er
// derfor en filter-påfører og ikke et oppslag: kallerne beholder sin egen
// spørringsform, men kan ikke ha hver sin mening om populasjonen.
//
// Definisjonen står foran en endring vi allerede vet kommer (arkivet), og det
// er nettopp da fire kopier drifter fra hverandre. Det har skjedd her før:
// `is_test`-guarden kom inn i `send-push` mens søsterruten `notify-subscribers`
// beholdt hullet og sendte «[TEST – ikke ekte] …» til påmeldingslisten samme
// kveld (7c81c0a).
//
// ── HVORFOR EN HVITELISTE, IKKE EN SVARTELISTE ──────────────────────────────
// `quiz_type` er NOT NULL DEFAULT 'weekly' UTEN CHECK-constraint, altså et
// åpent verdirom. En svarteliste (`not.in.(test,archive)`) må utvides for hver
// nye verdi noen finner på — og glemmer man det, er feilen den STILLE typen:
// radene teller med, ingen feilmelding noe sted.
//
// Hvitelisten gjør det motsatte. Arkivforsøk får `quiz_type = 'archive'` som
// EGEN verdi (ikke `is_test = true`), og faller da ut av alle fire leserne uten
// at én linje her endres. Radene blir samtidig liggende urørt i basen og er
// fullt FINNBARE for en senere XP-modell som spør etter dem eksplisitt — dette
// er et lesefilter, ikke en sletting og ikke et skjul-flagg.
//
// ── HVORFOR BÅDE quiz_type OG is_test ──────────────────────────────────────
// De fanger hver sin quiz. Oppskriftens testquiz har `quiz_type = 'test'` og
// fanges av hvitelisten. Men admin-editoren har en EGEN «testquiz»-bryter
// (app/admin/quizzes/new/page.tsx:1062) som setter `is_test = true` mens
// nedtrekket fortsatt står på 'weekly' — den quizen passerer hvitelisten, og
// `is_test` er det eneste som stopper den. Motsatt fanges 'test'/'archive' ikke
// av `is_test` i det hele tatt. Ingen av de to er altså overflødig.
//
// ── HVORFOR `.not(is_test, is, true)` OG IKKE `.eq(is_test, false)` ─────────
// `is_test` er NULLABLE med DEFAULT false, og `.eq('is_test', false)` matcher
// IKKE NULL-rader — det filteret er altså ikke totalt. Målt mot prod 25. august
// 2026: 13 quizer, 0 med `is_test IS NULL` (samme som målingen 11. august), så
// hullet er tomt i dag. Men formen `.not(kolonne, 'is', true)` koster ingenting,
// dekker både false og NULL, og er allerede husform i denne kodebasen
// (app/api/stripe/founders-activate/route.ts:223, med egen test på nettopp den
// NULL-semantikken i lib/founders-activate-trial-lock.test.ts:140).
//
// De ~12 øvrige `.eq('is_test', false)`-stedene er BEVISST ikke rørt her: de er
// en egen opprydding, ikke en del av denne saken.
//
// ── FORHOLDET TIL `.eq('quiz_type', 'weekly')` ─────────────────────────────
// Fem lesere avgrenser strengere enn dette (toppliste-rutens last_quiz og
// emptyResponse, org/quiz-scores, org/velkommen, deltakelsesrekken i
// lib/history.ts). Det er ikke det samme filteret og skal ikke slås sammen med
// dette: der er «ukens quiz» en produktdefinisjon, her er «ikke en kunstig
// quiz» en integritetsgrense. Helperen er GULVET. En kaller som trenger kun
// weekly legger sitt eget `.eq('quiz_type', 'weekly')` oppå.
//
// ── VERIFISERT MOT PROD, IKKE ANTATT (25. august 2026, read-only) ───────────
// Embed-formen og begge filtrene er målt med positiv OG negativ kontroll:
//   attempts totalt ................................... 625
//   `quizzes!inner(id)` uten filter (positiv kontroll) . 625  ← joinen mister
//                                                              ingen rader
//   + quiz_type=in.(weekly,bonus) ..................... 625
//   MOTPRØVE quiz_type=in.(archive) ...................   0  ← filteret BINDER
//   MOTPRØVE is_test=is.true ..........................   0  ← filteret BINDER
// Motprøvene er poenget: uten dem beviser 625 = 625 kun at ingenting ble
// utelukket, ikke at filteret i det hele tatt ble lest av PostgREST.

// ── TO MEKANISKE KRAV VED BRUK (begge er felt på ved skriving) ─────────────
// 1. HELPEREN FØR `.maybeSingle()`/`.single()`. De to returnerer en
//    PostgrestBuilder som ikke lenger har `.not()`/`.in()`, så filteret kan
//    ikke legges på i etterkant. `.order()`/`.limit()` er derimot greie før.
// 2. LEGG SPØRRINGEN I EN LOKAL VARIABEL, ikke inline som argument. Inlinet ga
//    `next build` TS2589 «Type instantiation is excessively deep» på de lengste
//    byggerkjedene. Merk at `npx tsc --noEmit` slapp to av dem gjennom —
//    build-en er den strengeste porten her, ikke tsc.

/**
 * Quiz-typene som teller som ekte konkurranse.
 *
 * 'bonus' er med fordi admin-editoren tilbyr den (page.tsx:2122) og fordi
 * ingen av de fire leserne ekskluderte den før — å fjerne bonusquizer fra
 * f.eks. et liga-snitt ville vært en produktendring, ikke en feilretting.
 * Finnes ikke i prod i dag (13 quizer, alle 'weekly', målt 25. august 2026).
 */
export const REAL_QUIZ_TYPES = ['weekly', 'bonus'] as const

/**
 * Minimums-formen helperne KREVER av argumentet.
 *
 * Metode-syntaks (ikke felt med funksjonstype) er med vilje: TypeScript er
 * bivariant på metodeparametere, så den ekte byggeren — som typer `column` som
 * en snever union av kolonnenavn — tilfredsstiller `column: string` her.
 *
 * Returtypen er `unknown` og IKKE `this`: med `this` (eller `T`) blir
 * constrainten selvrefererende, og TypeScript ga da TS2589 «Type instantiation
 * is excessively deep» på den lengste kjeden (admin/dashboard, som allerede har
 * et `.not()` i seg). Kjedingen gjøres derfor mot `Filterkjede` under, mens
 * signaturen returnerer `T` uendret — kalleren beholder sin egen, presise
 * byggertype.
 */
interface FiltrerbarSpørring {
  not(column: string, operator: string, value: unknown): unknown
  in(column: string, values: readonly unknown[]): unknown
}

/** Intern kjedeform. Den ekte byggeren returnerer `this` fra begge metodene. */
interface Filterkjede {
  not(column: string, operator: string, value: unknown): Filterkjede
  in(column: string, values: readonly unknown[]): Filterkjede
}

/**
 * Minimums-formen `onlyArtificialQuizzes` krever. Samme bivariante
 * metode-syntaks og samme `unknown`-retur som `FiltrerbarSpørring`, av samme
 * TS2589-grunn.
 */
interface OrSpørring {
  or(filters: string): unknown
}

/**
 * Avgrenser en spørring MOT `quizzes` til ekte quizer.
 *
 * Bruk der `.from('quizzes')` er tabellen.
 */
export function onlyRealQuizzes<T extends FiltrerbarSpørring>(query: T): T {
  return (query as unknown as Filterkjede)
    .not('is_test', 'is', true)
    .in('quiz_type', REAL_QUIZ_TYPES) as unknown as T
}

/**
 * Avgrenser en spørring MOT `quizzes` til KUNSTIGE quizer — det eksakte
 * komplementet av `onlyRealQuizzes`. Enhver quiz-rad matcher nøyaktig én av de
 * to, uansett verdiene av `is_test` (true/false/NULL) og `quiz_type` (åpent
 * verdirom):
 *
 *   onlyRealQuizzes:       NOT (is_test IS TRUE)  AND  quiz_type IN ekte
 *   onlyArtificialQuizzes:     (is_test IS TRUE)  OR   quiz_type NOT IN ekte
 *
 * `quiz_type` er NOT NULL, så `not.in` er totalt; `is.true` og
 * `not.is.true` deler true | false/NULL mellom seg. Komplement-egenskapen er
 * testdekket med full sannhetstabell i lib/season-reset-route.test.ts.
 *
 * Brukes der noe skal RYDDES eller unntas for alt som ikke er ekte konkurranse
 * (f.eks. admin-ruten som sletter test-poengrader). Definisjonen bor her —
 * utvides `REAL_QUIZ_TYPES`, følger komplementet med automatisk. Ikke skriv
 * et eget «testquiz-filter» (og aldri et tittelsøk) hos en kaller.
 */
export function onlyArtificialQuizzes<T extends OrSpørring>(query: T): T {
  return query.or(
    `is_test.is.true,quiz_type.not.in.(${REAL_QUIZ_TYPES.join(',')})`
  ) as T
}

/**
 * Embed-fragmentet som MÅ stå i `.select()` for at `onlyRealQuizAttempts()`
 * skal ha noe å filtrere på.
 *
 * `!inner` gjør joinen til et filter i stedet for et valgfritt vedlegg — uten
 * utropstegnet blir en attempt med testquiz liggende med `quizzes: null` i
 * stedet for å forsvinne. Uten embeden i selectet svarer PostgREST 400
 * PGRST108 («'quizzes' is not an embedded resource in this request») — altså
 * høylytt, ikke stille, som er den greie retningen å ta feil i.
 *
 * `(id)` og ikke `(is_test, quiz_type)`: kallerne bruker aldri verdiene, og
 * relasjonen attempts→quizzes er many-to-one, så embeden kommer tilbake som ett
 * OBJEKT per rad og multipliserer ikke radsettet (målt: 625 = 625).
 */
export const REAL_QUIZ_ATTEMPT_EMBED = 'quizzes!inner(id)'

/**
 * Avgrenser en spørring MOT `attempts` til forsøk på ekte quizer.
 *
 * Krever at `REAL_QUIZ_ATTEMPT_EMBED` står i `.select()`.
 */
export function onlyRealQuizAttempts<T extends FiltrerbarSpørring>(query: T): T {
  return (query as unknown as Filterkjede)
    .not('quizzes.is_test', 'is', true)
    .in('quizzes.quiz_type', REAL_QUIZ_TYPES) as unknown as T
}
