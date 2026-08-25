// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av POPULASJONEN i /api/toppliste — den OFFENTLIGE
// topplisten. To oppslag mot `quizzes` avgrenset på `quiz_type = 'weekly'`
// uten noen `is_test`-vakt:
//
//   1. last_quiz-grenen  — «Siste quiz»-fanen: tittel, deltakere, rangering
//   2. emptyResponse     — `activeQuizClosesAt`, som klienten oversetter til
//                          «er det en quiz i gang akkurat nå?»
//
// ── HVORFOR attempts!inner IKKE VAR NOK (funn 1) ───────────────────────────
// last_quiz-oppslaget hadde allerede en vakt mot testquizer, og kommentaren
// over den sier hva den var ment å stoppe: «testquizer med closes_at i
// fremtiden og 0 attempts». Den formuleringen er hele hullet. `attempts!inner`
// stopper en testquiz som ALDRI BLE SPILT — men .claude/QK_TESTQUIZ_OPPSKRIFT.md
// finnes nettopp for at testquizer skal spilles, og en spilt testquiz passerer
// joinen uten videre.
//
// `.eq('quiz_type','weekly')` fanger oppskriftens quiz (`quiz_type='test'`).
// Den fanger IKKE admin-editorens testbryter, som setter `is_test = true` mens
// nedtrekket blir stående på 'weekly'. Testene under bruker derfor nettopp den
// formen — TEST_FLAGG — for begge funnene: det er den ENE quiz-formen som
// slipper gjennom begge de gamle vaktene samtidig.
//
// ── HVORFOR EN FAKE SOM FAKTISK FILTRERER ──────────────────────────────────
// Samme begrunnelse som lib/real-quiz-population.test.ts og
// lib/org-real-quiz-population.test.ts: testene er BEHAVIORAL. De sjekker ikke
// at et `.not(...)` finnes i kildekoden — en slik test passerer på utkommentert
// kode og fanger ikke et filter skrevet på feil kolonne. De sjekker hvilken
// quiz som vinner, og hvilken stengetid forsiden får.
//
// ── MUTASJONSBEVIS (kjørt 25. august 2026, hver mutasjon gjenopprettet) ─────
//   • fjern `onlyRealQuizzes(...)` fra last_quiz-oppslaget       → feiler
//     «last_quiz: spilt testquiz overtar ikke Siste quiz»
//   • fjern `onlyRealQuizzes(...)` fra emptyResponse-oppslaget   → feiler
//     «tom toppliste: testquiz setter ikke activeQuizClosesAt»
//   • bytt helperen mot `.eq('is_test', false)` begge steder     → feiler
//     «last_quiz: is_test = NULL regnes fortsatt som ekte quiz»
//     (og INGEN av de to over — de to formene er ikke utbyttbare)
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const SPILLER_A = '11111111-1111-1111-1111-111111111111'
const SPILLER_B = '22222222-2222-2222-2222-222222222222'

type Rad = Record<string, unknown>

const db: Record<string, Rad[]> = {
  quizzes: [], attempts: [], profiles: [], excluded_members: [], season_scores: [],
}

const rpcSvar: Record<string, unknown> = {
  season_leaderboard_ranked: [],
  season_leaderboard_period_quizzes: [],
  season_leaderboard_user_stats: [],
}

// ── Fake-spørringsbygger med ekte filterevaluering ──────────────────────────
//
// `!inner` gjør embeden til et FILTER: en quiz uten forsøk forsvinner. Det er
// den gamle vakten i last_quiz-grenen, og den MÅ modelleres — ellers ville
// testen ikke kunne vise at den gamle vakten er utilstrekkelig, bare at den
// mangler.
function harForsok(quizId: unknown): boolean {
  return db.attempts.some(a => a.quiz_id === quizId)
}

