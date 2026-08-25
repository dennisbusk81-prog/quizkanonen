// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av de ekte rutehandlerne i org-admin. `mock.module` bytter ut
// lib/supabase-admin med en fake som faktisk HÅNDHEVER filtrene den får
// (.eq/.in/.gte/.lt/.not(col,'is',null)) mot rader i minnet. Det er hele poenget:
// en fake som ignorerer filtre ville bestått uansett hva ruten spør om, og da
// beviser testen ingenting.
//
// Bakgrunn: tre «aktiv»-definisjoner levde side om side i bedriftspanelet, og
// to av dem var direkte feil.
//
// MUTASJONSBEVIS — fjern linjen, og navngitt test skal feile:
//   1. `.not('submitted_at','is',null)` i quiz-scores sin leaderboard-spørring
//      → «uferdig forsøk teller ikke som spilt» feiler (b2 dukker opp i entries,
//        og ville dermed IKKE fått påminnelse om ukens quiz)
//   2. `.not('submitted_at','is',null)` i quiz-scores sin streak-spørring
//      → «uferdig forsøk holder ikke streaken i live» feiler
//   3. `.in('user_id', memberIds)` i admin-data sin season_scores-spørring
//      → «tidligere ansatt telles ikke som aktiv» feiler (2 i stedet for 1,
//        og activePercent kan passere 100 %)
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type Row = Record<string, unknown>

const state: {
  tables: Record<string, Row[]>
  authUserId: string
} = { tables: {}, authUserId: 'admin-1' }

function rowsFor(table: string): Row[] {
  return state.tables[table] ?? []
}

// Minimal PostgREST-etterligning. Kun operatorene rutene faktisk bruker —
// men de som er med, virker på ordentlig.
function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = []

  const settle = () => {
    const rows = rowsFor(table).filter(r => preds.every(p => p(r)))
    return { data: rows, error: null }
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { preds.push(r => r[col] === val); return b },
    in(col: string, vals: unknown[]) {
      // Embeddede kolonner (`quizzes.quiz_type`) kommer fra populasjonsfilteret
      // onlyRealQuizAttempts (25. august 2026). Faken har ingen relasjoner og
      // ville lest `r['quizzes.quiz_type']` som undefined — altså kastet ALLE
      // rader. Denne testen handler om «aktiv»-definisjonene, ikke om hvilke
      // quizer som er ekte; populasjonen felles av
      // lib/org-real-quiz-population.test.ts, som har en fake med ekte
      // relasjonsoppslag.
      if (col.includes('.')) return b
      const s = new Set(vals)
      preds.push(r => s.has(r[col]))
      return b
    },
    gte(col: string, val: string) { preds.push(r => r[col] != null && String(r[col]) >= val); return b },
    lt(col: string, val: string) { preds.push(r => r[col] != null && String(r[col]) < val); return b },
    // Kun formen rutene bruker: .not(col, 'is', null) = "kolonnen er satt".
    // Embeddede kolonner ignoreres av samme grunn som i .in() over.
    not(col: string, op: string, val: unknown) {
      if (col.includes('.')) return b
      if (op === 'is' && val === null) preds.push(r => r[col] != null && r[col] !== undefined)
      return b
    },
    order() { return b },
    limit() { return b },
    range() { return b },
    update() { return b },
    maybeSingle() {
      const { data } = settle()
      return Promise.resolve({ data: data[0] ?? null, error: null })
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(settle()).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: state.authUserId } }, error: null }),
      },
    },
  },
})

// Låsevakten har egne tester — her skal den aldri være det som avgjør utfallet.
mock.module('@/lib/org-lock-guard', {
  namedExports: { requireUnlockedOrg: () => Promise.resolve({ ok: true as const }) },
})

const { GET: quizScoresGET } = await import('@/app/api/org/[slug]/quiz-scores/route')
const { GET: adminDataGET } = await import('@/app/api/org/[slug]/admin-data/route')

const ORG = 'org-1'

// Rutene leser kun request.headers — resten av NextRequest er uinteressant her.
const req = () =>
  ({ headers: new Headers({ authorization: 'Bearer t' }) }) as unknown as Parameters<typeof quizScoresGET>[0]

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

beforeEach(() => {
  state.tables = {}
  state.authUserId = 'admin-1'
})

// ── Fiks 2: uferdige forsøk skal ikke regnes som spilt ────────────────────────

test('uferdig forsøk teller ikke som spilt (leaderboard + påminnelsesgrunnlag)', async () => {
  state.tables = {
    organization_members: [
      { organization_id: ORG, user_id: 'admin-1', role: 'admin' },
      { organization_id: ORG, user_id: 'a1', role: 'member' },
      { organization_id: ORG, user_id: 'b2', role: 'member' },
    ],
    quizzes: [{ id: 'q1', title: 'Ukens quiz', quiz_type: 'weekly' }],
    profiles: [
      { id: 'a1', display_name: 'Anne' },
      { id: 'b2', display_name: 'Bjørn' },
    ],
    attempts: [
      // Anne leverte.
      { quiz_id: 'q1', user_id: 'a1', player_name: 'Anne', correct_answers: 7, total_time_ms: 40_000, is_team: false, submitted_at: '2026-07-24T19:00:00Z', completed_at: '2026-07-24T18:00:00Z' },
      // Bjørn åpnet quizen og lukket fanen. start-attempt oppretter raden med
      // correct_answers: 0 og submitted_at: null — den skal ikke telle.
      { quiz_id: 'q1', user_id: 'b2', player_name: 'Bjørn', correct_answers: 0, total_time_ms: 0, is_team: false, submitted_at: null, completed_at: '2026-07-24T18:05:00Z' },
    ],
  }

  const res = await quizScoresGET(req(), ctx(ORG))
  assert.equal(res.status, 200)
  const json = await res.json() as { entries: Array<{ userId: string }> }

  const ids = json.entries.map(e => e.userId)
  assert.deepEqual(ids, ['a1'], 'kun Anne skal stå som deltaker på siste quiz')
  assert.ok(!ids.includes('b2'), 'Bjørn leverte aldri — han skal telles som «har ikke spilt» og få påminnelse')
})

