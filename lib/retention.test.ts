// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av fetchRetentionRows() sitt QUIZ-UTVALG — altså hvilken
// populasjon retention-prosenten regnes over. `mock.module` bytter ut
// supabase-admin; lib/paginate og computeRetention kjøres uendret, så
// prosentene i assertions er de EKTE tallene fra beregningen.
//
// Den rene beregningen (computeRetention) er dekket direkte nederst — den
// trenger ingen mock.
//
// MUTASJONSBEVIS (verifisert ved å fjerne mekanismen midlertidig):
//   - fjernes onlyRealQuizzes() rundt retentionQuizQuery, feiler
//     «arkivquiz som er gjort opp havner ikke i retention-populasjonen»
//     (arkivquizen blir en rad i resultatet og skyver nevneren)
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const ARCHIVE = 'cccccccc-0000-0000-0000-000000000003'
const NULLTEST = 'dddddddd-0000-0000-0000-000000000004'

const U1 = 'u1', U2 = 'u2', U3 = 'u3'

type QuizRow = {
  id: string; title: string; opens_at: string | null; closes_at: string | null
  is_test: boolean | null; quiz_type: string; season_points_awarded: boolean
}
type AttemptRow = {
  quiz_id: string; user_id: string | null; submitted_at: string | null
}

const db: { quizzes: QuizRow[]; attempts: AttemptRow[] } = { quizzes: [], attempts: [] }

// Dynamiske tidspunkter — aldri hardkodede datoer.
const now = new Date()
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()

function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  // Flere `.in()` per spørring: onlyRealQuizzes legger på `.in('quiz_type', …)`.
  const ins: Array<{ col: string; vals: string[] }> = []
  const notNullCols: string[] = []
  const notTrueCols: string[] = []
  let orderCol: string | null = null
  let rangeFrom = 0, rangeTo = Number.MAX_SAFE_INTEGER

  const source = (): Record<string, unknown>[] => {
    switch (table) {
      case 'quizzes':  return db.quizzes as unknown as Record<string, unknown>[]
      case 'attempts': return db.attempts as unknown as Record<string, unknown>[]
      default: throw new Error(`ukjent tabell i mock: ${table}`)
    }
  }

  const rows = (): Record<string, unknown>[] => {
    const filtered = source().filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      for (const { col, vals } of ins) if (!vals.includes(String(r[col] ?? ''))) return false
      for (const c of notNullCols) if (r[c] === null || r[c] === undefined) return false
      // `.not(col, 'is', true)` — speiler PostgREST: filtrerer bort KUN true,
      // og slipper både false og NULL/undefined gjennom.
      for (const c of notTrueCols) if (r[c] === true) return false
      return true
    })
    // `.order()` er ikke pynt her: computeRetention KREVER stigende opens_at —
    // rekkefølgen er hele grunnlaget for hva «forrige quiz» betyr.
    if (orderCol) {
      filtered.sort((x, y) => String(x[orderCol!] ?? '').localeCompare(String(y[orderCol!] ?? '')))
    }
    return filtered.slice(rangeFrom, rangeTo + 1)
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    in(col: string, vals: readonly string[]) { ins.push({ col, vals: vals.map(String) }); return b },
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) notNullCols.push(col)
      if (op === 'is' && val === true) notTrueCols.push(col)
      return b
    },
    order(col: string) { orderCol = col; return b },
    range(f: number, t: number) { rangeFrom = f; rangeTo = t; return b },
    then(resolve: (v: unknown) => void) {
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: { from: (t: string) => builder(t) },
  },
})

const { fetchRetentionRows, computeRetention } = await import('@/lib/retention')

const quiz = (
  id: string, title: string, openedDaysAgo: number, over: Partial<QuizRow> = {},
): QuizRow => ({
  id, title,
  opens_at: daysAgo(openedDaysAgo),
  closes_at: daysAgo(openedDaysAgo - 1),
  is_test: false,
  quiz_type: 'weekly',
  season_points_awarded: true,
  ...over,
})

const play = (quizId: string, userId: string): AttemptRow =>
  ({ quiz_id: quizId, user_id: userId, submitted_at: daysAgo(1) })

beforeEach(() => {
  // To ekte quizer: A spilt av U1+U2, B av U1 alene → retention på B = 1/2 = 50 %.
  db.quizzes = [quiz(A, 'Quiz A', 20), quiz(B, 'Quiz B', 13)]
  db.attempts = [play(A, U1), play(A, U2), play(B, U1)]
})

// ── quiz_type-vakten (onlyRealQuizzes) ──────────────────────────────────────

