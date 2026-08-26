// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av POPULASJONEN i de fire leserne som rangerte og telte over
// alle quiz-rader, uten å skille ekte quizer fra kunstige:
//   1. /api/leagues/[id]/leaderboard    — «siste quiz», all-time, beste_plassering
//   2. /api/toppliste/history           — de 21 nyeste stengte
//   3. /api/leaderboard/[id]/prev-rank  — «forrige quiz» for trendmerket
//   4. /api/admin/dashboard             — «Deltakere siste quiz»
//   5. countActivePlayersSince (lib/attempt-answer-stats.ts) — JS-fallbacken
//      bak forsidens «X aktive spillere siste 12 uker»; RPC-søsteren fikk
//      samme filter i migrasjon 20260825000000 (SQL, kan ikke testes herfra)
//
// ── HVORFOR EN FAKE SOM FAKTISK FILTRERER ──────────────────────────────────
// Testene her er BEHAVIORAL, ikke strukturelle: de sjekker ikke at et kall til
// `.not(...)` finnes i kildekoden, de sjekker hvilken quiz som vinner. En
// strukturell test ville passert på utkommentert kode, og den ville ikke fanget
// et filter som er skrevet riktig, men på feil kolonne.
//
// Prisen er at faken må evaluere filtrene på ekte — inkludert de EMBEDDEDE
// (`quizzes.is_test` på en attempts-spørring), som er hele mekanismen i funn 1.
// Det er derfor `hentVerdi()` slår opp den relaterte quiz-raden i stedet for å
// late som filteret ikke finnes.
//
// ── MUTASJONSBEVIS (kjørt 25. august 2026, hver mutasjon gjenopprettet) ─────
//   • fjern `q = onlyRealQuizAttempts(q)` i leagues/[id]/leaderboard  → feiler
//     «liga: testquiz blir ikke siste quiz og teller ikke i all-time»
//   • fjern `onlyRealQuizzes(...)` i toppliste/history                → feiler
//     «toppliste/history: kunstige quizer spiser ikke plasser i limit(21)»
//   • fjern `onlyRealQuizzes(...)` i leaderboard/[id]/prev-rank       → feiler
//     «prev-rank: forrige quiz er forrige EKTE quiz»
//   • fjern `onlyRealQuizzes(...)` i admin/dashboard                  → feiler
//     «admin/dashboard: siste quiz er siste EKTE quiz»
//   • bytt `.not('is_test', 'is', true)` → `.eq('is_test', false)`    → feiler
//     «helper: is_test = NULL regnes som ekte quiz»
//   • fjern `.in('quiz_type', ...)` fra onlyRealQuizzes               → feiler
//     «helper: arkiv- og testtyper faller ut av hvitelisten»
//   • fjern `onlyRealQuizAttempts(base)` i countActivePlayersSince
//     sin fallback (kjørt 25. august 2026)                            → feiler
//     «countActivePlayersSince-fallback: teller kun spillere på ekte quizer»
//     MERK: å fjerne KUN embeden fra selectet fanges ikke av faken (den slår
//     opp relasjonen uansett) — men i prod svarer PostgREST da 400 PGRST108,
//     fetchAllRows kaster, og forsidevakten skjuler stat-raden. Høylytt, ikke
//     stille — den greie retningen å ta feil i.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const KALLER   = '11111111-1111-1111-1111-111111111111'
const MEDSPILL = '22222222-2222-2222-2222-222222222222'
const TREDJE   = '33333333-3333-3333-3333-333333333333'
const LIGA     = 'aaaaaaaa-0000-0000-0000-000000000001'

type Rad = Record<string, unknown>

const db: Record<string, Rad[]> = {
  quizzes: [], attempts: [], profiles: [], leagues: [], league_members: [],
  season_scores: [], organizations: [], excluded_members: [], rivalries: [],
}

const rpcSvar: Record<string, unknown> = {
  weekly_active_players: [],
  count_active_leagues: 0,
}

// RPC-er som skal FEILE i en gitt test — slik at JS-fallbacken deres faktisk
// kjøres. Tom mellom tester (beforeEach).
const rpcFeil: Record<string, { message: string }> = {}