test('uferdig forsøk holder ikke streaken i live', async () => {
  state.tables = {
    organization_members: [
      { organization_id: ORG, user_id: 'admin-1', role: 'admin' },
      { organization_id: ORG, user_id: 'b2', role: 'member' },
    ],
    quizzes: [{ id: 'q1', title: 'Ukens quiz', quiz_type: 'weekly' }],
    profiles: [{ id: 'b2', display_name: 'Bjørn' }],
    attempts: [
      { quiz_id: 'q1', user_id: 'b2', player_name: 'Bjørn', correct_answers: 0, total_time_ms: 0, is_team: false, submitted_at: null, completed_at: new Date().toISOString() },
    ],
  }

  const res = await quizScoresGET(req(), ctx(ORG))
  const json = await res.json() as { streaks: Record<string, number> }

  assert.equal(json.streaks.b2, undefined, 'en uke der medlemmet bare åpnet quizen skal ikke gi streak')
})

test('levert forsøk gir fortsatt streak (ingen regresjon)', async () => {
  state.tables = {
    organization_members: [
      { organization_id: ORG, user_id: 'admin-1', role: 'admin' },
      { organization_id: ORG, user_id: 'a1', role: 'member' },
    ],
    quizzes: [{ id: 'q1', title: 'Ukens quiz', quiz_type: 'weekly' }],
    profiles: [{ id: 'a1', display_name: 'Anne' }],
    attempts: [
      { quiz_id: 'q1', user_id: 'a1', player_name: 'Anne', correct_answers: 5, total_time_ms: 30_000, is_team: false, submitted_at: new Date().toISOString(), completed_at: new Date().toISOString() },
    ],
  }

  const res = await quizScoresGET(req(), ctx(ORG))
  const json = await res.json() as { entries: Array<{ userId: string }>; streaks: Record<string, number> }

  assert.deepEqual(json.entries.map(e => e.userId), ['a1'])
  assert.equal(json.streaks.a1, 1)
})

// ── Fiks 3: tidligere ansatte skal ikke telles som aktive ─────────────────────

test('tidligere ansatt telles ikke som aktiv denne måneden', async () => {
  const now = new Date()
  const midMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)).toISOString()

  state.tables = {
    organizations: [{ id: ORG, slug: 'elkjop', name: 'Elkjøp', plan: 'standard', allow_global_league: true }],
    organization_members: [
      { organization_id: ORG, user_id: 'admin-1', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
      { organization_id: ORG, user_id: 'a1', role: 'member', joined_at: '2026-01-01T00:00:00Z' },
    ],
    profiles: [
      { id: 'admin-1', display_name: 'Admin' },
      { id: 'a1', display_name: 'Anne' },
    ],
    organization_invites: [],
    season_scores: [
      // Nåværende ansatt — skal telle.
      { scope_type: 'organization', scope_id: ORG, user_id: 'a1', closes_at: midMonth },
      // Sluttet i bedriften, men season_scores-raden ble stående. Uten
      // memberIds-filteret telte hun videre i det uendelige.
      { scope_type: 'organization', scope_id: ORG, user_id: 'gone-1', closes_at: midMonth },
    ],
  }

  const res = await adminDataGET(req(), ctx('elkjop'))
  assert.equal(res.status, 200)
  const json = await res.json() as { stats: { memberCount: number; activeThisMonth: number } }

  assert.equal(json.stats.activeThisMonth, 1, 'kun nåværende medlemmer skal telles')
  assert.ok(
    json.stats.activeThisMonth <= json.stats.memberCount,
    'aktive kan aldri overstige medlemmer — det ga over 100 % i statistikk-stripen og delingsteksten'
  )
})

test('aktive denne måneden teller fortsatt nåværende medlemmer (ingen regresjon)', async () => {
  const now = new Date()
  const midMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)).toISOString()
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString()

  state.tables = {
    organizations: [{ id: ORG, slug: 'elkjop', name: 'Elkjøp', plan: 'standard', allow_global_league: true }],
    organization_members: [
      { organization_id: ORG, user_id: 'admin-1', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
      { organization_id: ORG, user_id: 'a1', role: 'member', joined_at: '2026-01-01T00:00:00Z' },
      { organization_id: ORG, user_id: 'c3', role: 'member', joined_at: '2026-01-01T00:00:00Z' },
    ],
    profiles: [
      { id: 'admin-1', display_name: 'Admin' },
      { id: 'a1', display_name: 'Anne' },
      { id: 'c3', display_name: 'Cato' },
    ],
    organization_invites: [],
    season_scores: [
      { scope_type: 'organization', scope_id: ORG, user_id: 'a1', closes_at: midMonth },
      { scope_type: 'organization', scope_id: ORG, user_id: 'c3', closes_at: midMonth },
      // Samme bruker, to quizer samme måned → skal telles én gang.
      { scope_type: 'organization', scope_id: ORG, user_id: 'c3', closes_at: midMonth },
      // Forrige måned → utenfor vinduet.
      { scope_type: 'organization', scope_id: ORG, user_id: 'admin-1', closes_at: lastMonth },
    ],
  }

  const res = await adminDataGET(req(), ctx('elkjop'))
  const json = await res.json() as { stats: { memberCount: number; activeThisMonth: number } }

  assert.equal(json.stats.memberCount, 3)
  assert.equal(json.stats.activeThisMonth, 2)
})
