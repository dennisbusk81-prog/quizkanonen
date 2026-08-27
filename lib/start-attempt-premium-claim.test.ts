// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av premium-kravet start-attempt signerer inn i
// attempt-tokenet (P-2, 23. august 2026).
//
// HVORFOR DENNE FILEN FINNES — den ble skrevet ETTER en mutasjonsrunde som
// avdekket et hull: byttes `decidePremiumFromProfile(...)` ut med `false` i
// ruten, var ikke én eneste test rød. Konsekvensen i produksjon ville vært at
// HVER Premium-spiller stille mistet eksakt plassering under spilling — ingen
// feilmelding, ingen 500, ingen Sentry-hendelse. Nøyaktig den feilklassen
// «stille tap av en betalt funksjon» som resten av P-2 handler om, gjemt i det
// ene stedet kravet fødes.
//
// Ruten er den ENESTE utstederen av kravet. Tre utgangsveier deler den
// jobben — nytt forsøk, gjenbrukt uferdig forsøk, og race-grenen etter en
// unik-constraint — og alle tre må bære det. En som glemmer det gir en spiller
// som mistet Premium bare fordi hen lastet siden på nytt.
//
// MUTASJONSBEVIS
//   • `callerIsPremium = false` i ruten → «premium-profil får premium-token»
//     og begge grace-testene ryker.
//   • Fjern `{ premium: callerIsPremium }` fra ÉN av de tre createAttemptToken-
//     kallene → nøyaktig den ene utgangstesten ryker.
//   • Bytt decidePremiumFromProfile mot en rå `premium_status === true` →
//     grace-testene ryker (det var hele poenget med den delte helperen).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NEW_ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OLD_ATTEMPT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type ProfileRow = {
  suspended_until: string | null
  premium_status: boolean | null
  org_premium_grace_until: string | null
  personal_grace_until: string | null
}

const state: {
  profile: ProfileRow
  unfinishedId: string | null
  insertFails: boolean
} = {
  profile: {
    suspended_until: null,
    premium_status: false,
    org_premium_grace_until: null,
    personal_grace_until: null,
  },
  unfinishedId: null,
  insertFails: false,
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
    async maybeSingle() { return { data: state.profile, error: null } },
  }
  return b
}

function quizzesBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    // Åpent vindu rundt «nå», slik at ruten ikke avviser på tid.
    async maybeSingle() {
      return {
        data: {
          id: QUIZ,
          is_active: true,
          opens_at: new Date(Date.now() - 3_600_000).toISOString(),
          closes_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      }
    },
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

// attempts brukes til TRE ting i rekkefølge: replay-sperren (levert forsøk),
// gjenbruk av uferdig forsøk, og innsettingen. Vi skiller på hvilke filtre
// spørringen faktisk oppga — samme «mocken håndhever filtrene»-grep som
// rival-route-snapshot.test.ts.
function attemptsBuilder() {
  let sawNotSubmitted = false   // .not('submitted_at','is',null) → replay-sperren
  let sawIsSubmitted = false    // .is('submitted_at', null)      → uferdig
  const b = {
    select() { return b },
    eq() { return b },
    not(_col: string, _op: string, _val: unknown) { sawNotSubmitted = true; return b },
    is(_col: string, _val: unknown) { sawIsSubmitted = true; return b },
    order() { return b },
    limit() { return b },
    async maybeSingle() {
      if (sawNotSubmitted) return { data: null }               // ingen levert → får spille
      if (sawIsSubmitted) return { data: state.unfinishedId ? { id: state.unfinishedId } : null }
      return { data: null }
    },
    insert() {
      return {
        select() {
          return {
            async single() {
              return state.insertFails
                ? { data: null, error: { code: '23505', message: 'duplicate' } }
                : { data: { id: NEW_ATTEMPT }, error: null }
            },
          }
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

function call() {
  return POST(new Request('https://quizkanonen.no/api/quiz/start-attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({ quizId: QUIZ, playerName: 'Testesen' }),
  }) as never)
}

/** Les premium-kravet ut av tokenet ruten faktisk utstedte. */
async function claimFrom(res: Response): Promise<{ attemptId: string; premium: boolean }> {
  const json = await res.json() as { attemptId: string; attemptToken: string | null }
  assert.ok(json.attemptToken, 'ruten skal alltid utstede et token')
  const read = readAttemptToken(json.attemptToken, json.attemptId, QUIZ)
  assert.equal(read.valid, true, 'tokenet ruten utstedte skal verifisere mot sitt eget forsøk')
  return { attemptId: json.attemptId, premium: read.premium }
}

const IN_A_WEEK = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const A_WEEK_AGO = () => new Date(Date.now() - 7 * 86_400_000).toISOString()

beforeEach(() => {
  state.profile = {
    suspended_until: null,
    premium_status: false,
    org_premium_grace_until: null,
    personal_grace_until: null,
  }
  state.unfinishedId = null
  state.insertFails = false
})

// ── Kjernen: kravet speiler profilen ───────────────────────────────────────

test('gratis profil gir et token UTEN premium-krav', async () => {
  const { premium } = await claimFrom(await call() as Response)
  assert.equal(premium, false)
})

test('premium profil gir et token MED premium-krav', async () => {
  state.profile.premium_status = true
  const { premium } = await claimFrom(await call() as Response)
  assert.equal(premium, true)
})

// ── Grace teller som dekning — derfor den DELTE helperen ───────────────────

test('org-karens teller som Premium selv når cachen står i false', async () => {
  // Nøyaktig tilfellet decidePremiumFromProfile finnes for: en rå
  // `premium_status === true` her ville sendt en bruker i karens til
  // gratisvisningen midt i karensperioden.
  state.profile.premium_status = false
  state.profile.org_premium_grace_until = IN_A_WEEK()
  const { premium } = await claimFrom(await call() as Response)
  assert.equal(premium, true)
})

test('personlig karens (avvist kort) teller som Premium', async () => {
  state.profile.premium_status = false
  state.profile.personal_grace_until = IN_A_WEEK()
  const { premium } = await claimFrom(await call() as Response)
  assert.equal(premium, true)
})

test('UTLØPT karens teller ikke — datoen leses, ikke bare tilstedeværelsen', async () => {
  state.profile.premium_status = false
  state.profile.org_premium_grace_until = A_WEEK_AGO()
  state.profile.personal_grace_until = A_WEEK_AGO()
  const { premium } = await claimFrom(await call() as Response)
  assert.equal(premium, false)
})

// ── Alle TRE utstedelsesveiene må bære kravet ──────────────────────────────

test('gjenbrukt uferdig forsøk (reload midt i quiz) beholder premium-kravet', async () => {
  state.profile.premium_status = true
  state.unfinishedId = OLD_ATTEMPT

  const res = await call() as Response
  const json = await res.clone().json() as { reused?: boolean; attemptId: string }
  assert.equal(json.reused, true, 'positiv kontroll: vi traff faktisk gjenbruks-grenen')
  assert.equal(json.attemptId, OLD_ATTEMPT)

  const { premium } = await claimFrom(res)
  assert.equal(premium, true, 'en reload skal ikke koste spilleren Premium ut quizen')
})

test('race-grenen (unik-constraint) bærer også kravet', async () => {
  state.profile.premium_status = true
  state.insertFails = true      // 23505 → ruten henter den eksisterende raden
  state.unfinishedId = OLD_ATTEMPT

  // Merk: replay-/gjenbruks-oppslaget skjer FØR innsettingen, så for å nå
  // race-grenen må gjenbruks-oppslaget bomme første gang. Her er state satt
  // slik at gjenbruk treffer — testen over dekker den. Denne dekker at
  // race-grenen har SAMME form: den skal aldri kunne utstede et token uten
  // krav mens de to andre gjør det.
  const src = (await import('fs')).readFileSync('app/api/quiz/start-attempt/route.ts', 'utf8')
  const utstedelser = src.match(/createAttemptToken\([^)]*\)/g) ?? []
  assert.equal(utstedelser.length, 3, `forventet 3 utstedelsessteder, fant ${utstedelser.length}`)
  for (const u of utstedelser) {
    assert.match(u, /premium: callerIsPremium/,
      `et createAttemptToken-kall utsteder uten premium-krav: ${u}`)
  }
})
