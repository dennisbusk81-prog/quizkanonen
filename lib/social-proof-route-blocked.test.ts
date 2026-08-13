// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av /api/quiz/social-proof sin globale synlighets-gate
// (13. august 2026): blokkerte brukere skal hverken vises som navnepiller
// eller telles i totalPlayers — svaret går til helt anonyme kallere og er
// CDN-cachet.
//
// getGloballyBlockedSet er EKTE her — kun supabase-admin under den er mocket
// (samme mønster som lib/public-snapshot.test.ts): fail-stengt-retningen bor
// inne i den lib-en, så fail-stengt-testen nederst provoserer en ekte DB-feil
// og ser hva ruten faktisk gjør med svaret.
//
// MERK: getGloballyBlockedSet har en modul-lokal 30s-cache nøklet på quiz-id.
// Hver test bruker derfor sin EGEN quiz-id.
//
// Navnepille-assertene er deterministiske til tross for shuffle: med ≤3
// synlige innloggede samples ALLE, og gjestefyllet er også deterministisk når
// det bare finnes én gjest. Sammenlignes sortert.
//
// MUTASJONSBEVIS (kjørt 13. august 2026)
//   • Fjernes blocked-filteret (visibleLoggedInIds = loggedInIds), står
//     Bjørn igjen som navnepille OG telles i totalPlayers — «noen blokkerte»-,
//     live-gren- og fail-stengt-testene ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type AttemptRow = { user_id: string | null; player_name: string | null }
type QueryResult = { data: unknown[] | null; error: { message: string } | null }

const state: {
  quizRow: {
    opens_at: string | null
    closes_at: string | null
    time_limit_seconds: number | null
    season_points_awarded: boolean
  } | null
  attempts: AttemptRow[]
  // Hvem som fikk global season_scores-rad (awarded-grenen). Blokkert = spurt
  // om, men ikke her.
  scoredUserIds: string[]
  // Når satt: season_scores-oppslaget feiler → ekte fail-stengt i lib-en.
  scoredError: string | null
  // organization_members-rader med global_league_opt_out=true (live-grenen).
  optOutRows: { user_id: string; organization_id: string; global_league_opt_out: boolean }[]
  profilesInArgs: string[][]
  tablesTouched: string[]
} = {
  quizRow: null, attempts: [], scoredUserIds: [], scoredError: null,
  optOutRows: [], profilesInArgs: [], tablesTouched: [],
}

const DISPLAY_NAMES: Record<string, string> = {
  'u-anna': 'Anna Askeland',
  'u-bjorn': 'Bjørn Borge',
  'u-cato': 'Cato Carlsen',
}

function rowsBuilder(produce: () => QueryResult) {
  const b = {
    select() { return b },
    eq() { return b },
    is() { return b },
    order() { return b },
    async range() { return produce() },
  }
  return b
}

function quizzesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async single() {
      return state.quizRow
        ? { data: state.quizRow, error: null }
        : { data: null, error: { message: 'not found' } }
    },
  }
  return b
}

// questions/attempts awaites direkte på slutten av kjeden (thenable), ikke via
// .range() — egne buildere.
function thenableBuilder(produce: () => QueryResult) {
  const b = {
    select() { return b },
    eq() { return b },
    gte() { return b },
    lte() { return b },
    then(resolve: (r: QueryResult) => unknown) {
      return Promise.resolve(produce()).then(resolve)
    },
  }
  return b
}

