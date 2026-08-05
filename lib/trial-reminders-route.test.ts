// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av B2C-grenen i trial-reminders-cronen. To feil av samme
// klasse som F4 i notify-subscribers:
//   • ALLE mottakere gikk av gårde i ÉN Promise.allSettled — ingen batching,
//     så Resends grense på 10 forespørsler i sekundet kunne sprenges i ett jafs.
//   • `trial_reminder_sent_at` ble skrevet én gang, etter at alt var sendt. Et
//     tidsavbrudd stemplet da ingen, og neste kjøring sendte «X dager igjen»
//     på nytt til folk som alt hadde fått den.
//
// INGEN EKTE E-POST OG INGEN EKTE STRIPE: `lib/email` og `stripe` er mocket.
//
// MUTASJONSBEVIS: settes sendingen tilbake til én samlet Promise.allSettled
// med stempling etter, feiler «stemplingen skrives per batch» (1 skriving i
// stedet for 3). Fjernes `.is(trial_reminder_sent_at, null)` fra
// kandidatspørringen, feiler «alt påminnet bruker hoppes over».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const DAY = 86_400_000

type ProfileRow = {
  id: string
  personal_stripe_subscription_id: string | null
  premium_status: boolean
  premium_source: string | null
  trial_reminder_sent_at: string | null
}

const db: {
  profiles: ProfileRow[]
  subs: Record<string, { status: string; trial_end: number | null }>
  authEmails: Record<string, string>
  sentTo: string[]
  updates: string[][]
} = { profiles: [], subs: {}, authEmails: {}, sentTo: [], updates: [] }

// ── e-post ──────────────────────────────────────────────────────────────────
mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to }: { to: string }) => { db.sentTo.push(to); return { id: 'mock' } },
  },
})

// ── Stripe ──────────────────────────────────────────────────────────────────
class MockStripe {
  subscriptions = {
    retrieve: async (id: string) => {
      const s = db.subs[id]
      if (!s) throw new Error(`no such subscription: ${id}`)
      return { id, status: s.status, trial_end: s.trial_end }
    },
  }
}
mock.module('stripe', { defaultExport: MockStripe })

// Org-grenen er allerede korrekt (stempler per organisasjon inne i løkken) og
// er ikke det denne filen tester — den kortsluttes bort.
mock.module('@/lib/org-admin-emails', {
  namedExports: {
    getOrgAdminEmails: async () => ({ emails: [] }),
    sendToOrgAdmins: async () => ({ sent: 0 }),
  },
})
mock.module('@/lib/org-premium', {
  namedExports: { hasActiveOrgPremium: async () => false },
})

