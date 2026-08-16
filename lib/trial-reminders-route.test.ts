// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av trial-reminders-cronen — B2C-grenen og (fra 16. august)
// org-grenens stemplingsvilkår. To feil av samme klasse som F4 i
// notify-subscribers:
//   • ALLE mottakere gikk av gårde i ÉN Promise.allSettled — ingen batching,
//     så Resends grense på 10 forespørsler i sekundet kunne sprenges i ett jafs.
//   • `trial_reminder_sent_at` ble skrevet én gang, etter at alt var sendt. Et
//     tidsavbrudd stemplet da ingen, og neste kjøring sendte «X dager igjen»
//     på nytt til folk som alt hadde fått den.
//
// INGEN EKTE E-POST OG INGEN EKTE STRIPE: `lib/email` og `stripe` er mocket.
// Stripe-mocken simulerer nettverkslatens (STRIPE_LATENCY_MS per kall) og
// teller kall — det er det som gjør batch-mutasjonene målbare.
//
// MUTASJONSBEVIS: settes sendingen tilbake til én samlet Promise.allSettled
// med stempling etter, feiler «stemplingen skrives per batch» (1 skriving i
// stedet for 3). Fjernes `.is(trial_reminder_sent_at, null)` fra
// kandidatspørringen, feiler «alt påminnet bruker hoppes over».
//
// MUTASJONSBEVIS for batch-listekallet (16. august — kandidatfasen gjorde
// tidligere ett sekvensielt subscriptions.retrieve PER kandidat, som ved 58
// kandidater 8. august tok ~25–40 s og fikk cron-job.org til å deaktivere
// jobben som Timeout):
//   • Settes kandidatfasen tilbake til retrieve per kandidat, feiler
//     «58 kandidater …» både på kall-telleren (58 retrieve i stedet for
//     1 list) og på tidsmålingen (58 × latens ≫ 2 s).
//   • Fjernes has_more-løkken, feiler «paginering …»: med 120 trialing-
//     abonnementer ligger kandidat 101–120 på side 2 og forsvinner stille.
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

type OrgRow = {
  id: string
  name: string
  slug: string
  stripe_period_end: string | null
  subscription_status: string
  trial_reminder_sent_at: string | null
}

const db: {
  profiles: ProfileRow[]
  orgs: OrgRow[]
  subs: Record<string, { status: string; trial_end: number | null }>
  authEmails: Record<string, string>
  adminEmails: string[]
  failEmailsTo: string[]
  sentTo: string[]
  updates: string[][]
} = { profiles: [], orgs: [], subs: {}, authEmails: {}, adminEmails: [], failEmailsTo: [], sentTo: [], updates: [] }

// ── e-post ──────────────────────────────────────────────────────────────────
mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to }: { to: string }) => {
      if (db.failEmailsTo.includes(to)) throw new Error(`Resend 429 for ${to}`)
      db.sentTo.push(to)
      return { id: 'mock' }
    },
  },
})

// ── Stripe ──────────────────────────────────────────────────────────────────
// Simulert nettverkslatens per Stripe-kall. Uten den er et sekvensielt kall
// per kandidat like raskt som ett listekall i test, og batch-mutasjonen kan
// ikke felles med en tidsmåling. 150 ms er i underkant av de ~450–500 ms
// som ble målt mot ekte Stripe 16. august — konservativt nok til at testen
// ikke blir treg, stort nok til at 58 sekvensielle kall (8,7 s) rives.
const STRIPE_LATENCY_MS = 150
const stripeCalls = { list: 0, retrieve: 0 }
const stripeDelay = () => new Promise(resolve => setTimeout(resolve, STRIPE_LATENCY_MS))

