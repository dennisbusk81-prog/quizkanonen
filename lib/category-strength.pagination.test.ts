// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte getPlayerStats() — ikke av en utklippet
// hjelpefunksjon. `mock.module` bytter ut lib/supabase-admin med en fake som
// oppfører seg som PostgREST, slik at produksjonskoden kjøres uendret mot et
// datasett større enn 1000-taket. Samme mønster som
// ranking-snapshot.pagination.test.ts.
//
// MUTASJONSBEVIS: faken returnerer aldri mer enn 1000 rader per svar — også
// når kalleren ber om flere. Det er ikke en forenkling, det er MÅLT oppførsel:
// mot prod 2. august 2026 ga både `.limit(5000)` og `.range(0, 9999)` nøyaktig
// 1000 rader (db-max-rows = 1000). Byttes fetchAllRows i
// fetchCategoryStrength() ut med ett enkelt `.select()`, ser funksjonen 1000 av
// 1400 svar og «svakeste kategori»-asserten under feiler.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000

type AnswerRow = {
  question_id: string
  is_correct: boolean
  attempts: { user_id: string; correct_streak: number }
  questions: { category: string | null }
}

const state: {
  answers: AnswerRow[]
  answerQueries: number
  ranges: Array<{ from: number; to: number }>
  filters: string[]
} = { answers: [], answerQueries: 0, ranges: [], filters: [] }

