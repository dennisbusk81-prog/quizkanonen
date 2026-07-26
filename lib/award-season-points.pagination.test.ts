// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte processQuiz. `mock.module` bytter ut
// lib/supabase-admin med en fake som håndhever BEGGE grensene PostgREST har:
//
//   1. maks 1000 rader per svar (stille avkutting)
//   2. .in()-lister over ~390 id-er avvises (URL-lengde) — målt mot prod
//
// Dette er den mest alvorlige avkuttingen i kodebasen: hver tapt rad er en
// spiller uten sesongpoeng, og upsertScores bruker ignoreDuplicates: true, så
// en ny kjøring retter det ALDRI opp (se lib/season-resync-plan.ts).
//
// MUTASJONSBEVIS:
//   - fjern pagineringen  → 1000 av 2500 rader, første test feiler
//   - fjern chunkingen    → faken avviser .in() med 2500 id-er, testene feiler
//   - fjern feilsjekkene  → processQuiz returnerer stille suksess, de tre
//                           feilhåndteringstestene feiler
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_KEY_CAP = 390

type AttemptRow = {
  user_id: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number
}
type ScoreRow = { user_id: string; scope_type: string; scope_id: string | null; rank: number; points: number }

const state: {
  attempts: AttemptRow[]
  orgMembers: Array<{ user_id: string; organization_id: string; global_league_opt_out: boolean | null }>
  restrictedOrgs: Array<{ id: string }>
  leagueMembers: Array<{ league_id: string; user_id: string }>
  errorOn: string | null
  attemptQueries: number
  maxInChunk: number
  upserted: ScoreRow[] | null
} = {
  attempts: [],
  orgMembers: [],
  restrictedOrgs: [],
  leagueMembers: [],
  errorOn: null,
  attemptQueries: 0,
  maxInChunk: 0,
  upserted: null,
}

