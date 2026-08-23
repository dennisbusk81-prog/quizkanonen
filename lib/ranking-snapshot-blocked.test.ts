// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den globale synlighets-gaten på
// /api/quiz/[id]/ranking-snapshot (P-2, 23. august 2026).
//
// HVORFOR DENNE FILEN FINNES — den ble skrevet ETTER en mutasjonsrunde:
// byttes `computePlacement(publicSnapshot, …)` tilbake til `snapshot`, var
// ingen test rød. Ruten hadde ingen blokkert-gate i det hele tatt fram til nå,
// og avviket var MÅLT mot prod 23. august 2026: denne ruten svarte
// `total: 68` for 21. august-quizen mens /standings svarte `65` om samme felt
// (67 leverte forsøk, 65 globale season_scores-rader → 2 blokkerte som ble
// talt med). To flater, samme quiz, to ulike tall om hvor mange som deltok.
//
// ranking-snapshot- og public-snapshot-modulene er EKTE her (kun supabase-admin
// under dem er mocket, med en fersk cache-rad): re-ranken og computePlacement
// bevises mot reell kode, ikke mot en kopi. Det er den samme oppskriften
// standings-route-blocked.test.ts bruker.
//
// MUTASJONSBEVIS
//   • Rangér mot `snapshot` i stedet for `publicSnapshot`, og «blokkerte
//     telles ikke» ryker.
//   • Fjern den posisjonelle re-ranken i lib/public-snapshot.ts, og
//     plasseringen får hull.
//   • Send `season_points_awarded` som hardkodet true/false i stedet for fra
//     quiz-raden, og «oppgjørsstatusen sendes videre» ryker — gaten ville da
//     lest live-status for en gjort-opp quiz og gitt tilbakevirkende kraft.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { SnapshotEntry } from './ranking-snapshot'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function entry(id: string, userId: string | null, name: string, rank: number, correct: number, timeMs: number): SnapshotEntry {
  return {
    id, user_id: userId, player_name: name, rank,
    correct_answers: correct, total_time_ms: timeMs, correct_streak: 0,
  }
}

const state: {
  snapshot: SnapshotEntry[]
  seasonPointsAwarded: boolean
  blocked: string[]
  blockedCalls: { quizId: string; ids: string[]; awarded: boolean }[]
} = { snapshot: [], seasonPointsAwarded: false, blocked: [], blockedCalls: [] }

mock.module('@/lib/rate-limit-shared', {
  namedExports: {
    rateLimitShared: async () => ({ success: true, remaining: 99 }),
    SHARED_RATE_LIMIT_TIMEOUT_MS: 1000,
  },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'ranking_snapshots') {
          const b = {
            select() { return b },
            eq() { return b },
            // Fersk cache-rad → getOrBuildSnapshot returnerer den uten rebuild.
            async maybeSingle() {
              return { data: { snapshot: state.snapshot, created_at: new Date().toISOString() } }
            },
          }
          return b as never
        }
        if (table === 'quizzes') {
          const b = {
            select() { return b },
            eq() { return b },
            async maybeSingle() { return { data: { season_points_awarded: state.seasonPointsAwarded } } },
          }
          return b as never
        }
        throw new Error(`uventet tabell i test: ${table}`)
      },
    },
  },
})

mock.module('@/lib/globally-blocked-set', {
  namedExports: {
    getGloballyBlockedSet: async (quizId: string, ids: string[], awarded: boolean) => {
      state.blockedCalls.push({ quizId, ids: [...ids], awarded })
      return new Set(state.blocked)
    },
  },
})

const { GET } = await import('@/app/api/quiz/[id]/ranking-snapshot/route')
const { createAttemptToken } = await import('@/lib/attempt-token')

