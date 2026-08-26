// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte getPlayerStats() — ikke av en utklippet
// hjelpefunksjon. `mock.module` bytter ut lib/supabase-admin med en fake som
// oppfører seg som PostgREST, slik at produksjonskoden kjøres uendret. Samme
// mønster som category-strength.pagination.test.ts.
//
// FAKEN RETURNERER ALDRI MER ENN 1000 RADER per svar, også når kalleren ber om
// flere. Det er ikke en forenkling, det er målt oppførsel: databasen har
// db-max-rows = 1000, og både `.limit(5000)` og `.limit(10_000)` gir nøyaktig
// 1000 rader. Et `.limit()` i nærheten er derfor ikke bevis på at en spørring
// er trygg.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000

type QuizRow = { id: string; season_points_awarded: boolean }

const state: {
  quizzes: QuizRow[]
  played: string[]
  quizQueries: number
  playedQueries: number
  quizRanges: Array<{ from: number; to: number }>
  playedRanges: Array<{ from: number; to: number }>
  quizFilters: string[]
  playedFilters: string[]
} = {
  quizzes: [], played: [],
  quizQueries: 0, playedQueries: 0,
  quizRanges: [], playedRanges: [],
  quizFilters: [], playedFilters: [],
}

function page<T>(rows: T[], from: number | null, to: number | null): T[] {
  const f = from ?? 0
  const t = to ?? PG_ROW_CAP - 1
  return rows.slice(f, t + 1).slice(0, PG_ROW_CAP)
}

