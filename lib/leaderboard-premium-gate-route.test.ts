// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/leaderboard/[id]. `mock.module` bytter
// ut supabase-admin, slik at både ruten, lib/ranking og lib/premium-check
// kjøres uendret — grace-perioden testes derfor mot den EKTE isUserPremium.
//
// SAKEN: eksakt plassering er en Premium-funksjon, men muren lå kun i klienten.
// Ruten sendte `userRank` (og hele raden med eksakt rank) til enhver innlogget
// bruker — lesbart i nettverksfanen for alle, uansett Premium-status.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Fjernes `userIsPremium`-grenen (alltid eksakt)      → 4 tester ryker.
//   • Byttes grovmalingen til `mine.rank`                  → 2 tester ryker.
//   • Byttes isUserPremium tilbake til `premium_status === true` alene
//     → grace-testen ryker (brukeren i grace mister eksakt plassering).
//   • Fjernes raden helt for gratis (`userEntry = null`)   → 3 tester ryker
//     (score/tid/streak/antall spørsmål forsvinner for gratisbrukere).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ME = '11111111-1111-4111-8111-111111111111'

type AttemptRow = {
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
  quiz_id: string
}

const state: {
  attempts: AttemptRow[]
  profile: { premium_status: boolean; org_premium_grace_until: string | null }
} = {
  attempts: [],
  profile: { premium_status: false, org_premium_grace_until: null },
}

/** Et innsendt solo-forsøk. Færre riktige = dårligere plassering. */
function attempt(n: number, correct: number, userId: string | null = null): AttemptRow {
  return {
    id: `attempt-${n}`,
    user_id: userId,
    player_name: userId ? 'Meg Megsen' : `Spiller ${n}`,
    correct_answers: correct,
    total_questions: 15,
    total_time_ms: 30_000 + n,
    correct_streak: userId ? 4 : 1,
    is_team: false,
    team_size: 1,
    leader_display_name: null,
    submitted_at: '2026-08-01T10:00:00.000Z',
    quiz_id: QUIZ,
  }
}

// Minimal PostgREST-etterligning. To ulike spørringer mot `profiles`:
// premium-oppslaget (maybeSingle) og nickname-oppslaget (.in, await).
function builder(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = []

  const b: Record<string, unknown> = {
    select() { return b },
    eq(col: string, val: unknown) { filters.push(r => r[col] === val); return b },
    in(col: string, vals: unknown[]) { filters.push(r => vals.includes(r[col])); return b },
    limit() { return b },
    maybeSingle() {
      // Kun premium-oppslaget i lib/premium-check bruker maybeSingle her.
      return Promise.resolve({ data: state.profile, error: null })
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'attempts') {
        let out = state.attempts as unknown as Record<string, unknown>[]
        for (const f of filters) out = out.filter(f)
        return resolve({ data: out, error: null })
      }
      // profiles → nickname-oppslaget
      return resolve({ data: [{ id: ME, nickname: null }], error: null })
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
    },
  },
})

const { GET } = await import('@/app/api/leaderboard/[id]/route')

type Svar = {
  userRank: number | null
  userEntry: {
    rank: number
    correctAnswers: number
    totalQuestions: number
    totalTimeMs: number
    correctStreak: number | null
  } | null
  totalCount: number
  userIsPremium: boolean
}

async function hentLeaderboard(): Promise<Svar> {
  const request = new Request(`https://quizkanonen.no/api/leaderboard/${QUIZ}?is_team=false&limit=1`, {
    headers: { authorization: 'Bearer test-token' },
  })
  const res = await GET(request as never, { params: Promise.resolve({ id: QUIZ }) })
  return res.json() as Promise<Svar>
}

beforeEach(() => {
  // 20 spillere. Meg = 12. beste resultat (11 foran meg med flere riktige).
  state.attempts = [
    ...Array.from({ length: 11 }, (_, i) => attempt(i + 1, 15 - i)),
    attempt(12, 4, ME),
    ...Array.from({ length: 8 }, (_, i) => attempt(i + 13, 3 - i * 0)),
  ]
  state.profile = { premium_status: false, org_premium_grace_until: null }
})

test('PREMIUM: får eksakt plassering — både userRank og rank i raden', async () => {
  state.profile = { premium_status: true, org_premium_grace_until: null }

  const svar = await hentLeaderboard()

  assert.equal(svar.userIsPremium, true)
  assert.equal(svar.userRank, 12, 'Premium skal få det eksakte tallet')
  assert.equal(svar.userEntry?.rank, 12, 'raden skal også ha eksakt rank')
})

test('GRATIS: userRank utelates helt fra svaret', async () => {
  const svar = await hentLeaderboard()

  assert.equal(svar.userIsPremium, false)
  assert.equal(svar.userRank, null, 'det eksakte tallet skal ikke finnes i svaret')
})

test('GRATIS: rank i raden er grovmalt til 10-båndets start, ikke eksakt', async () => {
  const svar = await hentLeaderboard()

  // Eksakt rank er 12 → båndet er 11–20 → 11 er alt gratis-visningen trenger.
  assert.equal(svar.userEntry?.rank, 11, 'skal være båndstart, ikke 12')
  assert.notEqual(svar.userEntry?.rank, 12, 'eksakt rank skal ikke lekke via raden')
})

test('GRATIS: beholder sine egne resultattall (score, tid, streak)', async () => {
  // Raden er ikke Premium-data — resultatkortet viser disse til gratisbrukere,
  // og er eneste kilde når de spilte på en annen enhet.
  const svar = await hentLeaderboard()

  assert.equal(svar.userEntry?.correctAnswers, 4)
  assert.equal(svar.userEntry?.totalQuestions, 15)
  assert.equal(svar.userEntry?.correctStreak, 4)
  assert.ok((svar.userEntry?.totalTimeMs ?? 0) > 0)
})

test('GRACE etter tapt org-Premium teller som Premium (samme sjekk som resten)', async () => {
  // premium_status er false, men grace-perioden løper ennå. Den lokale
  // `premium_status === true`-spørringen ruten hadde før ville nektet her.
  state.profile = {
    premium_status: false,
    org_premium_grace_until: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  }

  const svar = await hentLeaderboard()

  assert.equal(svar.userIsPremium, true, 'grace skal telle som Premium')
  assert.equal(svar.userRank, 12, 'og gi eksakt plassering')
})

test('UTLØPT grace gir ikke Premium', async () => {
  state.profile = {
    premium_status: false,
    org_premium_grace_until: new Date(Date.now() - 86_400_000).toISOString(),
  }

  const svar = await hentLeaderboard()

  assert.equal(svar.userIsPremium, false)
  assert.equal(svar.userRank, null)
})

test('rank 1–10 grovmales til 1 (ingen bånd-start på 0 eller negativt)', async () => {
  // Meg på 3. plass → båndet er 1–10.
  state.attempts = [attempt(1, 15), attempt(2, 14), attempt(3, 13, ME), attempt(4, 12)]

  const svar = await hentLeaderboard()

  assert.equal(svar.userEntry?.rank, 1)
})
