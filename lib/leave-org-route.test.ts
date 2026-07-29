// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte leave-ruten. `mock.module` bytter ut
// supabase-admin, premium-rekalkuleringen og rate-limit, slik at
// produksjonskoden kjøres uendret — ingen injiserte parametere og ingen egen
// testvei. Samme mønster som lib/send-invite-route.test.ts.
//
// MUTASJONSBEVIS (siste-admin-sperren), bekreftet ved å fjerne den midlertidig:
//
//   1. Fjern forhåndssjekken (`if (adminCount <= 1) return 409`) i ruten
//      → «eneste admin kan ikke forlate» feiler: status 200 i stedet for 409,
//        og medlemsraden er faktisk slettet.
//   2. Fjern ETTERKONTROLLEN (rollback-blokken etter slettingen)
//      → «kappløp: to admins …» feiler: begge slipper ut og orgen står igjen
//        med 0 administratorer.
//
// Begge er verifisert — se rapporten. Testene under dekker altså to uavhengige
// sperrer, ikke én sjekk testet to ganger.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ORG_ID   = '26e5126f-4c40-4588-9646-aa81d0c6a082'
const ORG_SLUG = 'a1b2c3d4'
const USER_ID  = '5c312683-2010-46d5-8a9d-a3529ee2e285'

type MemberRow = {
  id: string
  organization_id: string
  user_id: string
  role: string
  joined_at: string
  welcome_email_sent: boolean
}

const state: {
  members: MemberRow[]
  orgExists: boolean
  countError: { message: string } | null
  deleteError: { message: string } | null
  insertError: { message: string } | null
  premiumThrows: boolean
  premiumSyncedFor: string[]
  logged: { action_type: string; scope_id: string }[]
  /** Simulerer at en ANNEN admin forlot samtidig, mellom vakt og etterkontroll. */
  concurrentAdminLeavesBeforeRecount: boolean
  /** Antall admin-tellinger så langt: 1 = vakten, 2 = etterkontrollen. */
  adminCountCalls: number
  /** Antall DELETE-er mot organization_members. Skiller de to sperrene fra
   *  hverandre: forhåndssjekken skal stoppe FØR noen sletting forsøkes,
   *  etterkontrollen først etterpå. Uten denne er de to umulige å skille
   *  utenfra — begge gir 409 og et intakt medlemskap. */
  deleteAttempts: number
} = {
  members: [],
  orgExists: true,
  countError: null,
  deleteError: null,
  insertError: null,
  premiumThrows: false,
  premiumSyncedFor: [],
  logged: [],
  concurrentAdminLeavesBeforeRecount: false,
  adminCountCalls: 0,
  deleteAttempts: 0,
}

const member = (id: string, user_id: string, role: string): MemberRow => ({
  id, organization_id: ORG_ID, user_id, role,
  joined_at: '2026-07-01T10:00:00.000Z', welcome_email_sent: true,
})

