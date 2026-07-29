// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av executeScheduledRemovals + den delte removeOrgMemberById.
// `mock.module` bytter kun ut supabase-admin og e-postsending, så BEGGE
// funksjonene kjøres som i produksjon — inkludert at cronen faktisk går via den
// samme fjerningen som «Fjern nå» i panelet.
//
// Mocken implementerer filtrene ekte (.not/.lte/.eq), ikke bare signaturen.
// Uten det ville mutasjonsbeviset vært verdiløst: en mock som returnerer alle
// rader uansett ville gitt «bestått» også med filtrene fjernet.
//
// MUTASJONSBEVIS — begge verifisert ved å fjerne vakten midlertidig:
//
//   (a) Fjern `.lte('scheduled_removal_at', now)` i executeScheduledRemovals
//       → «planlagt i morgen fjernes IKKE i dag» feiler: removed blir 1, og
//         medlemsraden er faktisk slettet før datoen.
//   (b) Fjern `.not('scheduled_removal_at', 'is', null)`
//       → «avbrutt plan stopper cronen» feiler: et medlem uten plan fjernes.
//
// Se rapporten for kjøringene.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ORG_ID = '26e5126f-4c40-4588-9646-aa81d0c6a082'
const NOW = new Date('2026-07-29T03:30:00.000Z')

type MemberRow = {
  id: string
  organization_id: string
  user_id: string
  role: string
  scheduled_removal_at: string | null
}
type ProfileRow = {
  id: string
  premium_status: boolean
  personal_stripe_subscription_id: string | null
  org_premium_grace_until?: string | null
}

const db: {
  members: MemberRow[]
  profiles: ProfileRow[]
  sent: { to: string; subject: string }[]
  logged: string[]
} = { members: [], profiles: [], sent: [], logged: [] }

const member = (
  id: string, user_id: string, role: string, scheduled_removal_at: string | null,
): MemberRow => ({ id, organization_id: ORG_ID, user_id, role, scheduled_removal_at })

