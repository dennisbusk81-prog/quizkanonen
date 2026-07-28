// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte DELETE /api/profile/delete. `mock.module` bytter
// ut supabase-admin, Stripe og rate-limit, så produksjonskoden kjøres uendret
// mot en liten etterligning av databasen som håndhever de ekte FK-reglene:
//
//   leagues.owner_id                → CASCADE   (river ligaen)
//   organizations.created_by        → NO ACTION (blokkerer slettingen)
//   organization_invites.created_by → NO ACTION (blokkerer slettingen)
//
// MUTASJONSBEVIS:
//   * Fjernes leagueSteps fra `steps` → «ligaen overlever» feiler (kaskaden
//     river ligaen), og «eierskifte skjer før deleteUser» feiler.
//   * Fjernes organizations.created_by-steget → «org-eier får slettet kontoen»
//     feiler med NO ACTION-blokkering, nøyaktig GDPR-problemet.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const EIER = 'eier-0000-0000'
const GAMMEL = 'aaa-lengst-medlem'
const NY = 'bbb-nyeste-medlem'
const ORG_ID = 'org-1'

type Row = Record<string, unknown>

const db: {
  leagues: Row[]
  league_members: Row[]
  organizations: Row[]
  organization_invites: Row[]
  rivalries: Row[]
  season_scores: Row[]
  organization_members: Row[]
  excluded_members: Row[]
  attempts: Row[]
  attempt_answers: Row[]
  profiles: Row[]
} = {
  leagues: [], league_members: [], organizations: [], organization_invites: [],
  rivalries: [], season_scores: [], organization_members: [], excluded_members: [],
  attempts: [], attempt_answers: [], profiles: [],
}

let logg: string[] = []
let deleteUserKalt = false
let deleteUserFeil: string | null = null

function matcher(filters: [string, unknown][]) {
  return (r: Row) => filters.every(([k, v]) => r[k] === v)
}

function builder(table: string) {
  const filters: [string, unknown][] = []
  let op: 'select' | 'update' | 'delete' = 'select'
  let patch: Row = {}
  let orIds: string[] | null = null

  const run = () => {
    const rows = db[table as keyof typeof db] ?? []
    let hit = rows.filter(matcher(filters))
    if (orIds) hit = rows.filter(r => orIds!.includes(String(r.challenger_id)) || orIds!.includes(String(r.rival_id)))

    if (op === 'select') return { data: hit, error: null }

    if (op === 'update') {
      logg.push(`update:${table}`)
      for (const r of hit) Object.assign(r, patch)
      return { data: hit, error: null }
    }

    logg.push(`delete:${table}`)
    // FK: leagues.id ← league_members.league_id er ON DELETE CASCADE
    if (table === 'leagues') {
      const ids = hit.map(l => l.id)
      db.league_members = db.league_members.filter(m => !ids.includes(m.league_id))
    }
    db[table as keyof typeof db] = rows.filter(r => !hit.includes(r)) as Row[]
    return { data: hit, error: null }
  }

  const b: Record<string, unknown> = {
    select() { op = 'select'; return b },
    update(p: Row) { op = 'update'; patch = p; return b },
    delete() { op = 'delete'; return b },
    eq(col: string, val: unknown) { filters.push([col, val]); return b },
    in() { return b },
    or(expr: string) { orIds = [...expr.matchAll(/eq\.([^,)]+)/g)].map(m => m[1]); return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }) },
    single() { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }) },
    then(resolve: (v: unknown) => void) { return resolve(run()) },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => ({ data: { user: { id: EIER, email: 'eier@test.no' } }, error: null }),
        admin: {
          deleteUser: async () => {
            deleteUserKalt = true
            // Etterligner NO ACTION: databasen nekter hvis noe fortsatt peker hit.
            const blokkering =
              db.organizations.some(o => o.created_by === EIER) ? 'organizations_created_by_fkey' :
              db.organization_invites.some(i => i.created_by === EIER) ? 'organization_invites_created_by_fkey' :
              null
            if (blokkering) {
              deleteUserFeil = blokkering
              return { error: { message: `update or delete on table "profiles" violates foreign key constraint "${blokkering}"` } }
            }
            // Etterligner CASCADE på leagues.owner_id.
            const revet = db.leagues.filter(l => l.owner_id === EIER).map(l => l.id)
            db.leagues = db.leagues.filter(l => l.owner_id !== EIER)
            db.league_members = db.league_members.filter(m => !revet.includes(m.league_id))
            logg.push('deleteUser')
            return { error: null }
          },
        },
      },
      from: (t: string) => builder(t),
    },
  },
})