function builder(table: string) {
  let from: number | null = null
  let to: number | null = null
  let head = false
  let inKeys: string[] | null = null

  const b = {
    select(_cols?: string, opts?: { head?: boolean }) { if (opts?.head) head = true; return b },
    eq() { return b },
    not() { return b },
    update() { return b },
    order() { return b },
    in(_col: string, keys: string[]) {
      inKeys = keys
      state.maxInChunk = Math.max(state.maxInChunk, keys.length)
      return b
    },
    range(f: number, t: number) { from = f; to = t; return b },
    maybeSingle() { return Promise.resolve({ data: null, error: null }) },
    upsert(rows: ScoreRow[]) {
      state.upserted = [...(state.upserted ?? []), ...rows]
      return Promise.resolve({ error: null })
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      const done = (v: unknown) => Promise.resolve(v).then(res, rej)

      if (head) return done({ count: state.upserted?.length ?? 0, error: null })
      if (state.errorOn === table) return done({ data: null, error: { message: `simulert feil: ${table}` } })

      // URL-grensen: en for lang .in()-liste avvises av serveren.
      if (inKeys && inKeys.length > URL_KEY_CAP) {
        return done({ data: null, error: { message: `Bad Request: URL for lang (${inKeys.length} id-er)` } })
      }

      let rows: unknown[] = []
      if (table === 'attempts') {
        state.attemptQueries++
        rows = state.attempts
      } else if (table === 'organization_members') {
        const set = new Set(inKeys ?? [])
        rows = state.orgMembers.filter(m => set.has(m.user_id))
      } else if (table === 'organizations') {
        const set = new Set(inKeys ?? [])
        rows = state.restrictedOrgs.filter(o => set.has(o.id))
      } else if (table === 'league_members') {
        const set = new Set(inKeys ?? [])
        rows = state.leagueMembers.filter(m => set.has(m.user_id))
      }

      const f = from ?? 0
      const t = to ?? PG_ROW_CAP - 1
      // PostgREST-taket.
      return done({ data: rows.slice(f, t + 1).slice(0, PG_ROW_CAP), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { processQuiz } = await import('@/lib/award-season-points')

const makeAttempts = (n: number): AttemptRow[] =>
  Array.from({ length: n }, (_, i) => ({
    user_id: 'u' + String(i).padStart(6, '0'),
    correct_answers: n - i,
    total_time_ms: 10_000 + i,
    correct_streak: 0,
  }))

function reset(overrides: Partial<typeof state> = {}) {
  Object.assign(state, {
    attempts: [],
    orgMembers: [],
    restrictedOrgs: [],
    leagueMembers: [],
    errorOn: null,
    attemptQueries: 0,
    maxInChunk: 0,
    upserted: null,
  }, overrides)
}

const CLOSES = '2026-07-24T20:00:00.000Z'
const rowsOfScope = (scope: string) => (state.upserted ?? []).filter(r => r.scope_type === scope)

// ── 1000-rads-taket ──────────────────────────────────────────────────────────

test('processQuiz gir sesongpoeng til ALLE spillere forbi 1000-taket', async () => {
  reset({ attempts: makeAttempts(2500) })

  const res = await processQuiz('quiz-1', CLOSES)

  assert.equal(res.error, null)
  assert.equal(rowsOfScope('global').length, 2500, 'alle 2500 innloggede spillere skal få en global rad')
  assert.ok(state.attemptQueries >= 3, `forventet paginering, fikk ${state.attemptQueries} spørring(er)`)
})

test('rangeringen går til siste plass, ikke bare til 1000', async () => {
  reset({ attempts: makeAttempts(2500) })

  await processQuiz('quiz-1', CLOSES)
  const ranks = rowsOfScope('global').map(r => r.rank)

  assert.equal(Math.min(...ranks), 1)
  assert.equal(Math.max(...ranks), 2500, 'siste plass må reflektere hele feltet')
})

// ── URL-grensen på .in() ─────────────────────────────────────────────────────

test('ingen .in()-liste sendes over chunk-grensen', async () => {
  reset({
    attempts: makeAttempts(2500),
    orgMembers: makeAttempts(2500).map(a => ({
      user_id: a.user_id, organization_id: 'org-1', global_league_opt_out: false,
    })),
  })

  const res = await processQuiz('quiz-1', CLOSES)

  assert.equal(res.error, null, 'en for lang .in()-liste ville blitt avvist av faken')
  assert.ok(state.maxInChunk <= 200, `største .in()-bit var ${state.maxInChunk}, forventet <= 200`)
  assert.ok(state.maxInChunk < URL_KEY_CAP, 'må ligge trygt under den målte URL-grensen')
})

test('org-medlemmer spredt over flere biter får alle sin org-rad', async () => {
  const attempts = makeAttempts(500)
  reset({
    attempts,
    orgMembers: attempts.map(a => ({
      user_id: a.user_id, organization_id: 'org-1', global_league_opt_out: false,
    })),
  })

  await processQuiz('quiz-1', CLOSES)

  assert.equal(rowsOfScope('organization').length, 500, 'ingen medlemmer skal falle mellom bitene')
})

test('liga-medlemmer spredt over flere biter får alle sin liga-rad', async () => {
  const attempts = makeAttempts(500)
  reset({
    attempts,
    leagueMembers: attempts.map(a => ({ league_id: 'liga-1', user_id: a.user_id })),
  })

  await processQuiz('quiz-1', CLOSES)

  assert.equal(rowsOfScope('league').length, 500)
})

// ── Feil skal ikke lenger passere stille ─────────────────────────────────────

test('feil på organization_members returneres i stedet for å passere stille', async () => {
  reset({ attempts: makeAttempts(50), errorOn: 'organization_members' })

  const res = await processQuiz('quiz-1', CLOSES)

  assert.match(String(res.error), /organization_members/)
  assert.equal(res.rows, 0, 'ingen poeng skal skrives når blokkeringsgrunnlaget mangler')
  assert.equal(state.upserted, null, 'upsert må ikke kjøre på ufullstendig grunnlag')
})

test('feil på league_members returneres i stedet for å passere stille', async () => {
  reset({ attempts: makeAttempts(50), errorOn: 'league_members' })

  const res = await processQuiz('quiz-1', CLOSES)

  assert.match(String(res.error), /league_members/)
})

test('feil på organizations returneres i stedet for å passere stille', async () => {
  reset({
    attempts: makeAttempts(50),
    orgMembers: [{ user_id: 'u000000', organization_id: 'org-1', global_league_opt_out: false }],
    errorOn: 'organizations',
  })

  const res = await processQuiz('quiz-1', CLOSES)

  assert.match(String(res.error), /organizations/)
})

test('feil på attempts returneres med rows 0', async () => {
  reset({ attempts: makeAttempts(50), errorOn: 'attempts' })

  const res = await processQuiz('quiz-1', CLOSES)

  assert.match(String(res.error), /attempts/)
  assert.equal(res.rows, 0)
})

// ── Forretningslogikken er uendret ───────────────────────────────────────────

test('global_league_opt_out blokkerer fortsatt global rad', async () => {
  const attempts = makeAttempts(10)
  reset({
    attempts,
    orgMembers: [
      { user_id: 'u000000', organization_id: 'org-1', global_league_opt_out: true },
      { user_id: 'u000001', organization_id: 'org-1', global_league_opt_out: false },
    ],
  })

  await processQuiz('quiz-1', CLOSES)
  const globalUsers = new Set(rowsOfScope('global').map(r => r.user_id))

  assert.ok(!globalUsers.has('u000000'), 'opt-out-bruker skal ikke ha global rad')
  assert.ok(globalUsers.has('u000001'), 'vanlig org-medlem skal ha global rad')
  assert.equal(rowsOfScope('organization').length, 2, 'begge beholder org-raden sin')
})

test('org med allow_global_league=false blokkerer medlemmene fra global', async () => {
  reset({
    attempts: makeAttempts(10),
    orgMembers: [{ user_id: 'u000000', organization_id: 'org-lukket', global_league_opt_out: false }],
    restrictedOrgs: [{ id: 'org-lukket' }],
  })

  await processQuiz('quiz-1', CLOSES)

  assert.ok(
    !new Set(rowsOfScope('global').map(r => r.user_id)).has('u000000'),
    'medlem av lukket org skal ikke ha global rad'
  )
})

test('dagens størrelse (75 spillere) gir nøyaktig én attempts-spørring', async () => {
  reset({ attempts: makeAttempts(75) })

  const res = await processQuiz('quiz-1', CLOSES)

  assert.equal(res.error, null)
  assert.equal(rowsOfScope('global').length, 75)
  assert.equal(state.attemptQueries, 1, 'ingen ekstra rundtur når alt får plass på én side')
})
