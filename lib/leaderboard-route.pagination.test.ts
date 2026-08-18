// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/leaderboard/[id] mot en fake som
// kutter ved 1000 rader (PostgREST db-max-rows, målt oppførsel).
// Attempts-lesningen går via fetchAllRows (18. august 2026); før det så
// rangeringen bare de 1000 første radene, og «alle rader» stemte kun opp til
// 1000 forsøk per quiz.
//
// MUTASJONSBEVIS: byttes fetchAllRows tilbake til ett rått kall, ser ruten
// 1000 av 1100 forsøk — vinneren (13 riktige) ligger på rad 1050 og
// forsvinner, så entries[0]-asserten OG totalCount-asserten ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000

type FakeRow = {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  is_team: boolean
  team_size: number
  leader_display_name: string | null
  submitted_at: string | null
}

const state: {
  attempts: FakeRow[]
  attemptQueries: number
  dbDown: boolean
} = { attempts: [], attemptQueries: 0, dbDown: false }

function attemptsBuilder() {
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select() { return b },
    eq() { return b },
    order() { return b },
    limit() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      state.attemptQueries++
      if (state.dbDown) {
        return Promise.resolve({ data: null, error: { message: 'db nede' } }).then(res, rej)
      }
      const window = state.attempts.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

function quizzesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() {
      // Stengt, gjort opp, leaderboard på — ingen skjuling i veien for entries.
      return {
        data: {
          closes_at: '2026-08-14T20:00:00Z',
          hide_leaderboard_until_closed: false,
          show_leaderboard: true,
          season_points_awarded: true,
        },
      }
    },
  }
  return b
}

function profilesBuilder() {
  const b = {
    select() { return b },
    in() { return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: (table: string) => {
        if (table === 'attempts') return attemptsBuilder() as never
        if (table === 'quizzes') return quizzesBuilder() as never
        if (table === 'profiles') return profilesBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

mock.module('@/lib/globally-blocked-set', {
  namedExports: { getGloballyBlockedSet: async () => new Set<string>() },
})

mock.module('@/lib/org-membership', {
  namedExports: { resolveOrgMembership: async () => ({ ok: false, status: 403, error: 'Ikke tilgang' }) },
})

mock.module('@/lib/premium-check', {
  namedExports: { isUserPremium: async () => false },
})

const { GET } = await import('@/app/api/leaderboard/[id]/route')

function call(query = 'is_team=false&limit=50') {
  const request = new Request(`https://quizkanonen.no/api/leaderboard/q-stor?${query}`)
  return GET(request as never, { params: Promise.resolve({ id: 'q-stor' }) })
}

beforeEach(() => {
  // 1100 distinkte innloggede spillere. Vinneren (13 riktige, alle andre har
  // 10) ligger på rad 1050 — bak 1000-taket.
  state.attempts = Array.from({ length: 1100 }, (_, i) => ({
    id: `a-${String(i).padStart(4, '0')}`,
    user_id: `u-${String(i).padStart(4, '0')}`,
    player_name: i === 1050 ? 'Vinner' : `Spiller ${i}`,
    correct_answers: i === 1050 ? 13 : 10,
    total_questions: 15,
    total_time_ms: 60_000 + i,
    correct_streak: 0,
    is_team: false,
    team_size: 1,
    leader_display_name: null,
    submitted_at: '2026-08-14T19:00:00Z',
  }))
  state.attemptQueries = 0
  state.dbDown = false
})

test('quiz-leaderboardet rangerer HELE feltet — vinneren bak 1000-taket er #1', async () => {
  const res = await call()
  assert.equal(res.status, 200)
  const j = await res.json()

  assert.equal(j.entries[0].playerName, 'Vinner',
    'vinneren ligger på rad 1050 — uten paginering er hen usynlig')
  assert.equal(j.entries[0].rank, 1)
  assert.equal(j.totalCount, 1100, 'kutt ved 1000 ville gitt 1000')
  assert.equal(j.entries.length, 50, 'klassisk visning: topp `limit`')
  assert.ok(state.attemptQueries >= 2,
    `forventet paginering, fikk ${state.attemptQueries} spørring(er)`)
})

test('feil gir tom liste med 200 — samme synlige oppførsel som før pagineringen', async () => {
  state.dbDown = true
  const res = await call()
  assert.equal(res.status, 200, 'en transient DB-feil skal ikke bli en 500 på resultatsiden')
  const j = await res.json()
  assert.deepEqual(j.entries, [])
  assert.equal(j.totalCount, 0)
})

test('kontroll: de 1000 første radene inneholder ikke vinneren', () => {
  const kuttet = state.attempts.slice(0, PG_ROW_CAP)
  assert.ok(!kuttet.some(r => r.player_name === 'Vinner'),
    'datasettet må gjemme vinneren bak taket — ellers beviser testen ingenting')
})
