// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/arkiv (arkivlisten) mot en fake som
// EVALUERER filtrene, SORTERER etter registrerte .order()-kall og kutter ved
// 1000 rader (PostgREST db-max-rows, målt oppførsel). Evalueringen er
// poenget: en fake som bare registrerer kjeden ville vært grønn selv om
// filteret aldri ble lest (husregel: grep teller navn, ikke oppførsel).
//
// MUTASJONSBEVIS (alle kjørt 27. august 2026 og revertert):
//   • fetchAllRows byttet mot ett rått quiz-kall  → 1050-testen rød (1000 av
//     1050 quizer, quizQueries === 1)
//   • fetchAllRowsChunked byttet mot ett rått questions-kall → spørsmåls-
//     pagineringstesten rød (quizer bak 1000-kuttet mister id-ene sine)
//   • .order()-kallene fjernet fra quiz-spørringen → rekkefølge-asserten rød
//     (innsettingsrekkefølgen er bevisst eldst-først)
//   • .order()-kallene fjernet fra questions-spørringen → order_index-
//     assertene røde (radene er bevisst satt inn stokket)
//   • onlyRealQuizzes fjernet → arkiv-/testquiz-testene røde
//   • .eq('is_active', true) fjernet → skjult-quiz-testen rød
//   • .lte('closes_at', …) fjernet → åpen-quiz-testen rød
//
// FIXTURE-REGELEN er fulgt: hvert felt testene hviler på har distinkt verdi
// per rad (id, tittel, closes_at, order_index).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000

type QuizRow = {
  id: string
  title: string
  closes_at: string | null
  is_active: boolean
  is_test: boolean | null
  quiz_type: string
}

type QuestionRow = { id: string; quiz_id: string; order_index: number }

type Filter = { method: string; args: unknown[] }
type Order = { col: string; asc: boolean }

const state = {
  quizzes: [] as QuizRow[],
  questions: [] as QuestionRow[],
  quizQueries: 0,
  questionQueries: 0,
  chunkSizes: [] as number[],
  quizzesDown: false,
  questionsDown: false,
  authCalls: 0,
}

function evalFilter(row: Record<string, unknown>, f: Filter): boolean {
  const [col, ...rest] = f.args as [string, ...unknown[]]
  const v = row[col]
  switch (f.method) {
    case 'eq':
      return v === rest[0]
    case 'lte':
      // NULL matcher aldri en lte — samme semantikk som PostgREST.
      return v !== null && v !== undefined && String(v) <= String(rest[0])
    case 'not': {
      const [op, val] = rest as [string, unknown]
      if (op !== 'is') throw new Error(`uventet not-operator i test: ${op}`)
      return !(v === val)
    }
    case 'in':
      return (rest[0] as unknown[]).includes(v)
    default:
      throw new Error(`uventet filter i test: ${f.method}`)
  }
}

function sortRows<T extends Record<string, unknown>>(rows: T[], orders: Order[]): T[] {
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const av = a[o.col]
      const bv = b[o.col]
      if (av === bv) continue
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av) < String(bv)
            ? -1
            : 1
      return o.asc ? cmp : -cmp
    }
    return 0
  })
}

function listBuilder(
  rows: () => Record<string, unknown>[],
  onQuery: (filters: Filter[]) => void,
  down: () => boolean
) {
  const filters: Filter[] = []
  const orders: Order[] = []
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select() { return b },
    eq(...args: unknown[]) { filters.push({ method: 'eq', args }); return b },
    lte(...args: unknown[]) { filters.push({ method: 'lte', args }); return b },
    not(...args: unknown[]) { filters.push({ method: 'not', args }); return b },
    in(...args: unknown[]) { filters.push({ method: 'in', args }); return b },
    order(col: string, opts?: { ascending?: boolean }) {
      orders.push({ col, asc: opts?.ascending ?? true })
      return b
    },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      onQuery(filters)
      if (down()) {
        return Promise.resolve({ data: null, error: { message: 'db nede' } }).then(res, rej)
      }
      const matched = rows().filter((row) => filters.every((f) => evalFilter(row, f)))
      const window = sortRows(matched, orders).slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => {
          state.authCalls++
          return { data: { user: null }, error: null }
        },
      },
      from: (table: string) => {
        if (table === 'quizzes') {
          return listBuilder(
            () => state.quizzes,
            () => { state.quizQueries++ },
            () => state.quizzesDown
          ) as never
        }
        if (table === 'questions') {
          return listBuilder(
            () => state.questions,
            (filters) => {
              state.questionQueries++
              const inChunk = filters.find((f) => f.method === 'in' && f.args[0] === 'quiz_id')
              if (inChunk) state.chunkSizes.push((inChunk.args[1] as unknown[]).length)
            },
            () => state.questionsDown
          ) as never
        }
        throw new Error(`uventet tabell i test: ${table}`)
      },
    },
  },
})