// Profilen i testen har hverken stripe_customer_id eller personlig
// subscription-id, så kanselleringsblokken hoppes over — Stripe trengs kun for
// at `new Stripe(...)` og `Stripe.errors` skal finnes.
class FakeStripeError extends Error { code?: string }
mock.module('stripe', {
  defaultExport: class FakeStripe {
    static errors = { StripeInvalidRequestError: FakeStripeError }
    subscriptions = { list: async () => ({ data: [] }), retrieve: async () => null, cancel: async () => ({}) }
  },
})
mock.module('@/lib/rate-limit', { namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) } })

const { DELETE } = await import('@/app/api/profile/delete/route')

function slettKonto() {
  const request = new Request('https://quizkanonen.no/api/profile/delete', {
    method: 'DELETE',
    headers: { authorization: 'Bearer test-token' },
  })
  return DELETE(request as never)
}

beforeEach(() => {
  logg = []
  deleteUserKalt = false
  deleteUserFeil = null
  db.leagues = []
  db.league_members = []
  db.organizations = []
  db.organization_invites = []
  db.rivalries = []
  db.season_scores = []
  db.organization_members = []
  db.excluded_members = []
  db.attempts = []
  db.attempt_answers = []
  db.profiles = [{ id: EIER, stripe_customer_id: null, personal_stripe_subscription_id: null }]
})

test('LIGA: eier med andre medlemmer sletter kontoen → ligaen overlever med ny eier', async () => {
  db.leagues = [{ id: 'liga-1', name: 'Fredagsgjengen', owner_id: EIER }]
  db.league_members = [
    { league_id: 'liga-1', user_id: EIER, joined_at: '2026-01-01T00:00:00.000Z' },
    { league_id: 'liga-1', user_id: NY, joined_at: '2026-06-01T00:00:00.000Z' },
    { league_id: 'liga-1', user_id: GAMMEL, joined_at: '2026-02-01T00:00:00.000Z' },
  ]

  const res = await slettKonto()
  assert.equal(res.status, 200)

  assert.equal(db.leagues.length, 1, 'ligaen skal fortsatt finnes')
  assert.equal(db.leagues[0].owner_id, GAMMEL, 'lengst medlem skal ha arvet ligaen')
  assert.equal(db.league_members.length, 2, 'de to andre medlemmene skal være igjen')
  assert.ok(!db.league_members.some(m => m.user_id === EIER), 'den avdøde eierens medlemskap er borte')
})

test('LIGA: eierskiftet skjer FØR deleteUser — ellers rekker kaskaden å rive ligaen', async () => {
  db.leagues = [{ id: 'liga-1', name: 'L', owner_id: EIER }]
  db.league_members = [
    { league_id: 'liga-1', user_id: EIER, joined_at: '2026-01-01T00:00:00.000Z' },
    { league_id: 'liga-1', user_id: NY, joined_at: '2026-02-01T00:00:00.000Z' },
  ]

  await slettKonto()

  const iOverføring = logg.indexOf('update:leagues')
  const iSlett = logg.indexOf('deleteUser')
  assert.ok(iOverføring >= 0, 'eierskiftet skal ha skjedd')
  assert.ok(iSlett >= 0, 'kontoen skal ha blitt slettet')
  assert.ok(iOverføring < iSlett, 'eierskiftet må skje før deleteUser')
})

