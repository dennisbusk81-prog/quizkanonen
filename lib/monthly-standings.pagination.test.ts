// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// PAGINERINGSTEST av forsidens månedstoppliste (lib/monthly-standings.ts) mot
// en fake som oppfører seg som PostgREST på 1000-radstaket. Dette er flaten
// premium-løftet «nøyaktig plassering» hviler på: et kutt gir feil topp 3 og
// feil «din plassering» — stille, cachet i 60 s.
//
// MUTASJONSBEVIS: byttes fetchAllRows ut med ett rått kall (slik koden sto i
// app/page.tsx fram til 23. august 2026), ser spørringen kun de 1000 første
// radene. Månedsvinneren har ALLE radene sine i posisjon 1000+, så asserten
// «vinneren er #1» ryker (vinneren finnes ikke i resultatet i det hele tatt).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000

type Row = { user_id: string; points: number; profiles: { display_name: string | null } | null }

const state: { rows: Row[]; failRead: boolean; rangeWindows: Array<[number, number]> } = {
  rows: [],
  failRead: false,
  rangeWindows: [],
}

function seasonScoresBuilder() {
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select() { return b },
    eq() { return b },
    is() { return b },
    gte() { return b },
    lt() { return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      state.rangeWindows.push([from, to])
      if (state.failRead) {
        return Promise.resolve({ data: null, error: { message: 'simulert lesefeil' } }).then(res, rej)
      }
      // PostgREST: respekterer range-vinduet, men aldri mer enn 1000 rader.
      const window = state.rows.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'season_scores') return seasonScoresBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { getMonthlyGlobalStandings } = await import('@/lib/monthly-standings')

beforeEach(() => {
  // 1050 fyllrader (én per bruker, 10 poeng) FØRST, deretter månedsvinnerens
  // 4 rader à 50. Vinneren er dermed USYNLIG for et enkeltkall som kuttes ved
  // 1000 — og «nest best» (en fyllbruker) ville feilaktig blitt #1.
  state.rows = [
    ...Array.from({ length: 1050 }, (_, i) => ({
      user_id: `fyll-${String(i).padStart(4, '0')}`,
      points: 10,
      profiles: { display_name: `Fyll ${i}` },
    })),
    ...Array.from({ length: 4 }, () => ({
      user_id: 'vinner',
      points: 50,
      profiles: { display_name: 'Vigdis Vinner' },
    })),
  ]
  state.failRead = false
  state.rangeWindows = []
})

test('månedsvinneren finnes selv når radene hennes ligger forbi 1000-taket', async () => {
  const standings = await getMonthlyGlobalStandings('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')

  assert.equal(standings[0]?.userId, 'vinner',
    'vinnerens rader ligger KUN i posisjon 1050+ — et kutt ved 1000 hadde utelatt henne helt')
  assert.equal(standings[0]?.totalPoints, 200, 'poengene skal summeres over alle 4 radene')
  assert.equal(standings.length, 1051, 'alle 1051 brukere skal med, ikke bare de 1000 første radene')
  assert.ok(state.rangeWindows.length >= 2,
    `forventet minst to range-vinduer (paginering), fikk ${JSON.stringify(state.rangeWindows)}`)
})

test('kontroll: de 1000 første radene inneholder IKKE vinneren', () => {
  const kuttet = state.rows.slice(0, PG_ROW_CAP)
  assert.ok(!kuttet.some(r => r.user_id === 'vinner'),
    'datasettet må gjøre vinneren usynlig for et kuttet kall — ellers beviser testen ingenting')
})

test('tomt/null navn beholdes som «—» (innlogget rang uendret)', async () => {
  state.rows = [
    { user_id: 'u-1', points: 30, profiles: null },
    { user_id: 'u-2', points: 20, profiles: { display_name: 'Nora' } },
  ]
  const standings = await getMonthlyGlobalStandings('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  assert.deepEqual(standings.map(s => [s.displayName, s.totalPoints]), [['—', 30], ['Nora', 20]])
})

test('lesefeil kaster — en feil skal ikke se ut som en tom måned', async () => {
  state.failRead = true
  await assert.rejects(
    () => getMonthlyGlobalStandings('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
    /simulert lesefeil/,
  )
})
