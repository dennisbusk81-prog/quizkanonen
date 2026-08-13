// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// hasSettledPlays (lib/has-settled-plays.ts) — 403-grenenes «har brukeren
// spilt?»-sjekk på /historikk og /historikk/[attemptId].
//
// MUTASJONSBEVIS — mocken håndhever filtrene spørringen selv oppgir:
//   • Gjeninnføres `.eq('scope_type','global')` (eller krympes .in-listen),
//     mister org-brukeren raden sin og «bruker med KUN organization-rader …»
//     ryker — det var nøyaktig buggen: hele Elkjøp ble kastet til /premium
//     med full historikk.
//   • Fjernes error-sjekken (count ?? 0 svelger feil igjen), returneres 'no'
//     ved DB-feil og «feilet spørring gir unknown …» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type ScoreRow = { user_id: string; scope_type: string }

const state: { rows: ScoreRow[]; error: { message: string } | null } = {
  rows: [],
  error: null,
}

function scoresBuilder() {
  let rows = [...state.rows]
  const b = {
    select() { return b },
    eq(col: keyof ScoreRow, val: string) { rows = rows.filter(r => r[col] === val); return b },
    in(col: keyof ScoreRow, vals: string[]) { rows = rows.filter(r => vals.includes(r[col])); return b },
    then(resolve: (r: { count: number | null; error: { message: string } | null }) => unknown) {
      return Promise.resolve(
        state.error ? { count: null, error: state.error } : { count: rows.length, error: null }
      ).then(resolve)
    },
  }
  return b
}

mock.module('@/lib/supabase', {
  namedExports: {
    supabase: {
      from: (table: string) => {
        if (table === 'season_scores') return scoresBuilder() as never
        throw new Error(`uventet tabell i test: ${table}`)
      },
    },
  },
})

const { hasSettledPlays } = await import('@/lib/has-settled-plays')

beforeEach(() => { state.rows = []; state.error = null })

test('bruker med KUN organization-rader regnes som å ha spilt (Elkjøp-tilfellet)', async () => {
  state.rows = [{ user_id: 'u1', scope_type: 'organization' }]
  assert.equal(await hasSettledPlays('u1'), 'yes')
})

test('league-rader teller også', async () => {
  state.rows = [{ user_id: 'u1', scope_type: 'league' }]
  assert.equal(await hasSettledPlays('u1'), 'yes')
})

test('global-rader teller som før', async () => {
  state.rows = [{ user_id: 'u1', scope_type: 'global' }]
  assert.equal(await hasSettledPlays('u1'), 'yes')
})

test('ingen rader gir no — kun da er /premium-redirect riktig', async () => {
  state.rows = [{ user_id: 'annen-bruker', scope_type: 'global' }]
  assert.equal(await hasSettledPlays('u1'), 'no')
})

test('feilet spørring gir unknown — aldri «har ikke spilt»', async () => {
  state.rows = [{ user_id: 'u1', scope_type: 'global' }]
  state.error = { message: 'simulert DB-feil' }
  assert.equal(await hasSettledPlays('u1'), 'unknown')
})
