// Kjøres med:  npm test
//
// Dekker at ALLE admins i en org mottar e-post — ikke bare den ene
// `.eq('role','admin').limit(1).maybeSingle()` tilfeldigvis plukket ut
// (29. juli 2026).
//
// MUTASJONSBEVIS (verifisert manuelt):
//   * Legges `.limit(1)`-oppførselen tilbake (kun første admin returneres),
//     feiler «alle admins får e-post …» med 1 mottaker i stedet for 3.
//   * Byttes Promise.allSettled i sendEmailToMany til Promise.all, feiler
//     «én feilende mottaker stopper ikke de andre».
//   * Svelges getUserById-feilen uten console.error, feiler «admin uten
//     e-postadresse logges».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ORG_ID = 'org-1'

const state: {
  admins: string[]
  org: { name: string; slug: string } | null
  membersError: { message: string } | null
  usersById: Record<string, { email: string | null } | null>
  rejectLookupFor: string[]
  failEmailsTo: string[]
  sent: Array<{ to: string; subject: string }>
  errors: string[]
} = {
  admins: [],
  org: null,
  membersError: null,
  usersById: {},
  rejectLookupFor: [],
  failEmailsTo: [],
  sent: [],
  errors: [],
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from(table: string) {
        const b = {
          select() { return b },
          eq() { return b },
          maybeSingle() {
            if (table === 'organizations') return Promise.resolve({ data: state.org, error: null })
            return Promise.resolve({ data: null, error: null })
          },
          then(resolve: (v: unknown) => void) {
            if (table !== 'organization_members') return resolve({ data: [], error: null })
            if (state.membersError) return resolve({ data: null, error: state.membersError })
            return resolve({ data: state.admins.map(user_id => ({ user_id })), error: null })
          },
        }
        return b
      },
      auth: {
        admin: {
          getUserById: async (id: string) => {
            if (state.rejectLookupFor.includes(id)) throw new Error(`auth nede for ${id}`)
            return { data: { user: state.usersById[id] ?? null } }
          },
        },
      },
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (opts: { to: string; subject: string }) => {
      if (state.failEmailsTo.includes(opts.to)) throw new Error(`Resend nede for ${opts.to}`)
      state.sent.push(opts)
    },
  },
})

const { getOrgAdminEmails, sendToOrgAdmins } = await import('@/lib/org-admin-emails')

const originalError = console.error
beforeEach(() => {
  state.admins = ['a1', 'a2', 'a3']
  state.org = { name: 'Elkjøp Nordic', slug: 'elkjop' }
  state.membersError = null
  state.usersById = {
    a1: { email: 'admin1@elkjop.test' },
    a2: { email: 'admin2@elkjop.test' },
    a3: { email: 'admin3@elkjop.test' },
  }
  state.rejectLookupFor = []
  state.failEmailsTo = []
  state.sent = []
  state.errors = []
  console.error = (...args: unknown[]) => { state.errors.push(args.map(String).join(' ')) }
})

function restoreConsole() { console.error = originalError }

// ── Kjernen: flere admins ──────────────────────────────────────────────────

test('alle admins får e-post — ikke bare den første', async () => {
  const { emails, orgName, orgSlug } = await getOrgAdminEmails(ORG_ID)
  await sendToOrgAdmins(emails, { subject: 'Test', html: '<p>x</p>' }, 'test')
  restoreConsole()

  assert.equal(emails.length, 3, 'alle tre admins skal returneres')
  assert.deepEqual(
    state.sent.map(s => s.to).sort(),
    ['admin1@elkjop.test', 'admin2@elkjop.test', 'admin3@elkjop.test'],
  )
  assert.equal(orgName, 'Elkjøp Nordic')
  assert.equal(orgSlug, 'elkjop')
})

test('én admin fungerer som før', async () => {
  state.admins = ['a1']
  const { emails } = await getOrgAdminEmails(ORG_ID)
  await sendToOrgAdmins(emails, { subject: 'Test', html: '<p>x</p>' }, 'test')
  restoreConsole()

  assert.deepEqual(state.sent.map(s => s.to), ['admin1@elkjop.test'])
})

test('én feilende mottaker stopper ikke de andre', async () => {
  state.failEmailsTo = ['admin2@elkjop.test']
  const { emails } = await getOrgAdminEmails(ORG_ID)
  const result = await sendToOrgAdmins(emails, { subject: 'Test', html: '<p>x</p>' }, 'test')
  restoreConsole()

  assert.equal(result.sent, 2)
  assert.equal(result.failed, 1)
  assert.deepEqual(state.sent.map(s => s.to).sort(), ['admin1@elkjop.test', 'admin3@elkjop.test'])
  assert.ok(state.errors.some(e => e.includes('sending feilet for admin2@elkjop.test')))
})

// ── Feilhåndtering: ingenting svelges ──────────────────────────────────────

test('admin uten e-postadresse logges og hoppes over', async () => {
  state.usersById.a2 = { email: null }
  const { emails } = await getOrgAdminEmails(ORG_ID)
  restoreConsole()

  assert.equal(emails.length, 2)
  assert.ok(state.errors.some(e => e.includes('a2') && e.includes('mangler e-postadresse')))
})

test('feilet getUserById logges og stopper ikke de andre', async () => {
  state.rejectLookupFor = ['a1']
  const { emails } = await getOrgAdminEmails(ORG_ID)
  restoreConsole()

  assert.deepEqual(emails.sort(), ['admin2@elkjop.test', 'admin3@elkjop.test'])
  assert.ok(state.errors.some(e => e.includes('getUserById feilet for a1')))
})

test('org uten admin i det hele tatt logges eksplisitt', async () => {
  state.admins = []
  const { emails, orgName } = await getOrgAdminEmails(ORG_ID)
  restoreConsole()

  assert.equal(emails.length, 0)
  assert.equal(orgName, 'Elkjøp Nordic', 'org-navnet skal fortsatt returneres')
  assert.ok(state.errors.some(e => e.includes('INGEN admin-medlemmer')))
})

test('feilet medlemsspørring gir tom liste og logges', async () => {
  state.membersError = { message: 'boom' }
  const { emails } = await getOrgAdminEmails(ORG_ID)
  restoreConsole()

  assert.equal(emails.length, 0)
  assert.ok(state.errors.some(e => e.includes('admin-oppslag feilet')))
})

test('sendToOrgAdmins med tom liste sender ingenting og kaster ikke', async () => {
  const result = await sendToOrgAdmins([], { subject: 'Test', html: '<p>x</p>' }, 'test')
  restoreConsole()

  assert.deepEqual(result, { sent: 0, failed: 0 })
  assert.equal(state.sent.length, 0)
})
