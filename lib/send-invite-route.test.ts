// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte send-invite-ruten. `mock.module` bytter ut
// supabase-admin, e-postsending og rate-limit, slik at produksjonskoden kjøres
// uendret — ingen injiserte parametere, ingen egen testvei, og ingen ekte
// e-post ut fra Resend.
//
// MUTASJONSBEVIS: fjernes kvotesjekken i ruten, sender testen «ny org, 40
// e-poster» 40 e-poster i stedet for null, og første assert feiler.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SITE_URL = 'https://quizkanonen.no'

const ORG_ID = '26e5126f-4c40-4588-9646-aa81d0c6a082'
const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'
const INVITE_URL = 'https://quizkanonen.no/bli-med/abc123'

type OrgRow = { name: string; created_at: string; subscription_status: string }

const state: {
  org: OrgRow
  memberCount: number
  usedToday: number
  countError: { message: string } | null
  displayName: string | null
  role: string
  sent: Array<{ to: string; subject: string; html: string }>
  logged: number
} = {
  org: { name: 'Elkjøp Nordic', created_at: '', subscription_status: 'trialing' },
  memberCount: 1,
  usedToday: 0,
  countError: null,
  displayName: 'Dennis Busk',
  role: 'admin',
  sent: [],
  logged: 0,
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function builder(table: string) {
  let counting = false

  const b = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      counting = opts?.count === 'exact'
      return b
    },
    eq() { return b },
    gte() { return b },
    maybeSingle() {
      if (table === 'organization_members') return Promise.resolve({ data: { role: state.role }, error: null })
      if (table === 'organizations') return Promise.resolve({ data: state.org, error: null })
      if (table === 'profiles') return Promise.resolve({ data: { display_name: state.displayName }, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    insert(rows: unknown[]) {
      state.logged += rows.length
      return Promise.resolve({ error: null })
    },
    // Tellespørringene (count/head) awaites uten terminalmetode.
    then(resolve: (v: unknown) => void) {
      if (!counting) return resolve({ data: null, error: null })
      if (table === 'organization_members') return resolve({ count: state.memberCount, error: null })
      if (table === 'admin_actions') return resolve({ count: state.usedToday, error: state.countError })
      return resolve({ count: 0, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: (table: string) => builder(table),
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (opts: { to: string; subject: string; html: string }) => {
      state.sent.push(opts)
    },
  },
})

// Rate-limit er per prosess og ville slått inn etter 5 kall i testfilen.
mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

const { POST } = await import('@/app/api/org/[slug]/send-invite/route')

function call(emails: string[], extraBody: Record<string, unknown> = {}) {
  const request = new Request('https://quizkanonen.no/api/org/x/send-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ emails, inviteUrl: INVITE_URL, ...extraBody }),
  })
  // NextRequest er en Request-subklasse; ruten bruker kun headers og json().
  return POST(request as never, { params: Promise.resolve({ slug: ORG_ID }) })
}

const addresses = (n: number) => Array.from({ length: n }, (_, i) => `ansatt${i}@bedrift.no`)

beforeEach(() => {
  state.org = { name: 'Elkjøp Nordic', created_at: daysAgo(0), subscription_status: 'trialing' }
  state.memberCount = 1
  state.usedToday = 0
  state.countError = null
  state.displayName = 'Dennis Busk'
  state.role = 'admin'
  state.sent = []
  state.logged = 0
})

test('ny org blokkeres over kvoten per kall — ingen e-post sendes', async () => {
  const res = await call(addresses(40))
  assert.equal(res.status, 400)
  assert.equal(state.sent.length, 0, 'ingen e-post skal ha gått ut')
  assert.match((await res.json()).error, /Maks 15/)
})

test('ny org innenfor kvoten sender, og forbruket bokføres', async () => {
  const res = await call(addresses(10))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).sent, 10)
  assert.equal(state.sent.length, 10)
  assert.equal(state.logged, 10, 'ett kvote-spor per sendt e-post')
})

test('døgnkvoten blokkerer når resten av dagen er brukt opp', async () => {
  state.usedToday = 35 // av 40
  const res = await call(addresses(10))
  assert.equal(res.status, 429)
  assert.equal(state.sent.length, 0)
  const json = await res.json()
  assert.equal(json.remaining, 5)
  assert.equal(json.dayLimit, 40)
})

test('resten av døgnkvoten kan fortsatt brukes', async () => {
  state.usedToday = 35
  const res = await call(addresses(5))
  assert.equal(res.status, 200)
  assert.equal(state.sent.length, 5)
})

test('Elkjøp (etablert) kan sende 50 som før — ingen regresjon', async () => {
  state.org = { name: 'Elkjøp Nordic', created_at: '2026-06-19T07:29:42.701198+00:00', subscription_status: 'trialing' }
  state.memberCount = 29

  const res = await call(addresses(50))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).sent, 50)
  assert.equal(state.sent.length, 50)
})

test('avsendernavnet hentes fra profilen, ikke fra request-body', async () => {
  await call(['en@bedrift.no'], { senderName: '<script>alert(1)</script>' })

  assert.equal(state.sent.length, 1)
  assert.equal(state.sent[0].subject, 'Dennis Busk inviterer deg til Quizkanonen')
  assert.ok(!state.sent[0].html.includes('<script'), 'body-navnet skal ikke nå malen')
  assert.ok(state.sent[0].html.includes('Dennis Busk'))
})

test('duplikate mottakere sendes kun én gang', async () => {
  const res = await call(Array(5).fill('samme@bedrift.no'))
  assert.equal(res.status, 200)
  assert.equal(state.sent.length, 1)
})

test('feilende telling blokkerer ny org — DB-feil er ingen omvei rundt kvoten', async () => {
  state.countError = { message: 'timeout' }

  const res = await call(addresses(10))
  assert.equal(res.status, 503)
  assert.equal(state.sent.length, 0)
})

test('feilende telling stopper ikke en etablert org', async () => {
  state.org = { name: 'Elkjøp Nordic', created_at: '2026-06-19T07:29:42.701198+00:00', subscription_status: 'trialing' }
  state.memberCount = 29
  state.countError = { message: 'timeout' }

  const res = await call(addresses(50))
  assert.equal(res.status, 200)
  assert.equal(state.sent.length, 50)
})

test('ikke-admin avvises før alt annet', async () => {
  state.role = 'member'
  const res = await call(addresses(1))
  assert.equal(res.status, 403)
  assert.equal(state.sent.length, 0)
})