function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let notNullCol: string | null = null
  let lteCol: string | null = null
  let lteVal: string | null = null
  let counting = false
  let deleting = false
  let updating: Record<string, unknown> | null = null

  const rowsFor = (): Record<string, unknown>[] => {
    const source: Record<string, unknown>[] =
      table === 'organization_members' ? db.members as unknown as Record<string, unknown>[]
      : table === 'profiles' ? db.profiles as unknown as Record<string, unknown>[]
      : table === 'organizations' ? [{ id: ORG_ID, name: 'Elkjøp Nordic' }]
      : []

    return source.filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (notNullCol && (r[notNullCol] === null || r[notNullCol] === undefined)) return false
      if (lteCol && lteVal !== null) {
        const cell = r[lteCol]
        if (typeof cell !== 'string' || cell > lteVal) return false
      }
      return true
    })
  }

  const b = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      counting = opts?.count === 'exact'
      return b
    },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    // Kalles som .not(col, 'is', null) — de to siste ignoreres, samme grep som
    // de andre rute-testene bruker (JS dropper ekstra argumenter).
    not(col: string) { notNullCol = col; return b },
    lte(col: string, val: string) { lteCol = col; lteVal = val; return b },
    order() { return b },
    limit() { return b },
    delete() { deleting = true; return b },
    update(patch: Record<string, unknown>) { updating = patch; return b },
    insert(row: Record<string, unknown>) {
      if (table === 'admin_actions') db.logged.push(String(row.action_type))
      return Promise.resolve({ error: null })
    },
    maybeSingle() {
      const hit = rowsFor()[0] ?? null
      return Promise.resolve({ data: hit, error: null })
    },
    then(resolve: (v: unknown) => void) {
      const hits = rowsFor()
      if (deleting) {
        if (table === 'organization_members') {
          db.members = db.members.filter(m => !hits.includes(m as unknown as Record<string, unknown>))
        }
        return resolve({ data: hits.map(h => ({ id: h.id })), error: null })
      }
      if (updating) {
        for (const h of hits) Object.assign(h, updating)
        return resolve({ data: hits.map(h => ({ id: h.id })), error: null })
      }
      if (counting) return resolve({ count: hits.length, error: null })
      return resolve({ data: hits, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        admin: {
          getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@bedrift.no` } } }),
        },
      },
      from: (table: string) => builder(table),
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (opts: { to: string; subject: string }) => { db.sent.push(opts) },
  },
})

const { executeScheduledRemovals } = await import('@/lib/org-member-removal')

const exists = (userId: string) => db.members.some(m => m.user_id === userId)
const grace = (userId: string) => db.profiles.find(p => p.id === userId)?.org_premium_grace_until ?? null

beforeEach(() => {
  db.members = []
  db.profiles = []
  db.sent = []
  db.logged = []
})

// ── (a) Fjerning skjer IKKE før datoen ───────────────────────────────────────

test('MUTASJONSMÅL (a): planlagt i morgen fjernes IKKE i dag', async () => {
  db.members = [
    member('m1', 'admin-1', 'admin', null),
    member('m2', 'marius', 'member', '2026-07-30T00:00:00.000Z'), // i morgen
  ]
  db.profiles = [{ id: 'marius', premium_status: true, personal_stripe_subscription_id: null }]

  const run = await executeScheduledRemovals(NOW)

  assert.equal(run.due, 0, 'ingen rader skal være forfalt')
  assert.equal(run.removed, 0)
  assert.equal(exists('marius'), true, 'medlemmet skal fortsatt være med')
  assert.equal(db.sent.length, 0, 'ingen e-post før datoen')
  assert.equal(grace('marius'), null, 'ingen grace-periode før datoen')
})

test('planlagt langt fram i tid rører ingenting', async () => {
  db.members = [
    member('m1', 'admin-1', 'admin', null),
    member('m2', 'marius', 'member', '2027-01-01T00:00:00.000Z'),
  ]
  const run = await executeScheduledRemovals(NOW)
  assert.equal(run.due, 0)
  assert.equal(exists('marius'), true)
})

test('planlagt i dag fjernes — grensen er inklusiv', async () => {
  db.members = [
    member('m1', 'admin-1', 'admin', null),
    member('m2', 'marius', 'member', '2026-07-29T00:00:00.000Z'), // i dag, før kjøretid
  ]
  db.profiles = [{ id: 'marius', premium_status: true, personal_stripe_subscription_id: null }]

  const run = await executeScheduledRemovals(NOW)

  assert.equal(run.due, 1)
  assert.equal(run.removed, 1)
  assert.equal(exists('marius'), false)
})

// ── (b) Avbrutt plan stopper cronen ──────────────────────────────────────────

test('MUTASJONSMÅL (b): avbrutt plan (null) fjernes aldri', async () => {
  db.members = [
    member('m1', 'admin-1', 'admin', null),
    member('m2', 'marius', 'member', null), // planen ble avbrutt
  ]
  db.profiles = [{ id: 'marius', premium_status: true, personal_stripe_subscription_id: null }]

  const run = await executeScheduledRemovals(NOW)

  assert.equal(run.due, 0, 'en avbrutt plan skal ikke engang plukkes opp')
  assert.equal(run.removed, 0)
  assert.equal(exists('marius'), true, 'medlemmet skal være urørt')
  assert.equal(db.sent.length, 0)
})

test('avbrutt plan stopper fjerning selv når datoen for lengst har passert', async () => {
  db.members = [
    member('m1', 'admin-1', 'admin', null),
    member('m2', 'marius', 'member', null),
    member('m3', 'annen', 'member', '2026-07-01T00:00:00.000Z'), // forfalt, skal fjernes
  ]
  db.profiles = [
    { id: 'marius', premium_status: true, personal_stripe_subscription_id: null },
    { id: 'annen', premium_status: true, personal_stripe_subscription_id: null },
  ]

  const run = await executeScheduledRemovals(NOW)

  assert.equal(run.removed, 1)
  assert.equal(exists('marius'), true, 'den avbrutte skal stå igjen')
  assert.equal(exists('annen'), false, 'den forfalte skal være fjernet')
})

// ── Fjerningen går via den DELTE kodestien ───────────────────────────────────

test('grace-periode og e-post er identisk med manuell fjerning', async () => {
  db.members = [
    member('m1', 'admin-1', 'admin', null),
    member('m2', 'marius', 'member', '2026-07-28T00:00:00.000Z'),
  ]
  db.profiles = [{ id: 'marius', premium_status: true, personal_stripe_subscription_id: null }]

  await executeScheduledRemovals(NOW)

  assert.equal(db.sent.length, 1, 'samme e-post som ved manuell fjerning')
  assert.match(db.sent[0].subject, /Du er fjernet fra Elkjøp Nordic/)
  assert.ok(grace('marius'), 'grace-periode skal være satt')
  const dager = (new Date(grace('marius')!).getTime() - Date.now()) / 86_400_000
  assert.ok(dager > 6.9 && dager < 7.1, `grace skal være 7 dager, var ${dager}`)
})

test('medlem med eget abonnement får ingen grace-periode', async () => {
  db.members = [
    member('m1', 'admin-1', 'admin', null),
    member('m2', 'betaler', 'member', '2026-07-28T00:00:00.000Z'),
  ]
  db.profiles = [{ id: 'betaler', premium_status: true, personal_stripe_subscription_id: 'sub_123' }]

  await executeScheduledRemovals(NOW)

  assert.equal(exists('betaler'), false)
  assert.equal(grace('betaler'), null, 'egen Premium skal ikke røres')
})

test('utført fjerning bokføres i admin_actions', async () => {
  db.members = [
    member('m1', 'admin-1', 'admin', null),
    member('m2', 'marius', 'member', '2026-07-28T00:00:00.000Z'),
  ]
  db.profiles = [{ id: 'marius', premium_status: true, personal_stripe_subscription_id: null }]

  await executeScheduledRemovals(NOW)
  assert.deepEqual(db.logged, ['org_member_removal_executed'])
})

// ── Siste-admin-vakten ───────────────────────────────────────────────────────

test('SPERRE: cronen fjerner ikke den siste admin-en', async () => {
  // Scenariet: to admins, den ene planlegges fjernet, den andre melder seg ut
  // selv før datoen (/api/org/[slug]/leave). Uten vakten står orgen igjen uten
  // administrator.
  db.members = [
    member('m1', 'siste-admin', 'admin', '2026-07-28T00:00:00.000Z'),
    member('m2', 'ansatt', 'member', null),
  ]
  db.profiles = [{ id: 'siste-admin', premium_status: true, personal_stripe_subscription_id: null }]

  const run = await executeScheduledRemovals(NOW)

  assert.equal(run.due, 1)
  assert.equal(run.removed, 0)
  assert.equal(run.skippedLastAdmin, 1)
  assert.equal(exists('siste-admin'), true, 'orgen skal aldri bli stående uten admin')
  assert.equal(db.sent.length, 0, 'ingen «du er fjernet»-e-post for noe som ikke skjedde')
})

test('admin fjernes når en annen admin blir igjen', async () => {
  db.members = [
    member('m1', 'admin-a', 'admin', '2026-07-28T00:00:00.000Z'),
    member('m2', 'admin-b', 'admin', null),
  ]
  db.profiles = [{ id: 'admin-a', premium_status: true, personal_stripe_subscription_id: null }]

  const run = await executeScheduledRemovals(NOW)

  assert.equal(run.removed, 1)
  assert.equal(run.skippedLastAdmin, 0)
  assert.equal(exists('admin-a'), false)
})

// ── Robusthet ────────────────────────────────────────────────────────────────

test('flere forfalte fjerninger i samme kjøring håndteres hver for seg', async () => {
  db.members = [
    member('m0', 'admin-1', 'admin', null),
    member('m1', 'en', 'member', '2026-07-20T00:00:00.000Z'),
    member('m2', 'to', 'member', '2026-07-25T00:00:00.000Z'),
    member('m3', 'tre', 'member', '2026-08-15T00:00:00.000Z'), // ikke forfalt
  ]
  db.profiles = [
    { id: 'en', premium_status: true, personal_stripe_subscription_id: null },
    { id: 'to', premium_status: false, personal_stripe_subscription_id: null },
  ]

  const run = await executeScheduledRemovals(NOW)

  assert.equal(run.due, 2)
  assert.equal(run.removed, 2)
  assert.equal(exists('tre'), true, 'framtidig plan skal stå urørt')
})

test('tom kjøring gjør ingenting og rapporterer null', async () => {
  db.members = [member('m1', 'admin-1', 'admin', null)]
  const run = await executeScheduledRemovals(NOW)
  assert.deepEqual(
    { due: run.due, removed: run.removed, failed: run.failed },
    { due: 0, removed: 0, failed: 0 },
  )
})