class MockStripe {
  subscriptions = {
    // Beholdt med vilje, med samme latens og teller: en mutasjon tilbake til
    // retrieve-per-kandidat skal KOMPILERE og KJØRE — og så felles av
    // kall-telleren og tidsmålingen, ikke av en manglende mock.
    retrieve: async (id: string) => {
      stripeCalls.retrieve++
      await stripeDelay()
      const s = db.subs[id]
      if (!s) throw new Error(`no such subscription: ${id}`)
      return { id, status: s.status, trial_end: s.trial_end }
    },
    // Som ekte Stripe: default limit 10, maks 100, paginering via
    // starting_after/has_more. Insertion-rekkefølgen i db.subs er sidenes
    // rekkefølge — stabil, som Stripes kronologiske sortering.
    list: async (params: { status?: string; limit?: number; starting_after?: string } = {}) => {
      stripeCalls.list++
      await stripeDelay()
      const limit = Math.min(params.limit ?? 10, 100)
      const all = Object.entries(db.subs)
        .filter(([, s]) => !params.status || s.status === params.status)
        .map(([id, s]) => ({ id, status: s.status, trial_end: s.trial_end }))
      const start = params.starting_after
        ? all.findIndex(s => s.id === params.starting_after) + 1
        : 0
      const data = all.slice(start, start + limit)
      return { data, has_more: start + limit < all.length }
    },
  }
}
mock.module('stripe', { defaultExport: MockStripe })

