// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Tester den delte lås-vakten `requireUnlockedOrg` direkte, OG de ekte rutene
// som nå kaller den. Rutetestene er poenget: en vakt som er riktig i seg selv,
// men ikke kalt fra rutene, beskytter ingenting.
//
// MUTASJONSBEVIS (b) — utført på to blokkerte ruter, se rapporten:
//
//   (b1) Fjern `requireUnlockedOrg`-kallet i app/api/org/[slug]/send-invite/route.ts
//        → «låst org kan ikke sende invitasjons-e-post» feiler: status blir 200
//          og 3 e-poster går faktisk ut fra hei@quizkanonen.no.
//   (b2) Fjern `requireUnlockedOrg`-kallet i app/api/org/join/[token]/route.ts
//        → «låst org deler ikke ut Premium til nye ansatte» feiler:
//          medlemsraden opprettes og profiles.premium_status settes til true.
//
// Assertene ser på SIDEEFFEKTENE (sendte e-poster, skrevne rader), ikke bare på
// statuskoden — to lag rundt samme invariant maskerer ellers hverandre.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SITE_URL = 'https://quizkanonen.no'

const ORG_ID = '26e5126f-4c40-4588-9646-aa81d0c6a082'
const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'
const INVITE_TOKEN = 'abc123'
const INVITE_URL = 'https://quizkanonen.no/bli-med/abc123'

const state: {
  subscriptionStatus: string
  orgLookupError: { message: string } | null
  role: string
  memberCount: number
  sent: { to: string; subject: string }[]
  memberInserts: Record<string, unknown>[]
  profileUpdates: Record<string, unknown>[]
  inviteUseCount: number
} = {
  subscriptionStatus: 'active',
  orgLookupError: null,
  role: 'admin',
  memberCount: 5,
  sent: [],
  memberInserts: [],
  profileUpdates: [],
  inviteUseCount: 0,
}

