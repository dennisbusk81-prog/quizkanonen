// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/toppliste. `mock.module` bytter ut
// supabase-admin, slik at ruten, lib/ranking, lib/globally-blocked-set,
// lib/paginate OG lib/premium-check kjøres uendret — karensperiodene testes
// derfor mot den EKTE getUserPremium, samme metode som
// lib/leaderboard-premium-gate-route.test.ts.
//
// SAKEN (B-8, 19. august 2026): ruten leste `profiles.premium_status` direkte
// på fire steder i tre kodestier (last_quiz, RPC, JS-fallback) i stedet for å
// gå via getUserPremium. To konsekvenser, begge STILLE:
//   1. En bruker i personlig eller org-karens fikk `userIsPremium: false` —
//      og mistet dermed sin egen eksakte plassering, paginering og søk på
//      /toppliste, uten feilmelding og uten noe som skilte det fra et utløpt
//      abonnement.
//   2. `error` ble aldri lest: en transient DB-feil ga samme gratisvisning.
//   I tillegg svarte de tidlige tom-returene i last_quiz (ingen quiz / ingen
//   attempts) alltid `userIsPremium: false`, helt uten oppslag.
//
// Fiksen: ETT delt getUserPremium-kall per forespørsel (startet tidlig,
// awaitet i settlePremium() før hver respons), `!ok` → 503 — samme valg som
// /api/leaderboard/[id].
//
// MUTASJONSBEVIS (alle kjørt 19. august 2026, med målt antall):
//   • Fjernes getUserPremium-kallet (premiumPromise → alltid null)
//     → 13 tester ryker (alt unntatt gratis- og utlogget-regresjonene).
//   • Byttes 503 til stille `userIsPremium = false` ved `!ok`
//     → 4 tester ryker (503-testene i alle tre stiene + tidlig retur).
//   • Byttes den delte sjekken tilbake til `premium_status === true` alene
//     (karensleddene i lib/premium-check mistes)
//     → 8 tester ryker (alle org- og personlig-karens-testene).
//
// Modul-lokale cacher i ruten (lastQuizAttemptsCache, globallyBlockedFacts)
// er nøklet på quiz-id med 30 s TTL — hver last_quiz-test bruker derfor sin
// EGEN quiz-id, ellers arver testene hverandres cachede attempts.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ME = '11111111-1111-4111-8111-111111111111'
const ANNEN = '22222222-2222-4222-8222-222222222222'

const OM_TRE_DAGER = () => new Date(Date.now() + 3 * 86_400_000).toISOString()
const FOR_EN_DAG_SIDEN = () => new Date(Date.now() - 86_400_000).toISOString()

type AttemptRow = {
  id: string
  user_id: string
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
  submitted_at: string | null
  is_team: boolean
  quiz_id: string
}

type RankedRow = {
  user_id: string; display_name: string | null
  points: number; quiz_count: number; rank: number; total_count: number
}

const state: {
  /** null = ingen quiz med attempts finnes (tidlig retur i last_quiz). */
  latestQuiz: { id: string; title: string; closes_at: string; season_points_awarded: boolean } | null
  attempts: AttemptRow[]
  profile: { premium_status: boolean; org_premium_grace_until: string | null; personal_grace_until: string | null }
  /** true = selve premium-oppslaget i lib/premium-check feiler. */
  premiumLookupFails: boolean
  profileRows: { id: string; display_name: string | null; nickname: string | null }[]
  /** true = season_leaderboard_ranked svarer med feil → JS-fallback. */
  rpcRankedFails: boolean
  rpcRanked: RankedRow[]
  rpcUserStats: { points: number; quiz_count: number; rank: number }[]
  seasonScores: { user_id: string; points: number; quiz_id: string; closes_at: string; scope_type: string; scope_id: string | null }[]
} = {
  latestQuiz: null,
  attempts: [],
  profile: { premium_status: false, org_premium_grace_until: null, personal_grace_until: null },
  premiumLookupFails: false,
  profileRows: [],
  rpcRankedFails: false,
  rpcRanked: [],
  rpcUserStats: [],
  seasonScores: [],
}

function attempt(quizId: string, n: number, correct: number, uid: string): AttemptRow {
  return {
    id: `attempt-${n}`,
    user_id: uid,
    player_name: uid === ME ? 'Meg Megsen' : `Spiller ${n}`,
    correct_answers: correct,
    total_time_ms: 30_000 + n,
    correct_streak: 1,
    submitted_at: '2026-08-14T20:00:00.000Z',
    is_team: false,
    quiz_id: quizId,
  }
}