function builder(tabell: string) {
  if (!(tabell in db)) throw new Error(`ukjent tabell i mock: ${tabell}`)

  const filtre: Array<(r: Rad) => boolean> = []
  let orderCol: string | null = null, orderAsc = true
  let limitN: number | null = null
  let rangeFra: number | null = null, rangeTil: number | null = null

  const b = {
    select(cols?: string) {
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
      // PostgREST: `not.is.true` = NOT (kol IS TRUE) → sant for BÅDE false og
      // NULL. Det er nettopp den semantikken helperen hviler på.
      if (val === null) filtre.push(r => r[col] != null)
      else              filtre.push(r => r[col] !== val)
      return b
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col; orderAsc = opts?.ascending !== false; return b
    },
    limit(n: number, opts?: { referencedTable?: string }) {
      // limit på en REFERERT tabell begrenser embeden, ikke radsettet — den er
      // et rent EXISTS-triks i ruten, og skal ikke kutte quiz-listen her.
      if (!opts?.referencedTable) limitN = n
      return b
    },
    range(fra: number, til: number) { rangeFra = fra; rangeTil = til; return b },

    rader(): Rad[] {
      let ut = db[tabell].filter(r => filtre.every(f => f(r)))
      if (orderCol) {
        const c = orderCol
        ut = [...ut].sort((x, y) => {
          const a = String(x[c] ?? ''), z = String(y[c] ?? '')
          return orderAsc ? a.localeCompare(z) : z.localeCompare(a)
        })
      }
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
      rpc: (navn: string) => Promise.resolve({ data: rpcSvar[navn] ?? null, error: null }),
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    },
  },
})

// Utenfor det testen handler om — stubbet slik at ruten kan kjøre.
mock.module('@/lib/globally-blocked-set', {
  namedExports: { getGloballyBlockedSet: async () => new Set<string>() },
})
mock.module('@/lib/premium-check', {
  namedExports: { getUserPremium: async () => ({ ok: true as const, isPremium: false }) },
})

const dagerSiden = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const dagerFram  = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

function quiz(id: string, over: Partial<Rad> = {}): Rad {
  return { id, title: `Quiz ${id}`, opens_at: dagerSiden(30), closes_at: dagerSiden(29),
           created_at: dagerSiden(31), quiz_type: 'weekly', is_test: false, is_active: true,
           season_points_awarded: true,
           // Begge skjul-gatene AV: denne testen handler om hvilken quiz som
           // velges, ikke om stillingen vises.
           hide_leaderboard_until_closed: false, show_leaderboard: true, ...over }
}

let lopenr = 0
function forsok(quizId: string, userId: string, riktige = 8, over: Partial<Rad> = {}): Rad {
  return { id: `att-${++lopenr}`, quiz_id: quizId, user_id: userId,
           player_name: `Spiller ${userId.slice(0, 2)}`, is_team: false,
           correct_answers: riktige, total_time_ms: 60_000, correct_streak: riktige,
           submitted_at: dagerSiden(1), completed_at: dagerSiden(1), ...over }
}

// Admin-editorens testbryter: `is_test = true` mens nedtrekket blir stående på
// 'weekly' (app/admin/quizzes/new/page.tsx:1061). Den ENE formen som slipper
// forbi BÅDE `.eq('quiz_type','weekly')` OG `attempts!inner` — sistnevnte så
// snart quizen faktisk er spilt, som er hele poenget med en testquiz.
const TEST_FLAGG = { quiz_type: 'weekly', is_test: true }

type RuteRequest = Parameters<typeof import('@/app/api/toppliste/route')['GET']>[0]

// Anonym forespørsel, som forsiden gjør den. Ingen authorization-header.
const req = (qs: string) =>
  new Request(`https://quizkanonen.no/api/toppliste?${qs}`) as unknown as RuteRequest

