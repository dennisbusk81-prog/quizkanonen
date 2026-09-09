// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// getOrgCoverage() gjorde fram til 9. september 2026 «kunne ikke lese» om til
// «har ingen org-dekning» — tre lesinger uten error-sjekk, uten logglinje.
// Svaret gikk videre gjennom getPremiumState() til syncPremiumCache(), som
// skrev premium_status=false på et medlem bedriften faktisk dekker. Kallerne
// har alle et «kunne ikke avgjøre → hopp over»-vern, men det aktiveres KUN av
// et kast.
//
// To lag her, med vilje:
//   1. Enhetstester av getOrgCoverage/hasActiveOrgPremium mot en fake
//      supabaseAdmin: feil kaster, null rader gir «ingen dekning», dekning
//      gir dekning.
//   2. INTEGRASJONSTEST av den EKTE /api/cron/expire-code-premium-ruten, med
//      ekte lib/premium-state-io og ekte lib/org-premium — kun
//      supabase-admin og e-post er mocket. Den beviser at kastet faktisk når
//      fram til rutens vern, og at cachen IKKE skrives. Kontrolltesten ved
//      siden av beviser at faken ville registrert en skriving hvis den kom —
//      ellers er «ingen skriving» et tomt utsagn.
//
// MUTASJONSBEVIS: fjernes `if (membershipError) throw …` i getOrgCoverage,
// blir «lesefeil på organization_members kaster» rød OG «cron: lesefeil på
// organization_members → cachen skrives IKKE» rød (ruten skriver
// premium_status=false på begge kandidatene). Bekreftet 9. september 2026.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

type Row = Record<string, unknown>

const IN_FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString()
const IN_PAST = new Date(Date.now() - 3 * 86_400_000).toISOString()

const db: {
  profiles: Row[]
  members: Row[]
  orgs: Row[]
  redemptions: Row[]
  /** Tabell hvis LESING skal svare med error. Skrivinger rammes ikke. */
  failRead: string | null
  /** Alle UPDATE-kall faken har mottatt — det er disse som ikke skal skje. */
  updates: Array<{ table: string; values: Row; id: unknown }>
  authEmails: Record<string, string>
  sentTo: string[]
} = {
  profiles: [], members: [], orgs: [], redemptions: [],
  failRead: null, updates: [], authEmails: {}, sentTo: [],
}

function source(table: string): Row[] {
  switch (table) {
    case 'profiles': return db.profiles
    case 'organization_members': return db.members
    case 'organizations': return db.orgs
    case 'access_code_redemptions': return db.redemptions
    default: throw new Error(`faken kjenner ikke tabellen ${table}`)
  }
}

// Kjedbar builder som speiler filtrene org-premium, premium-state-io og
// expire-code-premium faktisk bruker. ISO-strenger sammenlignes leksikalsk,
// som Postgres gjør for timestamptz i samme sone.
function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let single = false
  let update: Row | null = null
  let idFilter: unknown = undefined

  const run = () => {
    if (update) {
      db.updates.push({ table, values: update, id: idFilter })
      return { data: null, error: null }
    }
    if (db.failRead === table) {
      return { data: null, error: { code: '57P01', message: `simulert lesefeil på ${table}` } }
    }
    const rows = source(table).filter(r => filters.every(f => f(r)))
    return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) {
      if (col === 'id') idFilter = val
      filters.push(r => r[col] === val)
      return b
    },
    in(col: string, vals: unknown[]) { filters.push(r => vals.includes(r[col])); return b },
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) filters.push(r => r[col] != null)
      return b
    },
    lt(col: string, val: string) { filters.push(r => r[col] != null && (r[col] as string) < val); return b },
    gt(col: string, val: string) { filters.push(r => r[col] != null && (r[col] as string) > val); return b },
    order() { return b },
    limit() { return b },
    maybeSingle() { single = true; return b },
    update(values: Row) { update = values; return b },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve, reject)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      auth: {
        admin: {
          getUserById: async (id: string) => ({
            data: { user: db.authEmails[id] ? { id, email: db.authEmails[id] } : null },
          }),
        },
      },
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to }: { to: string }) => { db.sentTo.push(to); return { id: 'mock' } },
  },
})

