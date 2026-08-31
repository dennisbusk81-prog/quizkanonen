// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// «SISTE QUIZ» ER ÉN DEFINISJON — INTEGRASJONSTEST AV BEGGE FLATENE SAMMEN
// (26. august 2026)
//
// ── FEILEN ──────────────────────────────────────────────────────────────────
// «Siste quiz» ble utledet to steder med to ulike spørringer:
//
//   Fanen      /api/toppliste?period=last_quiz
//              quiz_type='weekly' + attempts!inner + closes_at DESC, limit 1
//              — INGEN closes_at-grense.
//   Historikk  /api/toppliste/history?period=last_quiz
//              closes_at < now + closes_at DESC, limit 21, deretter `.slice(1)`
//              for å hoppe over «den nyeste, som vises i hovedfanen».
//
// `.slice(1)` ANTOK at de to pekte på samme quiz. De var uenige på TRE punkter
// samtidig (stengt/åpen, weekly/bonus, forsøkskrav), og utslaget gikk begge
// veier:
//
//   • MENS EN QUIZ ER ÅPEN pekte fanen på den åpne, mens historikken kastet
//     den nyeste STENGTE — altså forrige ukes quiz, som da ikke fantes på
//     flaten i det hele tatt. Hver fredag, ca. 12–22, i produksjon.
//   • STENGER EN BONUSQUIZ (eller en weekly uten forsøk) SIST viser fanen
//     forrige weekly, historikken kaster bonusquizen, og den weeklyen fanen
//     viser blir rad 1 i historikken: DOBBELTVISNING, og bonusquizen borte.
//
// ── HVA TESTEN FELLER ───────────────────────────────────────────────────────
// Ikke «står det et closes_at-filter i koden» — en slik test passerer på
// utkommentert kode og fanger ikke et filter skrevet på feil kolonne. Testen
// kjører BEGGE de ekte rutene mot SAMME fixture og sjekker invarianten de to
// sammen skal oppfylle:
//
//   UNIONEN av (quizen fanen viser) og (quizene historikken lister) skal være
//   nøyaktig de stengte ekte quizene — ingen borte, ingen dobbelt.
//
// Å binde de to inngangene sammen i én test er poenget: hver av dem er internt
// konsistent hver for seg, og feilen bodde utelukkende i FORHOLDET mellom dem.
// En test per rute ville vært grønn hele veien.
//
// ── MUTASJONER KJØRT ────────────────────────────────────────────────────────
// Se nederst i filen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const SPILLER_A = '11111111-1111-1111-1111-111111111111'
const SPILLER_B = '22222222-2222-2222-2222-222222222222'

type Rad = Record<string, unknown>

const db: Record<string, Rad[]> = {
  quizzes: [], attempts: [], profiles: [], excluded_members: [], season_scores: [],
  organization_members: [], league_members: [],
}

// ── Fake-spørringsbygger med ekte filterevaluering ──────────────────────────
//
// Filtrene rutes på KOLONNE, ikke på kallrekkefølge. En fake som lagrer
// `.in(_col, ids)` uansett kolonne gir et bevis som ikke beviser: et filter
// skrevet på feil kolonne ville sett identisk ut for den.
function harForsok(quizId: unknown): boolean {
  return db.attempts.some(a => a.quiz_id === quizId)
}

/**
 * `order(col, ...)` med Postgres' NULL-plassering: NULLS LAST på ASC,
 * NULLS FIRST på DESC.
 *
 * Dette er ikke pedanteri. `closes_at` er nullable, og på DESC sorterer
 * Postgres NULL FØRST — et utkast uten stengetid vant derfor fanens
 * `order('closes_at', desc).limit(1)` så snart det hadde ett forsøk. Sorterer
 * faken NULL sist, kan den mutasjonen ikke felles.
 */
function sorter(rader: Rad[], col: string, asc: boolean): Rad[] {
  return [...rader].sort((x, y) => {
    const a = x[col], z = y[col]
    if (a == null && z == null) return 0
    if (a == null) return asc ? 1 : -1
    if (z == null) return asc ? -1 : 1
    const s = String(a).localeCompare(String(z))
    return asc ? s : -s
  })
}