function builder(table: string) {
  let counting = false
  let cols = ''
  let inserted: Record<string, unknown>[] | null = null
  let updated: Record<string, unknown> | null = null

  const b = {
    select(c?: string, opts?: { count?: string; head?: boolean }) {
      if (typeof c === 'string') cols = c
      counting = opts?.count === 'exact'
      return b
    },
    eq() { return b },
    lt() { return b },
    gte() { return b },
    not() { return b },
    order() { return b },
    in() { return b },
    delete() { return b },
    limit() { return b },
    insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
      inserted = Array.isArray(rows) ? rows : [rows]
      if (table === 'organization_members') state.memberInserts.push(...inserted)
      return b
    },
    update(values: Record<string, unknown>) {
      updated = values
      if (table === 'profiles') state.profileUpdates.push(values)
      return b
    },
    single() {
      if (inserted) return Promise.resolve({ data: { id: 'ny-rad' }, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    maybeSingle() {
      if (table === 'organizations') {
        if (state.orgLookupError) return Promise.resolve({ data: null, error: state.orgLookupError })
        return Promise.resolve({
          data: {
            id: ORG_ID,
            slug: 'elkjop',
            name: 'Elkjøp Nordic',
            plan: 'standard',
            created_at: '2026-06-19T07:29:42.701Z',
            subscription_status: state.subscriptionStatus,
          },
          error: null,
        })
      }
      if (table === 'organization_members') {
        // Skiller på kolonnene, ikke bare på tabellen: rolle-oppslaget og
        // «er du allerede medlem av en annen org?»-oppslaget treffer samme
        // tabell, men skal svare motsatt. Uten dette ville join-testen fått
        // 409 «allerede medlem» og aldri nådd lås-vakten i det hele tatt.
        if (cols.includes('role')) return Promise.resolve({ data: { role: state.role }, error: null })
        return Promise.resolve({ data: null, error: null })
      }
      if (table === 'organization_invites') {
        if (updated) return Promise.resolve({ data: { id: 'inv1' }, error: null })
        return Promise.resolve({
          data: {
            id: 'inv1',
            organization_id: ORG_ID,
            is_active: true,
            expires_at: null,
            max_uses: null,
            use_count: state.inviteUseCount,
          },
          error: null,
        })
      }
      if (table === 'profiles') {
        return Promise.resolve({ data: { display_name: 'Dennis Busk', premium_status: false }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then(resolve: (v: unknown) => void) {
      if (counting) return resolve({ count: state.memberCount, error: null })
      if (inserted) return resolve({ data: inserted, error: null })
      return resolve({ data: [], error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => ({ data: { user: { id: USER_ID, email: 'dennis@example.test' } }, error: null }),
        admin: {
          getUserById: async () => ({ data: { user: { id: USER_ID, email: 'dennis@example.test' } } }),
        },
      },
      from: (table: string) => builder(table),
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (opts: { to: string; subject: string }) => { state.sent.push(opts) },
  },
})

// BEGGE lagene må mockes her: fila kjører tre ruter, og de ligger på hver sin
// side av migreringen. org/join bruker den delte limiteren (Upstash),
// send-invite og settings bruker fortsatt in-memory-varianten.
mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

mock.module('@/lib/rate-limit-shared', {
  namedExports: { rateLimitShared: async () => ({ success: true, remaining: 99 }) },
})

const { requireUnlockedOrg, ORG_LOCKED_CODE, ORG_LOCKED_ERROR } = await import('@/lib/org-lock-guard')
const { POST: sendInvite } = await import('@/app/api/org/[slug]/send-invite/route')
const { POST: join, GET: checkInvite } = await import('@/app/api/org/join/[token]/route')
const { PATCH: settings } = await import('@/app/api/org/[slug]/settings/route')

beforeEach(() => {
  state.subscriptionStatus = 'active'
  state.orgLookupError = null
  state.role = 'admin'
  state.memberCount = 5
  state.sent = []
  state.memberInserts = []
  state.profileUpdates = []
  state.inviteUseCount = 0
})

// ── Vakten selv ─────────────────────────────────────────────────────────────

test('aktiv org slipper gjennom og gir org-raden tilbake', async () => {
  const res = await requireUnlockedOrg({ id: ORG_ID })
  assert.equal(res.ok, true)
  assert.equal(res.ok && res.org.name, 'Elkjøp Nordic')
})

test('trialing slipper gjennom — Elkjøp står som trialing i prod', async () => {
  state.subscriptionStatus = 'trialing'
  assert.equal((await requireUnlockedOrg({ slug: 'elkjop' })).ok, true)
})

test('locked avvises med 403, tydelig melding og maskinlesbar kode', async () => {
  state.subscriptionStatus = 'locked'
  const res = await requireUnlockedOrg({ id: ORG_ID })
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.status, 403)
  assert.equal(res.ok === false && res.body.code, ORG_LOCKED_CODE)
  assert.equal(res.ok === false && res.body.error, ORG_LOCKED_ERROR)
})

test('oppslagsfeil feiler LUKKET med 503 — ikke fri passasje', async () => {
  state.orgLookupError = { message: 'statement timeout' }
  const res = await requireUnlockedOrg({ id: ORG_ID })
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.status, 503)
})

// ── MUTASJONSBEVIS (b1): send-invite ────────────────────────────────────────

function inviteCall() {
  const request = new Request('https://quizkanonen.no/api/org/x/send-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({
      emails: ['a@bedrift.no', 'b@bedrift.no', 'c@bedrift.no'],
      inviteUrl: INVITE_URL,
    }),
  })
  return sendInvite(request as never, { params: Promise.resolve({ slug: ORG_ID }) })
}

test('låst org kan ikke sende invitasjons-e-post — ingen e-post går ut', async () => {
  state.subscriptionStatus = 'locked'

  const res = await inviteCall()
  const json = await res.json()

  // Sideeffekten først: det er DEN som er skaden. En statuskode-assert alene
  // ville latt en mutasjon som fortsatt sender e-post feile på «feil tall» i
  // stedet for på «e-post gikk ut fra hei@quizkanonen.no».
  assert.equal(state.sent.length, 0, 'INGEN e-post skal ha gått ut fra hei@quizkanonen.no')
  assert.equal(res.status, 403)
  assert.equal(json.code, ORG_LOCKED_CODE)
  assert.match(json.error, /abonnement/i)
})

test('aktiv org sender som før — ingen regresjon', async () => {
  const res = await inviteCall()
  assert.equal(res.status, 200)
  assert.equal(state.sent.length, 3)
})

// ── MUTASJONSBEVIS (b2): join ───────────────────────────────────────────────

function joinCall() {
  const request = new Request(`https://quizkanonen.no/api/org/join/${INVITE_TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
  })
  return join(request as never, { params: Promise.resolve({ token: INVITE_TOKEN }) })
}

test('låst org deler ikke ut Premium til nye ansatte', async () => {
  state.subscriptionStatus = 'locked'

  const res = await joinCall()
  const json = await res.json()

  // Sideeffektene først — se merknaden i send-invite-testen.
  assert.deepEqual(
    state.profileUpdates.filter(u => u.premium_status === true),
    [],
    'premium_status skal ALDRI settes for en låst org',
  )
  assert.equal(state.memberInserts.length, 0, 'ingen medlemsrad skal ha blitt opprettet')
  assert.equal(res.status, 403)
  assert.equal(json.code, ORG_LOCKED_CODE)
})

test('invitasjonslenken til en låst org viser en forklaring, ikke en blindvei', async () => {
  state.subscriptionStatus = 'locked'

  const request = new Request(`https://quizkanonen.no/api/org/join/${INVITE_TOKEN}`)
  const res = await checkInvite(request as never, { params: Promise.resolve({ token: INVITE_TOKEN }) })
  const json = await res.json()

  assert.equal(res.status, 403)
  assert.equal(json.valid, false)
  // Den ansatte kan ikke fornye abonnementet selv — teksten skal peke på admin.
  assert.match(json.error, /administrator/i)
})

test('aktiv org: innmelding fungerer som før', async () => {
  const res = await joinCall()
  assert.equal(res.status, 200)
  assert.equal(state.memberInserts.length, 1)
})

// ── Én rute til, for å bekrefte at mønsteret er likt overalt ─────────────────

test('låst org kan ikke endre bedriftsnavn', async () => {
  state.subscriptionStatus = 'locked'

  const request = new Request('https://quizkanonen.no/api/org/elkjop/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ name: 'Nytt Navn AS' }),
  })
  const res = await settings(request as never, { params: Promise.resolve({ slug: 'elkjop' }) })

  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, ORG_LOCKED_CODE)
})