/** Unik quiz-id per test — se cache-merknaden i toppkommentaren. */
let quizTeller = 0
function nyLastQuiz(seasonPointsAwarded = false): string {
  quizTeller += 1
  const id = `00000000-0000-4000-8000-${String(quizTeller).padStart(12, '0')}`
  state.latestQuiz = { id, title: 'Fredagsquiz uke 34', closes_at: FOR_EN_DAG_SIDEN(), season_points_awarded: seasonPointsAwarded }
  state.attempts = [attempt(id, 1, 15, ANNEN), attempt(id, 2, 12, ME)]
  state.profileRows = [
    { id: ANNEN, display_name: 'Spiller En', nickname: null },
    { id: ME, display_name: 'Meg Megsen', nickname: null },
  ]
  return id
}

// Minimal PostgREST-etterligning. Samme tabell spørres i FLERE fasonger her
// (profiles: premium-oppslag, navne-oppslag, batch, suspendert-sveip), så
// dispatchen går på tabell + select-kolonnene — ikke tabell alene.
// `order`/`range`/`not` MÅ finnes: ruten kaller den EKTE lib/paginate og
// lib/globally-blocked-set, som paginerer med fetchAllRows.
function builder(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = []
  let selectCols = ''
  let rangeFrom: number | null = null
  let rangeTo: number | null = null

  function slice<T>(rows: T[]): T[] {
    return rangeFrom === null ? rows : rows.slice(rangeFrom, (rangeTo ?? rows.length) + 1)
  }

  function applyFilters(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    let out = rows
    for (const f of filters) out = out.filter(f)
    return out
  }

  const b: Record<string, unknown> = {
    select(cols: string) { selectCols = cols; return b },
    eq(col: string, val: unknown) { filters.push(r => r[col] === val); return b },
    is(col: string, val: unknown) { filters.push(r => r[col] === val); return b },
    in(col: string, vals: unknown[]) { filters.push(r => vals.includes(r[col])); return b },
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) filters.push(r => r[col] !== null)
      return b
    },
    gt() { return b },
    gte() { return b },
    lt() { return b },
    order() { return b },
    limit() { return b },
    range(from: number, to: number) { rangeFrom = from; rangeTo = to; return b },
    maybeSingle() {
      if (table === 'quizzes') {
        // attempts!inner = latestQuiz-oppslaget; ellers emptyResponse sitt
        // «ventende quiz»-oppslag (closes_at) — ingen åpen quiz i fixturene.
        if (selectCols.includes('attempts!inner')) return Promise.resolve({ data: state.latestQuiz, error: null })
        return Promise.resolve({ data: null, error: null })
      }
      if (table === 'profiles') {
        // Premium-oppslaget i lib/premium-check — kjennes på kolonnene.
        if (selectCols.includes('premium_status')) {
          if (state.premiumLookupFails) {
            return Promise.resolve({ data: null, error: { message: 'simulert DB-feil' } })
          }
          return Promise.resolve({ data: state.profile, error: null })
        }
        // Navne-oppslag for kalleren (RPC-stien og fallbackens navne-fallback).
        return Promise.resolve({ data: { display_name: 'Meg Megsen', nickname: null }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'excluded_members') return resolve({ data: [], error: null })
      if (table === 'profiles') {
        // Suspendert-sveipet (select('id')) → ingen suspenderte.
        if (selectCols === 'id') return resolve({ data: [], error: null })
        // Batch-oppslag (navn/nickname) — ruten mapper selv på id.
        return resolve({ data: applyFilters(state.profileRows as unknown as Record<string, unknown>[]), error: null })
      }
      if (table === 'attempts') {
        // enrich() sin raskeste-tid-spørring → tom (badges testes ikke her).
        if (selectCols === 'user_id, total_time_ms') return resolve({ data: [], error: null })
        // last_quiz-attempts via fetchAllRows (paginert).
        return resolve({ data: slice(applyFilters(state.attempts as unknown as Record<string, unknown>[])), error: null })
      }
      if (table === 'season_scores') {
        // globally-blocked-set (gjort-opp-grenen) og enrich() → tomt.
        if (selectCols === 'user_id' || selectCols === 'user_id, quiz_id') {
          return resolve({ data: [], error: null })
        }
        // JS-fallbackens hovedoppslag.
        return resolve({ data: applyFilters(state.seasonScores as unknown as Record<string, unknown>[]), error: null })
      }
      // organizations / organization_members / league_members → ingen
      // restriksjoner, ingen medlemskap (riktig grunntilstand for global scope).
      return resolve({ data: [], error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => ({ data: { user: { id: ME } }, error: null }),
      },
      from: (table: string) => builder(table),
      rpc: (fn: string) => {
        if (fn === 'season_leaderboard_ranked') {
          return Promise.resolve(state.rpcRankedFails
            ? { data: null, error: { message: 'simulert: funksjonen finnes ikke' } }
            : { data: state.rpcRanked, error: null })
        }
        if (fn === 'season_leaderboard_user_stats') {
          return Promise.resolve({ data: state.rpcUserStats, error: null })
        }
        // season_leaderboard_period_quizzes
        return Promise.resolve({ data: [], error: null })
      },
    },
  },
})