test('LIGA: eneste medlem → ligaen slettes, ingen andre rammes', async () => {
  db.leagues = [{ id: 'liga-1', name: 'Solo', owner_id: EIER }]
  db.league_members = [{ league_id: 'liga-1', user_id: EIER, joined_at: '2026-01-01T00:00:00.000Z' }]

  const res = await slettKonto()
  assert.equal(res.status, 200)
  assert.equal(db.leagues.length, 0)
  assert.equal(db.league_members.length, 0)
})

test('LIGA: flere eide ligaer håndteres hver for seg', async () => {
  db.leagues = [
    { id: 'liga-1', name: 'Med venner', owner_id: EIER },
    { id: 'liga-2', name: 'Alene', owner_id: EIER },
  ]
  db.league_members = [
    { league_id: 'liga-1', user_id: EIER, joined_at: '2026-01-01T00:00:00.000Z' },
    { league_id: 'liga-1', user_id: NY, joined_at: '2026-03-01T00:00:00.000Z' },
    { league_id: 'liga-2', user_id: EIER, joined_at: '2026-01-01T00:00:00.000Z' },
  ]

  await slettKonto()

  assert.equal(db.leagues.length, 1)
  assert.equal(db.leagues[0].id, 'liga-1')
  assert.equal(db.leagues[0].owner_id, NY)
})

test('ORG: oppretter av en organisasjon får faktisk slettet kontoen (GDPR)', async () => {
  db.organizations = [{ id: ORG_ID, name: 'Elkjøp Nordic', created_by: EIER, subscription_status: 'trialing' }]

  const res = await slettKonto()

  assert.equal(res.status, 200, 'slettingen skal fullføre')
  assert.equal(deleteUserFeil, null, 'ingen FK-blokkering skal ha oppstått')
  assert.ok(deleteUserKalt)
})

test('ORG: organisasjonen består — kun created_by nulles', async () => {
  db.organizations = [{ id: ORG_ID, name: 'Elkjøp Nordic', created_by: EIER, subscription_status: 'trialing' }]
  db.organization_members = [{ organization_id: ORG_ID, user_id: 'annen-ansatt', role: 'admin' }]

  await slettKonto()

  assert.equal(db.organizations.length, 1, 'organisasjonen skal IKKE slettes')
  assert.equal(db.organizations[0].created_by, null)
  assert.equal(db.organizations[0].name, 'Elkjøp Nordic')
  assert.equal(db.organizations[0].subscription_status, 'trialing')
})

test('ORG: aktiv invitasjonslenke overlever — nulles, slettes ikke', async () => {
  db.organizations = [{ id: ORG_ID, name: 'Elkjøp Nordic', created_by: EIER }]
  db.organization_invites = [{ id: 'inv-1', organization_id: ORG_ID, token: 'abc', created_by: EIER, is_active: true, use_count: 28 }]

  const res = await slettKonto()

  assert.equal(res.status, 200)
  assert.equal(db.organization_invites.length, 1, 'invitasjonen skal ikke slettes')
  assert.equal(db.organization_invites[0].created_by, null)
  assert.equal(db.organization_invites[0].is_active, true, 'lenken skal fortsatt virke')
  assert.equal(db.organization_invites[0].token, 'abc')
})

test('ORG: nullingen skjer før deleteUser', async () => {
  db.organizations = [{ id: ORG_ID, name: 'O', created_by: EIER }]
  db.organization_invites = [{ id: 'inv-1', created_by: EIER }]

  await slettKonto()

  const iOrg = logg.indexOf('update:organizations')
  const iInv = logg.indexOf('update:organization_invites')
  const iSlett = logg.indexOf('deleteUser')
  assert.ok(iOrg >= 0 && iInv >= 0 && iSlett >= 0)
  assert.ok(iOrg < iSlett && iInv < iSlett)
})

test('bruker uten liga eller org slettes som før — ingen regresjon', async () => {
  db.rivalries = [{ challenger_id: EIER, rival_id: 'x' }]
  db.season_scores = [{ user_id: EIER }]

  const res = await slettKonto()
  assert.equal(res.status, 200)
  assert.equal(db.rivalries.length, 0)
  assert.equal(db.season_scores.length, 0)
  assert.ok(deleteUserKalt)
})