// ── Fake-spørringsbygger med ekte filterevaluering ──────────────────────────
//
// Relasjonen attempts→quizzes er den eneste embeden som trengs, og den er
// many-to-one: én quiz-rad per attempt, aldri en liste. Det speiler prod, der
// `quizzes!inner(id)` målt IKKE multipliserte radsettet (625 = 625).
function slåOppRelasjon(tabell: string, rad: Rad, relasjon: string): Rad | undefined {
  if (tabell === 'attempts' && relasjon === 'quizzes') {
    return db.quizzes.find(q => q.id === rad.quiz_id)
  }
  // quizzes→attempts (fra 26. august 2026): fanens oppslag i lib/last-quiz.ts
  // bruker `attempts!inner(id)` som et rent EXISTS-filter. Retningen er
  // one-to-many i prod, altså en LISTE — men verdien leses aldri av noen
  // kaller, kun eksistensen, og `limit(1, { referencedTable: 'attempts' })`
  // gjør oppslaget til nettopp ett treff. Første match er derfor riktig
  // modell her.
  if (tabell === 'quizzes' && relasjon === 'attempts') {
    return db.attempts.find(a => a.quiz_id === rad.id)
  }
  throw new Error(`faken kjenner ikke relasjonen ${tabell}→${relasjon}`)
}

function hentVerdi(tabell: string, rad: Rad, kolonne: string): unknown {
  if (!kolonne.includes('.')) return rad[kolonne]
  const [relasjon, felt] = kolonne.split('.')
  const relatert = slåOppRelasjon(tabell, rad, relasjon)
  return relatert?.[felt]
}

