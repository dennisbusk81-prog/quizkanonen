// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av GET /api/rivalries/my sitt quiz-utvalg og feilhåndtering.
// `mock.module` bytter ut supabase-admin — ruten, lib/paginate, lib/duel-scoring
// og lib/season-points kjøres uendret, så poengtallene i assertions er de EKTE
// tallene fra poengmodellen (rank 1 = 12, rank 2 = 10).
//
// MUTASJONSBEVIS (verifisert ved å fjerne mekanismen midlertidig):
//   - fjernes .eq('is_test', false) i rangeQuizzes-oppslaget, feiler
//     «testquiz i duellmåneden teller ikke inn i duellpoengene»
//     (motstanderen får 22 i stedet for 10)
//   - fjernes feilsjekken på rangeQuizzes, feiler
//     «feilende quiz-spørring gir 500, ikke stille 0-0»
//     (ruten svarer da 200 med alle dueller 0-0)
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ME  = '11111111-1111-1111-1111-111111111111'
const OPP = '22222222-2222-2222-2222-222222222222'
const REAL_QUIZ = 'aaaaaaaa-1111-2222-3333-444444444444'
const TEST_QUIZ = 'cccccccc-1111-2222-3333-444444444444'

type QuizRow = { id: string; closes_at: string; is_test: boolean }
type AttemptRow = {
  user_id: string; quiz_id: string; correct_answers: number
  total_time_ms: number; correct_streak: number
  is_team: boolean; submitted_at: string | null
}
type RivalryRow = {
  id: string; challenger_id: string; rival_id: string
  status: string; created_at: string; seen_at: string | null
}

const db: {
  rivalries: RivalryRow[]
  profiles: Array<{ id: string; display_name: string; nickname: string | null }>
  quizzes: QuizRow[]
  attempts: AttemptRow[]
  errorOn: string | null
} = { rivalries: [], profiles: [], quizzes: [], attempts: [], errorOn: null }

// Dynamiske tidspunkter (aldri hardkodede datoer): duellen opprettes «nå», og
// quizene stenger tidligere i SAMME kalendermåned. max() mot månedsstart gjør
// testen robust også i de første minuttene av en ny måned (UTC).
const now = new Date()
const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
const closedAgo = (minutes: number) =>
  new Date(Math.max(monthStart + minutes * 1000, now.getTime() - minutes * 60_000)).toISOString()

function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let inCol: string | null = null, inVals: string[] = []
  let gteVal: string | null = null, ltVal: string | null = null, lteVal: string | null = null
  const notNullCols: string[] = []
  let rangeFrom = 0, rangeTo = Number.MAX_SAFE_INTEGER

  const source = (): Record<string, unknown>[] => {
    switch (table) {
      case 'rivalries': return db.rivalries as unknown as Record<string, unknown>[]
      case 'profiles':  return db.profiles as unknown as Record<string, unknown>[]
      case 'quizzes':   return db.quizzes as unknown as Record<string, unknown>[]
      case 'attempts':  return db.attempts as unknown as Record<string, unknown>[]
      default: throw new Error(`ukjent tabell i mock: ${table}`)
    }
  }

  const rows = (): Record<string, unknown>[] =>
    source().filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (inCol && !inVals.includes(String(r[inCol] ?? ''))) return false
      if (gteVal !== null && String(r.closes_at) <  gteVal) return false
      if (ltVal  !== null && String(r.closes_at) >= ltVal)  return false
      if (lteVal !== null && String(r.closes_at) >  lteVal) return false
      for (const c of notNullCols) if (r[c] === null || r[c] === undefined) return false
      return true
    }).slice(rangeFrom, rangeTo + 1)

  const b = {
    select() { return b },
    // Rivalry-oppslagets .or() og .in('status', …) filtreres ikke i mocken —
    // testdataene inneholder kun relevante rader.
    or() { return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals.map(String); return b },
    gte(_col: string, val: string) { gteVal = val; return b },
    lt(_col: string, val: string) { ltVal = val; return b },
    lte(_col: string, val: string) { lteVal = val; return b },
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) notNullCols.push(col)
      return b
    },
    order() { return b },
    range(f: number, t: number) { rangeFrom = f; rangeTo = t; return b },
    then(resolve: (v: unknown) => void) {
      if (db.errorOn === table) return resolve({ data: null, error: { message: `simulert feil: ${table}` } })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      auth: {
        getUser: async (token: string) =>
          token === 'gyldig-token'
            ? { data: { user: { id: ME } }, error: null }
            : { data: { user: null }, error: { message: 'bad token' } },
        admin: { getUserById: async () => ({ data: { user: null } }) },
      },
    },
  },
})

