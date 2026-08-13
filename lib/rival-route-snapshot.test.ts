// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av /api/quiz/rival sin ferdig-definisjon (VINDU D,
// 13. august 2026): buildRankingSnapshot og buildSuggestions skal kun regne
// på LEVERTE forsøk (submitted_at IS NOT NULL) — samme definisjon som
// getOrBuildSnapshot i lib/ranking-snapshot.ts og findRival i samme fil.
//
// Bakgrunn: start-attempt oppretter attempts-raden med correct_answers=0 og
// submitted_at=null; submit skriver tallet først ved innsending. Uten
// filteret viste sidepanelet «I tet … 0 riktige» med navnet til en spiller
// som bare hadde STARTET — gjennom hele quizen for en spiller alene, og hver
// fredag kveld før første innlevering.
//
// MUTASJONSBEVIS — mocken håndhever filtrene den får, så:
//   • Fjernes .not('submitted_at','is',null) fra top11-spørringen, blir det
//     uferdige forsøket (9 riktige) leder og «uferdig forsøk kan ikke bli
//     leder» ryker.
//   • Fjernes filteret fra count-spørringen, teller totalPlayers det uferdige
//     forsøket og «tomt felt gir totalPlayers 0» ryker.
//   • Fjernes filteret fra buildSuggestions, dukker den uferdige spilleren
//     opp som duell-forslag og «suggestions inneholder kun leverte» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type AttemptRow = {
  quiz_id: string
  user_id: string | null
  is_team: boolean
  correct_answers: number
  total_time_ms: number
  submitted_at: string | null
}

type ProfileRow = { id: string; display_name: string | null; nickname: string | null }

const state: {
  attempts: AttemptRow[]
  profiles: ProfileRow[]
  user: { id: string } | null
} = { attempts: [], profiles: [], user: null }

// Filter-håndhevende attempts-builder: spørringen får nøyaktig de radene
// filtrene den selv oppga tillater. Dermed beviser testene at filteret står i
// ruten — ikke bare at mocken returnerer det testen ønsker seg.
function attemptsBuilder() {
  let rows = [...state.attempts]
  let countMode = false
  const b = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.count === 'exact') countMode = true
      return b
    },
    eq(col: keyof AttemptRow, val: unknown) { rows = rows.filter(r => r[col] === val); return b },
    neq(col: keyof AttemptRow, val: unknown) { rows = rows.filter(r => r[col] !== val); return b },
    gt(col: keyof AttemptRow, val: number) { rows = rows.filter(r => (r[col] as number) > val); return b },
    not(col: keyof AttemptRow, op: string, val: unknown) {
      if (op === 'is' && val === null) rows = rows.filter(r => r[col] !== null)
      return b
    },
    order(col: keyof AttemptRow, opts?: { ascending?: boolean }) {
      const asc = opts?.ascending !== false
      rows = [...rows].sort((a, x) => {
        const av = a[col] as number, xv = x[col] as number
        return asc ? av - xv : xv - av
      })
      return b
    },
    limit(n: number) { rows = rows.slice(0, n); return b },
    then(resolve: (r: { data: AttemptRow[] | null; count: number | null }) => unknown) {
      return Promise.resolve(
        countMode ? { data: null, count: rows.length } : { data: rows, count: null }
      ).then(resolve)
    },
  }
  return b
}

function profilesBuilder() {
  let rows = [...state.profiles]
  const b = {
    select() { return b },
    eq(_col: string, val: string) { rows = rows.filter(r => r.id === val); return b },
    in(_col: string, vals: string[]) { rows = rows.filter(r => vals.includes(r.id)); return b },
    async maybeSingle() { return { data: rows[0] ?? null } },
    then(resolve: (r: { data: ProfileRow[] }) => unknown) {
      return Promise.resolve({ data: rows }).then(resolve)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'attempts') return attemptsBuilder() as never
        if (table === 'profiles') return profilesBuilder() as never
        throw new Error(`uventet tabell i test: ${table}`)
      },
      auth: {
        getUser: async () =>
          state.user
            ? { data: { user: state.user }, error: null }
            : { data: { user: null }, error: { message: 'ugyldig token' } },
      },
    },
  },
})

const { GET } = await import('@/app/api/quiz/rival/route')

function call(auth = false) {
  const headers = auth ? { Authorization: 'Bearer test-token' } : undefined
  const request = new Request('https://quizkanonen.no/api/quiz/rival?quizId=q-1', { headers })
  return GET(request as never)
}

function attempt(over: Partial<AttemptRow>): AttemptRow {
  return {
    quiz_id: 'q-1', user_id: null, is_team: false,
    correct_answers: 0, total_time_ms: 0, submitted_at: null,
    ...over,
  }
}

beforeEach(() => { state.attempts = []; state.profiles = []; state.user = null })

test('tomt felt (kun startede forsøk) gir totalPlayers 0 — leder-blokken kan skjules', async () => {
  // Ett forsøk som bare er STARTET. correct_answers=7 er syntetisk (reelle
  // uferdige rader står i 0), valgt slik at et manglende filter gir et tall
  // som umulig kan forveksles med tomt felt.
  state.attempts = [attempt({ user_id: 'u-uferdig', correct_answers: 7, total_time_ms: 60_000 })]

  const res = await call()
  const json = await res.json() as { rankingSnapshot: { totalPlayers: number; leaderCorrect: number } }

  assert.equal(json.rankingSnapshot.totalPlayers, 0, 'tomt felt gir totalPlayers 0')
  assert.equal(json.rankingSnapshot.leaderCorrect, 0, 'ingen leder-tall fra et uferdig forsøk')
})

test('uferdig forsøk kan ikke bli leder — leverte vinner uansett tall', async () => {
  state.attempts = [
    attempt({ user_id: 'u-ferdig', correct_answers: 5, total_time_ms: 90_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-uferdig', correct_answers: 9, total_time_ms: 10_000 }),
  ]
  state.profiles = [{ id: 'u-ferdig', display_name: 'Kari', nickname: null }]

  const res = await call()
  const json = await res.json() as {
    rankingSnapshot: { totalPlayers: number; leaderName: string; leaderCorrect: number }
  }

  assert.equal(json.rankingSnapshot.leaderCorrect, 5, 'lederen er beste LEVERTE forsøk')
  assert.equal(json.rankingSnapshot.leaderName, 'Kari')
  assert.equal(json.rankingSnapshot.totalPlayers, 1, 'kun leverte telles')
})

test('suggestions inneholder kun leverte — en som bare har startet foreslås ikke', async () => {
  state.user = { id: 'u-self' }
  state.attempts = [
    attempt({ user_id: 'u-ferdig', correct_answers: 8, total_time_ms: 80_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-uferdig', correct_answers: 3, total_time_ms: 30_000 }),
  ]
  state.profiles = [
    { id: 'u-ferdig', display_name: 'Kari', nickname: null },
    { id: 'u-uferdig', display_name: 'Starta Bare', nickname: null },
  ]

  const res = await call(true)
  const json = await res.json() as { suggestions?: { userId: string }[] }

  const ids = (json.suggestions ?? []).map(s => s.userId)
  assert.ok(!ids.includes('u-uferdig'), 'uferdig spiller skal ikke foreslås')
  assert.ok(ids.includes('u-ferdig'), 'levert spiller kan foreslås')
})
