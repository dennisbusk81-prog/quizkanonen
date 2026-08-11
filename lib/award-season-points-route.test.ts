// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av quiz-UTVALGET i begge rutene som tildeler sesongpoeng
// på «quiz stengte»-hendelsen:
//   - /api/cron/award-season-points  (hvert 5. minutt)
//   - /api/cron/publish-quiz         (hvert minutt — samme processQuiz, så en
//                                     testquiz ville blitt gjort opp HER før
//                                     5-minutters-cronen i det hele tatt så den)
//
// `mock.module` bytter ut supabase-admin og processQuiz — rutene selv kjøres
// uendret. processQuiz-mocken registrerer hvilke quiz-id-er som faktisk
// behandles; det er hele poenget med testen.
//
// MUTASJONSBEVIS (verifisert ved å fjerne mekanismen midlertidig):
//   - fjernes .eq('is_test', false) i award-season-points, feiler
//     «testquiz som stenges får ikke sesongpoeng»
//   - fjernes .eq('is_test', false) i publish-quiz, feiler
//     «publish-quiz gjør ikke opp en testquiz»
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

const REAL_QUIZ = 'aaaaaaaa-1111-2222-3333-444444444444'
const TEST_QUIZ = 'cccccccc-1111-2222-3333-444444444444'

type QuizRow = {
  id: string; title: string; closes_at: string
  season_points_awarded: boolean; is_test: boolean; is_active: boolean
}

const db: { quizzes: QuizRow[]; processed: string[] } = { quizzes: [], processed: [] }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

let pending: Promise<unknown>[] = []
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})
mock.module('next/cache', {
  namedExports: { revalidateTag: () => {} },
})

// processQuiz mockes bort: testen handler om UTVALGET, ikke poengberegningen
// (den dekkes av lib/award-season-points.pagination.test.ts).
mock.module('@/lib/award-season-points', {
  namedExports: {
    processQuiz: async (quizId: string) => {
      db.processed.push(quizId)
      return { rows: 1, error: null }
    },
  },
})

function builder(table: string) {
  if (table !== 'quizzes') throw new Error(`ukjent tabell i mock: ${table}`)
  const eqs: Record<string, unknown> = {}
  let ltCol: string | null = null, ltVal: string | null = null
  let limitN: number | null = null
  let orderAsc = true
  let updating = false

  const rows = (): QuizRow[] => {
    let out = db.quizzes.filter(q => {
      for (const [k, v] of Object.entries(eqs)) if ((q as unknown as Record<string, unknown>)[k] !== v) return false
      if (ltCol && ltVal !== null && String((q as unknown as Record<string, unknown>)[ltCol]) >= ltVal) return false
      return true
    })
    out = [...out].sort((a, b) => orderAsc
      ? a.closes_at.localeCompare(b.closes_at)
      : b.closes_at.localeCompare(a.closes_at))
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    select() { return b },
    update() { updating = true; return b },
    eq(col: string, val: unknown) { if (!updating) eqs[col] = val; return b },
    lt(col: string, val: string) { ltCol = col; ltVal = val; return b },
    lte() { return b },
    not() { return b },
    order(_col: string, opts?: { ascending?: boolean }) { orderAsc = opts?.ascending !== false; return b },
    limit(n: number) { limitN = n; return b },
    then(resolve: (v: unknown) => void) {
      // publish-quiz sin publiserings-UPDATE (scheduled_at) er ikke tema her —
      // den svarer alltid tomt.
      if (updating) return resolve({ data: [], error: null })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { GET: awardGET } = await import('@/app/api/cron/award-season-points/route')
const { GET: publishGET } = await import('@/app/api/cron/publish-quiz/route')

async function call(handler: (req: never) => Promise<Response>, secret = 'test-cron-secret') {
  pending = []
  const request = new Request('https://quizkanonen.no/api/cron/x', {
    headers: { authorization: `Bearer ${secret}` },
  })
  const res = await handler(request as never)
  await Promise.all(pending)
  return res
}

const quiz = (over: Partial<QuizRow> = {}): QuizRow => ({
  id: REAL_QUIZ, title: 'Fredagsquiz', closes_at: minutesAgo(30),
  season_points_awarded: false, is_test: false, is_active: true,
  ...over,
})

beforeEach(() => {
  db.quizzes = []
  db.processed = []
})

// ── Rammeverk ───────────────────────────────────────────────────────────────

test('feil hemmelighet gir 401 og behandler ingenting (begge rutene)', async () => {
  db.quizzes = [quiz()]
  assert.equal((await call(awardGET, 'feil')).status, 401)
  assert.equal((await call(publishGET, 'feil')).status, 401)
  assert.deepEqual(db.processed, [])
})

// ── award-season-points ─────────────────────────────────────────────────────

test('testquiz som stenges får ikke sesongpoeng', async () => {
  // MUTASJONSBEVIS: uten .eq('is_test', false) behandles TEST_QUIZ og
  // fixture-brukerne får season_scores-rader i global scope.
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: '[TEST – ikke ekte]', is_test: true, closes_at: minutesAgo(10) }),
  ]

  const res = await call(awardGET)
  assert.equal(res.status, 200)
  assert.deepEqual(db.processed, [REAL_QUIZ])

  const body = await res.json() as { processed: number }
  assert.equal(body.processed, 1)
})

test('ekte stengt quiz gjøres fortsatt opp — filteret låser ikke ute noe legitimt', async () => {
  db.quizzes = [quiz()]

  const res = await call(awardGET)
  assert.equal(res.status, 200)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('skjult ekte quiz (is_active=false) gjøres FORTSATT opp', async () => {
  // Bevisst asymmetri mot varslingsrutene: «Skjul» i admin skal ikke frata
  // spillerne poengene for en quiz de allerede har spilt.
  db.quizzes = [quiz({ is_active: false })]

  await call(awardGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('allerede oppgjort quiz behandles ikke på nytt', async () => {
  db.quizzes = [quiz({ season_points_awarded: true })]

  await call(awardGET)
  assert.deepEqual(db.processed, [])
})

// ── publish-quiz (samme hendelse, kjører hvert minutt) ──────────────────────

test('publish-quiz gjør ikke opp en testquiz', async () => {
  // MUTASJONSBEVIS: uten .eq('is_test', false) her er award-fiksen verdiløs —
  // denne ruten kjører hvert minutt og ville rukket testquizen først.
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: '[TEST – ikke ekte]', is_test: true, closes_at: minutesAgo(10) }),
  ]

  const res = await call(publishGET)
  assert.equal(res.status, 200)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('publish-quiz gjør opp ekte stengt quiz umiddelbart', async () => {
  db.quizzes = [quiz()]

  await call(publishGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})