function profilesBuilder() {
  const b = {
    select() { return b },
    in(_col: string, ids: string[]) {
      state.profilesInArgs.push([...ids])
      return {
        then(resolve: (r: QueryResult) => unknown) {
          const rows = ids
            .filter(id => DISPLAY_NAMES[id])
            .map(id => ({ display_name: DISPLAY_NAMES[id] }))
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        state.tablesTouched.push(table)
        if (table === 'quizzes') return quizzesBuilder() as never
        if (table === 'questions') return thenableBuilder(() => ({ data: [], error: null })) as never
        if (table === 'attempts') return thenableBuilder(() => ({ data: state.attempts, error: null })) as never
        if (table === 'profiles') return profilesBuilder() as never
        if (table === 'season_scores') {
          return rowsBuilder(() =>
            state.scoredError
              ? { data: null, error: { message: state.scoredError } }
              : { data: state.scoredUserIds.map(user_id => ({ user_id })), error: null }
          ) as never
        }
        if (table === 'organizations') return rowsBuilder(() => ({ data: [], error: null })) as never
        if (table === 'organization_members') return rowsBuilder(() => ({ data: state.optOutRows, error: null })) as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { GET } = await import('@/app/api/quiz/social-proof/route')

function call(quizId: string) {
  const request = new Request(`https://quizkanonen.no/api/quiz/social-proof?quizId=${quizId}`)
  return GET(request as never)
}

beforeEach(() => {
  state.quizRow = {
    opens_at: '2026-08-13T15:00:00Z',
    closes_at: '2026-08-14T20:00:00Z',
    time_limit_seconds: 15,
    season_points_awarded: true,
  }
  // Tre innloggede + én gjest — påbegynte forsøk (ruten filtrerer bevisst
  // ikke på submitted_at; det er en egen, kjent sak).
  state.attempts = [
    { user_id: 'u-anna', player_name: 'Anna A' },
    { user_id: 'u-bjorn', player_name: 'Bjørn B' },
    { user_id: 'u-cato', player_name: 'Cato C' },
    { user_id: null, player_name: 'Gjest Gjestesen' },
  ]
  state.scoredUserIds = []
  state.scoredError = null
  state.optOutRows = []
  state.profilesInArgs = []
  state.tablesTouched = []
})

// ── Positiv kontroll FØRST: uten blokkerte er alt som før ───────────────────

test('positiv kontroll: ingen blokkerte — alle telles, alle kan vises, cache-header uendret', async () => {
  state.scoredUserIds = ['u-anna', 'u-bjorn', 'u-cato']
  const res = await call('q-sp-ingen')
  assert.equal(res.status, 200)
  // CDN-headeren skal IKKE endres av gaten — svaret inneholder ikke lenger
  // blokkerte data, så offentlig caching er like trygt som før.
  assert.equal(res.headers.get('Cache-Control'), 'public, s-maxage=60, max-age=0')
  const j = await res.json()
  assert.equal(j.totalPlayers, 4)
  assert.deepEqual([...j.sampleNames].sort(), ['Anna', 'Bjørn', 'Cato'])
  // Gaten ble faktisk konsultert (awarded-grenen leser season_scores).
  assert.ok(state.tablesTouched.includes('season_scores'))
})

// ── Blokkert fjernes fra BÅDE navnepiller og telling ────────────────────────

test('noen blokkerte: fjernet fra navn og telling, gjesten upåvirket', async () => {
  // Bjørn mangler global season_scores-rad → blokkert.
  state.scoredUserIds = ['u-anna', 'u-cato']
  const j = await (await call('q-sp-noen')).json()

  // MUTASJONSANKERET: uten filteret er dette 4, og Bjørn kan dukke opp.
  assert.equal(j.totalPlayers, 3)
  assert.deepEqual([...j.sampleNames].sort(), ['Anna', 'Cato', 'Gjest'])
  assert.ok(!j.sampleNames.includes('Bjørn'))
  // Den blokkerte id-en når aldri profiles-oppslaget — navnet kan ikke lekke
  // via en annen vei i samme rute.
  assert.equal(state.profilesInArgs.length, 1)
  assert.ok(!state.profilesInArgs[0].includes('u-bjorn'))
})

test('alle innloggede blokkert: kun gjesten står igjen', async () => {
  state.scoredUserIds = []
  const j = await (await call('q-sp-alle')).json()

  assert.equal(j.totalPlayers, 1)
  assert.deepEqual(j.sampleNames, ['Gjest'])
  // Ingen synlige innloggede → profiles slås aldri opp.
  assert.equal(state.profilesInArgs.length, 0)
})

// ── Live-grenen (quiz ikke gjort opp — normaltilfellet på startsiden) ───────

test('ikke gjort opp: eget opt-out blokkerer via live-grenen', async () => {
  state.quizRow!.season_points_awarded = false
  state.optOutRows = [{ user_id: 'u-bjorn', organization_id: 'o-elkjop', global_league_opt_out: true }]
  const j = await (await call('q-sp-live')).json()

  assert.equal(j.totalPlayers, 3)
  assert.ok(!j.sampleNames.includes('Bjørn'))
  // Riktig gren: live leser organizations/organization_members, aldri
  // season_scores.
  assert.ok(state.tablesTouched.includes('organizations'))
  assert.ok(!state.tablesTouched.includes('season_scores'))
})

// ── Tomt felt ───────────────────────────────────────────────────────────────

test('ingen forsøk: tomt svar, og gaten slås aldri opp', async () => {
  state.attempts = []
  const j = await (await call('q-sp-tomt')).json()

  assert.equal(j.totalPlayers, 0)
  assert.deepEqual(j.sampleNames, [])
  assert.ok(!state.tablesTouched.includes('season_scores'))
  assert.ok(!state.tablesTouched.includes('organizations'))
})

test('felt med bare gjester: gaten kortslutter uten DB-rundtur', async () => {
  state.attempts = [{ user_id: null, player_name: 'Gjest Gjestesen' }]
  const j = await (await call('q-sp-gjester')).json()

  assert.equal(j.totalPlayers, 1)
  assert.deepEqual(j.sampleNames, ['Gjest'])
  assert.ok(!state.tablesTouched.includes('season_scores'))
})

// ── Fail-stengt: DB-feil i gaten skjuler alle innloggede, aldri motsatt ─────

test('DB-feil i gaten: alle innloggede skjules (fail-stengt), gjesten vises, feilen logges', async () => {
  state.scoredError = 'boom: season_scores utilgjengelig'

  const logged: unknown[][] = []
  const realError = console.error
  console.error = (...args: unknown[]) => { logged.push(args) }
  let j: { totalPlayers: number; sampleNames: string[] }
  try {
    j = await (await call('q-sp-feil')).json()
  } finally {
    console.error = realError
  }

  // Vet vi ikke hvem som er blokkert, vises og telles kun gjester. Retningen
  // skal ikke snus til «vis alle ved feil» — det ville publisert navnene
  // gaten finnes for å holde interne.
  assert.equal(j.totalPlayers, 1)
  assert.deepEqual(j.sampleNames, ['Gjest'])
  assert.equal(state.profilesInArgs.length, 0)
  assert.ok(logged.some(args => String(args[0]).includes('globally-blocked-set')))
})