// Org-grenen drives via db.orgs/db.adminEmails. sendToOrgAdmins delegerer til
// den EKTE sendEmailToMany (mot den mockede sendEmail over), slik at
// `delivered`-plumbingen som stemplingen avhenger av faktisk testes — en mock
// som fant på sitt eget delivered-svar ville bevist ingenting.
mock.module('@/lib/org-admin-emails', {
  namedExports: {
    getOrgAdminEmails: async () => ({ emails: [...db.adminEmails], orgName: 'Org', orgSlug: 'org' }),
    sendToOrgAdmins: async (emails: string[], message: { subject: string; html: string }, context: string) => {
      if (emails.length === 0) return { sent: 0, failed: 0, delivered: [] }
      const { sendEmailToMany } = await import('@/lib/send-email-many')
      return sendEmailToMany(emails, message, context)
    },
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
    const source: Record<string, unknown>[] =
      table === 'profiles' ? (db.profiles as unknown as Record<string, unknown>[])
      : table === 'organizations' ? (db.orgs as unknown as Record<string, unknown>[])
      : []

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
      if (updating && table === 'organizations' && typeof eqs.id === 'string') {
        for (const o of db.orgs) {
          if (o.id === eqs.id) o.trial_reminder_sent_at = updating.trial_reminder_sent_at
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

/** Org i påminnelsesvinduet (trialing, utløper om 1 dag, ikke påminnet). */
function orgCandidate(adminEmails: string[]) {
  db.orgs.push({
    id: 'org-1',
    name: 'Testorg',
    slug: 'testorg',
    stripe_period_end: new Date(Date.now() + DAY).toISOString(),
    subscription_status: 'trialing',
    trial_reminder_sent_at: null,
  })
  db.adminEmails = adminEmails
}

beforeEach(() => {
  db.profiles = []
  db.orgs = []
  db.subs = {}
  db.authEmails = {}
  db.adminEmails = []
  db.failEmailsTo = []
  db.sentTo = []
  db.updates = []
  stripeCalls.list = 0
  stripeCalls.retrieve = 0
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

test('58 kandidater (som 8. august): ett listekall, ingen retrieve, under 2 sekunder', async () => {
  // Scenarioet fra 8. august 2026: 58 kandidater i 6–8-dagersvinduet. Den
  // gamle kandidatfasen gjorde 58 sekvensielle retrieve (~25–40 s mot ekte
  // Stripe; 58 × 150 ms = 8,7 s mot mocken) — her skal den være ETT listekall.
  // Dry-run brukes med vilje: den stopper før dispatchInBatches, så målingen
  // er kandidatfasen alene, uten 1 s-pacingen mellom e-postbatcher.
  for (let i = 0; i < 58; i++) candidate(`p${i}`)

  const t0 = Date.now()
  const res = await call('?dry-run=1')
  const elapsed = Date.now() - t0
  const body = await res.json() as { b2cWouldSend: number }

  assert.equal(body.b2cWouldSend, 58, 'alle 58 står i vinduet og ville fått påminnelse')
  assert.equal(stripeCalls.list, 1, '58 abonnementer er én side — nøyaktig ett listekall')
  assert.equal(stripeCalls.retrieve, 0, 'ingen retrieve per kandidat')
  assert.ok(elapsed < 2_000, `kandidatfasen tok ${elapsed} ms — skal være under 2 s`)
})

// ── Org-grenen: stempling krever FULL leveranse (16. august 2026) ───────────
//
// MUTASJONSBEVIS: endres vilkåret i sendOrgTrialReminders tilbake til
// `delivered.length > 0` (eller gamle `okCount > 0`), feiler «delvis leveranse
// stempler ikke orgen» — orgen ville blitt stemplet med bare 2 av 3 admins
// varslet, og «neste kjøring tar hele orgen på nytt» ville funnet 0 kandidater.

test('full leveranse til alle admins stempler orgen', async () => {
  orgCandidate(['a1@org.test', 'a2@org.test', 'a3@org.test'])

  const res = await call()
  const body = await res.json() as { orgSent: number }

  assert.equal(body.orgSent, 1)
  assert.deepEqual(db.sentTo.sort(), ['a1@org.test', 'a2@org.test', 'a3@org.test'])
  assert.notEqual(db.orgs[0].trial_reminder_sent_at, null, 'orgen skal stemples ved full leveranse')
})

test('delvis leveranse stempler ikke orgen — neste kjøring tar den på nytt', async () => {
  orgCandidate(['a1@org.test', 'a2@org.test', 'a3@org.test'])
  db.failEmailsTo = ['a2@org.test']

  const res1 = await call()
  const body1 = await res1.json() as { orgSent: number }

  assert.equal(body1.orgSent, 0, 'delvis leveranse teller ikke som sendt')
  assert.deepEqual(db.sentTo.sort(), ['a1@org.test', 'a3@org.test'], '2 av 3 gikk gjennom')
  assert.equal(db.orgs[0].trial_reminder_sent_at, null, 'orgen skal IKKE stemples ved delvis leveranse')

  // Neste kjøring: Resend har friskmeldt seg. Hele orgen tas på nytt — a2 får
  // endelig e-posten, a1/a3 får et duplikat (den bevisste, billige feilen).
  db.failEmailsTo = []
  const res2 = await call()
  const body2 = await res2.json() as { orgSent: number }

  assert.equal(body2.orgSent, 1)
  assert.ok(db.sentTo.includes('a2@org.test'), 'den som feilet får e-posten ved neste kjøring')
  assert.notEqual(db.orgs[0].trial_reminder_sent_at, null, 'nå stemples orgen')
})

test('null leveranse stempler ikke orgen', async () => {
  orgCandidate(['a1@org.test', 'a2@org.test'])
  db.failEmailsTo = ['a1@org.test', 'a2@org.test']

  const res = await call()
  const body = await res.json() as { orgSent: number }

  assert.equal(body.orgSent, 0)
  assert.equal(db.orgs[0].trial_reminder_sent_at, null)
})

test('allerede stemplet org er ikke kandidat', async () => {
  orgCandidate(['a1@org.test'])
  db.orgs[0].trial_reminder_sent_at = new Date().toISOString()

  await call()
  assert.deepEqual(db.sentTo, [], 'ingen e-post til en stemplet org')
})

test('paginering: kandidater på side 2 (over 100 trialing-abonnementer) blir med', async () => {
  // Stripe leverer maks 100 per side. 120 trialing-abonnementer = 2 sider;
  // uten has_more-løkken forsvinner kandidat 101–120 stille — ingen feil,
  // ingen logg, bare 20 mottakere som aldri får påminnelsen.
  for (let i = 0; i < 120; i++) candidate(`p${String(i).padStart(3, '0')}`)

  const res = await call('?dry-run=1')
  const body = await res.json() as { b2cWouldSend: number }

  assert.equal(body.b2cWouldSend, 120, 'også kandidatene på side 2 er med')
  assert.equal(stripeCalls.list, 2, '120 abonnementer = nøyaktig to listekall')
})