function builder(tabell: string) {
  if (!(tabell in db)) throw new Error(`ukjent tabell i mock: ${tabell}`)

  const filtre: Array<(r: Rad) => boolean> = []
  let selectCols = '*'
  let vilHaCount = false, headOnly = false
  let orderCol: string | null = null, orderAsc = true
  let limitN: number | null = null
  let rangeFra: number | null = null, rangeTil: number | null = null
  let innerEmbed: string | null = null

  const V = (r: Rad, c: string) => hentVerdi(tabell, r, c)

  const b = {
    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      if (cols) selectCols = cols
      // `!inner` gjør embeden til et filter: en rad uten relatert quiz-rad
      // forsvinner. Uten utropstegnet ville den blitt liggende med null.
      const m = /(\w+)!inner/.exec(selectCols)
      if (m) { innerEmbed = m[1]; filtre.push(r => !!slåOppRelasjon(tabell, r, m[1])) }
      if (opts?.count) vilHaCount = true
      if (opts?.head)  headOnly = true
      return b
    },
    eq(col: string, val: unknown)  { filtre.push(r => V(r, col) === val); return b },
    neq(col: string, val: unknown) { filtre.push(r => V(r, col) !== val); return b },
    gt(col: string, val: string)   { filtre.push(r => V(r, col) != null && String(V(r, col)) >  val); return b },
    gte(col: string, val: string)  { filtre.push(r => V(r, col) != null && String(V(r, col)) >= val); return b },
    lt(col: string, val: string)   { filtre.push(r => V(r, col) != null && String(V(r, col)) <  val); return b },
    lte(col: string, val: string)  { filtre.push(r => V(r, col) != null && String(V(r, col)) <= val); return b },
    is(col: string, val: unknown)  { filtre.push(r => (val === null ? V(r, col) == null : V(r, col) === val)); return b },
    in(col: string, vals: readonly unknown[]) { filtre.push(r => vals.includes(V(r, col))); return b },
    not(col: string, op: string, val: unknown) {
      if (op !== 'is') throw new Error(`faken støtter kun .not(col, 'is', …), fikk '${op}'`)
      // PostgREST: `not.is.true` = NOT (kol IS TRUE) → sant for BÅDE false og
      // NULL. Det er nettopp den semantikken helperen hviler på.
      if (val === null) filtre.push(r => V(r, col) != null)
      else              filtre.push(r => V(r, col) !== val)
      return b
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col; orderAsc = opts?.ascending !== false; return b
    },
    limit(n: number, opts?: { referencedTable?: string }) {
      if (!opts?.referencedTable) limitN = n
      return b
    },
    range(fra: number, til: number) { rangeFra = fra; rangeTil = til; return b },

    rader(): Rad[] {
      let ut = db[tabell].filter(r => filtre.every(f => f(r)))
      if (orderCol) {
        const c = orderCol
        ut = [...ut].sort((x, y) => {
          const a = String(V(x, c) ?? ''), z = String(V(y, c) ?? '')
          return orderAsc ? a.localeCompare(z) : z.localeCompare(a)
        })
      }
      if (limitN !== null) ut = ut.slice(0, limitN)
      if (rangeFra !== null && rangeTil !== null) ut = ut.slice(rangeFra, rangeTil + 1)
      // Embeden gjengis som ETT objekt (many-to-one), ikke en liste.
      if (innerEmbed) {
        const rel = innerEmbed
        ut = ut.map(r => ({ ...r, [rel]: { id: slåOppRelasjon(tabell, r, rel)!.id } }))
      }
      return ut
    },
    maybeSingle() { return Promise.resolve({ data: b.rader()[0] ?? null, error: null }) },
    single()      { return Promise.resolve({ data: b.rader()[0] ?? null, error: null }) },
    // Typet resolve-parameter: det er den som gir `await` sin type, så uten den
    // blir hvert oppslag i testene `unknown` og tsc rødt.
    then(resolve: (v: { data: Rad[] | null; count?: number; error: null }) => void) {
      if (headOnly || vilHaCount) {
        const n = b.rader().length
        return resolve({ data: headOnly ? null : b.rader(), count: n, error: null })
      }
      return resolve({ data: b.rader(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      rpc: (navn: string) =>
        Promise.resolve(
          rpcFeil[navn]
            ? { data: null, error: rpcFeil[navn] }
            : { data: rpcSvar[navn] ?? null, error: null }
        ),
      auth: {
        getUser: (token?: string) =>
          Promise.resolve(
            token ? { data: { user: { id: KALLER } }, error: null }
                  : { data: { user: null }, error: { message: 'ingen token' } }
          ),
      },
    },
  },
})

// Utenfor det testen handler om — stubbet slik at rutene kan kjøre.
mock.module('@/lib/admin-auth',           { namedExports: { verifyAdminRequest: () => true } })
mock.module('@/lib/globally-blocked-set', { namedExports: { getGloballyBlockedSet: async () => new Set<string>() } })
mock.module('@/lib/retention',            { namedExports: { fetchRetentionRows: async () => [], latestClosedRetention: () => null } })

const dagerSiden = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function quiz(id: string, lukket: string, over: Partial<Rad> = {}): Rad {
  return { id, title: `Quiz ${id}`, closes_at: lukket, opens_at: dagerSiden(400),
           quiz_type: 'weekly', is_test: false, is_active: true,
           season_points_awarded: true, ...over }
}

let løpenr = 0
function forsøk(quizId: string, userId: string, riktige: number, tidMs: number, over: Partial<Rad> = {}): Rad {
  return { id: `att-${++løpenr}`, quiz_id: quizId, user_id: userId,
           player_name: `Spiller ${userId.slice(0, 2)}`, is_team: false, team_size: 1,
           correct_answers: riktige, total_questions: 10, total_time_ms: tidMs,
           correct_streak: riktige, completed_at: dagerSiden(1), submitted_at: dagerSiden(1),
           leader_display_name: null, ...over }
}

// De tre formene en «ikke-ekte» quiz kan ha. Alle tre må falle ut, og de faller
// ut av HVER SIN halvdel av definisjonen — derfor står de sammen i hver test:
//   TEST_TYPE  → oppskriftens testquiz, fanges av hvitelisten på quiz_type
//   TEST_FLAGG → admin-editorens testbryter; quiz_type er fortsatt 'weekly',
//                så KUN is_test stopper den
//   ARKIV      → framtidig arkivforsøk, fanges av hvitelisten (ikke av is_test)
const TEST_TYPE  = { quiz_type: 'test',    is_test: true  }
const TEST_FLAGG = { quiz_type: 'weekly',  is_test: true  }
const ARKIV      = { quiz_type: 'archive', is_test: false }

beforeEach(() => {
  for (const t of Object.keys(db)) db[t] = []
  for (const k of Object.keys(rpcFeil)) delete rpcFeil[k]
  løpenr = 0
})

// ════════════════════════════════════════════════════════════════════════════
// Helperen selv
// ════════════════════════════════════════════════════════════════════════════

test('helper: is_test = NULL regnes som ekte quiz', async () => {
  const { onlyRealQuizzes } = await import('@/lib/real-quiz-population')
  db.quizzes = [quiz('null-rad', dagerSiden(2), { is_test: null })]

  const { data } = await onlyRealQuizzes(builder('quizzes').select('id'))

  // `.eq('is_test', false)` ville droppet denne raden stille — kolonnen er
  // NULLABLE, og en NULL matcher ingen likhetssammenligning.
  assert.equal((data as Rad[]).length, 1,
    'is_test = NULL må passere: filteret skal være .not(is_test, is, true), ikke .eq(is_test, false)')
})

test('helper: arkiv- og testtyper faller ut av hvitelisten', async () => {
  const { onlyRealQuizzes, REAL_QUIZ_TYPES } = await import('@/lib/real-quiz-population')
  db.quizzes = [
    quiz('ekte',  dagerSiden(2)),
    quiz('bonus', dagerSiden(2), { quiz_type: 'bonus' }),
    quiz('arkiv', dagerSiden(2), ARKIV),
    quiz('test',  dagerSiden(2), TEST_TYPE),
    quiz('ukjent-fremtidig-type', dagerSiden(2), { quiz_type: 'duell-2027' }),
  ]

  const { data } = await onlyRealQuizzes(builder('quizzes').select('id'))
  const ids = (data as Rad[]).map(r => r.id).sort()

  assert.deepEqual(ids, ['bonus', 'ekte'],
    'hviteliste, ikke svarteliste: en ukjent framtidig quiz_type skal falle ut UTEN at helperen endres')
  assert.deepEqual([...REAL_QUIZ_TYPES], ['weekly', 'bonus'])
})

test('helper: arkivrader blir liggende og er finnbare for en senere XP-modell', async () => {
  db.quizzes = [quiz('arkiv', dagerSiden(2), ARKIV)]

  // Poenget: filteret er en LESEBEGRENSNING, ikke en sletting og ikke et
  // skjul-flagg. En spørring som ber om arkivet eksplisitt får det.
  const { data } = await builder('quizzes').select('id').eq('quiz_type', 'archive')

  assert.equal((data as Rad[]).length, 1)
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 1 — /api/leagues/[id]/leaderboard
// ════════════════════════════════════════════════════════════════════════════

test('liga: testquiz blir ikke siste quiz og teller ikke i all-time', async () => {
  const { GET } = await import('@/app/api/leagues/[id]/leaderboard/route')

  db.leagues = [{ id: LIGA, name: 'Kontoret', reset_at: null }]
  db.league_members = [
    { league_id: LIGA, user_id: KALLER },
    { league_id: LIGA, user_id: MEDSPILL },
  ]
  db.profiles = [
    { id: KALLER,   display_name: 'Kaller' },
    { id: MEDSPILL, display_name: 'Medspiller' },
  ]
  db.quizzes = [
    quiz('ekte',  dagerSiden(7)),
    quiz('test',  dagerSiden(1), TEST_TYPE),   // stengte SIST → vinner ellers
    quiz('flagg', dagerSiden(2), TEST_FLAGG),
    quiz('arkiv', dagerSiden(3), ARKIV),
  ]
  db.attempts = [
    forsøk('ekte',  KALLER,   8, 50_000, { completed_at: dagerSiden(7) }),
    forsøk('ekte',  MEDSPILL, 6, 60_000, { completed_at: dagerSiden(7) }),
    // Testkjøring: full pott på null tid. Nøyaktig den raden som ville
    // forgiftet både «siste quiz», snittet og beste_plassering.
    forsøk('test',  KALLER,  10,  1_000, { completed_at: dagerSiden(1) }),
    forsøk('flagg', KALLER,  10,  1_000, { completed_at: dagerSiden(2) }),
    forsøk('arkiv', KALLER,  10,  1_000, { completed_at: dagerSiden(3) }),
  ]

  const res = await GET(
    new Request('http://x/api/leagues/x/leaderboard', { headers: { authorization: 'Bearer t' } }) as never,
    { params: Promise.resolve({ id: LIGA }) },
  )
  const body = await res.json() as {
    siste_quiz: { quiz_id: string } | null
    all_time: { user_id: string; quiz_count: number; avg_score_pct: number; beste_plassering: number | null }[]
  }

  assert.equal(body.siste_quiz?.quiz_id, 'ekte',
    'siste quiz i ligaen skal være siste EKTE quiz — en testquiz stenger sist og vinner ellers maks completed_at')

  const kaller = body.all_time.find(u => u.user_id === KALLER)!
  assert.equal(kaller.quiz_count, 1, 'all-time skal telle 1 quiz, ikke 4 — tre av dem er kunstige')
  assert.equal(kaller.avg_score_pct, 80, 'snittet skal være 8/10 fra den ekte quizen, ikke løftet av 10/10-testrader')
  assert.equal(kaller.beste_plassering, 1,
    'beste_plassering regnes per quiz-id over settet — kunstige quizer skal ikke kunne dele ut plasseringer')
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 2 — /api/toppliste/history
// ════════════════════════════════════════════════════════════════════════════

test('toppliste/history: kunstige quizer spiser ikke plasser i limit(21)', async () => {
  const { GET } = await import('@/app/api/toppliste/history/route')

  // 21 ekte quizer: R01 (eldst) … R21 (nyest). Ruten henter 21 og utelater den
  // hovedfanen viser, så fasiten er R01..R20.
  //
  // Hver quiz får ETT forsøk (26. august 2026): hvilken quiz hovedfanen viser
  // avgjøres nå av lib/last-quiz.ts, som krever minst ett forsøk
  // (`attempts!inner`). Uten forsøk ville fanen vært tom, ingenting blitt
  // utelatt, og listen forskjøvet til R21..R02 — altså ville denne testen
  // felt en helt annen ting enn populasjonsfilteret den handler om.
  db.quizzes = []
  db.attempts = []
  for (let i = 1; i <= 21; i++) {
    const id = `R${String(i).padStart(2, '0')}`
    db.quizzes.push(quiz(id, dagerSiden(100 - i)))
    db.attempts.push(forsøk(id, KALLER, 8, 60_000))
  }
  // Én kunstig quiz som stengte aller sist. Uten filteret spiser DEN en plass i
  // limit(21) og presser R01 ut av listen, samtidig som den legger seg der
  // fanens quiz skal utelates. Listen forskyves altså i BEGGE ender.
  db.quizzes.push(quiz('KUNSTIG', dagerSiden(78), TEST_TYPE))
  db.attempts.push(forsøk('KUNSTIG', KALLER, 10, 1_000))

  const res = await GET(new Request('http://x/api/toppliste/history?period=last_quiz&scope=global') as never)
  const body = await res.json() as { entries: { key: string }[] }
  const nøkler = body.entries.map(e => e.key).sort()

  const fasit = Array.from({ length: 20 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`)
  assert.deepEqual(nøkler, fasit,
    'listen skal være R01–R20: den kunstige quizen skal hverken stå i den eller skyve R21 inn / R01 ut')
  assert.ok(!nøkler.includes('KUNSTIG'))
  assert.ok(!nøkler.includes('R21'), 'R21 er nyeste ekte quiz og hører hjemme i hovedfanen, ikke i historikken')
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 3 — /api/leaderboard/[id]/prev-rank
// ════════════════════════════════════════════════════════════════════════════

test('prev-rank: forrige quiz er forrige EKTE quiz', async () => {
  const { GET } = await import('@/app/api/leaderboard/[id]/prev-rank/route')

  db.quizzes = [
    quiz('naa',   dagerSiden(1)),               // quizen man ser på
    quiz('test',  dagerSiden(2), TEST_TYPE),    // stengte MELLOM → vinner ellers
    quiz('ekte',  dagerSiden(9)),               // faktisk forrige ekte quiz
  ]
  db.attempts = [
    // Kalleren ble nr. 3 i den ekte forrige quizen.
    forsøk('ekte', TREDJE,   9, 10_000),
    forsøk('ekte', MEDSPILL, 8, 10_000),
    forsøk('ekte', KALLER,   7, 10_000),
    // Testquizen ble kun kjørt av én person, og ikke av kalleren. Uten filteret
    // finnes kalleren dermed ikke i «forrige quiz», og trendmerket forsvinner
    // stille for alle — ingen feilmelding noe sted.
    forsøk('test', MEDSPILL, 10, 1_000),
  ]

  const res = await GET(
    new Request('http://x/api/leaderboard/naa/prev-rank', { headers: { authorization: 'Bearer t' } }) as never,
    { params: Promise.resolve({ id: 'naa' }) },
  )
  const body = await res.json() as { prevRanks: Record<string, number> }

  assert.deepEqual(body.prevRanks, { [KALLER]: 3 },
    'sammenligningsgrunnlaget skal være den ekte quizen kalleren faktisk spilte, ikke testquizen som stengte sist')
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 4 — /api/admin/dashboard
// ════════════════════════════════════════════════════════════════════════════

test('admin/dashboard: siste quiz er siste EKTE quiz', async () => {
  const { GET } = await import('@/app/api/admin/dashboard/route')

  db.quizzes = [
    quiz('ekte',  dagerSiden(7)),
    quiz('test',  dagerSiden(1), TEST_TYPE),
    quiz('flagg', dagerSiden(2), TEST_FLAGG),
  ]
  db.attempts = [
    forsøk('ekte', KALLER,   8, 50_000),
    forsøk('ekte', MEDSPILL, 6, 60_000),
    forsøk('ekte', TREDJE,   5, 70_000),
    forsøk('test', KALLER,  10,  1_000),   // testkjøringens ene rad
  ]

  const res = await GET(new Request('http://x/api/admin/dashboard') as never)
  const body = await res.json() as { lastQuiz: { id: string; participants: number } | null }

  assert.equal(body.lastQuiz?.id, 'ekte',
    '[A-7]: kortet skal vise siste ekte quiz — ellers er «Deltakere siste quiz» radene fra en testkjøring')
  assert.equal(body.lastQuiz?.participants, 3,
    'deltakertallet skal følge den ekte quizen (3), ikke testquizens ene rad')
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 5 — countActivePlayersSince sin JS-fallback (forsidens «X aktive
// spillere siste 12 uker»). RPC-stien fikk populasjonsgulvet i migrasjon
// 20260825000000 og kan ikke testes herfra (den er SQL); fallbacken MÅ speile
// den, ellers teller de to stiene ulike populasjoner og et RPC-bortfall
// endrer forsidetallet stille.
// ════════════════════════════════════════════════════════════════════════════

test('countActivePlayersSince-fallback: teller kun spillere på ekte quizer', async () => {
  const { countActivePlayersSince } = await import('@/lib/attempt-answer-stats')

  // Tving fallbacken: RPC-en later som den ikke finnes (samme situasjon som
  // «deployet før migrasjonen er kjørt» — mønsteret koden eksplisitt lover).
  rpcFeil.count_active_players_since = { message: 'function does not exist (simulert)' }

  db.quizzes = [
    quiz('ekte',  dagerSiden(2)),
    quiz('test',  dagerSiden(1), TEST_TYPE),
    quiz('flagg', dagerSiden(1), TEST_FLAGG),
    quiz('arkiv', dagerSiden(1), ARKIV),
  ]
  db.attempts = [
    forsøk('ekte',  KALLER,   8, 50_000),
    // KALLER har OGSÅ et testforsøk — skal hverken telle dobbelt eller felle
    // KALLER ut av tellingen.
    forsøk('test',  KALLER,  10,  1_000),
    // MEDSPILL og TREDJE finnes KUN på kunstige quizer. Uten filteret ville
    // de blåst tallet fra 1 til 3 — nøyaktig det arkivspill vil gjøre.
    forsøk('flagg', MEDSPILL, 10, 1_000),
    forsøk('arkiv', TREDJE,  10,  1_000),
    // Eksisterende avgrensninger skal bestå: gjest og lag teller fortsatt ikke.
    forsøk('ekte',  KALLER,   5, 10_000, { user_id: null }),
    forsøk('ekte',  MEDSPILL, 5, 10_000, { is_team: true, team_size: 3 }),
  ]

  const n = await countActivePlayersSince(dagerSiden(30))

  assert.equal(n, 1,
    'fallbacken skal telle 1 aktiv spiller (KALLER på den ekte quizen) — ikke 3: ' +
    'spillere som kun finnes på test-/flagg-/arkivquizer er ikke ukentlig deltakelse')
})