function builder(tabell: string) {
  if (!(tabell in db)) throw new Error(`ukjent tabell i mock: ${tabell}`)

  const filtre: Array<(r: Rad) => boolean> = []
  let orderCol: string | null = null, orderAsc = true
  let limitN: number | null = null
  let rangeFra: number | null = null, rangeTil: number | null = null

  const b = {
    select(cols?: string) {
      // `!inner` gjør embeden til et FILTER: en quiz uten forsøk forsvinner.
      // Det er forsøkskravet i fanens definisjon, og det MÅ modelleres —
      // ellers kan ikke «weekly uten forsøk stenger sist» testes i det hele tatt.
      if (cols && /attempts!inner/.test(cols)) filtre.push(r => harForsok(r.id))
      return b
    },
    eq(col: string, val: unknown) { filtre.push(r => r[col] === val); return b },
    gt(col: string, val: string)  { filtre.push(r => r[col] != null && String(r[col]) >  val); return b },
    gte(col: string, val: string) { filtre.push(r => r[col] != null && String(r[col]) >= val); return b },
    lt(col: string, val: string)  { filtre.push(r => r[col] != null && String(r[col]) <  val); return b },
    is(col: string, val: unknown) { filtre.push(r => (val === null ? r[col] == null : r[col] === val)); return b },
    in(col: string, vals: readonly unknown[]) { filtre.push(r => vals.includes(r[col])); return b },
    not(col: string, op: string, val: unknown) {
      if (op !== 'is') throw new Error(`faken støtter kun .not(col, 'is', …), fikk '${op}'`)
      // PostgREST: `not.is.true` = NOT (kol IS TRUE) → sant for BÅDE false og NULL.
      if (val === null) filtre.push(r => r[col] != null)
      else              filtre.push(r => r[col] !== val)
      return b
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col; orderAsc = opts?.ascending !== false; return b
    },
    limit(n: number, opts?: { referencedTable?: string }) {
      // limit på en REFERERT tabell begrenser embeden, ikke radsettet — den er
      // et rent EXISTS-triks i fanens oppslag, og skal ikke kutte quiz-listen.
      if (!opts?.referencedTable) limitN = n
      return b
    },
    range(fra: number, til: number) { rangeFra = fra; rangeTil = til; return b },

    rader(): Rad[] {
      let ut = db[tabell].filter(r => filtre.every(f => f(r)))
      if (orderCol) ut = sorter(ut, orderCol, orderAsc)
      if (limitN !== null) ut = ut.slice(0, limitN)
      if (rangeFra !== null && rangeTil !== null) ut = ut.slice(rangeFra, rangeTil + 1)
      return ut
    },
    maybeSingle() { return Promise.resolve({ data: b.rader()[0] ?? null, error: null }) },
    // Typet resolve-parameter: det er den som gir `await` sin type, så uten den
    // blir hvert oppslag i testene `unknown` og tsc rødt.
    then(resolve: (v: { data: Rad[] | null; error: null }) => void) {
      return resolve({ data: b.rader(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    },
  },
})

// Utenfor det testen handler om — stubbet slik at rutene kan kjøre.
mock.module('@/lib/globally-blocked-set', {
  namedExports: { getGloballyBlockedSet: async () => new Set<string>() },
})
mock.module('@/lib/premium-check', {
  namedExports: { getUserPremium: async () => ({ ok: true as const, isPremium: false }) },
})

const dagerSiden = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const dagerFram  = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

// Tittelen er BEVISST ulik id-en. De to flatene svarer med hver sin kolonne —
// fanen med `quizTitle` (title), historikken med `key` (id) — og med
// `title === id` ville en eksklusjon skrevet på feil kolonne sett identisk ut.
// Mutasjonen «ekskluder på title i stedet for id» var da grønn her.
const tittel = (id: string) => `Fredagsquiz ${id}`

function quiz(id: string, closesAt: string | null, over: Partial<Rad> = {}): Rad {
  return {
    id, title: tittel(id), closes_at: closesAt,
    opens_at: dagerSiden(40), created_at: dagerSiden(41),
    quiz_type: 'weekly', is_test: false, is_active: true, season_points_awarded: true,
    // Begge skjul-gatene AV: denne testen handler om hvilken quiz som VELGES,
    // ikke om stillingen vises.
    hide_leaderboard_until_closed: false, show_leaderboard: true,
    ...over,
  }
}

let lopenr = 0
function forsok(quizId: string, userId: string, riktige = 8): Rad {
  return {
    id: `att-${String(++lopenr).padStart(4, '0')}`, quiz_id: quizId, user_id: userId,
    player_name: `Spiller ${userId.slice(0, 2)}`, is_team: false,
    correct_answers: riktige, total_time_ms: 60_000, correct_streak: riktige,
    submitted_at: dagerSiden(1), completed_at: dagerSiden(1),
  }
}

beforeEach(() => {
  for (const t of Object.keys(db)) db[t] = []
  db.profiles = [
    { id: SPILLER_A, display_name: 'Anne', nickname: null },
    { id: SPILLER_B, display_name: 'Bjørn', nickname: null },
  ]
  lopenr = 0
})

// ── De to ekte rutene, kjørt anonymt mot global scope ────────────────────────
type TopplisteRequest = Parameters<typeof import('@/app/api/toppliste/route')['GET']>[0]
type HistoryRequest   = Parameters<typeof import('@/app/api/toppliste/history/route')['GET']>[0]

async function fane(): Promise<string | null> {
  const { GET } = await import('@/app/api/toppliste/route')
  const res = await GET(
    new Request('https://quizkanonen.no/api/toppliste?period=last_quiz&scope=global') as unknown as TopplisteRequest,
  )
  const body = await res.json() as { quizTitle: string | null }
  return body.quizTitle
}

/** Historikklista, som (id, tittel)-par — begge kolonnene, i rekkefølge. */
async function historikk(): Promise<{ key: string; label: string }[]> {
  const { GET } = await import('@/app/api/toppliste/history/route')
  const res = await GET(
    new Request('https://quizkanonen.no/api/toppliste/history?period=last_quiz&scope=global') as unknown as HistoryRequest,
  )
  const body = await res.json() as { entries: { key: string; label: string }[] }
  return body.entries.map(e => ({ key: e.key, label: e.label }))
}

/**
 * Invarianten de to flatene sammen skal oppfylle.
 *
 * `forventetDekning` er hele settet av quizer som skal være synlige for en
 * bruker på topplisten — fanen viser én av dem, historikken resten. De tre
 * assertene sier hver sin ting, slik at en feil peker på HVILKEN halvdel som
 * røk: feil quiz i fanen, dobbeltvisning, eller en quiz som er borte.
 */
async function sjekkDekning(forventetDekning: string[], forventetIFanen: string) {
  const iFanen = await fane()
  const rader = await historikk()

  // Sammenligningen går på TITTEL fordi det er den ene verdien begge flatene
  // svarer med (fanen har ingen id i svaret). `key` sjekkes for seg under, så
  // begge kolonnene er dekket.
  assert.equal(iFanen, tittel(forventetIFanen), 'feil quiz i «Siste quiz»-fanen')
  assert.ok(!rader.some(r => r.label === iFanen),
    `DOBBELTVISNING: ${iFanen} står både i fanen og i historikklista`)

  const union = [iFanen, ...rader.map(r => r.label)].filter((v): v is string => v !== null).sort()
  assert.deepEqual(union, forventetDekning.map(tittel).sort(),
    'unionen av fane + historikk skal være nøyaktig de stengte ekte quizene — ingen borte, ingen dobbelt')

  // Radene skal peke på riktig quiz-id — `key` er det historikk-accordionen
  // lenker videre på. Uten denne kunne id-en vært hva som helst.
  assert.deepEqual(rader.map(r => r.key), rader.map(r => r.label.replace('Fredagsquiz ', '')),
    'hver historikk-rad sin key skal være quiz-id-en til raden sin egen tittel')
}

// ════════════════════════════════════════════════════════════════════════════
// DEN EKTE FEILTILSTANDEN: en åpen quiz samtidig med tidligere stengte
// ════════════════════════════════════════════════════════════════════════════

test('åpen quiz samtidig med stengte: forrige ukes quiz forsvinner ikke fra begge flatene', async () => {
  // Fredag kveld i produksjon: uke 35 er åpen og spilles nå, uke 34 og 33 er
  // stengt. FØR fiksen viste fanen den ÅPNE uke 35, mens historikkens
  // `.slice(1)` kastet uke 34 som «den som vises i hovedfanen» — uke 34 fantes
  // da ikke på flaten i det hele tatt.
  db.quizzes = [
    quiz('apen-uke35', dagerFram(2)),
    quiz('stengt-uke34', dagerSiden(7)),
    quiz('stengt-uke33', dagerSiden(14)),
  ]
  db.attempts = [
    forsok('apen-uke35', SPILLER_A), forsok('apen-uke35', SPILLER_B),
    forsok('stengt-uke34', SPILLER_A), forsok('stengt-uke34', SPILLER_B),
    forsok('stengt-uke33', SPILLER_A),
  ]

  await sjekkDekning(['stengt-uke34', 'stengt-uke33'], 'stengt-uke34')
})

test('åpen quiz og BARE åpen quiz: fanen lover ikke et resultat som ikke finnes', async () => {
  // Grensetilfellet av samme feil. Finnes ingen stengt quiz, skal fanen være
  // tom — klientens tomme tilstand sier nettopp «Ingen avsluttede quizer ennå.
  // Kom tilbake etter at neste quiz er stengt»
  // (components/SeasonLeaderboard.tsx:343), og den setningen var usann så lenge
  // en åpen quiz kunne fylle fanen med en halvtom liste.
  db.quizzes = [quiz('apen-uke35', dagerFram(2))]
  db.attempts = [forsok('apen-uke35', SPILLER_A), forsok('apen-uke35', SPILLER_B)]

  assert.equal(await fane(), null, 'en åpen quiz skal ikke kunne være «Siste quiz»')
  assert.deepEqual(await historikk(), [], 'ingen stengt quiz å liste')
})

// ════════════════════════════════════════════════════════════════════════════
// SØSKNENE: samme antakelse, motsatt utslag — dobbeltvisning
// ════════════════════════════════════════════════════════════════════════════

test('bonusquiz stenger sist: den EIER fanen, og weeklyen vises i accordionen uten dobbelt', async () => {
  // ── DENNE TESTEN ER SKREVET OM 31. AUGUST 2026 ────────────────────────────
  // Den het før «bonusquiz stenger sist: den forsvinner ikke, og weeklyen vises
  // ikke dobbelt», og krevde `weekly-uke34` i fanen. Det var den GAMLE
  // beslutningen kodet inn som forventning: fanen krevde 'weekly', historikken
  // tillot 'bonus', og testen felte bare den ene halvdelen av problemet — at
  // ingenting sto to steder. Den sa ingenting om at bonusquizen var forvist til
  // accordionen, fordi det den gang var meningen.
  //
  // Samme klasse som season-period-table.test.ts:62, som krevde at liga IKKE
  // var et lukket rom og ville stoppet den fiksen: en test kan pinne en
  // BESLUTNING og se ut som den pinner en invariant. Invarianten her — ingen
  // borte, ingen dobbelt — er uendret og felles fortsatt. Det som er byttet ut
  // er hvilken quiz som skal EIE fanen.
  //
  // Ny regel (Dennis, 31. august 2026): «Siste quiz» = siste quiz som teller i
  // sesongkonkurransen. Bonusquizen stenger sist, altså eier den fanen, og
  // weeklyen skal da dukke opp i accordionen — ikke forsvinne, ikke stå begge
  // steder. Se lib/last-quiz.ts.
  db.quizzes = [
    quiz('bonus-julequiz', dagerSiden(3), { quiz_type: 'bonus' }),
    quiz('weekly-uke34', dagerSiden(7)),
    quiz('weekly-uke33', dagerSiden(14)),
  ]
  db.attempts = [
    forsok('bonus-julequiz', SPILLER_A),
    forsok('weekly-uke34', SPILLER_A), forsok('weekly-uke34', SPILLER_B),
    forsok('weekly-uke33', SPILLER_A),
  ]

  await sjekkDekning(['bonus-julequiz', 'weekly-uke34', 'weekly-uke33'], 'bonus-julequiz')

  // Eksplisitt om DET som er nytt: weeklyen er ikke borte, den er rad 1 i
  // accordionen. `sjekkDekning` felles av unionen, men unionen alene skiller
  // ikke «weeklyen ligger i accordionen» fra «weeklyen ligger i fanen» — det
  // er nettopp den forvekslingen den gamle testen levde i.
  assert.deepEqual((await historikk()).map(r => r.key), ['weekly-uke34', 'weekly-uke33'],
    'weeklyen skal ligge øverst i accordionen når bonusquizen eier fanen')
})

test('bonusquiz STENGT mens fredagsquizen er ÅPEN: fanen viser den stengte bonusquizen', async () => {
  // Kanttilfellet Dennis ba om bekreftet før endringen (31. august 2026), og
  // den ene kombinasjonen den nye regelen gjør nåbar: to ULIKE typer der den
  // nyeste er åpen. Beslutningen fra 26. august — fanen viser nyeste STENGTE —
  // er uendret og skal fortsatt vinne over «nyeste».
  //
  // Uten denne ville den nye regelen vært forenlig med at en åpen weekly tok
  // fanen tilbake, siden ingen annen test har en åpen og en stengt quiz av
  // ULIK type samtidig.
  db.quizzes = [
    quiz('apen-uke36', dagerFram(2)),
    quiz('bonus-eurovision', dagerSiden(2), { quiz_type: 'bonus' }),
    quiz('weekly-uke34', dagerSiden(9)),
  ]
  db.attempts = [
    forsok('apen-uke36', SPILLER_A), forsok('apen-uke36', SPILLER_B),
    forsok('bonus-eurovision', SPILLER_A),
    forsok('weekly-uke34', SPILLER_B),
  ]

  await sjekkDekning(['bonus-eurovision', 'weekly-uke34'], 'bonus-eurovision')
})

test('weekly uten forsøk stenger sist: den forsvinner ikke, og forrige vises ikke dobbelt', async () => {
  // Fanen krever minst ett forsøk (attempts!inner), historikken krever ingen.
  // Samme dobbeltvisning som over, med en annen årsak — og det er nettopp
  // derfor «legg på closes_at begge steder» ikke hadde vært nok: kravene må
  // avgjøres ETT sted, ikke to steder som tilfeldigvis er enige.
  db.quizzes = [
    quiz('tom-uke35', dagerSiden(3)),
    quiz('weekly-uke34', dagerSiden(7)),
    quiz('weekly-uke33', dagerSiden(14)),
  ]
  db.attempts = [
    forsok('weekly-uke34', SPILLER_A), forsok('weekly-uke34', SPILLER_B),
    forsok('weekly-uke33', SPILLER_A),
  ]

  await sjekkDekning(['tom-uke35', 'weekly-uke34', 'weekly-uke33'], 'weekly-uke34')
})

// ════════════════════════════════════════════════════════════════════════════
// HULLET closes_at-kravet lukker på kjøpet: NULL stengetid
// ════════════════════════════════════════════════════════════════════════════

test('quiz uten stengetid kan ikke bli «Siste quiz» — Postgres sorterer NULL FØRST på DESC', async () => {
  // `closes_at` er nullable. Uten `closes_at < now` vant et utkast uten
  // stengetid fanens `order('closes_at', desc).limit(1)` så snart det hadde ett
  // forsøk — NULLS FIRST er Postgres' default på DESC. NULL kan ikke
  // tilfredsstille `lt`, så kravet lukker hullet uten et eget filter.
  db.quizzes = [
    quiz('utkast-uten-stengetid', null),
    quiz('weekly-uke34', dagerSiden(7)),
  ]
  db.attempts = [
    forsok('utkast-uten-stengetid', SPILLER_A),
    forsok('weekly-uke34', SPILLER_A), forsok('weekly-uke34', SPILLER_B),
  ]

  await sjekkDekning(['weekly-uke34'], 'weekly-uke34')
})

// ════════════════════════════════════════════════════════════════════════════
// MOTPRØVE: den vanlige tilstanden skal være uendret
// ════════════════════════════════════════════════════════════════════════════

test('ingen åpen quiz: fanen viser nyeste stengte, historikken resten — uendret oppførsel', async () => {
  // Uten denne ville testene over vært forenlige med en «fiks» som tømte fanen
  // helt. Dette er tilstanden mandag–torsdag, altså det normale.
  db.quizzes = [
    quiz('uke34', dagerSiden(1)),
    quiz('uke33', dagerSiden(8)),
    quiz('uke32', dagerSiden(15)),
  ]
  db.attempts = [
    forsok('uke34', SPILLER_A), forsok('uke34', SPILLER_B),
    forsok('uke33', SPILLER_A),
    forsok('uke32', SPILLER_B),
  ]

  await sjekkDekning(['uke34', 'uke33', 'uke32'], 'uke34')

  // Rekkefølgen i historikken er nyest først — «første element» er forrige uke.
  assert.deepEqual((await historikk()).map(r => r.key), ['uke33', 'uke32'])
})

// ── MUTASJONER KJØRT (26. august 2026, hver mutasjon gjenopprettet) ─────────
// Kjørt mot lib/last-quiz-definition.test.ts + lib/real-quiz-population.test.ts
// + lib/toppliste-real-quiz-population.test.ts.
//
//   M1  fjern `.lt('closes_at', nowIso)` i fetchLastQuiz     → 3 røde
//       «åpen quiz samtidig med stengte …», «åpen quiz og BARE åpen quiz …»,
//       «quiz uten stengetid kan ikke bli «Siste quiz» …»
//   M2  gjeninnfør `.slice(1)` i historikkruten              → 2 røde
//       «bonusquiz stenger sist …», «weekly uten forsøk stenger sist …»
//   M3  ekskluder på `title` i stedet for `id`               → 6 røde
//   M4  fjern `.eq('quiz_type', LAST_QUIZ_TYPE)`             → 1 rød
//       «bonusquiz stenger sist …»
//       ⚠ M4 GJELDER IKKE LENGER — se mutasjonsloggen for 31. august under.
//   M5  fjern `attempts!inner(id)` (forsøkskravet)           → 1 rød
//       «weekly uten forsøk stenger sist …»
//
// M3 er verdt en merknad. Med `title === id` i fixturen var den GRØNN her —
// et filter skrevet på feil kolonne så identisk ut, og beviset beviste
// ingenting. Titlene ble derfor gjort ulike id-ene, og `sjekkDekning` sjekker
// nå begge kolonnene hver for seg.
//
// ── MUTASJONER KJØRT 31. AUGUST 2026 (definisjonsendringen) ────────────────
// Kjørt mot lib/last-quiz-definition.test.ts + lib/toppliste-real-quiz-
// population.test.ts + lib/org-real-quiz-population.test.ts +
// lib/real-quiz-population.test.ts (35 tester). Hver mutasjon verifisert med
// `git diff` FØR testresultatet ble lest, og reversert etterpå.
//
// «Slipper bonus inn» — den nye regelen, ett kallsted hver:
//   N1  lib/last-quiz.ts:  `.in(…LAST_QUIZ_SEASON_TYPES)` → `.eq(…,'weekly')`
//                                                             → 3 røde
//       «bonusquiz stenger sist …», «bonusquiz STENGT mens fredagsquizen er
//       ÅPEN …», «last_quiz: bonusquiz KAN overta Siste quiz …»
//   N2  toppliste/route.ts (emptyResponse), samme substitusjon    → 1 rød
//       «tom toppliste: åpen bonusquiz SETTER activeQuizClosesAt»
//   N3  org/[slug]/quiz-scores/route.ts, samme substitusjon       → 1 rød
//       «quiz-scores: bonusquiz som stenger sist EIER bedriftens …»
//
// «Slipper ikke arkiv/test inn» — og her er funnet som er verdt å skrive ned:
//   N4  fjern `.in(…)` fra fetchLastQuiz, behold gulvet          → 0 røde
//   N5  utvid LAST_QUIZ_SEASON_TYPES med 'archive'               → 0 røde
//   N6  fjern `onlyRealQuizzes(…)` fra fetchLastQuiz, behold `.in`→ 1 rød
//       «last_quiz: spilt testquiz overtar ikke Siste quiz» — arkivtesten
//       overlevde, fordi `.in` fortsatt utelukker 'archive'
//   N7  fjern BEGGE i fetchLastQuiz                              → 3 røde
//       inkl. «last_quiz: spilt arkivkopi overtar ikke Siste quiz»
//   N8/N9  samme par på emptyResponse   → gulvet alene: 2 røde (begge
//       testquiz-testene); begge fjernet: 3 røde, arkivtesten med
//   N10/N11 samme par på quiz-scores    → gulvet alene: 1 rød (is_test);
//       begge fjernet: 2 røde, arkivtesten med
//
// N4–N7 er poenget: de to vaktene OVERLAPPER på quiz_type-aksen, og `is_test`
// holdes KUN av gulvet. En mutasjonsrunde som stopper etter N6 ville meldt
// arkivtestene som tannløse. De er dekket to ganger — ikke ikke-dekket.
// Se lib/last-quiz.ts for hvorfor overlappet står med vilje.
//
// M4 fra 26. august er dermed erstattet: filteret er ikke lenger `.eq`, og
// den gamle testen den felte er skrevet om (se kommentaren i selve testen).