const { GET } = await import('@/app/api/arkiv/route')

type ListEntry = { id: string; title: string; closesAt: string | null; questionIds: string[] }

async function kall(): Promise<{ status: number; quizzes: ListEntry[] }> {
  const res = await GET()
  const json = (await res.json()) as { quizzes?: ListEntry[] }
  return { status: res.status, quizzes: json.quizzes ?? [] }
}

/** Stengt, ekte, synlig quiz — hver med distinkt id/tittel/stengetid. */
function stengtQuiz(i: number, overrides: Partial<QuizRow> = {}): QuizRow {
  return {
    id: `q-${String(i).padStart(4, '0')}`,
    title: `Fredagsquiz nr. ${i}`,
    // Nyest ved i=0 — men radene SETTES INN eldst-først (se testene).
    closes_at: new Date(Date.UTC(2026, 7, 1) - i * 60_000).toISOString(),
    is_active: true,
    is_test: false,
    quiz_type: 'weekly',
    ...overrides,
  }
}

beforeEach(() => {
  state.quizzes = []
  state.questions = []
  state.quizQueries = 0
  state.questionQueries = 0
  state.chunkSizes = []
  state.quizzesDown = false
  state.questionsDown = false
  state.authCalls = 0
})

// ── Paginering: hele populasjonen, ikke de 1000 første ──────────────────────

test('1050 stengte quizer: ALLE er med, nyeste først, og .in()-bitene er ≤ 200', async () => {
  // Satt inn ELDST-FØRST med vilje: faller .order() ut av spørringen, kommer
  // radene i innsettingsrekkefølge og nyeste-først-asserten under blir rød.
  for (let i = 1049; i >= 0; i--) {
    state.quizzes.push(stengtQuiz(i))
    state.questions.push({ id: `s-${String(i).padStart(4, '0')}`, quiz_id: `q-${String(i).padStart(4, '0')}`, order_index: 1 })
  }

  const { status, quizzes } = await kall()
  assert.equal(status, 200)
  assert.equal(quizzes.length, 1050, 'kutt ved 1000 ville gitt 1000')
  assert.ok(state.quizQueries >= 2, `forventet paginering av quizlisten, fikk ${state.quizQueries} spørring(er)`)

  // Totalordningen: nyeste stengetid først, strengt synkende hele veien.
  assert.equal(quizzes[0].id, 'q-0000', 'nyeste quiz skal ligge først')
  for (let i = 1; i < quizzes.length; i++) {
    assert.ok(
      String(quizzes[i - 1].closesAt) > String(quizzes[i].closesAt),
      `rekkefølgen brytes ved rad ${i}`
    )
  }

  // 1050 quiz-id-er → minst 6 biter, ingen over .in()-taket på 200.
  assert.ok(state.chunkSizes.length >= 6, `forventet ≥ 6 spørsmåls-spørringer, fikk ${state.chunkSizes.length}`)
  assert.ok(state.chunkSizes.every((n) => n <= 200), `en .in()-bit er over 200: ${state.chunkSizes}`)
})

