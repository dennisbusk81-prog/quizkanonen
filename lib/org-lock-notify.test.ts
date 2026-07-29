// Kjøres med:  npm test
//
// Dekker varslingen til ANSATTE når en org låses (29. juli 2026):
//   1. den rene overgangsvakten (duplikatvernet), og
//   2. selve utsendingen — hvem som får e-post, og at feil logges.
//
// MUTASJONSBEVIS (verifisert manuelt):
//   * Fjernes `previousStatus !== 'locked'` fra shouldNotifyMembersOfLock,
//     feiler «allerede låst …».
//   * Byttes `.neq('role', 'admin')` til å hente alle, feiler
//     «admin skal ikke få ansatt-e-posten».
//   * Svelges sendEmail-feilen uten console.error, feiler «feil på én
//     e-post …».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ORG_ID = 'org-1'

type Member = { user_id: string; role: string }

const state: {
  members: Member[]
  /** Filtrene siste organization_members-spørring ble bygget med. */
  filters: Record<string, unknown>
  users: Array<{ id: string; email: string | null }>
  membersError: { message: string } | null
  listUsersError: { message: string } | null
  failEmailsTo: string[]
  sent: Array<{ to: string; subject: string; html: string }>
  errors: string[]
} = {
  members: [],
  filters: {},
  users: [],
  membersError: null,
  listUsersError: null,
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
          eq(col: string, val: unknown) { state.filters[`eq:${col}`] = val; return b },
          neq(col: string, val: unknown) { state.filters[`neq:${col}`] = val; return b },
          then(resolve: (v: unknown) => void) {
            if (table !== 'organization_members') return resolve({ data: [], error: null })
            if (state.membersError) return resolve({ data: null, error: state.membersError })
            // Speiler .neq('role', 'admin') i produksjonskoden.
            const excluded = state.filters['neq:role']
            const rows = state.members.filter(m => m.role !== excluded)
            return resolve({ data: rows.map(m => ({ user_id: m.user_id })), error: null })
          },
        }
        return b
      },
      auth: {
        admin: {
          listUsers: async () => state.listUsersError
            ? { data: null, error: state.listUsersError }
            : { data: { users: state.users }, error: null },
        },
      },
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (opts: { to: string; subject: string; html: string }) => {
      if (state.failEmailsTo.includes(opts.to)) throw new Error(`Resend nede for ${opts.to}`)
      state.sent.push(opts)
    },
  },
})

const { shouldNotifyMembersOfLock, notifyMembersOfOrgLock } = await import('@/lib/org-lock-notify')

const originalError = console.error
beforeEach(() => {
  state.members = [
    { user_id: 'u-admin', role: 'admin' },
    { user_id: 'u-ansatt-1', role: 'member' },
    { user_id: 'u-ansatt-2', role: 'member' },
  ]
  state.filters = {}
  state.users = [
    { id: 'u-admin', email: 'admin@elkjop.test' },
    { id: 'u-ansatt-1', email: 'ansatt1@elkjop.test' },
    { id: 'u-ansatt-2', email: 'ansatt2@elkjop.test' },
  ]
  state.membersError = null
  state.listUsersError = null
  state.failEmailsTo = []
  state.sent = []
  state.errors = []
  console.error = (...args: unknown[]) => { state.errors.push(args.map(String).join(' ')) }
})

function restoreConsole() { console.error = originalError }

// ── Duplikatvernet ─────────────────────────────────────────────────────────

test('overgang til locked fra aktiv/trial varsler', () => {
  assert.equal(shouldNotifyMembersOfLock('active', 'locked'), true)
  assert.equal(shouldNotifyMembersOfLock('trialing', 'locked'), true)
  assert.equal(shouldNotifyMembersOfLock(null, 'locked'), true)
})

test('allerede låst → ingen ny e-post (past_due → unpaid → canceled gir ÉN)', () => {
  assert.equal(shouldNotifyMembersOfLock('locked', 'locked'), false)
})

test('overgang til aktiv eller trial varsler aldri', () => {
  assert.equal(shouldNotifyMembersOfLock('locked', 'active'), false)
  assert.equal(shouldNotifyMembersOfLock('active', 'trialing'), false)
  assert.equal(shouldNotifyMembersOfLock('locked', null), false)
})

// ── Utsendingen ────────────────────────────────────────────────────────────

test('admin skal ikke få ansatt-e-posten — kun ordinære medlemmer', async () => {
  await notifyMembersOfOrgLock(ORG_ID, 'Elkjøp Nordic', 'test')
  restoreConsole()

  assert.deepEqual(state.sent.map(s => s.to).sort(), ['ansatt1@elkjop.test', 'ansatt2@elkjop.test'])
  assert.equal(state.filters['neq:role'], 'admin', 'medlemsspørringen må filtrere bort admin')
})

test('e-posten navngir bedriften og escaper markup i navnet', async () => {
  await notifyMembersOfOrgLock(ORG_ID, '<b>Elkjøp</b>', 'test')
  restoreConsole()

  assert.ok(state.sent.length > 0)
  assert.ok(state.sent[0].html.includes('&lt;b&gt;Elkj'), 'org-navnet skal escapes i malen')
  assert.ok(!state.sent[0].html.includes('<b>Elkjøp</b>'), 'rå markup skal ikke nå e-posten')
})

test('feil på én e-post stopper ikke de andre — og logges', async () => {
  state.failEmailsTo = ['ansatt1@elkjop.test']
  await notifyMembersOfOrgLock(ORG_ID, 'Elkjøp Nordic', 'test')
  restoreConsole()

  assert.deepEqual(state.sent.map(s => s.to), ['ansatt2@elkjop.test'], 'de øvrige skal fortsatt få e-post')
  assert.ok(
    state.errors.some(e => e.includes('sendEmail feilet')),
    'en feilet e-post skal logges, ikke svelges stille',
  )
})

test('org uten ordinære medlemmer sender ingenting', async () => {
  state.members = [{ user_id: 'u-admin', role: 'admin' }]
  await notifyMembersOfOrgLock(ORG_ID, 'Elkjøp Nordic', 'test')
  restoreConsole()

  assert.equal(state.sent.length, 0)
})

test('feilet medlemsspørring logges og sender ingenting', async () => {
  state.membersError = { message: 'boom' }
  await notifyMembersOfOrgLock(ORG_ID, 'Elkjøp Nordic', 'test')
  restoreConsole()

  assert.equal(state.sent.length, 0)
  assert.ok(state.errors.some(e => e.includes('kunne ikke hente medlemmer')))
})

test('manglende orgName logges i stedet for å sende en navnløs e-post', async () => {
  await notifyMembersOfOrgLock(ORG_ID, null, 'test')
  restoreConsole()

  assert.equal(state.sent.length, 0)
  assert.ok(state.errors.some(e => e.includes('mangler orgName')))
})

test('kaster aldri — listUsers-feil bobler ikke opp i webhooken', async () => {
  state.listUsersError = { message: 'auth nede' }
  await notifyMembersOfOrgLock(ORG_ID, 'Elkjøp Nordic', 'test')
  restoreConsole()

  assert.equal(state.sent.length, 0)
  assert.ok(state.errors.some(e => e.includes('listUsers feilet')))
})
