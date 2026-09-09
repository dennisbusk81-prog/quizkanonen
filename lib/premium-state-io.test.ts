// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// getCodeCoverage() returnerte null ved LESEFEIL fram til 9. september 2026,
// begrunnet med at tabellen ikke fantes før migrasjonen var kjørt. Den har
// vært i prod siden 26. juli. Null der betydde «ingen verdikode» — checkout
// opprettet abonnement uten trial_end (rad E-vernet bortfalt stille), og
// syncPremiumCache kunne skrive premium_status=false på en kode-bruker.
//
// To lag, samme grep som lib/org-premium.test.ts:
//   1. Enhetstester av getCodeCoverage/getPremiumState (ekte) mot en fake
//      supabaseAdmin: lesefeil kaster, null rader gir null, dekning gir dekning.
//   2. INTEGRASJONSTEST av den EKTE /api/cron/expire-code-premium-ruten med
//      ekte premium-state-io og ekte org-premium — kastet skal nå rutens
//      «kunne ikke avgjøre → hopp over»-vern, og cachen skal IKKE skrives.
//      Kontrolltesten beviser at faken registrerer skrivinger når lesingen
//      lykkes.
//
// MUTASJONSBEVIS: gjeninnføres `return null` i error-grenen i getCodeCoverage,
// ryker «lesefeil kaster», «getPremiumState propagerer kastet» og
// «cron: lesefeil → cachen skrives IKKE» (ruten skriver da premium_status=false
// på begge kandidatene).
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

const { getCodeCoverage, getPremiumState } = await import('./premium-state-io')
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

function seedProfile(userId: string) {
  db.profiles.push({ id: userId, stripe_customer_id: null, org_premium_grace_until: null, personal_grace_until: null })
}

// ── 1. Enhetstester ─────────────────────────────────────────────────────────

test('aktiv innløsning → dekning med kodens utløp, som i dag', async () => {
  db.redemptions.push({ id: 'r1', code_id: 'c1', user_id: 'u-1', expires_at: IN_FUTURE, redeemed_at: IN_PAST })
  assert.deepEqual(await getCodeCoverage('u-1'), { redemptionId: 'r1', codeId: 'c1', expiresAt: IN_FUTURE })
})

test('null rader → null («ingen verdikode»), som i dag — ikke et kast', async () => {
  assert.equal(await getCodeCoverage('u-2'), null)
})

test('kun utløpte innløsninger → null, som i dag', async () => {
  db.redemptions.push({ id: 'r1', code_id: 'c1', user_id: 'u-3', expires_at: IN_PAST, redeemed_at: IN_PAST })
  assert.equal(await getCodeCoverage('u-3'), null)
})

test('lesefeil kaster — og logges med [premium-state] og bruker-id', async () => {
  db.failRead = 'access_code_redemptions'
  const logged: unknown[][] = []
  const restore = mock.method(console, 'error', (...args: unknown[]) => { logged.push(args) })
  try {
    await assert.rejects(
      () => getCodeCoverage('u-4'),
      (err: unknown) => err instanceof Error && /\[premium-state\] kunne ikke lese kode-innløsninger/.test(err.message),
    )
  } finally {
    restore.mock.restore()
  }
  assert.ok(
    logged.some(a => String(a[0]).startsWith('[premium-state] kunne ikke lese kode-innløsninger') && String(a[0]).includes('u-4')),
    `forventet logglinje med bruker-id, fikk: ${JSON.stringify(logged)}`,
  )
})

test('getPremiumState propagerer kastet — det er den redeem:142 og checkout møter', async () => {
  seedProfile('u-5')
  db.failRead = 'access_code_redemptions'
  const restore = mock.method(console, 'error', () => {})
  try {
    await assert.rejects(() => getPremiumState('u-5'))
  } finally {
    restore.mock.restore()
  }
})

test('getPremiumState uten innløsninger → ikke Premium, som i dag', async () => {
  seedProfile('u-6')
  const state = await getPremiumState('u-6')
  assert.equal(state.isPremium, false)
  assert.equal(state.sources.code, null)
})

// ── 2. Integrasjon: kastet når fram til vernet i expire-code-premium ────────

function cronRequest() {
  return new Request('http://localhost/api/cron/expire-code-premium', {
    headers: { authorization: 'Bearer test-cron-secret' },
  }) as unknown as import('next/server').NextRequest
}

function seedExpiredCodeCandidate(userId: string) {
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

test('cron (kontroll): lesing lykkes → kode-bruker med NY gyldig innløsning beholder, den andre mister — begge SKRIVES', async () => {
  seedExpiredCodeCandidate('stablet')
  // Cache-raden er utløpt, men en nyere innløsning gjelder fortsatt.
  db.redemptions.push({ id: 'r2', code_id: 'c2', user_id: 'stablet', expires_at: IN_FUTURE, redeemed_at: IN_PAST })
  seedExpiredCodeCandidate('udekket')

  const res = await GET(cronRequest())
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { expired: 1, keptViaOtherSource: 1, sent: 1 })

  const byId = Object.fromEntries(db.updates.map(u => [String(u.id), u.values]))
  assert.equal(byId['stablet']?.premium_status, true)
  assert.equal(byId['stablet']?.premium_source, 'code')
  assert.equal(byId['udekket']?.premium_status, false)
  assert.deepEqual(db.sentTo, ['udekket@example.com'])
})

test('cron: lesefeil på access_code_redemptions → hopper over ALLE, cachen skrives IKKE, ingen e-post', async () => {
  seedExpiredCodeCandidate('stablet')
  db.redemptions.push({ id: 'r2', code_id: 'c2', user_id: 'stablet', expires_at: IN_FUTURE, redeemed_at: IN_PAST })
  seedExpiredCodeCandidate('udekket')
  db.failRead = 'access_code_redemptions'

  const restore = mock.method(console, 'error', () => {})
  let res: Response
  try {
    res = await GET(cronRequest())
  } finally {
    restore.mock.restore()
  }

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { expired: 0, keptViaOtherSource: 0, sent: 0 })
  // Før fiksen: begge skrevet til premium_status=false — også «stablet», som
  // har en gyldig kode.
  assert.deepEqual(db.updates, [])
  assert.deepEqual(db.sentTo, [])
})