function builder(table: string) {
  let from: number | null = null
  let to: number | null = null

  const b = {
    select() { return b },
    eq(col: string, val: unknown) {
      if (table === 'attempt_answers') state.filters.push(`eq:${col}=${String(val)}`)
      return b
    },
    not(col: string, op: string) {
      if (table === 'attempt_answers') state.filters.push(`not:${col}.${op}`)
      return b
    },
    order() { return b },
    limit() { return b },
    gte() { return b },
    lte() { return b },
    in() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    single() { return Promise.resolve({ data: null, error: null }) },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      if (table === 'attempts') {
        // Ett fullført forsøk holder: getPlayerStats returnerer EMPTY uten,
        // og denne testen handler om svarradene, ikke om rangeringen.
        return Promise.resolve({
          data: [{
            id: 'attempt-1', quiz_id: 'quiz-1', correct_answers: 5,
            total_questions: 10, total_time_ms: 60_000, correct_streak: 2,
            completed_at: '2026-07-31T10:00:00.000Z',
          }],
          error: null,
        }).then(res, rej)
      }
      if (table !== 'attempt_answers') {
        return Promise.resolve({ data: [], error: null }).then(res, rej)
      }
      state.answerQueries++
      const f = from ?? 0
      const t = to ?? PG_ROW_CAP - 1
      state.ranges.push({ from: f, to: t })
      // PostgREST-taket: aldri mer enn 1000 rader i ett svar.
      const window = state.answers.slice(f, t + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { getPlayerStats } = await import('@/lib/history')

function answer(i: number, category: string | null, isCorrect: boolean): AnswerRow {
  return {
    question_id: 'q' + String(i).padStart(6, '0'),
    is_correct: isCorrect,
    attempts: { user_id: 'user-1', correct_streak: 2 },
    questions: { category },
  }
}

function reset(answers: AnswerRow[]) {
  state.answers = answers
  state.answerQueries = 0
  state.ranges = []
  state.filters = []
}

// ── Selve mutasjonsbeviset ──────────────────────────────────────────────────
//
// Datasettet er konstruert slik at avkutting ved 1000 gir et ANNET svar, ikke
// bare et dårligere: «Geografi» ligger i sin helhet ETTER rad 1000.
//
//   rad    0– 999  Sport, 60 % riktig      (1000 svar)
//   rad 1000–1199  Musikk, 90 % riktig      (200 svar)
//   rad 1200–1399  Geografi, 10 % riktig    (200 svar)
//
// Med full historikk: sterkeste = Musikk, svakeste = Geografi.
// Kuttet ved 1000: kun Sport finnes → færre enn to kategorier → BEGGE null.
function makeSplitDataset(): AnswerRow[] {
  const rows: AnswerRow[] = []
  for (let i = 0; i < 1000; i++) rows.push(answer(i, 'Sport', i % 10 < 6))
  for (let i = 1000; i < 1200; i++) rows.push(answer(i, 'Musikk', i % 10 < 9))
  for (let i = 1200; i < 1400; i++) rows.push(answer(i, 'Geografi', i % 10 < 1))
  return rows
}

test('kategoristyrke leser HELE historikken forbi 1000-taket', async () => {
  reset(makeSplitDataset())

  const stats = await getPlayerStats('user-1')

  assert.equal(
    stats.sterkeste_kategori, 'Musikk',
    'Musikk ligger etter rad 1000 — uten paginering er den usynlig',
  )
  assert.equal(
    stats.svakeste_kategori, 'Geografi',
    'Geografi ligger etter rad 1200 — uten paginering er den usynlig',
  )
  assert.ok(
    state.answerQueries >= 2,
    `forventet paginering, fikk ${state.answerQueries} spørring(er)`,
  )
})

test('pagineringen ber om sammenhengende vinduer og stopper på siste delside', async () => {
  reset(makeSplitDataset())
  await getPlayerStats('user-1')

  assert.deepEqual(state.ranges[0], { from: 0, to: 999 })
  assert.deepEqual(state.ranges[1], { from: 1000, to: 1999 })
  // Andre side ga 400 rader (< 1000) → fetchAllRows skal stoppe der.
  assert.equal(state.answerQueries, 2, 'hentet en unødvendig tredje side')
})

test('uten paginering ville tallene vært feil — kontroll på selve datasettet', () => {
  // Beviser at datasettet FAKTISK skiller de to utfallene. Uten denne
  // kontrollen kunne testen over passert selv om avkutting ga samme svar,
  // og da ville den ikke bevist noe.
  const kuttet = makeSplitDataset().slice(0, PG_ROW_CAP)
  const kategorier = new Set(kuttet.map(r => r.questions.category))
  assert.deepEqual([...kategorier], ['Sport'], 'de 1000 første må inneholde KUN Sport')
})

// ── Populasjonen: samme avgrensning som resten av getPlayerStats ────────────

test('svarene hentes for riktig bruker og kun fra fullførte forsøk', async () => {
  reset(makeSplitDataset())
  await getPlayerStats('user-1')

  assert.ok(
    state.filters.includes('eq:attempts.user_id=user-1'),
    `manglet bruker-filter, fikk: ${JSON.stringify(state.filters)}`,
  )
  assert.ok(
    state.filters.includes('not:attempts.correct_streak.is'),
    `manglet «fullført forsøk»-filter, fikk: ${JSON.stringify(state.filters)}`,
  )
})

// ── Terskel og eksklusjon gjennom HELE kjeden, ikke bare i ren logikk ───────

test('en kategori med for få svar velges ikke, ende til ende', async () => {
  reset([
    ...Array.from({ length: 10 }, (_, i) => answer(i, 'Sport', i < 7)),        // 70 %
    ...Array.from({ length: 10 }, (_, i) => answer(100 + i, 'Musikk', i < 3)), // 30 %
    answer(200, 'Kunst & Kultur', false),                                       // 0 %, 1 svar
  ])

  const stats = await getPlayerStats('user-1')

  assert.equal(stats.svakeste_kategori, 'Musikk', 'ett enkelt svar ble svakeste kategori')
  assert.equal(stats.sterkeste_kategori, 'Sport')
})

test('«Uten kategori» velges ikke, ende til ende', async () => {
  reset([
    ...Array.from({ length: 40 }, (_, i) => answer(i, null, true)),            // 100 %, ukategorisert
    ...Array.from({ length: 10 }, (_, i) => answer(100 + i, 'Sport', i < 7)),  // 70 %
    ...Array.from({ length: 10 }, (_, i) => answer(200 + i, 'Musikk', i < 3)), // 30 %
  ])

  const stats = await getPlayerStats('user-1')

  assert.equal(stats.sterkeste_kategori, 'Sport')
  assert.equal(stats.svakeste_kategori, 'Musikk')
})

test('Diverse velges ikke, ende til ende', async () => {
  reset([
    ...Array.from({ length: 40 }, (_, i) => answer(i, 'Diverse', true)),       // 100 %
    ...Array.from({ length: 10 }, (_, i) => answer(100 + i, 'Sport', i < 7)),  // 70 %
    ...Array.from({ length: 10 }, (_, i) => answer(200 + i, 'Musikk', i < 3)), // 30 %
  ])

  const stats = await getPlayerStats('user-1')

  assert.equal(stats.sterkeste_kategori, 'Sport', 'Diverse ble sterkeste kategori')
})

test('for få kategorier over terskelen → begge null, ikke en tilfeldig kategori', async () => {
  reset([
    ...Array.from({ length: 10 }, (_, i) => answer(i, 'Sport', i < 7)),
    answer(100, 'Musikk', false),
    answer(101, 'Historie', true),
  ])

  const stats = await getPlayerStats('user-1')

  assert.equal(stats.sterkeste_kategori, null)
  assert.equal(stats.svakeste_kategori, null)
})

test('samme spørsmål besvart i flere quizer teller hver gang', async () => {
  // question_id går igjen — computeCategoryStats slår opp kategori per
  // questionId, så dedupliseringen i fetchCategoryStrength må gjelde
  // OPPSLAGSTABELLEN, ikke svarene.
  const gjentatt = (n: number, cat: string, correct: boolean) =>
    Array.from({ length: n }, () => answer(1, cat, correct))

  reset([
    ...gjentatt(6, 'Sport', true),
    ...gjentatt(2, 'Sport', false),                                            // Sport 6/8 = 75 %
    ...Array.from({ length: 10 }, (_, i) => answer(200 + i, 'Musikk', i < 3)), // 30 %
  ])

  const stats = await getPlayerStats('user-1')

  assert.equal(stats.sterkeste_kategori, 'Sport')
  assert.equal(stats.svakeste_kategori, 'Musikk')
})