// Kallet bærer et PREMIUM-token, slik at `rank` er observerbar. Uten det ville
// premium-gaten skjult tallet og filen ville bevist feil gate — se samme
// begrunnelse i standings-route-blocked.test.ts.
function call(opts: { correct?: number; time?: number; premium?: boolean } = {}) {
  const { correct = 8, time = 80_000, premium = true } = opts
  const params = new URLSearchParams({
    question: '9',
    correct: String(correct),
    time: String(time),
    attemptId: ATTEMPT,
  })
  const token = createAttemptToken(ATTEMPT, QUIZ, { premium })
  return GET(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/ranking-snapshot?${params}`, {
      headers: token ? { 'x-attempt-token': token } : {},
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) },
  )
}

beforeEach(() => {
  // Fire LEVERTE forsøk. Kalleren selv er IKKE i lista (playerInPool: false —
  // hen spiller fortsatt), som er nøyaktig situasjonen ruten tjener.
  state.snapshot = [
    entry('a-anna', 'u-anna', 'Anna', 1, 12, 60_000),
    entry('a-bjorn', 'u-bjorn', 'Bjørn', 2, 11, 65_000),
    entry('a-cato', 'u-cato', 'Cato', 3, 10, 70_000),
    entry('a-gjest', null, 'Gjest Gjestesen', 4, 9, 75_000),
  ]
  state.seasonPointsAwarded = false
  state.blocked = []
  state.blockedCalls = []
})

// ── Positiv kontroll FØRST ─────────────────────────────────────────────────

test('positiv kontroll: uten blokkerte telles hele feltet, og gaten ble spurt riktig', async () => {
  const j = await (await call()).json()
  // 4 ferdige + kalleren selv (playerInPool: false) = 5.
  assert.equal(j.total, 5)
  assert.equal(j.rank, 5, '8 riktige er dårligst i feltet')

  assert.equal(state.blockedCalls.length, 1, 'gaten er koblet på, ikke bare importert')
  assert.equal(state.blockedCalls[0].quizId, QUIZ)
  assert.deepEqual([...state.blockedCalls[0].ids].sort(), ['u-anna', 'u-bjorn', 'u-cato'],
    'gjesten har ingen user_id og skal aldri sendes til gaten')
})

// ── Kjernen: blokkerte telles ikke, og plasseringen følger det synlige feltet ──

test('blokkerte telles ikke i total — avviket mot /standings er borte', async () => {
  state.blocked = ['u-anna', 'u-bjorn']
  const j = await (await call()).json()
  // 2 synlige ferdige (Cato + gjesten) + kalleren = 3, ikke 5.
  assert.equal(j.total, 3, 'to blokkerte skal forsvinne fra feltet, ikke bare fra navnelistene')
  assert.equal(j.rank, 3)
})

test('en blokkert spiller foran deg løfter plasseringen din', async () => {
  // Kalleren har 10,5 «riktige» i praksis: bedre enn Cato er hen ikke, men
  // blokkeres Anna og Bjørn, er det bare Cato igjen over.
  state.blocked = ['u-anna']
  const j = await (await call({ correct: 10, time: 71_000 })).json()
  // Synlig felt: Bjørn (11), Cato (10 @70s), gjest (9). Kalleren: 10 @71s →
  // bak Cato, foran gjesten → rank 3 av 4.
  assert.equal(j.rank, 3)
  assert.equal(j.total, 4)
})

test('gjester (user_id null) berøres aldri av gaten', async () => {
  state.blocked = ['u-anna', 'u-bjorn', 'u-cato']
  const j = await (await call()).json()
  // Kun gjesten står igjen + kalleren.
  assert.equal(j.total, 2)
})

test('alle synlige blokkert: tomt felt, ikke et feilaktig komplett ett', async () => {
  // Fail-stengt-retningen fra lib/public-snapshot.ts, tatt helt ut: klarer
  // gaten ikke avgjøre noe, blokkeres alle den ble spurt om. Da skal ruten
  // svare tomt — ikke falle tilbake på det ufiltrerte feltet.
  state.snapshot = state.snapshot.filter(e => e.user_id !== null)
  state.blocked = ['u-anna', 'u-bjorn', 'u-cato']
  const j = await (await call()).json()
  assert.equal(j.total, 0)
  assert.equal(j.low, 1)
  assert.equal(j.high, 1)
})

// ── Oppgjørsstatusen må videreformidles, ikke gjettes ──────────────────────

test('season_points_awarded sendes videre til gaten — historikken står som den var', async () => {
  state.seasonPointsAwarded = true
  await call()
  assert.equal(state.blockedCalls[0].awarded, true)

  state.blockedCalls = []
  state.seasonPointsAwarded = false
  await call()
  assert.equal(state.blockedCalls[0].awarded, false)
})

// ── Gatene komponerer: blokkert-filtrering skjer uansett premium ───────────

test('en ikke-Premium kaller får spennet regnet mot det SAMME synlige feltet', async () => {
  state.blocked = ['u-anna', 'u-bjorn']
  const j = await (await call({ premium: false })).json()
  assert.equal(j.rank, null, 'premium-gaten står')
  assert.equal(j.total, 3, 'blokkert-gaten står også — de to er uavhengige')
  // Spennet må omslutte den (skjulte) plasseringen, ellers ville gratis- og
  // premium-visningen fortalt to ulike historier om samme felt.
  assert.ok(j.low <= 3 && j.high >= 3, `spennet ${j.low}–${j.high} dekker ikke plassering 3`)
})