// Minimal PostgREST-etterligning: nok til å dekke filtrene ruten faktisk bruker
// (.eq på organization_id/user_id/role/id/slug), tellespørringer med head:true,
// og delete().select('*').
function builder(table: string) {
  const filters: Record<string, unknown> = {}
  let counting = false
  let deleting = false

  const matching = () =>
    state.members.filter(m =>
      (filters.organization_id === undefined || m.organization_id === filters.organization_id) &&
      (filters.user_id === undefined || m.user_id === filters.user_id) &&
      (filters.role === undefined || m.role === filters.role) &&
      (filters.id === undefined || m.id === filters.id)
    )

  const b = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      counting = opts?.count === 'exact'
      return b
    },
    eq(col: string, val: unknown) { filters[col] = val; return b },
    delete() { deleting = true; return b },
    insert(row: MemberRow) {
      if (state.insertError) return Promise.resolve({ error: state.insertError })
      if (table === 'organization_members') state.members.push(row)
      if (table === 'admin_actions') {
        state.logged.push(row as unknown as { action_type: string; scope_id: string })
      }
      return Promise.resolve({ error: null })
    },
    maybeSingle() {
      if (table === 'organizations') {
        return Promise.resolve({
          data: state.orgExists ? { id: ORG_ID, name: 'Elkjøp Nordic' } : null,
          error: null,
        })
      }
      if (table === 'organization_members') {
        const hit = matching()[0]
        return Promise.resolve({ data: hit ? { id: hit.id, role: hit.role } : null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    // delete(...).select('*') — returnerer de slettede radene
    then(resolve: (v: unknown) => void) {
      if (deleting) {
        if (table === 'organization_members') state.deleteAttempts++
        if (state.deleteError) return resolve({ data: null, error: state.deleteError })
        const hits = matching()
        state.members = state.members.filter(m => !hits.includes(m))
        return resolve({ data: hits, error: null })
      }
      if (counting) {
        if (state.countError) return resolve({ count: null, error: state.countError })
        if (filters.role === 'admin') {
          state.adminCountCalls++
          // Kappløpet: vakten (kall 1) ser to administratorer og slipper
          // gjennom. Rett FØR etterkontrollen (kall 2) rekker den ANDRE
          // admin-en å fullføre sin egen utmelding. Kun andre admins fjernes —
          // vår egen rad er allerede slettet av ruten på dette tidspunktet.
          if (state.concurrentAdminLeavesBeforeRecount && state.adminCountCalls === 2) {
            state.members = state.members.filter(m => !(m.role === 'admin' && m.user_id !== USER_ID))
          }
        }
        return resolve({ count: matching().length, error: null })
      }
      return resolve({ data: null, error: null })
    },
  }

  // delete().eq(...).select('*') må også kunne awaites via select
  const origSelect = b.select
  b.select = (cols: string, opts?: { count?: string; head?: boolean }) => {
    origSelect(cols, opts)
    return b
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

mock.module('@/lib/premium-state-io', {
  namedExports: {
    syncPremiumCache: async (userId: string) => {
      if (state.premiumThrows) throw new Error('Stripe nede')
      state.premiumSyncedFor.push(userId)
      return { isPremium: false, sources: {} }
    },
  },
})

mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

const { POST } = await import('@/app/api/org/[slug]/leave/route')

function call() {
  const request = new Request(`https://quizkanonen.no/api/org/${ORG_SLUG}/leave`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  })
  return POST(request as never, { params: Promise.resolve({ slug: ORG_SLUG }) })
}

const adminsLeft = () => state.members.filter(m => m.role === 'admin').length
const isMember   = () => state.members.some(m => m.user_id === USER_ID)

beforeEach(() => {
  state.members = []
  state.orgExists = true
  state.countError = null
  state.deleteError = null
  state.insertError = null
  state.premiumThrows = false
  state.premiumSyncedFor = []
  state.logged = []
  state.concurrentAdminLeavesBeforeRecount = false
  state.adminCountCalls = 0
  state.deleteAttempts = 0
})

// ── Vanlig medlem ────────────────────────────────────────────────────────────

test('vanlig medlem kan forlate — medlemskapet fjernes', async () => {
  state.members = [member('m1', 'annen-admin', 'admin'), member('m2', USER_ID, 'member')]

  const res = await call()
  assert.equal(res.status, 200)
  assert.equal(isMember(), false, 'medlemsraden skal være borte')
  assert.equal(adminsLeft(), 1, 'admin-en skal ikke røres')
})

test('premium rekalkuleres for den som forlot — aldri antatt', async () => {
  state.members = [member('m1', 'annen-admin', 'admin'), member('m2', USER_ID, 'member')]

  const res = await call()
  assert.equal(res.status, 200)
  assert.deepEqual(state.premiumSyncedFor, [USER_ID])
  assert.equal((await res.json()).premiumRecomputed, true)
})

test('utmeldingen bokføres i admin_actions', async () => {
  state.members = [member('m1', 'annen-admin', 'admin'), member('m2', USER_ID, 'member')]

  await call()
  assert.equal(state.logged.length, 1)
  assert.equal(state.logged[0].action_type, 'org_member_left')
  assert.equal(state.logged[0].scope_id, ORG_ID)
})

test('feilet premium-rekalkulering ruller IKKE tilbake en korrekt utmelding', async () => {
  state.members = [member('m1', 'annen-admin', 'admin'), member('m2', USER_ID, 'member')]
  state.premiumThrows = true

  const res = await call()
  assert.equal(res.status, 200, 'brukeren fikk det de ba om')
  assert.equal(isMember(), false)
  assert.equal((await res.json()).premiumRecomputed, false, 'skal rapporteres, ikke skjules')
})

// ── Siste-admin-sperren ──────────────────────────────────────────────────────

test('SPERRE: eneste admin kan ikke forlate — 409 og medlemskapet består', async () => {
  state.members = [member('m1', USER_ID, 'admin'), member('m2', 'ansatt', 'member')]

  const res = await call()
  assert.equal(res.status, 409)
  const json = await res.json()
  assert.equal(json.code, 'last_admin')
  assert.match(json.error, /eneste administrator/)
  assert.equal(isMember(), true, 'medlemskapet skal IKKE være fjernet')
  assert.equal(adminsLeft(), 1, 'orgen skal fortsatt ha en admin')
  assert.deepEqual(state.premiumSyncedFor, [], 'ingen premium-endring når ingenting skjedde')

  // Selve poenget med FORHÅNDSsjekken. Uten den ville etterkontrollen fanget
  // opp det samme og gitt nøyaktig samme 409 med medlemskapet intakt — så uten
  // denne assert-en er de to sperrene ikke til å skille fra hverandre utenfra,
  // og en fjernet forhåndssjekk ville passert testen ubemerket (verifisert).
  // Den eneste admin-raden skal aldri slettes, ikke engang et øyeblikk.
  assert.equal(state.deleteAttempts, 0, 'ingen sletting skal i det hele tatt forsøkes')
})

test('admin som IKKE er alene kan forlate som et vanlig medlem', async () => {
  state.members = [member('m1', USER_ID, 'admin'), member('m2', 'medadmin', 'admin')]

  const res = await call()
  assert.equal(res.status, 200)
  assert.equal(isMember(), false)
  assert.equal(adminsLeft(), 1, 'den andre admin-en står igjen')
})

test('SPERRE: kappløp — to admins forlater samtidig, den siste rulles tilbake', async () => {
  state.members = [member('m1', USER_ID, 'admin'), member('m2', 'medadmin', 'admin')]
  // Vakten ser 2 administratorer og slipper gjennom. Rett før etterkontrollen
  // rekker den andre admin-en å forlate — da ville orgen stått uten admin.
  state.concurrentAdminLeavesBeforeRecount = true

  const res = await call()
  assert.equal(res.status, 409)
  assert.equal((await res.json()).code, 'last_admin')
  assert.equal(isMember(), true, 'utmeldingen skal være rullet tilbake')
  assert.equal(adminsLeft(), 1, 'orgen skal aldri stå igjen uten admin')
})

test('SPERRE: telling som feiler slipper ingen admin ut (503, feiler lukket)', async () => {
  state.members = [member('m1', USER_ID, 'admin'), member('m2', 'medadmin', 'admin')]
  state.countError = { message: 'timeout' }

  const res = await call()
  assert.equal(res.status, 503)
  assert.equal(isMember(), true)
})

test('en DB-feil på tellingen stopper ikke et vanlig medlem', async () => {
  state.members = [member('m1', 'admin-en', 'admin'), member('m2', USER_ID, 'member')]
  state.countError = { message: 'timeout' }

  const res = await call()
  assert.equal(res.status, 200, 'vakten gjelder kun administratorer')
  assert.equal(isMember(), false)
})

// ── Øvrige feilveier ─────────────────────────────────────────────────────────

test('ikke-medlem får 404 — ingenting slettes', async () => {
  state.members = [member('m1', 'noen-andre', 'admin')]

  const res = await call()
  assert.equal(res.status, 404)
  assert.equal(state.members.length, 1)
})

test('ukjent org gir 404', async () => {
  state.orgExists = false

  const res = await call()
  assert.equal(res.status, 404)
})

test('slettingen som matcher 0 rader gir 500, ikke falsk suksess', async () => {
  state.members = [member('m1', 'annen-admin', 'admin'), member('m2', USER_ID, 'member')]
  state.deleteError = { message: 'deadlock detected' }

  const res = await call()
  assert.equal(res.status, 500)
  assert.deepEqual(state.premiumSyncedFor, [], 'premium skal ikke røres når fjerningen feilet')
})

test('mislykket tilbakerulling gir 500 med support-melding, ikke en stille 409', async () => {
  state.members = [member('m1', USER_ID, 'admin'), member('m2', 'medadmin', 'admin')]
  state.concurrentAdminLeavesBeforeRecount = true
  state.insertError = { message: 'constraint violation' }

  const res = await call()
  assert.equal(res.status, 500)
  assert.match((await res.json()).error, /Kontakt support/)
})