const { getOrgCoverage, hasActiveOrgPremium } = await import('./org-premium')
const { GET } = await import('@/app/api/cron/expire-code-premium/route')

beforeEach(() => {
  db.profiles = []
  db.members = []
  db.orgs = []
  db.redemptions = []
  db.failRead = null
  db.updates = []
  db.authEmails = {}
  db.sentTo = []
})

function seedCoveredMember(userId: string, orgId = 'org-1', name = 'Elkjøp Nordic') {
  db.profiles.push({ id: userId, org_premium_grace_until: null, stripe_customer_id: null, personal_grace_until: null })
  db.members.push({ user_id: userId, organization_id: orgId })
  db.orgs.push({ id: orgId, name, subscription_status: 'trialing', member_grace_until: null })
}

// ── 1. Enhetstester ─────────────────────────────────────────────────────────

test('lesing gir dekning → orgIds og orgNames, som i dag', async () => {
  seedCoveredMember('u-1')
  const c = await getOrgCoverage('u-1')
  assert.deepEqual(c, { orgIds: ['org-1'], orgNames: ['Elkjøp Nordic'], graceUntil: null })
  assert.equal(await hasActiveOrgPremium('u-1'), true)
})

test('lesing gir null rader → «ingen org-dekning», som i dag — ikke et kast', async () => {
  db.profiles.push({ id: 'u-2', org_premium_grace_until: null })
  const c = await getOrgCoverage('u-2')
  assert.deepEqual(c, { orgIds: [], orgNames: [], graceUntil: null })
  assert.equal(await hasActiveOrgPremium('u-2'), false)
})

test('medlem av org som ikke er active/trialing → ingen dekning, ikke et kast', async () => {
  db.profiles.push({ id: 'u-3', org_premium_grace_until: null })
  db.members.push({ user_id: 'u-3', organization_id: 'org-c' })
  db.orgs.push({ id: 'org-c', name: 'Kansellert AS', subscription_status: 'canceled', member_grace_until: null })
  const c = await getOrgCoverage('u-3')
  assert.deepEqual(c, { orgIds: [], orgNames: [], graceUntil: null })
})

test('profil uten rad (maybeSingle → null) er ikke en feil', async () => {
  const c = await getOrgCoverage('finnes-ikke')
  assert.deepEqual(c, { orgIds: [], orgNames: [], graceUntil: null })
})

test('profil-grace i framtiden teller som dekning', async () => {
  db.profiles.push({ id: 'u-4', org_premium_grace_until: IN_FUTURE })
  assert.equal(await hasActiveOrgPremium('u-4'), true)
  db.profiles[0].org_premium_grace_until = IN_PAST
  assert.equal(await hasActiveOrgPremium('u-4'), false)
})

for (const table of ['profiles', 'organization_members', 'organizations'] as const) {
  test(`lesefeil på ${table} kaster — og logges med [org-premium]`, async () => {
    seedCoveredMember('u-5')
    db.failRead = table
    const logged: unknown[][] = []
    const restore = mock.method(console, 'error', (...args: unknown[]) => { logged.push(args) })
    try {
      await assert.rejects(
        () => getOrgCoverage('u-5'),
        (err: unknown) => err instanceof Error && /\[org-premium\] kunne ikke lese/.test(err.message),
      )
      await assert.rejects(() => hasActiveOrgPremium('u-5'))
    } finally {
      restore.mock.restore()
    }
    assert.ok(
      logged.some(args => String(args[0]).startsWith('[org-premium] kunne ikke lese') && String(args[0]).includes('u-5')),
      `forventet en [org-premium]-logglinje med bruker-id, fikk: ${JSON.stringify(logged)}`,
    )
  })
}