const { GET } = await import('@/app/api/toppliste/route')

type Svar = {
  entries: { rank: number; userId: string }[]
  userEntry: { rank: number; displayName: string } | null
  userIsPremium: boolean
  userRank: number | null
  totalCount: number
  error?: string
}

/** `query` er alt etter `?`. Uten Authorization-header hvis `anonym`. */
async function hent(query: string, anonym = false): Promise<{ status: number; body: Svar }> {
  const request = new Request(`https://quizkanonen.no/api/toppliste?${query}`, {
    headers: anonym ? {} : { authorization: 'Bearer test-token' },
  })
  const res = await GET(request as never)
  return { status: res.status, body: await res.json() as Svar }
}

/** premium_status false, men org-karensen løper — den gamle lokale
 *  `premium_status === true`-lesingen ville svart false her. */
function settOrgKarens() {
  state.profile = { premium_status: false, org_premium_grace_until: OM_TRE_DAGER(), personal_grace_until: null }
}

/** premium_status false, men personlig betalings-karens løper. */
function settPersonligKarens() {
  state.profile = { premium_status: false, org_premium_grace_until: null, personal_grace_until: OM_TRE_DAGER() }
}

beforeEach(() => {
  state.latestQuiz = null
  state.attempts = []
  state.profile = { premium_status: false, org_premium_grace_until: null, personal_grace_until: null }
  state.premiumLookupFails = false
  state.profileRows = []
  state.rpcRankedFails = false
  state.rpcRanked = []
  state.rpcUserStats = []
  state.seasonScores = []
})

// ── LAST QUIZ-STIEN ──────────────────────────────────────────────────────────

test('last_quiz: ORG-KARENS teller som Premium — den lokale premium_status-lesingen gjorde det ikke', async () => {
  nyLastQuiz()
  settOrgKarens()

  const { status, body } = await hent('period=last_quiz&scope=global')

  assert.equal(status, 200)
  assert.equal(body.userIsPremium, true, 'karens skal telle som Premium')
  assert.equal(body.userEntry?.rank, 2, 'egen rad skal være med som før')
})

test('last_quiz: PERSONLIG karens teller også som Premium', async () => {
  nyLastQuiz()
  settPersonligKarens()

  const { body } = await hent('period=last_quiz&scope=global')

  assert.equal(body.userIsPremium, true)
})

test('last_quiz: vanlig betalt Premium gir true (ingen regresjon)', async () => {
  nyLastQuiz()
  state.profile = { premium_status: true, org_premium_grace_until: null, personal_grace_until: null }

  const { body } = await hent('period=last_quiz&scope=global')

  assert.equal(body.userIsPremium, true)
  assert.equal(body.entries.length, 2)
})

test('last_quiz: gratisbruker gir false og full liste (ingen regresjon)', async () => {
  nyLastQuiz()

  const { status, body } = await hent('period=last_quiz&scope=global')

  assert.equal(status, 200)
  assert.equal(body.userIsPremium, false)
  assert.equal(body.entries.length, 2)
})

test('last_quiz: FEILET premium-oppslag gir 503 — ikke en stille nedgradering til gratis', async () => {
  nyLastQuiz()
  state.profile = { premium_status: true, org_premium_grace_until: null, personal_grace_until: null }
  state.premiumLookupFails = true

  const { status, body } = await hent('period=last_quiz&scope=global')

  assert.equal(status, 503, 'et forbigående svar, ikke en dom')
  assert.equal(body.entries, undefined, 'ingen liste skal sendes med feilen')
  assert.equal(body.userIsPremium, undefined, 'ingen påstand om Premium-status skal sendes')
  assert.ok(body.error, 'feilen skal være synlig for klienten')
})

test('last_quiz: utlogget kaller berøres IKKE av premium-vakten', async () => {
  // Gaten står kun for innloggede — en anonym kaller gjør ikke oppslaget i det
  // hele tatt, og skal få topplisten som før selv når profiles svikter.
  nyLastQuiz()
  state.premiumLookupFails = true

  const { status, body } = await hent('period=last_quiz&scope=global', true)

  assert.equal(status, 200)
  assert.equal(body.userIsPremium, false)
  assert.equal(body.entries.length, 2, 'listen skal leveres som normalt')
})

// ── De tidlige tom-returene i last_quiz — søsknene fra kartleggingen ─────────
// Fram til B-8 returnerte disse `userIsPremium` som fortsatt sto på default
// false, uten at noe oppslag noensinne ble gjort — også for betalende kunder.