// ── Supabase ────────────────────────────────────────────────────────────────
function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let isNullCol: string | null = null
  let notNullCol: string | null = null
  let orExpr: string | null = null
  let inCol: string | null = null, inVals: string[] = []
  let updating: Record<string, string> | null = null

  const matchesOr = (row: Record<string, unknown>): boolean => {
    if (!orExpr) return true
    return orExpr.split(',').some(clause => {
      const [col, op, val] = clause.split('.')
      const cell = row[col]
      if (op === 'is' && val === 'null') return cell === null || cell === undefined
      if (op === 'eq') return cell === val
      if (op === 'neq') return cell !== val
      return false
    })
  }

  const rows = (): Record<string, unknown>[] => {
    // organizations returnerer tomt — org-grenen testes ikke her.
    const source: Record<string, unknown>[] =
      table === 'profiles' ? (db.profiles as unknown as Record<string, unknown>[]) : []

    return source.filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (isNullCol && r[isNullCol] !== null && r[isNullCol] !== undefined) return false
      if (notNullCol && (r[notNullCol] === null || r[notNullCol] === undefined)) return false
      if (!matchesOr(r)) return false
      if (inCol && !inVals.includes(String(r[inCol]))) return false
      return true
    })
  }

  const b = {
    select() { return b },
    update(patch: Record<string, string>) { updating = patch; return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    is(col: string) { isNullCol = col; return b },
    not(col: string) { notNullCol = col; return b },
    or(expr: string) { orExpr = expr; return b },
    gte() { return b },
    lte() { return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals; return b },
    then(resolve: (v: unknown) => void) {
      if (updating && table === 'profiles' && inCol) {
        db.updates.push([...inVals])
        for (const p of db.profiles) {
          if (inVals.includes(p.id)) p.trial_reminder_sent_at = updating.trial_reminder_sent_at
        }
        return resolve({ error: null })
      }
      return resolve({ data: rows(), error: null })
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

const routeModule = await import('@/app/api/cron/trial-reminders/route')
const { GET } = routeModule

function call(query = '') {
  const request = new Request(`https://quizkanonen.no/api/cron/trial-reminders${query}`, {
    headers: { authorization: 'Bearer test-cron-secret' },
  })
  return GET(request as never)
}

/** Kandidat med trial som slutter om 7 dager — midt i 6–8-dagersvinduet. */
function candidate(id: string, over: Partial<ProfileRow> = {}, daysLeft = 7) {
  const subId = `sub_${id}`
  db.profiles.push({
    id,
    personal_stripe_subscription_id: subId,
    premium_status: true,
    premium_source: 'founders',
    trial_reminder_sent_at: null,
    ...over,
  })
  db.subs[subId] = { status: 'trialing', trial_end: Math.floor((Date.now() + daysLeft * DAY) / 1000) }
  db.authEmails[id] = `${id}@example.com`
}

beforeEach(() => {
  db.profiles = []
  db.subs = {}
  db.authEmails = {}
  db.sentTo = []
  db.updates = []
})

test('ruten setter maxDuration eksplisitt', () => {
  assert.equal((routeModule as { maxDuration?: number }).maxDuration, 60)
})

test('trial som slutter om 7 dager gir påminnelse og stempling', async () => {
  candidate('a'); candidate('b')

  await call()

  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com'])
  assert.equal(db.profiles.every(p => p.trial_reminder_sent_at !== null), true)
})

test('alt påminnet bruker hoppes over', async () => {
  candidate('a', { trial_reminder_sent_at: new Date().toISOString() })
  candidate('b')

  await call()
  assert.deepEqual(db.sentTo, ['b@example.com'])
})

test('to kjøringer på rad gir nøyaktig én påminnelse per bruker', async () => {
  candidate('a'); candidate('b')

  await call()
  await call()

  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com'])
})

test('trial utenfor 6–8-dagersvinduet gir ingen påminnelse', async () => {
  candidate('for_tidlig', {}, 20)
  candidate('for_sent', {}, 2)
  candidate('midt_i', {}, 7)

  await call()
  assert.deepEqual(db.sentTo, ['midt_i@example.com'])
})

test('abonnement som ikke lenger er trialing gir ingen påminnelse', async () => {
  candidate('a')
  db.subs['sub_a'].status = 'active'

  await call()
  assert.deepEqual(db.sentTo, [])
})

test('dry-run sender ingenting og stempler ingenting', async () => {
  candidate('a'); candidate('b')

  const res = await call('?dry-run=1')
  const body = await res.json() as { dryRun: boolean; b2cWouldSend: number }

  assert.equal(body.dryRun, true)
  assert.equal(body.b2cWouldSend, 2)
  assert.deepEqual(db.sentTo, [], 'ingen e-post i dry-run')
  assert.deepEqual(db.updates, [], 'ingen stempling i dry-run')
})

test('stemplingen skrives per batch, ikke som én skriving til slutt', async () => {
  // 20 kandidater = 3 batcher (8/8/4). Med den gamle formen — én samlet
  // Promise.allSettled og stempling etter — ville dette vært 1 skriving.
  for (let i = 0; i < 20; i++) candidate(`s${i}`)

  await call()

  assert.equal(db.updates.length, 3, 'én skriving per batch')
  assert.deepEqual(db.updates.map(u => u.length), [8, 8, 4])
  assert.equal(db.sentTo.length, 20)
})