beforeEach(() => {
  for (const t of Object.keys(db)) db[t] = []
  lopenr = 0
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 1 — last_quiz-grenen
// ════════════════════════════════════════════════════════════════════════════

test('last_quiz: spilt testquiz overtar ikke Siste quiz', async () => {
  const { GET } = await import('@/app/api/toppliste/route')

  // Testquizen er SPILT — altså passerer den `attempts!inner` — og stenger
  // ferskest, så den vinner `order('closes_at', desc)`. Unike quiz-id-er per
  // test: getLastQuizAttempts har en modul-lokal cache med 30 s TTL.
  db.quizzes = [
    quiz('lq-ekte', { closes_at: dagerSiden(7), title: 'Fredagsquiz uke 34' }),
    quiz('lq-bryter', { closes_at: dagerSiden(1), title: '[TEST via bryter]', ...TEST_FLAGG }),
  ]
  db.attempts = [
    forsok('lq-ekte', SPILLER_A, 9), forsok('lq-ekte', SPILLER_B, 5),
    forsok('lq-bryter', SPILLER_A, 1),
  ]
  db.profiles = [
    { id: SPILLER_A, display_name: 'Anne', nickname: null },
    { id: SPILLER_B, display_name: 'Bjørn', nickname: null },
  ]

  const res = await GET(req('period=last_quiz&scope=global'))
  const body = await res.json() as { quizTitle: string | null; entries: unknown[] }

  assert.equal(body.quizTitle, 'Fredagsquiz uke 34',
    'en spilt testquiz skal ikke kunne overta «Siste quiz» på den offentlige topplisten')
  assert.equal(body.entries.length, 2, 'deltakerlista skal komme fra den ekte quizen')
})

test('last_quiz: is_test = NULL regnes fortsatt som ekte quiz', async () => {
  const { GET } = await import('@/app/api/toppliste/route')

  // Motprøve mot en for STRENG erstatning. Kolonnen er nullable, og
  // `.eq('is_test', false)` ville droppet denne raden stille — da hadde
  // topplisten mistet «Siste quiz» helt i stedet for å vise feil quiz.
  db.quizzes = [quiz('lq-null', { closes_at: dagerSiden(7), title: 'Fredagsquiz uke 34', is_test: null })]
  db.attempts = [forsok('lq-null', SPILLER_A, 9), forsok('lq-null', SPILLER_B, 5)]
  db.profiles = [
    { id: SPILLER_A, display_name: 'Anne', nickname: null },
    { id: SPILLER_B, display_name: 'Bjørn', nickname: null },
  ]

  const res = await GET(req('period=last_quiz&scope=global'))
  const body = await res.json() as { quizTitle: string | null; entries: unknown[] }

  assert.equal(body.quizTitle, 'Fredagsquiz uke 34')
  assert.equal(body.entries.length, 2)
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 2 — emptyResponse sin activeQuizClosesAt
// ════════════════════════════════════════════════════════════════════════════

test('tom toppliste: testquiz setter ikke activeQuizClosesAt', async () => {
  const { GET } = await import('@/app/api/toppliste/route')

  // Ingen sesongpoeng i perioden → emptyResponse. Den slår da opp «neste quiz
  // som stenger», og verdien er ikke intern: klienten utleder `quizStillOpen`
  // av den (components/SeasonLeaderboard.tsx:914, :1225) og bytter mellom
  // «Poeng beregnes etter quizen» og «Spill en quiz for å komme på listen».
  //
  // Testquizen stenger FØR den ekte og vinner derfor `order('closes_at', asc)`.
  const ekteStenger = dagerFram(5)
  db.quizzes = [
    quiz('ar-ekte', { closes_at: ekteStenger, title: 'Fredagsquiz uke 35' }),
    quiz('ar-bryter', { closes_at: dagerFram(1), title: '[TEST via bryter]', ...TEST_FLAGG }),
  ]

  const res = await GET(req('period=month&scope=global'))
  const body = await res.json() as { entries: unknown[]; activeQuizClosesAt: string | null }

  assert.equal(body.entries.length, 0, 'forutsetningen: dette skal være emptyResponse-grenen')
  assert.equal(body.activeQuizClosesAt, ekteStenger,
    'stengetiden forsiden viser skal komme fra den ekte quizen, ikke fra en testquiz')
})

test('tom toppliste: bare en testquiz åpen gir ingen stengetid i det hele tatt', async () => {
  const { GET } = await import('@/app/api/toppliste/route')

  // Den verste varianten, og grunnen til at dette ikke bare er «feil dato»:
  // finnes det INGEN ekte quiz på vei, men en testquiz ligger åpen, lovte
  // topplisten «Poeng beregnes etter quizen» — altså at en quiz er i gang —
  // til alle som ikke har spilt. Svaret skal være null, som gir den ærlige
  // teksten «Spill en quiz for å komme på listen».
  db.quizzes = [
    quiz('ba-gammel', { closes_at: dagerSiden(7), title: 'Fredagsquiz uke 34' }),
    quiz('ba-bryter', { closes_at: dagerFram(1), title: '[TEST via bryter]', ...TEST_FLAGG }),
  ]

  const res = await GET(req('period=month&scope=global'))
  const body = await res.json() as { activeQuizClosesAt: string | null }

  assert.equal(body.activeQuizClosesAt, null,
    'en åpen testquiz skal ikke få topplisten til å love at en quiz er i gang')
})