test('last_quiz TIDLIG RETUR (ingen quiz): går gjennom det delte kallet — karens gir true', async () => {
  state.latestQuiz = null
  settOrgKarens()

  const { status, body } = await hent('period=last_quiz&scope=global')

  assert.equal(status, 200)
  assert.deepEqual(body.entries, [])
  assert.equal(body.userIsPremium, true, 'tom-returen skal bære ekte premium-status, ikke default false')
})

test('last_quiz TIDLIG RETUR (ingen quiz): feilet oppslag gir 503 også her', async () => {
  state.latestQuiz = null
  state.premiumLookupFails = true

  const { status } = await hent('period=last_quiz&scope=global')

  assert.equal(status, 503)
})

test('last_quiz TIDLIG RETUR (quiz uten attempts): går gjennom det delte kallet', async () => {
  nyLastQuiz()
  state.attempts = []

  settOrgKarens()

  const { status, body } = await hent('period=last_quiz&scope=global')

  assert.equal(status, 200)
  assert.deepEqual(body.entries, [])
  assert.equal(body.userIsPremium, true)
})

// ── PERIODE — RPC-STIEN ──────────────────────────────────────────────────────

function settRpcListeMedMeg() {
  state.rpcRanked = [
    { user_id: ANNEN, display_name: 'Spiller En', points: 20, quiz_count: 2, rank: 1, total_count: 2 },
    { user_id: ME, display_name: 'Meg Megsen', points: 10, quiz_count: 1, rank: 2, total_count: 2 },
  ]
  state.rpcUserStats = [{ points: 10, quiz_count: 1, rank: 2 }]
  state.profileRows = [
    { id: ANNEN, display_name: 'Spiller En', nickname: null },
    { id: ME, display_name: 'Meg Megsen', nickname: null },
  ]
}

test('periode/RPC: ORG-KARENS teller som Premium', async () => {
  settRpcListeMedMeg()
  settOrgKarens()

  const { status, body } = await hent('period=month&scope=global')

  assert.equal(status, 200)
  assert.equal(body.userIsPremium, true)
  assert.equal(body.userRank, 2, 'plasseringen skal leveres som før')
  assert.equal(body.entries.length, 2)
})

test('periode/RPC: FEILET premium-oppslag gir 503', async () => {
  settRpcListeMedMeg()
  state.premiumLookupFails = true

  const { status, body } = await hent('period=month&scope=global')

  assert.equal(status, 503)
  assert.equal(body.entries, undefined)
})

test('periode/RPC: TOM liste (emptyResponse) bærer også riktig premium-status', async () => {
  // rpcRanked er tom → ruten svarer via emptyResponse-helperen. Den deler
  // settlePremium med hovedstiene, så karensen skal synes også her.
  settOrgKarens()

  const { status, body } = await hent('period=month&scope=global')

  assert.equal(status, 200)
  assert.deepEqual(body.entries, [])
  assert.equal(body.userIsPremium, true)
})

// ── PERIODE — JS-FALLBACK (RPC utilgjengelig) ────────────────────────────────

function settFallbackScores(medMeg: boolean) {
  state.rpcRankedFails = true
  const iGaar = FOR_EN_DAG_SIDEN()
  state.seasonScores = [
    { user_id: ANNEN, points: 20, quiz_id: 'quiz-1', closes_at: iGaar, scope_type: 'global', scope_id: null },
    ...(medMeg ? [{ user_id: ME, points: 10, quiz_id: 'quiz-1', closes_at: iGaar, scope_type: 'global', scope_id: null }] : []),
  ]
  state.profileRows = [
    { id: ANNEN, display_name: 'Spiller En', nickname: null },
    { id: ME, display_name: 'Meg Megsen', nickname: null },
  ]
}

test('fallback: ORG-KARENS teller som Premium', async () => {
  settFallbackScores(true)
  settOrgKarens()

  const { status, body } = await hent('period=alltime&scope=global')

  assert.equal(status, 200)
  assert.equal(body.userIsPremium, true)
  assert.equal(body.userRank, 2)
})

test('fallback: FEILET premium-oppslag gir 503', async () => {
  settFallbackScores(true)
  state.premiumLookupFails = true

  const { status, body } = await hent('period=alltime&scope=global')

  assert.equal(status, 503)
  assert.equal(body.entries, undefined)
})

test('fallback: kaller UTEN season_scores får fortsatt riktig premium-status', async () => {
  // Søskenet på det gamle navne-fallback-oppslaget: premium ble tidligere lest
  // fra nettopp den spørringen. Nå kommer premium fra det delte kallet, og
  // navne-fallbacken består urørt for navnets skyld (FA-2 er en egen sak).
  settFallbackScores(false)
  settPersonligKarens()

  const { status, body } = await hent('period=alltime&scope=global')

  assert.equal(status, 200)
  assert.equal(body.userEntry, null, 'ingen rader i perioden → ingen egen rad')
  assert.equal(body.userIsPremium, true, 'premium-statusen skal ikke avhenge av season_scores')
})
