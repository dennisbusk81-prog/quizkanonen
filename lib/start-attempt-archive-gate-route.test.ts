// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av arkiv-gaten på spill-porten (ARK-1 steg 1A, 27. august
// 2026): den ekte POST /api/quiz/start-attempt kjøres med den ekte
// decideArchivePlayGate og den ekte decidePremiumFromProfile — kun
// supabase-admin og rate-limit-lagene er mocket.
//
// Bevisene bestillingen krever, i rekkefølge:
//   gratisbruker mot arkivquiz   → avvist (403), ingen attempt skrevet
//   premium mot arkivquiz        → slipper inn
//   lesefeil mot arkivquiz       → 503, ingen attempt skrevet
//   gratisbruker mot fredagsquiz → UENDRET fra i dag
// Det siste er det viktigste: en regresjon der ville rammet hver eneste
// spiller fredag kl. 12. Derfor dekkes fredagsstien BÅDE for gratisbruker og
// for lesefeil («vet ikke → ikke premium» skal bestå der, aldri bli 503).
//
// MUTASJONSBEVIS (alle kjørt 27. august 2026 og revertert):
//   • decideArchivePlayGate-kallet fjernet fra ruten → 403- og 503-testene røde
//   • gatens 503-gren kollapset til 403             → lesefeil-mot-arkiv-testen rød
//   • gatens ikke-arkiv-tidligretur fjernet         → BEGGE fredagstestene røde
//   • lesefeil kollapset til { ok: true, value: false } i ruten
//                                                   → lesefeil-mot-arkiv-testen rød
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const ARCHIVE_QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FRIDAY_QUIZ = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const NEW_ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type ProfileRow = {
  suspended_until: string | null
  premium_status: boolean | null
  org_premium_grace_until: string | null
  personal_grace_until: string | null
}

const state = {
  profile: null as ProfileRow | null,
  profileFails: false,
  attemptInserts: 0,
  attemptQueries: 0,
}

// Rate-limit-lagene er ikke det denne filen beviser — slipp alt gjennom.
mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})
mock.module('@/lib/rate-limit-shared', {
  namedExports: {
    rateLimitShared: async () => ({ success: true, remaining: 99 }),
    SHARED_RATE_LIMIT_TIMEOUT_MS: 1000,
  },
})

function profilesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() {
      return state.profileFails
        ? { data: null, error: { message: 'simulert lesefeil' } }
        : { data: state.profile, error: null }
    },
  }
  return b
}

function quizzesBuilder() {
  const b = {
    select() { return b },
    eq(_col: string, id: string) {
      const rows: Record<string, unknown> = {
        // Arkivkopien slik buildArchiveCopy skriver den: NULL-tider, egen type.
        [ARCHIVE_QUIZ]: { id: ARCHIVE_QUIZ, is_active: true, opens_at: null, closes_at: null, quiz_type: 'archive' },
        // Fredagsquiz med åpent vindu rundt «nå».
        [FRIDAY_QUIZ]: {
          id: FRIDAY_QUIZ,
          is_active: true,
          opens_at: new Date(Date.now() - 3_600_000).toISOString(),
          closes_at: new Date(Date.now() + 3_600_000).toISOString(),
          quiz_type: 'weekly',
        },
      }
      return { ...b, async maybeSingle() { return { data: rows[id] ?? null } } }
    },
    async maybeSingle() { return { data: null } },
  }
  return b
}

function questionsBuilder() {
  const b = {
    select() { return b },
    eq() { return Promise.resolve({ count: 15 }) },
  }
  return b
}

function attemptsBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    not() { return b },
    is() { return b },
    order() { return b },
    limit() { return b },
    async maybeSingle() {
      state.attemptQueries++
      return { data: null } // ingen levert, ingen uferdig → ny rad
    },
    insert() {
      state.attemptInserts++
      return {
        select() {
          return { async single() { return { data: { id: NEW_ATTEMPT }, error: null } } }
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
        if (table === 'profiles') return profilesBuilder() as never
        if (table === 'quizzes') return quizzesBuilder() as never
        if (table === 'questions') return questionsBuilder() as never
        if (table === 'attempts') return attemptsBuilder() as never
        throw new Error(`uventet tabell i test: ${table}`)
      },
      auth: {
        getUser: async () => ({ data: { user: { id: 'u-self' } }, error: null }),
      },
    },
  },
})

