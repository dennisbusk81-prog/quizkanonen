// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// PAGINERINGSTEST av forsidens liga-kort (lib/league-card-data.ts) mot en fake
// som oppfører seg som PostgREST på BEGGE de målte takene: 1000-radskuttet og
// «Bad Request» for .in()-lister over ~390 nøkler.
//
// MUTASJONSBEVIS:
//   • Byttes sesongpoeng-lesingen til ett rått kall → «sesongvinneren …» ryker
//     (vinnerens rader ligger kun i posisjon 1000+).
//   • Byttes fallback-lesingen til ett rått .in(alle 401) → faken svarer
//     «Bad Request» slik prod-PostgREST gjør, kallet kaster, og
//     «fallback …»-testen ryker. Før 23. august 2026 var erroren i tillegg
//     ULEST — da ble kortet stille tomt.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_CAP = 390

type ScoreRow = { user_id: string; points: number; profiles: { display_name: string | null } | null }
type AttemptRow = { user_id: string; correct_answers: number; total_time_ms: number }

const state: {
  scoreRows: ScoreRow[]
  memberIds: string[]
  attempts: AttemptRow[]
  chunkSizes: number[]
} = { scoreRows: [], memberIds: [], attempts: [], chunkSizes: [] }

function rangedBuilder(rowsFor: (chunk: string[]) => unknown[]) {
  let from = 0
  let to = PG_ROW_CAP - 1
  let chunk: string[] = []
  const b = {
    select() { return b },
    eq() { return b },
    gte() { return b },
    lt() { return b },
    not() { return b },
    in(_col: string, keys: string[]) { chunk = keys; return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      if (chunk.length > URL_CAP) {
        state.chunkSizes.push(chunk.length)
        return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
      }
      if (chunk.length > 0) state.chunkSizes.push(chunk.length)
      const rows = rowsFor(chunk)
      const window = rows.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'season_scores') return rangedBuilder(() => state.scoreRows) as never
        if (table === 'league_members') return rangedBuilder(() => state.memberIds.map(id => ({ user_id: id }))) as never
        if (table === 'attempts') {
          return rangedBuilder(chunk => state.attempts.filter(a => chunk.includes(a.user_id))) as never
        }
        if (table === 'profiles') {
          return rangedBuilder(chunk => chunk.map(id => ({ id, display_name: `Navn ${id}` }))) as never
        }
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { getLeagueCardData } = await import('@/lib/league-card-data')

const LIGA = { id: 'liga-1', name: 'Testligaen' }

beforeEach(() => {
  state.scoreRows = []
  state.memberIds = []
  state.attempts = []
  state.chunkSizes = []
})

test('sesongvinneren finnes selv når radene hennes ligger forbi 1000-taket', async () => {
  state.scoreRows = [
    ...Array.from({ length: 1020 }, (_, i) => ({
      user_id: `fyll-${String(i).padStart(4, '0')}`,
      points: 5,
      profiles: { display_name: `Fyll ${i}` },
    })),
    { user_id: 'vinner', points: 90, profiles: { display_name: 'Vigdis Vinner' } },
  ]

  const card = await getLeagueCardData(LIGA, null, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')

  assert.equal(card.fromFallback, false)
  assert.equal(card.top3[0]?.displayName, 'Vigdis Vinner',
    'vinnerens rad ligger KUN i posisjon 1020 — et kutt ved 1000 hadde utelatt henne')
})

test('fallback: 401 medlemmer chunkes under URL-taket, og beste forsøk i siste chunk vinner', async () => {
  // Ingen sesongpoeng → fallback-stien. 401 medlemmer er over URL-taket i én
  // liste; u-0400 (kun i chunk 3) har beste resultat.
  state.memberIds = Array.from({ length: 401 }, (_, i) => `u-${String(i).padStart(4, '0')}`)
  state.attempts = [
    { user_id: 'u-0000', correct_answers: 10, total_time_ms: 60_000 },
    { user_id: 'u-0400', correct_answers: 14, total_time_ms: 55_000 },
  ]

  const card = await getLeagueCardData(LIGA, 'quiz-1', '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')

  assert.equal(card.fromFallback, true)
  assert.deepEqual(
    card.top3.map(t => [t.displayName, t.value]),
    [['Navn u-0400', 14], ['Navn u-0000', 10]],
    'u-0400 finnes kun i siste chunk — et rått .in(alle 401) hadde feilet med Bad Request',
  )
  assert.ok(state.chunkSizes.every(n => n <= URL_CAP),
    `en .in()-liste oversteg URL-taket: ${JSON.stringify(state.chunkSizes)}`)
})

test('lesefeil kaster i stedet for å bli et stille tomt kort', async () => {
  // 400 fra faken (chunk over taket presset inn via ett rått kall finnes ikke
  // lenger — så vi simulerer feilen på sesongpoeng-lesingen direkte).
  const failing = {
    select() { return failing },
    eq() { return failing },
    gte() { return failing },
    lt() { return failing },
    order() { return failing },
    range() { return failing },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve({ data: null, error: { message: 'simulert lesefeil' } }).then(res, rej)
    },
  }
  const original = (await import('@/lib/supabase-admin')).supabaseAdmin.from
  const admin = (await import('@/lib/supabase-admin')).supabaseAdmin as unknown as { from: (t: string) => unknown }
  admin.from = () => failing
  try {
    await assert.rejects(
      () => getLeagueCardData(LIGA, null, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      /simulert lesefeil/,
    )
  } finally {
    admin.from = original
  }
})
