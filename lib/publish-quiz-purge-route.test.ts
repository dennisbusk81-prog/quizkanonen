// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Cache-purge-gaten i cron/publish-quiz: purg KUN når forsidedataene kan ha
// endret seg (publisering, åpen quiz, nettopp stengt quiz, oppslagsfeil) —
// aldri i ro. Mocken implementerer filtrene ekte mot en mini-quizzes-tabell,
// så testene måler grensene og ikke bare at kall ble gjort.
//
// MUTASJONSBEVIS:
//   - gjøres purgen ubetinget igjen, feiler «i ro: ingen quiz i nærheten →
//     ingen purge».
//   - gates den på KUN publiserte rader (den opprinnelig bestilte formen),
//     feiler «åpen quiz trigger purge uten at noen rad skrives» — nettopp
//     regresjonen a32dff9 rettet (quiz usynlig på forsiden i 12+ min).
//   - fjernes 10-minutters-lookbacken, feiler «quiz stengt for 5 min siden
//     trigger purge».
//   - byttes fail-open til fail-closed, feiler «oppslagsfeil → purge likevel».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

type QuizRow = {
  id: string
  title: string
  is_active: boolean
  is_test: boolean | null
  quiz_type: string
  scheduled_at: string | null
  opens_at: string | null
  closes_at: string | null
  season_points_awarded: boolean
}

const db: { quizzes: QuizRow[]; liveLookupError: boolean } = {
  quizzes: [],
  liveLookupError: false,
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

const revalidateTagMock = mock.fn()

type Pred = (r: QuizRow) => boolean

function builder(table: string) {
  // Rekjøringsvinduets vaktspørring leser attempts; her finnes aldri sene
  // innsendinger (dekkes av lib/publish-quiz-resettle-route.test.ts).
  if (table === 'attempts') {
    const a = {
      select() { return a }, eq() { return a }, gt() { return a }, not() { return a },
      limit() { return a },
      maybeSingle() { return Promise.resolve({ data: null, error: null }) },
    }
    return a as never
  }
  assert.equal(table, 'quizzes')
  const preds: Pred[] = []
  let updatePatch: Partial<QuizRow> | null = null
  let usedOr = false
  let orderCol: keyof QuizRow | null = null
  let orderAsc = true
  let limitN: number | null = null

  const val = (r: QuizRow, col: string) => r[col as keyof QuizRow]

  const rows = (): QuizRow[] => {
    let out = db.quizzes.filter(r => preds.every(p => p(r)))
    if (orderCol) {
      const col = orderCol
      out = [...out].sort((a, b) => {
        const cmp = String(a[col]).localeCompare(String(b[col]))
        return orderAsc ? cmp : -cmp
      })
    }
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    update(patch: Partial<QuizRow>) { updatePatch = patch; return b },
    select() { return b },
    eq(col: string, v: unknown) { preds.push(r => val(r, col) === v); return b },
    lte(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) <= v); return b },
    lt(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) < v); return b },
    gte(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) >= v); return b },
    // Godtar både `is null` (scheduled_at) og `is true` (populasjonsgulvet i
    // oppgjørs-/rekjørings-utvalgene nedstrøms). Purge-gaten selv bruker ingen
    // av dem — byggeren må bare kunne svare på spørringene waitUntil-blokka
    // bygger, ellers blir det en ubehandlet avvisning.
    not(col: string, op: string, v: unknown) {
      assert.equal(op, 'is', 'mocken kjenner kun .not(col, "is", verdi)')
      preds.push(r => val(r, col) !== v)
      return b
    },
    in(col: string, values: readonly unknown[]) {
      preds.push(r => values.includes(val(r, col)))
      return b
    },
    or(expr: string) {
      usedOr = true
      // Implementerer formene ruten faktisk bruker: `col.is.null` og `col.gte.<verdi>`.
      const parts = expr.split(',').map(p => {
        const [col, op, ...rest] = p.split('.')
        const v = rest.join('.')
        if (op === 'is' && v === 'null') return (r: QuizRow) => val(r, col) === null
        if (op === 'gte') return (r: QuizRow) => val(r, col) !== null && String(val(r, col)) >= v
        throw new Error(`ukjent or-form i mock: ${p}`)
      })
      preds.push(r => parts.some(p => p(r)))
      return b
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col as keyof QuizRow
      orderAsc = opts?.ascending !== false
      return b
    },
    limit(n: number) { limitN = n; return b },
    then(resolve: (v: unknown) => void) {
      // Kun boundary-oppslaget bruker .or() — det er feilinjeksjonspunktet.
      if (usedOr && db.liveLookupError) {
        return resolve({ data: null, error: { message: 'injected lookup error' } })
      }
      if (updatePatch) {
        const hit = rows()
        for (const r of hit) Object.assign(r, updatePatch)
        return resolve({ data: hit.map(r => ({ id: r.id, title: r.title })), error: null })
      }
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})
mock.module('next/cache', {
  namedExports: { revalidateTag: revalidateTagMock },
})
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (_p: Promise<unknown>) => {} },
})
mock.module('@/lib/award-season-points', {
  namedExports: { processQuiz: async () => ({ rows: 0, error: null }) },
})

const { GET } = await import('@/app/api/cron/publish-quiz/route')

const call = (secret = 'test-cron-secret') =>
  GET(new Request('https://quizkanonen.no/api/cron/publish-quiz', {
    headers: { authorization: `Bearer ${secret}` },
  }) as never)

const purgedTags = () => revalidateTagMock.mock.calls.map(c => c.arguments[0] as string)

