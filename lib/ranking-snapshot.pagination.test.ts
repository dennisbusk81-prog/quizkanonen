// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Dette er en INTEGRASJONSTEST av den ekte getOrBuildSnapshot — ikke av en
// utklippet hjelpefunksjon. `mock.module` bytter ut lib/supabase-admin med en
// fake som oppfører seg som PostgREST, slik at produksjonskoden kjøres uendret
// (ingen injisert parameter, ingen egen testvei) mot et datasett større enn
// 1000-taket.
//
// MUTASJONSBEVIS: faken returnerer aldri mer enn 1000 rader per svar. Fjernes
// pagineringen i lib/ranking-snapshot.ts, ser funksjonen 1000 av 2500 forsøk og
// den første assert-en feiler.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000

type AttemptRow = {
  id: string
  user_id: string
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number
  submitted_at: string
}

// Muterbar tilstand faken leser — lar hver test sette opp sitt eget datasett
// uten å registrere mocken på nytt.
const state: {
  attempts: AttemptRow[]
  cached: { snapshot: unknown; created_at: string } | null
  attemptQueries: number
  orderedBy: string[]
  ranges: Array<{ from: number; to: number }>
  upserted: { snapshot: AttemptRow[] } | null
} = {
  attempts: [],
  cached: null,
  attemptQueries: 0,
  orderedBy: [],
  ranges: [],
  upserted: null,
}

function builder(table: string) {
  let from: number | null = null
  let to: number | null = null

  const b = {
    select() { return b },
    eq() { return b },
    not() { return b },
    order(col: string) { state.orderedBy.push(`${table}.${col}`); return b },
    range(f: number, t: number) { from = f; to = t; return b },
    maybeSingle() {
      return Promise.resolve({ data: table === 'ranking_snapshots' ? state.cached : null, error: null })
    },
    upsert(row: { snapshot: AttemptRow[] }) {
      state.upserted = row
      return Promise.resolve({ error: null })
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      if (table !== 'attempts') {
        return Promise.resolve({ data: [], error: null }).then(res, rej)
      }
      state.attemptQueries++
      const f = from ?? 0
      const t = to ?? PG_ROW_CAP - 1
      state.ranges.push({ from: f, to: t })
      // PostgREST-taket: aldri mer enn 1000 rader i ett svar.
      const window = state.attempts.slice(f, t + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { getOrBuildSnapshot } = await import('@/lib/ranking-snapshot')

const makeAttempts = (n: number): AttemptRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: 'a' + String(i).padStart(6, '0'),
    user_id: 'u' + String(i).padStart(6, '0'),
    player_name: 'Spiller ' + i,
    // Synkende antall riktige gir en forutsigbar, entydig rangering.
    correct_answers: n - i,
    total_time_ms: 10_000 + i,
    correct_streak: 0,
    submitted_at: '2026-07-24T20:00:00.000Z',
  }))

function reset(attempts: AttemptRow[]) {
  state.attempts = attempts
  state.cached = null
  state.attemptQueries = 0
  state.orderedBy = []
  state.ranges = []
  state.upserted = null
}

test('getOrBuildSnapshot henter ALLE forsøk forbi 1000-taket', async () => {
  reset(makeAttempts(2500))

  const snapshot = await getOrBuildSnapshot('quiz-1')

  assert.equal(snapshot.length, 2500, 'alle 2500 leverte forsøk skal være med i snapshoten')
  assert.ok(state.attemptQueries >= 3, `forventet paginering, fikk ${state.attemptQueries} spørring(er)`)
})

test('rangeringen dekker hele populasjonen, ikke bare de 1000 første', async () => {
  reset(makeAttempts(2500))

  const snapshot = await getOrBuildSnapshot('quiz-1')
  const ranks = snapshot.map(e => e.rank)

  assert.equal(Math.min(...ranks), 1)
  assert.equal(Math.max(...ranks), 2500, 'siste plass må reflektere hele feltet')
  assert.equal(new Set(ranks).size, 2500, 'total ordning uten delte plasseringer')

  // Spilleren som ville falt utenfor et upaginert kall skal ha en ekte plassering.
  const beyondCap = snapshot.find(e => e.id === 'a002400')
  assert.ok(beyondCap, 'forsøk nr. 2400 skal finnes i snapshoten')
  assert.equal(beyondCap.rank, 2401)
})

test('pagineringen sorteres stabilt på id', async () => {
  reset(makeAttempts(2500))

  await getOrBuildSnapshot('quiz-1')

  assert.ok(
    state.orderedBy.includes('attempts.id'),
    'attempts må sorteres på id — uten stabil sortering kan sider hoppe over eller duplisere rader'
  )
})

test('den cachede snapshoten som skrives inneholder hele feltet', async () => {
  reset(makeAttempts(2500))

  await getOrBuildSnapshot('quiz-1')

  assert.ok(state.upserted, 'en fersk snapshot skal skrives til cachen')
  assert.equal(state.upserted.snapshot.length, 2500, 'cachen må ikke lagre en avkuttet liste')
})

test('sidevinduene er sammenhengende og overlapper ikke', async () => {
  reset(makeAttempts(2500))

  await getOrBuildSnapshot('quiz-1')

  for (let i = 1; i < state.ranges.length; i++) {
    assert.equal(
      state.ranges[i].from,
      state.ranges[i - 1].to + 1,
      'hver side må starte rett etter forrige — ellers tapes eller dupliseres rader'
    )
  }
})

test('under 1000 forsøk fungerer nøyaktig som før (ingen regresjon)', async () => {
  reset(makeAttempts(71)) // dagens mest spilte quiz

  const snapshot = await getOrBuildSnapshot('quiz-1')

  assert.equal(snapshot.length, 71)
  assert.equal(state.attemptQueries, 1, 'ingen ekstra rundtur når alt får plass på én side')
})
