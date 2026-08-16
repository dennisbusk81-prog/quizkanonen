// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av chunking/paginering i computeWeeklySummary
// (lib/weekly-report.ts). Mocken under HÅNDHEVER de to prod-takene fra
// lib/paginate.ts, i stedet for å bare telle kall:
//   1. .in(kolonne, ids) med flere enn 390 id-er → error (URL-grensen, målt
//      mot prod 26. juli 2026: 380 OK, 400 feiler).
//   2. Maks 1000 rader per svar, STILLE (radtaket).
//
// MUTASJONSBEVIS (verifisert ved å fjerne mekanismene midlertidig):
//   - byttes fetchAllRowsChunked på attempts- eller profiles-oppslaget tilbake
//     til ett rått .in('user_id', memberIds), feiler testen: 1201 id-er i én
//     URL → mocken svarer med error, fetchAllRows kaster.
//   - heves chunk-størrelsen over den målte grensen (>390), feiler den av
//     samme grunn — grensen i mocken er prod-grensen, ikke chunk-størrelsen.
//   - byttes fetchAllRows på organization_members tilbake til ett rått
//     .select(), feiler «alle 1201 medlemmer telles»: mocken kutter stille på
//     1000 rader, og participantCount blir 1000.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_KEY_CAP = 390 // målt: 380 OK, 400 feiler
const MEMBER_COUNT = 1201 // > radtaket OG > 6 hele chunks à 200

const ORG = 'dddddddd-1111-2222-3333-444444444444'
const REAL_QUIZ = 'aaaaaaaa-1111-2222-3333-444444444444'

const memberId = (i: number) => `u${String(i).padStart(4, '0')}`

type AttemptRow = {
  user_id: string; quiz_id: string; player_name: string | null
  correct_answers: number; total_questions: number; total_time_ms: number
  correct_streak: number; is_team: boolean; submitted_at: string | null
}

const db: {
  orgMembers: Array<{ user_id: string; organization_id: string }>
  quizzes: Array<{ id: string; title: string; closes_at: string | null; is_test: boolean }>
  attempts: AttemptRow[]
  profiles: Array<{ id: string; display_name: string | null }>
} = { orgMembers: [], quizzes: [], attempts: [], profiles: [] }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let inCol: string | null = null, inVals: string[] | null = null
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

  const respond = (): { data: Record<string, unknown>[] | null; error: { message: string } | null } => {
    // Tak 1: URL-grensen for .in()-lister — en HARD feil i prod, ikke et kutt.
    if (inVals !== null && inVals.length > URL_KEY_CAP) {
      return { data: null, error: { message: `Bad Request (mock: ${inVals.length} id-er i .in(), taket er ${URL_KEY_CAP})` } }
    }
    let out = source().filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (inCol && inVals && !inVals.includes(String(r[inCol] ?? ''))) return false
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
    // Tak 2: radtaket — STILLE, akkurat som PostgREST.
    return { data: out.slice(0, PG_ROW_CAP), error: null }
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
    maybeSingle() {
      const { data, error } = respond()
      return Promise.resolve({ data: data?.[0] ?? null, error })
    },
    then(resolve: (v: unknown) => void) { return resolve(respond()) },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { computeWeeklySummary } = await import('@/lib/weekly-report')

beforeEach(() => {
  db.orgMembers = []
  db.attempts = []
  db.profiles = []
  db.quizzes = [{ id: REAL_QUIZ, title: 'Fredagsquiz', closes_at: minutesAgo(120), is_test: false }]

  for (let i = 0; i < MEMBER_COUNT; i++) {
    const uid = memberId(i)
    db.orgMembers.push({ user_id: uid, organization_id: ORG })
    db.attempts.push({
      user_id: uid, quiz_id: REAL_QUIZ, player_name: null,
      // Medlem 0 vinner: flest riktige og raskest.
      correct_answers: i === 0 ? 10 : 5, total_questions: 10,
      total_time_ms: i === 0 ? 60_000 : 90_000 + i,
      correct_streak: 0, is_team: false, submitted_at: minutesAgo(125),
    })
    db.profiles.push({ id: uid, display_name: `Ansatt ${i}` })
  }
})

test('alle 1201 medlemmer telles — begge prod-takene håndheves av mocken', async () => {
  const summary = await computeWeeklySummary(ORG)
  assert.notEqual(summary, null, 'beregningen skal ikke feile med 1201 medlemmer')
  assert.equal(
    summary!.participantCount, MEMBER_COUNT,
    'radtaket på 1000 skal ikke kutte medlemslisten — organization_members må pagineres'
  )
  assert.equal(summary!.winner?.displayName, 'Ansatt 0', 'navn skal slås opp for ALLE deltakere, også forbi chunk-grensen')
  assert.equal(summary!.winner?.correct, 10)
})

test('navneoppslaget dekker id-er i SISTE chunk, ikke bare den første', async () => {
  // Vinneren legges sist i id-sortering — havner i 7. og siste chunk.
  const lastUid = memberId(MEMBER_COUNT - 1)
  const winner = db.attempts.find(a => a.user_id === lastUid)!
  winner.correct_answers = 10
  winner.total_time_ms = 1_000

  const summary = await computeWeeklySummary(ORG)
  assert.notEqual(summary, null)
  assert.equal(summary!.winner?.displayName, `Ansatt ${MEMBER_COUNT - 1}`)
})