function builder(table: string) {
  let from: number | null = null
  let to: number | null = null
  const filters: string[] = []

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { filters.push(`eq:${col}=${String(val)}`); return b },
    not(col: string, op: string) { filters.push(`not:${col}.${op}`); return b },
    is() { return b },
    lte(col: string) { filters.push(`lte:${col}`); return b },
    gte(col: string) { filters.push(`gte:${col}`); return b },
    // Kolonnen MÅ med i nøkkelen: en fake som lagrer bare 'in' ruter på at et
    // filter FINNES, ikke hva det filtrerer på — og brakk (med vilje, høylytt)
    // da primærspørringen fikk sitt `.in('quizzes.quiz_type', …)`-ledd
    // 26. august 2026.
    in(col: string) { filters.push(`in:${col}`); return b },
    order() { return b },
    limit() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    single() { return Promise.resolve({ data: null, error: null }) },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      const done = (data: unknown[]) =>
        Promise.resolve({ data, error: null, count: data.length }).then(res, rej)

      if (table === 'quizzes') {
        state.quizQueries++
        state.quizRanges.push({ from: from ?? 0, to: to ?? PG_ROW_CAP - 1 })
        state.quizFilters = filters
        return done(page(state.quizzes, from, to))
      }

      if (table === 'attempts') {
        // Deltakelses-spørringen er den ENESTE som filtrerer på submitted_at.
        if (filters.includes('not:submitted_at.is')) {
          state.playedQueries++
          state.playedRanges.push({ from: from ?? 0, to: to ?? PG_ROW_CAP - 1 })
          state.playedFilters = filters
          return done(page(state.played.map(q => ({ quiz_id: q })), from, to))
        }
        // fetchFieldStats (.in på quiz_id) er uinteressant her. Primærens
        // `.in('quizzes.quiz_type', …)` (populasjonsfilteret, 26. august 2026)
        // skal derimot IKKE rute hit — derfor ruter vi på kolonne, ikke på at
        // et in-filter finnes.
        if (filters.includes('in:quiz_id') || filters.some(f => f.startsWith('gte:'))) return done([])
        // Primærspørringen: ett fullført forsøk holder — uten den returnerer
        // getPlayerStats EMPTY og testen måler ingenting.
        return done([{
          id: 'attempt-1', quiz_id: 'q0000', correct_answers: 5,
          total_questions: 10, total_time_ms: 60_000, correct_streak: 2,
          completed_at: '2026-07-31T10:00:00.000Z',
        }])
      }

      return done([])
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { getPlayerStats } = await import('@/lib/history')

const qid = (i: number) => 'q' + String(i).padStart(4, '0')

function reset(quizzes: QuizRow[], played: string[]) {
  state.quizzes = quizzes
  state.played = played
  state.quizQueries = 0
  state.playedQueries = 0
  state.quizRanges = []
  state.playedRanges = []
  state.quizFilters = []
  state.playedFilters = []
}

// ── Mutasjonsbevis: begge spørringene må pagineres ──────────────────────────
//
// Datasettet er konstruert slik at avkutting ved 1000 gir et ANNET svar, ikke
// bare et dårligere:
//
//   quiz    0– 999  spilt        → uten paginering ser koden KUN disse
//   quiz 1000–1099  spilt        → ligger etter taket
//
// Med full henting: 1100 på rad. Kuttet ved 1000: 1000.
//
// Merk om realismen: quizzes vokser med én rad i uka, så 1000 rader ligger
// ~19 år fram. Pagineringen er billig forsikring, ikke et akutt problem — men
// den er GRATIS her, og alternativet er en stille avkutting som ingen ville
// oppdaget fordi tallet fortsatt ser plausibelt ut.
function bigDataset(): { quizzes: QuizRow[]; played: string[] } {
  const quizzes: QuizRow[] = []
  for (let i = 0; i < 1100; i++) quizzes.push({ id: qid(i), season_points_awarded: true })
  return { quizzes, played: quizzes.map(q => q.id) }
}

test('rekken leser HELE quiz-historikken forbi 1000-taket', async () => {
  const { quizzes, played } = bigDataset()
  reset(quizzes, played)

  const stats = await getPlayerStats('user-1')

  assert.equal(stats.deltakelsesrekke, 1100, 'quizene etter rad 1000 er usynlige uten paginering')
  assert.equal(stats.lengste_deltakelsesrekke, 1100)
  assert.ok(state.quizQueries >= 2, `forventet paginert quiz-henting, fikk ${state.quizQueries}`)
  assert.ok(state.playedQueries >= 2, `forventet paginert deltakelse-henting, fikk ${state.playedQueries}`)
})

test('kontroll: avkutting ved 1000 ville faktisk gitt et annet tall', () => {
  // Uten denne kontrollen kunne testen over passert selv om avkutting ga samme
  // svar, og da ville den ikke bevist noe.
  const { quizzes } = bigDataset()
  assert.equal(quizzes.length, 1100)
  assert.notEqual(quizzes.slice(0, PG_ROW_CAP).length, quizzes.length)
})

test('pagineringen ber om sammenhengende vinduer og stopper på siste delside', async () => {
  const { quizzes, played } = bigDataset()
  reset(quizzes, played)
  await getPlayerStats('user-1')

  assert.deepEqual(state.quizRanges[0], { from: 0, to: 999 })
  assert.deepEqual(state.quizRanges[1], { from: 1000, to: 1999 })
  assert.equal(state.quizQueries, 2, 'hentet en unødvendig tredje side')
  assert.deepEqual(state.playedRanges[0], { from: 0, to: 999 })
  assert.equal(state.playedQueries, 2)
})

// ── Populasjonen: gjenbruk av retention-markørene, ikke en ny definisjon ────

test('quiz-populasjonen filtrerer på is_test, quiz_type og allerede åpnede', async () => {
  reset([{ id: qid(0), season_points_awarded: true }], [qid(0)])
  await getPlayerStats('user-1')

  assert.ok(state.quizFilters.includes('eq:is_test=false'),
    `manglet is_test-filter, fikk: ${JSON.stringify(state.quizFilters)}`)
  assert.ok(state.quizFilters.includes('eq:quiz_type=weekly'),
    `manglet quiz_type-filter — en bonusquiz ville brutt rekken: ${JSON.stringify(state.quizFilters)}`)
  assert.ok(state.quizFilters.includes('lte:opens_at'),
    `manglet «allerede åpnet»-filter — planlagte quizer ville talt som misser: ${JSON.stringify(state.quizFilters)}`)
  assert.ok(state.quizFilters.includes('not:opens_at.is'),
    `manglet opens_at NOT NULL — rekkefølgen er hele grunnlaget: ${JSON.stringify(state.quizFilters)}`)
})

test('deltakelse måles på submitted_at for riktig bruker — ikke på correct_streak', async () => {
  reset([{ id: qid(0), season_points_awarded: true }], [qid(0)])
  await getPlayerStats('user-42')

  assert.ok(state.playedFilters.includes('eq:user_id=user-42'),
    `manglet bruker-filter, fikk: ${JSON.stringify(state.playedFilters)}`)
  assert.ok(state.playedFilters.includes('not:submitted_at.is'),
    `deltakelse må måles på submitted_at, fikk: ${JSON.stringify(state.playedFilters)}`)
  assert.ok(!state.playedFilters.includes('not:correct_streak.is'),
    'correct_streak teller med forlatte forsøk (0 riktige, 0 ms) som deltakelse')
})

// ── Grensetilfellene, ende til ende ────────────────────────────────────────

test('aldri spilt → 0, ikke null-feil', async () => {
  reset(
    Array.from({ length: 7 }, (_, i) => ({ id: qid(i), season_points_awarded: true })),
    [],
  )
  const stats = await getPlayerStats('user-1')

  assert.equal(stats.deltakelsesrekke, 0)
  assert.equal(stats.lengste_deltakelsesrekke, 0)
})

test('kun én quiz spilt → rekke = 1', async () => {
  reset(
    Array.from({ length: 7 }, (_, i) => ({ id: qid(i), season_points_awarded: true })),
    [qid(6)],
  )
  const stats = await getPlayerStats('user-1')

  assert.equal(stats.deltakelsesrekke, 1)
  assert.equal(stats.lengste_deltakelsesrekke, 1)
})

test('brutt rekke → 0 nå, men rekorden står', async () => {
  reset(
    Array.from({ length: 7 }, (_, i) => ({ id: qid(i), season_points_awarded: true })),
    [qid(0), qid(1), qid(2), qid(3), qid(4)],
  )
  const stats = await getPlayerStats('user-1')

  assert.equal(stats.deltakelsesrekke, 0)
  assert.equal(stats.lengste_deltakelsesrekke, 5)
})

test('kveldens ÅPNE quiz teller så snart den er levert', async () => {
  const quizzes = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: qid(i), season_points_awarded: true })),
    { id: qid(7), season_points_awarded: false }, // åpen, ikke gjort opp
  ]
  reset(quizzes, quizzes.map(q => q.id))
  const stats = await getPlayerStats('user-1')

  assert.equal(stats.deltakelsesrekke, 8)
})

test('kveldens ÅPNE quiz drar ikke rekken ned for den som ikke har spilt ennå', async () => {
  const settled = Array.from({ length: 7 }, (_, i) => ({ id: qid(i), season_points_awarded: true }))
  reset([...settled, { id: qid(7), season_points_awarded: false }], settled.map(q => q.id))
  const stats = await getPlayerStats('user-1')

  assert.equal(stats.deltakelsesrekke, 7, 'rekken falt før quizen var gjort opp')
})

// ── Deltakelsesrekke er IKKE correct_streak ────────────────────────────────

test('deltakelsesrekke og best_streak er to ulike tall', async () => {
  // Faken gir primærforsøket correct_streak = 2. Rekken er 7. At de er ulike
  // er hele poenget: blandes de to feltene sammen, ryker denne.
  reset(
    Array.from({ length: 7 }, (_, i) => ({ id: qid(i), season_points_awarded: true })),
    Array.from({ length: 7 }, (_, i) => qid(i)),
  )
  const stats = await getPlayerStats('user-1')

  assert.equal(stats.best_streak, 2, 'best_streak = riktige svar på rad inne i én quiz')
  assert.equal(stats.deltakelsesrekke, 7, 'deltakelsesrekke = quizer på rad')
})