test('1440 spørsmål: quizer bak 1000-kuttet har KOMPLETTE id-lister i order_index-rekkefølge', async () => {
  for (let i = 0; i < 120; i++) state.quizzes.push(stengtQuiz(i))
  // Satt inn STOKKET (synkende order_index, quizene interleavet) med vilje:
  // faller .order() ut av questions-spørringen, brytes order_index-asserten.
  for (let idx = 12; idx >= 1; idx--) {
    for (let i = 119; i >= 0; i--) {
      state.questions.push({
        id: `s-${String(i).padStart(3, '0')}-${String(idx).padStart(2, '0')}`,
        quiz_id: `q-${String(i).padStart(4, '0')}`,
        order_index: idx,
      })
    }
  }

  const { status, quizzes } = await kall()
  assert.equal(status, 200)
  assert.equal(quizzes.length, 120)
  assert.ok(state.questionQueries >= 2, `forventet paginering av spørsmålene, fikk ${state.questionQueries} spørring(er)`)

  // Sortert på (quiz_id, order_index) ligger halen av populasjonen bak
  // 1000-radskuttet — uten paginering ville de quizene manglet spørsmål.
  for (const q of quizzes) {
    const nr = q.id.slice(2)
    assert.equal(q.questionIds.length, 12, `quiz ${q.id} mangler spørsmål`)
    assert.deepEqual(
      q.questionIds,
      Array.from({ length: 12 }, (_, k) => `s-${nr.slice(1)}-${String(k + 1).padStart(2, '0')}`),
      `quiz ${q.id} har id-ene i feil rekkefølge`
    )
  }
})

// ── Populasjonen: speiler kildegaten i POST ─────────────────────────────────

test('arkivkopier, testquizer, skjulte, åpne og stengetid-løse quizer er ALLE utenfor', async () => {
  state.quizzes = [
    stengtQuiz(1),                                              // med
    stengtQuiz(2, { is_test: null }),                           // med — .not(is,true) dekker NULL
    stengtQuiz(3, { quiz_type: 'archive', closes_at: null }),   // ute: arkivkopi
    stengtQuiz(4, { quiz_type: 'test' }),                       // ute: hviteliste
    stengtQuiz(5, { is_test: true }),                           // ute: testflagg
    stengtQuiz(6, { is_active: false }),                        // ute: skjult i admin
    stengtQuiz(7, { closes_at: '2099-01-01T00:00:00.000Z' }),   // ute: ikke stengt
    stengtQuiz(8, { closes_at: null }),                         // ute: uten stengetid
  ]
  for (const q of state.quizzes) {
    state.questions.push({ id: `s-${q.id}`, quiz_id: q.id, order_index: 1 })
  }

  const { quizzes } = await kall()
  assert.deepEqual(
    quizzes.map((q) => q.id).sort(),
    ['q-0001', 'q-0002'],
    'kun stengte, ekte, synlige quizer skal vises'
  )
})

test('en quiz uten spørsmål vises ikke — POST ville svart tom-liste', async () => {
  state.quizzes = [stengtQuiz(1), stengtQuiz(2)]
  state.questions = [{ id: 's-1', quiz_id: 'q-0001', order_index: 1 }]

  const { quizzes } = await kall()
  assert.deepEqual(quizzes.map((q) => q.id), ['q-0001'])
})

// ── Feil er «vet ikke», aldri en tom liste ──────────────────────────────────

test('quiz-lesefeil → 503, aldri en tom liste forkledd som suksess', async () => {
  state.quizzesDown = true
  const { status, quizzes } = await kall()
  assert.equal(status, 503)
  assert.deepEqual(quizzes, [])
})

test('spørsmåls-lesefeil → 503', async () => {
  state.quizzes = [stengtQuiz(1)]
  state.questionsDown = true
  const { status } = await kall()
  assert.equal(status, 503)
})

// ── Ugatet med vilje ────────────────────────────────────────────────────────

test('listen er UGATET: intet auth-oppslag, 200 uten token', async () => {
  state.quizzes = [stengtQuiz(1)]
  state.questions = [{ id: 's-1', quiz_id: 'q-0001', order_index: 1 }]
  const { status } = await kall()
  assert.equal(status, 200)
  assert.equal(state.authCalls, 0, 'gratisbrukere skal se arkivet — ingen auth i lesestien')
})
