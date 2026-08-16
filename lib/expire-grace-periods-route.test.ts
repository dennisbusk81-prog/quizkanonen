// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av /api/cron/expire-grace-periods, med fokus på
// delvis-suksess-stempling (16. august 2026). To feilklasser rettes:
//
//   • remindOrgGrace stemplet `member_grace_reminded_at` så snart NOE var
//     sendt — admin-grenen satte til og med flagget uten å se på resultatet.
//     Én forsøkt admin-e-post stemplet bort ansatte som fikk 429.
//   • Profil-/org-grace nullstilte grace-feltet FØR e-posten ble sendt. En
//     feilet sending kunne da aldri tas igjen: brukeren mistet Premium uten
//     beskjed, for alltid, uten loggspor utover én console.error.
//
// INGEN EKTE E-POST, STRIPE ELLER DB: `lib/email`, `lib/premium-state-io`,
// `lib/org-lock-notify`, `lib/org-admin-emails` (delvis) og
// `lib/supabase-admin` er mocket. `lib/send-email-many` og
// `lib/org-lock-grace` kjører EKTE — det er `delivered`-plumbingen og
// vindus-logikken som skal bevises, ikke mockes.
//
// MUTASJONSBEVIS:
//   • Settes remindOrgGrace tilbake til «stemple hvis noe ble sendt»
//     (allDelivered fjernes), feiler «én feilende ansatt-e-post hindrer
//     stempling» og «admin-e-poster som alle feiler hindrer stempling».
//   • Settes expireProfileGrace tilbake til «nullstill markøren først»,
//     feiler «feilet avslutnings-e-post lar markøren stå» — og
//     retry-halvdelen av samme test beviser at neste kjøring faktisk
//     leverer (den gamle formen fant 0 kandidater i kjøring 2).
//   • Fjernes `premium_status`-uavhengigheten (filteret gjeninnføres),
//     feiler samme retry-halvdel: brukeren er nedgradert etter kjøring 1
//     og ville vært usynlig for kjøring 2.
//   • Settes expireOrgGrace tilbake til «rydd stempelet først», feiler
//     «feilet medlems-e-post lar org-stempelet stå».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

const DAY = 86_400_000

type ProfileRow = { id: string; org_premium_grace_until: string | null }
type OrgRow = {
  id: string
  name: string | null
  slug: string | null
  subscription_status: string
  member_grace_until: string | null
  member_grace_reason: string | null
  member_grace_reminded_at: string | null
}

const db: {
  profiles: ProfileRow[]
  orgs: OrgRow[]
  members: Record<string, string[]>
  membersError: boolean
  authEmails: Record<string, string | null>
  sentTo: Array<{ to: string; subject: string }>
  failEmailsTo: string[]
  premiumKept: string[]
  syncFail: string[]
  synced: string[]
  memberLookup: { memberCount: number; emails: string[] } | null | 'fail'
  adminEmails: string[]
} = {
  profiles: [], orgs: [], members: {}, membersError: false, authEmails: {},
  sentTo: [], failEmailsTo: [], premiumKept: [], syncFail: [], synced: [],
  memberLookup: { memberCount: 0, emails: [] }, adminEmails: [],
}

// ── e-post ──────────────────────────────────────────────────────────────────
mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to, subject }: { to: string; subject: string }) => {
      if (db.failEmailsTo.includes(to)) throw new Error(`Resend 429 for ${to}`)
      db.sentTo.push({ to, subject })
      return { id: 'mock' }
    },
  },
})

// ── Premium-rekalkulering ───────────────────────────────────────────────────
mock.module('@/lib/premium-state-io', {
  namedExports: {
    syncPremiumCache: async (id: string) => {
      if (db.syncFail.includes(id)) throw new Error(`stripe nede for ${id}`)
      db.synced.push(id)
      return { isPremium: db.premiumKept.includes(id) }
    },
  },
})

// ── Mottaker-oppslag ────────────────────────────────────────────────────────
mock.module('@/lib/org-lock-notify', {
  namedExports: {
    getOrgMemberEmails: async () => {
      if (db.memberLookup === 'fail') return null
      return db.memberLookup
    },
  },
})

// sendToOrgAdmins delegerer til den EKTE sendEmailToMany, slik at
// delivered-plumbingen testes ende til ende — samme grep som i
// trial-reminders-route.test.ts.
mock.module('@/lib/org-admin-emails', {
  namedExports: {
    getOrgAdminEmails: async () => ({
      emails: [...db.adminEmails],
      orgName: db.orgs[0]?.name ?? null,
      orgSlug: db.orgs[0]?.slug ?? null,
    }),
    sendToOrgAdmins: async (emails: string[], message: { subject: string; html: string }, context: string) => {
      if (emails.length === 0) return { sent: 0, failed: 0, delivered: [] }
      const { sendEmailToMany } = await import('@/lib/send-email-many')
      return sendEmailToMany(emails, message, context)
    },
  },
})