const { POST } = await import('@/app/api/quiz/start-attempt/route')
const { readAttemptToken } = await import('@/lib/attempt-token')

function call(quizId: string) {
  return POST(new Request('https://quizkanonen.no/api/quiz/start-attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({ quizId, playerName: 'Testesen' }),
  }) as never)
}

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    suspended_until: null,
    premium_status: false,
    org_premium_grace_until: null,
    personal_grace_until: null,
    ...overrides,
  }
}

const IN_A_WEEK = () => new Date(Date.now() + 7 * 86_400_000).toISOString()

beforeEach(() => {
  state.profile = profile()
  state.profileFails = false
  state.attemptInserts = 0
  state.attemptQueries = 0
})

// ── Arkivquiz: gaten binder ────────────────────────────────────────────────

test('gratisbruker mot arkivquiz → 403, og INGEN attempt-lesing eller -skriving', async () => {
  const res = await call(ARCHIVE_QUIZ) as Response
  assert.equal(res.status, 403)
  assert.equal(((await res.json()) as { error: string }).error, 'Arkivet krever Premium.')
  assert.equal(state.attemptInserts, 0, 'et avslag skal aldri etterlate en attempt-rad')
  assert.equal(state.attemptQueries, 0, 'gaten skal stå FØR replay-/gjenbrukslogikken')
})

test('premium mot arkivquiz → slipper inn, med premium-krav i tokenet', async () => {
  state.profile = profile({ premium_status: true })
  const res = await call(ARCHIVE_QUIZ) as Response
  assert.equal(res.status, 200)
  const json = (await res.json()) as { attemptId: string; attemptToken: string }
  assert.equal(json.attemptId, NEW_ATTEMPT)
  const read = readAttemptToken(json.attemptToken, json.attemptId, ARCHIVE_QUIZ)
  assert.equal(read.valid, true)
  assert.equal(read.premium, true)
  assert.equal(state.attemptInserts, 1)
})

test('org-karens alene slipper inn — gaten rir på decidePremiumFromProfile, ikke en rå kolonnelesing', async () => {
  // Aktivt org-medlemskap uttrykkes som premium_status=true i cachen (skrives
  // ved innmelding, app/api/org/join/[token]/route.ts) og dekkes av testen
  // over. Karens-leddet er det som SKILLER den delte helperen fra en rå
  // premium_status-lesing.
  state.profile = profile({ premium_status: false, org_premium_grace_until: IN_A_WEEK() })
  const res = await call(ARCHIVE_QUIZ) as Response
  assert.equal(res.status, 200)
})

test('lesefeil mot arkivquiz → 503, aldri en dom — og ingen attempt skrevet', async () => {
  state.profileFails = true
  const res = await call(ARCHIVE_QUIZ) as Response
  assert.equal(res.status, 503)
  assert.equal(state.attemptInserts, 0)
  assert.equal(state.attemptQueries, 0)
})

// ── Fredagsquiz: UENDRET — det viktigste beviset ───────────────────────────

test('gratisbruker mot fredagsquiz → uendret: 200 med token uten premium-krav', async () => {
  const res = await call(FRIDAY_QUIZ) as Response
  assert.equal(res.status, 200)
  const json = (await res.json()) as { attemptId: string; attemptToken: string }
  const read = readAttemptToken(json.attemptToken, json.attemptId, FRIDAY_QUIZ)
  assert.equal(read.valid, true)
  assert.equal(read.premium, false)
  assert.equal(state.attemptInserts, 1)
})

test('lesefeil mot fredagsquiz → fortsatt 200, aldri 503 — «vet ikke → ikke premium» består der', async () => {
  // En regresjon her ville rammet hver eneste spiller fredag kl. 12: en
  // transient DB-feil midt i tidsvinduet skal ikke avvise noen fra
  // fredagsquizen. Tokenet utstedes uten premium-krav (visningskravets
  // dokumenterte retning), og spilleren spiller videre.
  state.profileFails = true
  const res = await call(FRIDAY_QUIZ) as Response
  assert.equal(res.status, 200)
  const json = (await res.json()) as { attemptId: string; attemptToken: string }
  const read = readAttemptToken(json.attemptToken, json.attemptId, FRIDAY_QUIZ)
  assert.equal(read.valid, true)
  assert.equal(read.premium, false)
  assert.equal(state.attemptInserts, 1)
})
