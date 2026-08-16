// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av computeWeeklySummary sitt quiz-valg («sist stengte
// quiz») i lib/weekly-report.ts. `mock.module` bytter ut supabase-admin —
// funksjonen selv kjøres uendret.
//
// MUTASJONSBEVIS (verifisert ved å fjerne mekanismen midlertidig):
//   - fjernes .eq('is_test', false) i quiz-oppslaget, feiler «testquiz kaprer
//     ikke ukesrapporten»: testquizen stengte sist og vinner
//     order('closes_at', desc), org-medlemmene har ingen forsøk på den, og
//     computeWeeklySummary returnerer null — B2B-ukesrapporten undertrykkes
//     STILLE for den ekte quizen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ORG = 'dddddddd-1111-2222-3333-444444444444'
const MEMBER = '11111111-1111-1111-1111-111111111111'
const REAL_QUIZ = 'aaaaaaaa-1111-2222-3333-444444444444'
const TEST_QUIZ = 'cccccccc-1111-2222-3333-444444444444'

type QuizRow = { id: string; title: string; closes_at: string | null; is_test: boolean }
type AttemptRow = {
  user_id: string; quiz_id: string; player_name: string | null
  correct_answers: number; total_questions: number; total_time_ms: number
  correct_streak: number; is_team: boolean; submitted_at: string | null
}

const db: {
  orgMembers: Array<{ user_id: string; organization_id: string }>
  quizzes: QuizRow[]
  attempts: AttemptRow[]
  profiles: Array<{ id: string; display_name: string | null }>
} = { orgMembers: [], quizzes: [], attempts: [], profiles: [] }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let inCol: string | null = null, inVals: string[] = []
  let ltVal: string | null = null
  const notNullCols: string[] = []
  let orderCol: string | null = null
  let orderAsc = true
  let limitN: number | null = null
  let rangeFrom: number | null = null
  let rangeTo = 0

  const source = (): Record<string, unknown>[] => {
    switch (table) {
      case 'organization_members': return db.orgMembers as unknown as Record<string, unknown>[]
      case 'quizzes':              return db.quizzes as unknown as Record<string, unknown>[]
      case 'attempts':             return db.attempts as unknown as Record<string, unknown>[]
      case 'profiles':             return db.profiles as unknown as Record<string, unknown>[]
      default: throw new Error(`ukjent tabell i mock: ${table}`)
    }
  }

  const rows = (): Record<string, unknown>[] => {
    let out = source().filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (inCol && !inVals.includes(String(r[inCol] ?? ''))) return false
      if (ltVal !== null && (r.closes_at === null || String(r.closes_at) >= ltVal)) return false
      for (const c of notNullCols) if (r[c] === null || r[c] === undefined) return false
      return true
    })
    if (orderCol !== null) {
      const col = orderCol
      out = [...out].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')))
      if (!orderAsc) out.reverse()
    }
    if (rangeFrom !== null) out = out.slice(rangeFrom, rangeTo + 1)
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals.map(String); return b },
    lt(_col: string, val: string) { ltVal = val; return b },
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) notNullCols.push(col)
      return b
    },
    order(col: string, opts?: { ascending?: boolean }) { orderCol = col; orderAsc = opts?.ascending !== false; return b },
    limit(n: number) { limitN = n; return b },
    range(from: number, to: number) { rangeFrom = from; rangeTo = to; return b },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
    then(resolve: (v: unknown) => void) { return resolve({ data: rows(), error: null }) },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { computeWeeklySummary } = await import('@/lib/weekly-report')

beforeEach(() => {
  db.orgMembers = [{ user_id: MEMBER, organization_id: ORG }]
  db.quizzes = [{ id: REAL_QUIZ, title: 'Fredagsquiz', closes_at: minutesAgo(120), is_test: false }]
  db.attempts = [{
    user_id: MEMBER, quiz_id: REAL_QUIZ, player_name: null,
    correct_answers: 7, total_questions: 10, total_time_ms: 90_000,
    correct_streak: 3, is_team: false, submitted_at: minutesAgo(125),
  }]
  db.profiles = [{ id: MEMBER, display_name: 'Kari Ansatt' }]
})

test('testquiz kaprer ikke ukesrapporten', async () => {
  // MUTASJONSBEVIS: testquizen stengte SIST og vinner sorteringen uten
  // filteret — da blir summary null og rapporten for den ekte quizen sendes
  // aldri.
  db.quizzes.push({ id: TEST_QUIZ, title: '[TEST – ikke ekte]', closes_at: minutesAgo(10), is_test: true })

  const summary = await computeWeeklySummary(ORG)
  assert.notEqual(summary, null, 'rapporten skal bygges fra den ekte quizen')
  assert.equal(summary!.quizId, REAL_QUIZ)
  assert.equal(summary!.participantCount, 1)
})

test('ekte sist stengte quiz rapporteres fortsatt normalt', async () => {
  const summary = await computeWeeklySummary(ORG)
  assert.notEqual(summary, null)
  assert.equal(summary!.quizId, REAL_QUIZ)
  assert.equal(summary!.winner?.displayName, 'Kari Ansatt')
  assert.equal(summary!.winner?.correct, 7)
})