const { GET } = await import('@/app/api/rivalries/my/route')

async function call(token = 'gyldig-token') {
  const request = new Request('https://quizkanonen.no/api/rivalries/my', {
    headers: { authorization: `Bearer ${token}` },
  })
  return GET(request as never)
}

const attempt = (userId: string, quizId: string, correct: number): AttemptRow => ({
  user_id: userId, quiz_id: quizId, correct_answers: correct,
  total_time_ms: 60_000, correct_streak: 0, is_team: false,
  submitted_at: closedAgo(5),
})

beforeEach(() => {
  db.rivalries = [{
    id: 'r1', challenger_id: ME, rival_id: OPP, status: 'active',
    created_at: now.toISOString(), seen_at: now.toISOString(),
  }]
  db.profiles = [
    { id: ME,  display_name: 'Meg Selv',   nickname: null },
    { id: OPP, display_name: 'Motstander', nickname: null },
  ]
  db.quizzes = [{ id: REAL_QUIZ, closes_at: closedAgo(30), is_test: false }]
  db.attempts = [
    attempt(ME,  REAL_QUIZ, 8),  // rank 1 → 12 poeng
    attempt(OPP, REAL_QUIZ, 5),  // rank 2 → 10 poeng
  ]
  db.errorOn = null
})

// ── Auth ────────────────────────────────────────────────────────────────────

test('ugyldig token gir 401', async () => {
  assert.equal((await call('feil-token')).status, 401)
})

// ── is_test-filteret ────────────────────────────────────────────────────────

test('testquiz i duellmåneden teller ikke inn i duellpoengene', async () => {
  // MUTASJONSBEVIS: uten .eq('is_test', false) vinner motstanderen testquizen
  // (rank 1 = 12 poeng) og stillingen vises som 12–22 i stedet for 12–10.
  db.quizzes.push({ id: TEST_QUIZ, closes_at: closedAgo(10), is_test: true })
  db.attempts.push(attempt(OPP, TEST_QUIZ, 10))

  const res = await call()
  assert.equal(res.status, 200)

  const body = await res.json() as { rivalries: Array<{ myPoints: number; opponentPoints: number }> }
  assert.equal(body.rivalries.length, 1)
  assert.equal(body.rivalries[0].myPoints, 12)
  assert.equal(body.rivalries[0].opponentPoints, 10, 'testquizens 12 poeng skal ikke telle')
})

test('ekte quizer teller fortsatt — filteret låser ikke ute legitim scoring', async () => {
  const res = await call()
  assert.equal(res.status, 200)

  const body = await res.json() as { rivalries: Array<{ myPoints: number; opponentPoints: number; opponentName: string | null }> }
  assert.equal(body.rivalries[0].myPoints, 12)
  assert.equal(body.rivalries[0].opponentPoints, 10)
  assert.equal(body.rivalries[0].opponentName, 'Motstander')
})

// ── Feilhåndtering ──────────────────────────────────────────────────────────

test('feilende quiz-spørring gir 500, ikke stille 0-0', async () => {
  // MUTASJONSBEVIS: uten feilsjekken på rangeQuizzes svarer ruten 200 og hver
  // duell vises som 0-0 — feil data presentert som fasit, uten loggspor.
  db.errorOn = 'quizzes'

  const res = await call()
  assert.equal(res.status, 500)
})

test('feilende profil-spørring er IKKE fatal — poengene beregnes fortsatt', async () => {
  // Navnefallbacken mot auth.users dekker manglende profiler; poengene skal
  // ikke ofres for et navneoppslag.
  db.errorOn = 'profiles'

  const res = await call()
  assert.equal(res.status, 200)

  const body = await res.json() as { rivalries: Array<{ myPoints: number; opponentPoints: number }> }
  assert.equal(body.rivalries[0].myPoints, 12)
  assert.equal(body.rivalries[0].opponentPoints, 10)
})