beforeEach(() => {
  db.quizzes = []
  db.liveLookupError = false
  revalidateTagMock.mock.resetCalls()
})

test('feil hemmelighet gir 401 og purger ingenting', async () => {
  db.quizzes = [{
    id: 'q1', title: 'Åpen quiz', is_active: true, is_test: false, quiz_type: 'weekly',
    scheduled_at: null, opens_at: minutesAgo(30), closes_at: minutesFromNow(30),
    season_points_awarded: true,
  }]
  const res = await call('feil-hemmelighet')
  assert.equal(res.status, 401)
  assert.deepEqual(purgedTags(), [])
})

test('i ro: ingen quiz i nærheten → ingen purge', async () => {
  db.quizzes = [
    { // stengte for lengst, poeng gjort opp
      id: 'gammel', title: 'Forrige fredag', is_active: true, is_test: false, quiz_type: 'weekly',
      scheduled_at: null, opens_at: minutesAgo(3 * 24 * 60), closes_at: minutesAgo(3 * 24 * 60 - 120),
      season_points_awarded: true,
    },
    { // neste ukes quiz, åpner om 2 dager
      id: 'neste', title: 'Neste fredag', is_active: true, is_test: false, quiz_type: 'weekly',
      scheduled_at: null, opens_at: minutesFromNow(2 * 24 * 60), closes_at: minutesFromNow(2 * 24 * 60 + 120),
      season_points_awarded: false,
    },
  ]
  const res = await call()
  const body = await res.json() as { published: number }
  assert.equal(res.status, 200)
  assert.equal(body.published, 0)
  assert.deepEqual(purgedTags(), [], 'cachen skal leve når ingenting kan ha endret seg')
})

test('publisering trigger purge selv uten åpen quiz', async () => {
  db.quizzes = [{
    // scheduled_at passert (UPDATE treffer), men opens_at fortsatt i fremtiden
    // — beviser at count>0-grenen alene utløser purgen.
    id: 'planlagt', title: 'Planlagt quiz', is_active: false, is_test: false, quiz_type: 'weekly',
    scheduled_at: minutesAgo(1), opens_at: minutesFromNow(60), closes_at: minutesFromNow(180),
    season_points_awarded: false,
  }]
  const res = await call()
  const body = await res.json() as { published: number }
  assert.equal(body.published, 1)
  assert.equal(db.quizzes[0].is_active, true, 'UPDATE-en skal faktisk ha publisert')
  assert.deepEqual(purgedTags().sort(), ['home-page-insights', 'home-shared-data'])
})

test('åpen quiz trigger purge uten at noen rad skrives', async () => {
  // Regresjonen a32dff9 rettet: quizen blir synlig/teller deltakere ved at
  // opens_at passerer — INGEN UPDATE skjer. Purgen må komme likevel.
  db.quizzes = [{
    id: 'aapen', title: 'Fredagsquiz', is_active: true, is_test: false, quiz_type: 'weekly',
    scheduled_at: null, opens_at: minutesAgo(30), closes_at: minutesFromNow(60),
    season_points_awarded: false,
  }]
  const res = await call()
  const body = await res.json() as { published: number }
  assert.equal(body.published, 0, 'ingen rad publiseres — purgen skal komme fra åpen-quiz-grenen')
  assert.deepEqual(purgedTags().sort(), ['home-page-insights', 'home-shared-data'])
})

test('åpen quiz uten stengetid (closes_at null) trigger også purge', async () => {
  db.quizzes = [{
    id: 'endeloes', title: 'Åpen uten slutt', is_active: true, is_test: false, quiz_type: 'weekly',
    scheduled_at: null, opens_at: minutesAgo(30), closes_at: null,
    season_points_awarded: false,
  }]
  await call()
  assert.deepEqual(purgedTags().sort(), ['home-page-insights', 'home-shared-data'])
})

test('quiz stengt for 5 min siden trigger purge (topp 3 / poeng / innsikt endres etter stengetid)', async () => {
  db.quizzes = [{
    id: 'nettopp', title: 'Nettopp stengt', is_active: true, is_test: false, quiz_type: 'weekly',
    scheduled_at: null, opens_at: minutesAgo(120), closes_at: minutesAgo(5),
    season_points_awarded: true,
  }]
  await call()
  assert.deepEqual(purgedTags().sort(), ['home-page-insights', 'home-shared-data'])
})

test('quiz stengt for 3 dager siden trigger IKKE purge', async () => {
  db.quizzes = [{
    id: 'gammel', title: 'Gammel', is_active: true, is_test: false, quiz_type: 'weekly',
    scheduled_at: null, opens_at: minutesAgo(3 * 24 * 60), closes_at: minutesAgo(3 * 24 * 60 - 120),
    season_points_awarded: true,
  }]
  await call()
  assert.deepEqual(purgedTags(), [])
})

test('åpen TESTquiz trigger ikke purge (forsiden filtrerer is_test bort)', async () => {
  db.quizzes = [{
    id: 'test', title: '[TEST – ikke ekte]', is_active: true, is_test: true, quiz_type: 'weekly',
    scheduled_at: null, opens_at: minutesAgo(30), closes_at: minutesFromNow(60),
    season_points_awarded: true,
  }]
  await call()
  assert.deepEqual(purgedTags(), [])
})

test('oppslagsfeil → purge likevel (fail-open = dagens atferd)', async () => {
  db.liveLookupError = true
  const res = await call()
  assert.equal(res.status, 200, 'oppslagsfeilen skal ikke velte kjøringen')
  assert.deepEqual(purgedTags().sort(), ['home-page-insights', 'home-shared-data'])
})