// ── 2. Integrasjon: kastet når fram til vernet i expire-code-premium ────────

function cronRequest() {
  return new Request('http://localhost/api/cron/expire-code-premium', {
    headers: { authorization: 'Bearer test-cron-secret' },
  }) as unknown as import('next/server').NextRequest
}

function seedExpiredCodeCandidate(userId: string) {
  // Kandidat = premium via kode som er utløpt. Ingen Stripe-kunde, så
  // getStripeCoverage svarer null uten å røre Stripe.
  db.profiles.push({
    id: userId,
    premium_status: true,
    premium_source: 'code',
    premium_expires_at: IN_PAST,
    org_premium_grace_until: null,
    stripe_customer_id: null,
    personal_grace_until: null,
  })
  db.authEmails[userId] = `${userId}@example.com`
}

test('cron (kontroll): lesing lykkes → org-medlem beholder Premium, den andre mister — begge SKRIVES', async () => {
  seedExpiredCodeCandidate('dekket')
  db.members.push({ user_id: 'dekket', organization_id: 'org-1' })
  db.orgs.push({ id: 'org-1', name: 'Elkjøp Nordic', subscription_status: 'active', member_grace_until: null })
  seedExpiredCodeCandidate('udekket')

  const res = await GET(cronRequest())
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { expired: 1, keptViaOtherSource: 1, sent: 1 })

  const byId = Object.fromEntries(db.updates.map(u => [String(u.id), u.values]))
  assert.equal(byId['dekket']?.premium_status, true)
  assert.equal(byId['dekket']?.premium_source, 'org')
  assert.equal(byId['udekket']?.premium_status, false)
  assert.deepEqual(db.sentTo, ['udekket@example.com'])
})

test('cron: lesefeil på organization_members → syncPremiumCache hopper over ALLE, cachen skrives IKKE, ingen e-post', async () => {
  seedExpiredCodeCandidate('dekket')
  db.members.push({ user_id: 'dekket', organization_id: 'org-1' })
  db.orgs.push({ id: 'org-1', name: 'Elkjøp Nordic', subscription_status: 'active', member_grace_until: null })
  seedExpiredCodeCandidate('udekket')
  db.failRead = 'organization_members'

  const restore = mock.method(console, 'error', () => {})
  let res: Response
  try {
    res = await GET(cronRequest())
  } finally {
    restore.mock.restore()
  }

  // Ruten skal svare normalt — vernet er per bruker, ikke et 500.
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { expired: 0, keptViaOtherSource: 0, sent: 0 })

  // Selve poenget: ingen premium_status-skriving på NOEN av dem. Før fiksen
  // ble «dekket» skrevet til premium_status=false her.
  assert.deepEqual(db.updates, [])
  assert.deepEqual(db.sentTo, [])
})

test('cron: lesefeil på organizations → medlemmet hoppes over, IKKE-medlemmet gjøres opp som før', async () => {
  // Skillet «feilet» vs. «null rader» i praksis: brukeren uten medlemskap
  // returnerer FØR organizations leses, og skal fortsatt gjøres opp normalt.
  // Medlemmet treffer den feilende lesingen og skal ikke røres.
  seedExpiredCodeCandidate('dekket')
  db.members.push({ user_id: 'dekket', organization_id: 'org-1' })
  db.orgs.push({ id: 'org-1', name: 'Elkjøp Nordic', subscription_status: 'active', member_grace_until: null })
  seedExpiredCodeCandidate('udekket')
  db.failRead = 'organizations'

  const restore = mock.method(console, 'error', () => {})
  let res: Response
  try {
    res = await GET(cronRequest())
  } finally {
    restore.mock.restore()
  }

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { expired: 1, keptViaOtherSource: 0, sent: 1 })

  assert.deepEqual(db.updates.map(u => String(u.id)), ['udekket'])
  assert.equal(db.updates[0].values.premium_status, false)
  assert.deepEqual(db.sentTo, ['udekket@example.com'])
})