// ── Supabase ────────────────────────────────────────────────────────────────
function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let notNullCol: string | null = null
  let ltCol: string | null = null, ltVal = ''
  let inCol: string | null = null, inVals: string[] = []
  let updating: Record<string, unknown> | null = null

  const rows = (): Record<string, unknown>[] => {
    const source: Record<string, unknown>[] =
      table === 'profiles' ? (db.profiles as unknown as Record<string, unknown>[])
      : table === 'organizations' ? (db.orgs as unknown as Record<string, unknown>[])
      : table === 'organization_members'
        ? (db.members[String(eqs.organization_id)] ?? []).map(user_id => ({ user_id }))
      : []

    return source.filter(r => {
      for (const [k, v] of Object.entries(eqs)) {
        if (k === 'organization_id') continue
        if (r[k] !== v) return false
      }
      if (notNullCol && (r[notNullCol] === null || r[notNullCol] === undefined)) return false
      if (ltCol && !(typeof r[ltCol] === 'string' && String(r[ltCol]) < ltVal)) return false
      if (inCol && !inVals.includes(String(r[inCol]))) return false
      return true
    })
  }

  const b = {
    select() { return b },
    update(patch: Record<string, unknown>) { updating = patch; return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    not(col: string) { notNullCol = col; return b },
    lt(col: string, val: string) { ltCol = col; ltVal = val; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals; return b },
    then(resolve: (v: unknown) => void) {
      if (table === 'organization_members' && db.membersError) {
        return resolve({ data: null, error: { message: 'members boom' } })
      }
      if (updating && table === 'profiles' && inCol) {
        for (const p of db.profiles) {
          if (inVals.includes(p.id)) {
            p.org_premium_grace_until = updating.org_premium_grace_until as string | null
          }
        }
        return resolve({ error: null })
      }
      if (updating && table === 'organizations' && typeof eqs.id === 'string') {
        const org = db.orgs.find(o => o.id === eqs.id)
        if (org) Object.assign(org, updating)
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

const { GET } = await import('@/app/api/cron/expire-grace-periods/route')

function call() {
  const request = new Request('https://quizkanonen.no/api/cron/expire-grace-periods', {
    headers: { authorization: 'Bearer test-cron-secret' },
  })
  return GET(request as never)
}

/** Profil med grace som utløp for `daysAgo` dager siden. */
function graceProfile(id: string, daysAgo = 1) {
  db.profiles.push({ id, org_premium_grace_until: new Date(Date.now() - daysAgo * DAY).toISOString() })
  db.authEmails[id] = `${id}@example.com`
}

/** Låst org. `graceInDays` > 0 = i påminnelsesvinduet; < 0 = utløpt. */
function lockedOrg(graceInDays: number, over: Partial<OrgRow> = {}) {
  db.orgs.push({
    id: 'org-1',
    name: 'Testorg',
    slug: 'testorg',
    subscription_status: 'locked',
    member_grace_until: new Date(Date.now() + graceInDays * DAY).toISOString(),
    member_grace_reason: 'trial_expired',
    member_grace_reminded_at: null,
    ...over,
  })
}

const graceEndedTo = () => db.sentTo.filter(s => s.subject === 'Premium-tilgangen din er avsluttet').map(s => s.to)

beforeEach(() => {
  db.profiles = []
  db.orgs = []
  db.members = {}
  db.membersError = false
  db.authEmails = {}
  db.sentTo = []
  db.failEmailsTo = []
  db.premiumKept = []
  db.syncFail = []
  db.synced = []
  db.memberLookup = { memberCount: 0, emails: [] }
  db.adminEmails = []
})

// ── Profil-grace: markøren ryddes ETTER bekreftet leveranse ─────────────────

test('mistet Premium: nedgradert, varslet, markør ryddet', async () => {
  graceProfile('u1')

  const res = await call()
  const body = await res.json() as { profileGrace: { expired: number; sent: number } }

  assert.deepEqual(db.synced, ['u1'], 'premium rekalkuleres')
  assert.deepEqual(graceEndedTo(), ['u1@example.com'])
  assert.equal(db.profiles[0].org_premium_grace_until, null, 'markøren ryddes etter levert e-post')
  assert.equal(body.profileGrace.expired, 1)
  assert.equal(body.profileGrace.sent, 1)
})

test('feilet avslutnings-e-post lar markøren stå — og neste kjøring leverer', async () => {
  graceProfile('u1')
  db.failEmailsTo = ['u1@example.com']

  const res1 = await call()
  const body1 = await res1.json() as { profileGrace: { sent: number; emailFailed: number } }

  assert.deepEqual(db.synced, ['u1'], 'nedgraderingen venter ALDRI på e-posten')
  assert.notEqual(db.profiles[0].org_premium_grace_until, null, 'markøren står når sendingen feiler')
  assert.equal(body1.profileGrace.emailFailed, 1)
  assert.equal(body1.profileGrace.sent, 0)

  // Neste kjøring: brukeren er allerede premium_status=false (nedgradert i
  // kjøring 1) — kandidatspørringen må se raden likevel, ellers finnes ingen
  // retry. Resend er friskmeldt.
  db.failEmailsTo = []
  await call()

  assert.deepEqual(graceEndedTo(), ['u1@example.com'], 'e-posten leveres ved neste kjøring')
  assert.equal(db.profiles[0].org_premium_grace_until, null, 'og først DA ryddes markøren')
})

test('beholdt via annen kilde: markør ryddet, ingen e-post', async () => {
  graceProfile('u1')
  db.premiumKept = ['u1']

  const res = await call()
  const body = await res.json() as { profileGrace: { keptViaOtherSource: number } }

  assert.deepEqual(graceEndedTo(), [], 'ingen avslutnings-e-post til en som beholdt Premium')
  assert.equal(db.profiles[0].org_premium_grace_until, null)
  assert.equal(body.profileGrace.keptViaOtherSource, 1)
})

test('urgammel markør (eldre enn 14 dager) ryddes uten e-post', async () => {
  graceProfile('u1', 20)

  const res = await call()
  const body = await res.json() as { profileGrace: { clearedWithoutEmail: number; sent: number } }

  assert.deepEqual(graceEndedTo(), [], '«tilgangen din er avsluttet» tre uker på etterskudd sendes ikke')
  assert.equal(db.profiles[0].org_premium_grace_until, null)
  assert.equal(body.profileGrace.clearedWithoutEmail, 1)
  assert.equal(body.profileGrace.sent, 0)
})

test('bruker uten e-postadresse ryddes — en retry kan aldri levere', async () => {
  graceProfile('u1')
  db.authEmails.u1 = null

  await call()

  assert.deepEqual(graceEndedTo(), [])
  assert.equal(db.profiles[0].org_premium_grace_until, null, 'uleverbar mottaker holder ikke markøren åpen')
})

test('feilet rekalkulering lar markøren stå urørt', async () => {
  graceProfile('u1')
  db.syncFail = ['u1']

  await call()

  assert.deepEqual(graceEndedTo(), [], 'ingen e-post når tilstanden er ukjent')
  assert.notEqual(db.profiles[0].org_premium_grace_until, null, 'markøren står — neste kjøring prøver igjen')
})

// ── remindOrgGrace: stempling krever FULL leveranse ─────────────────────────

test('full leveranse (ansatte + admins) stempler påminnelsen', async () => {
  lockedOrg(1)
  db.memberLookup = { memberCount: 2, emails: ['ansatt1@org.test', 'ansatt2@org.test'] }
  db.adminEmails = ['admin@org.test']

  const res = await call()
  const body = await res.json() as { orgGrace: { reminded: number } }

  assert.equal(db.sentTo.length, 3)
  assert.notEqual(db.orgs[0].member_grace_reminded_at, null, 'stemples ved full leveranse')
  assert.equal(body.orgGrace.reminded, 1)
})

test('én feilende ansatt-e-post hindrer stempling — hele orgen tas på nytt', async () => {
  lockedOrg(1)
  db.memberLookup = { memberCount: 2, emails: ['ansatt1@org.test', 'ansatt2@org.test'] }
  db.adminEmails = ['admin@org.test']
  db.failEmailsTo = ['ansatt2@org.test']

  const res1 = await call()
  const body1 = await res1.json() as { orgGrace: { reminded: number } }

  assert.equal(body1.orgGrace.reminded, 0)
  assert.equal(db.orgs[0].member_grace_reminded_at, null,
    'admin-leveransen alene skal IKKE stemple bort en ansatt som fikk 429')

  db.failEmailsTo = []
  await call()

  assert.ok(db.sentTo.some(s => s.to === 'ansatt2@org.test'), 'den som feilet nås ved neste kjøring')
  assert.notEqual(db.orgs[0].member_grace_reminded_at, null)
})

test('admin-e-poster som alle feiler hindrer stempling', async () => {
  // Den gamle koden satte anythingSent = true UTEN å se på resultatet av
  // sendToOrgAdmins — selv null leverte admin-e-poster stemplet orgen.
  lockedOrg(1)
  db.memberLookup = { memberCount: 1, emails: ['ansatt1@org.test'] }
  db.adminEmails = ['admin@org.test']
  db.failEmailsTo = ['admin@org.test']

  await call()

  assert.equal(db.orgs[0].member_grace_reminded_at, null,
    'levert ansatt-e-post + feilet admin-e-post skal ikke stemple')
})

test('org uten ordinære ansatte: full admin-leveranse stempler', async () => {
  lockedOrg(1)
  db.memberLookup = { memberCount: 0, emails: [] }
  db.adminEmails = ['admin@org.test']

  await call()

  assert.notEqual(db.orgs[0].member_grace_reminded_at, null, 'tom ansatt-gruppe blokkerer ikke')
})

// ── expireOrgGrace: stempelet ryddes SIST, etter oppgjort e-post ────────────

test('utløpt org-grace: medlemmer nedgradert, varslet, stempel ryddet', async () => {
  lockedOrg(-1)
  db.members['org-1'] = ['m1', 'm2']
  db.authEmails.m1 = 'm1@example.com'
  db.authEmails.m2 = 'm2@example.com'
  db.premiumKept = ['m2']

  const res = await call()
  const body = await res.json() as { orgGrace: { expiredOrgs: number; lostPremium: number; keptViaOtherSource: number } }

  assert.deepEqual(db.synced.sort(), ['m1', 'm2'])
  assert.deepEqual(graceEndedTo(), ['m1@example.com'], 'kun den som mistet Premium varsles')
  assert.equal(db.orgs[0].member_grace_until, null, 'stempelet ryddes når alt er gjort opp')
  assert.equal(body.orgGrace.expiredOrgs, 1)
  assert.equal(body.orgGrace.lostPremium, 1)
  assert.equal(body.orgGrace.keptViaOtherSource, 1)
})

test('feilet medlems-e-post lar org-stempelet stå — retry leverer, med duplikat som pris', async () => {
  lockedOrg(-1)
  db.members['org-1'] = ['m1', 'm2']
  db.authEmails.m1 = 'm1@example.com'
  db.authEmails.m2 = 'm2@example.com'
  db.failEmailsTo = ['m2@example.com']

  const res1 = await call()
  const body1 = await res1.json() as { orgGrace: { expiredOrgs: number; retrying: number } }

  assert.deepEqual(db.synced.sort(), ['m1', 'm2'], 'nedgraderingen venter aldri på e-posten')
  assert.notEqual(db.orgs[0].member_grace_until, null, 'stempelet står når en e-post feilet')
  assert.equal(body1.orgGrace.expiredOrgs, 0)
  assert.equal(body1.orgGrace.retrying, 1)

  db.failEmailsTo = []
  await call()

  assert.ok(graceEndedTo().includes('m2@example.com'), 'den som feilet nås ved neste kjøring')
  assert.equal(db.orgs[0].member_grace_until, null, 'og først DA ryddes stempelet')
  // Den dokumenterte prisen for Vei A: m1 fikk e-posten i begge kjøringene.
  assert.equal(graceEndedTo().filter(to => to === 'm1@example.com').length, 2,
    'duplikat til den leverte er den bevisste, billige feilen')
})

test('feilet medlemshenting: ingenting ryddes, org-en tas på nytt', async () => {
  lockedOrg(-1)
  db.membersError = true

  const res = await call()
  const body = await res.json() as { orgGrace: { expiredOrgs: number; retrying: number } }

  assert.notEqual(db.orgs[0].member_grace_until, null,
    'før 16. august var stempelet alt ryddet her — org-en falt stille ut')
  assert.equal(body.orgGrace.expiredOrgs, 0)
  assert.equal(body.orgGrace.retrying, 1)
})

test('org som ikke lenger er låst ryddes stille (uendret oppførsel)', async () => {
  lockedOrg(-1, { subscription_status: 'active' })

  const res = await call()
  const body = await res.json() as { orgGrace: { cleanedStale: number } }

  assert.equal(db.orgs[0].member_grace_until, null)
  assert.deepEqual(db.sentTo, [], 'ingen e-post for opprydding av foreldet stempel')
  assert.equal(body.orgGrace.cleanedStale, 1)
})