test('arkivquiz som er gjort opp havner ikke i retention-populasjonen', async () => {
  // KJERNEN I FIKSEN. Arkivquizen har `is_test = false` — nøyaktig som
  // lib/archive-copy.ts:201 setter den — så det gamle `.eq('is_test', false)`
  // slapp den GJENNOM. Det eneste som holdt den ute i prod var at
  // `season_points_awarded` sto på DB-defaulten false. Her ER den gjort opp,
  // altså den framtidige tilstanden. Kun quiz_type-hvitelisten stopper den.
  //
  // Arkivquizen legges MELLOM A og B i tid, så den ikke bare blir en ekstra
  // rad på slutten: uten vakten blir den forgjengeren til B, og B sin
  // retention måles mot ÉN arkivspiller (U3) i stedet for A sine to. Da går
  // B fra 50 % til 0 % — en oppslutningskurve som stuper uten at noe skjedde.
  //
  // MUTASJONSBEVIS: fjernes onlyRealQuizzes, blir det 3 rader og B får 0 %.
  db.quizzes.push(quiz(ARCHIVE, 'Arkivquiz', 16, {
    quiz_type: 'archive', season_points_awarded: true,
  }))
  db.attempts.push(play(ARCHIVE, U3))

  const rows = await fetchRetentionRows()

  assert.equal(rows.length, 2, 'kun de to ekte quizene skal være rader')
  assert.deepEqual(rows.map(r => r.title), ['Quiz B', 'Quiz A'], 'nyeste først')

  const b = rows.find(r => r.quizId === B)!
  assert.equal(b.retentionPct, 50, 'forgjengeren til B skal være Quiz A, ikke arkivquizen')
  assert.equal(b.returned, 1)
})

test('arkivspilleren teller ikke som spiller på en ekte quiz', async () => {
  // Negativ kontroll på ATTEMPT-siden: forsøks-spørringen er bevisst uten
  // vakt, fordi computeRetention kun slår opp quizer som står i listen. En
  // arkiv-attempt skal derfor være usynlig — ikke i `players`, ikke i nevneren.
  db.quizzes.push(quiz(ARCHIVE, 'Arkivquiz', 16, {
    quiz_type: 'archive', season_points_awarded: true,
  }))
  db.attempts.push(play(ARCHIVE, U3), play(ARCHIVE, U1))

  const rows = await fetchRetentionRows()
  const a = rows.find(r => r.quizId === A)!

  assert.equal(a.players, 2, 'Quiz A har U1 og U2 — arkivforsøkene skal ikke telle')
})

// ── is_test-leddets NULL-hull ───────────────────────────────────────────────

test('quiz med is_test = NULL er ikke en testquiz og skal fortsatt telle', async () => {
  // `.eq('is_test', false)` matcher IKKE NULL — kolonnen er nullable. Denne
  // raden ville falt stille ut av retention med den gamle formen. Helperens
  // `.not('is_test', 'is', true)` slipper den gjennom.
  //
  // Byttes helperen tilbake til `.eq('is_test', false)`, blir det 2 rader her
  // i stedet for 3, og testen felles.
  db.quizzes.push(quiz(NULLTEST, 'Quiz NULL', 6, { is_test: null }))
  db.attempts.push(play(NULLTEST, U1))

  const rows = await fetchRetentionRows()

  assert.equal(rows.length, 3, 'is_test = NULL skal ikke filtreres bort')
  assert.equal(rows[0].title, 'Quiz NULL')
})

test('ekte testquiz (is_test = true) filtreres fortsatt bort', async () => {
  db.quizzes.push(quiz(NULLTEST, 'Testquiz', 6, { is_test: true }))
  db.attempts.push(play(NULLTEST, U1))

  const rows = await fetchRetentionRows()

  assert.equal(rows.length, 2)
  assert.equal(rows.some(r => r.title === 'Testquiz'), false)
})

// ── «gjort opp»-leddet er en EGEN betingelse, ikke erstattet av vakten ──────

test('uspilt framtidig quiz er fortsatt ute — season_points_awarded beholdt', async () => {
  // Dennis planlegger quizer flere uker fram. En kommende, uspilt quiz er
  // 'weekly' og ikke test, så onlyRealQuizzes slipper den gjennom — det er
  // `season_points_awarded` som holder den ute. Testen felles om noen fjerner
  // det leddet i den tro at populasjonsfilteret dekker det.
  db.quizzes.push(quiz('ffffffff-0000-0000-0000-000000000005', 'Kommende', -7, {
    season_points_awarded: false,
  }))

  const rows = await fetchRetentionRows()

  assert.equal(rows.length, 2)
  assert.equal(rows.some(r => r.title === 'Kommende'), false)
})

// ── Ren beregning ───────────────────────────────────────────────────────────

test('computeRetention: første quiz får null, ikke 0', async () => {
  const rows = computeRetention(
    [
      { id: A, title: 'A', opens_at: daysAgo(20), closes_at: daysAgo(19) },
      { id: B, title: 'B', opens_at: daysAgo(13), closes_at: daysAgo(12) },
    ],
    [
      { quiz_id: A, user_id: U1 }, { quiz_id: A, user_id: U2 },
      { quiz_id: B, user_id: U1 },
    ],
  )

  const a = rows.find(r => r.quizId === A)!
  assert.equal(a.retentionPct, null, '«ingen målt verdi» er ikke «ingen kom tilbake»')
  assert.equal(a.returned, null)
  assert.equal(rows.find(r => r.quizId === B)!.retentionPct, 50)
})
