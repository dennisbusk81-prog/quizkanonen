// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av POST /api/admin/exclude-member.
//
// BAKGRUNN (F2, 9. september 2026): ruten er den eneste under admin/ som kan
// nås UTEN admin-hemmeligheten — en org-admin eller liga-eier kommer inn på
// bearer-stien. Hoveddelen var riktig (rollesjekken bruker scope_id fra
// forespørselen, og skrivingen bruker de samme verdiene), men fire vakter
// søsterrutene har fra før manglet: medlemskapskrav på `user_id`, hviteliste
// på `scope_type`, rate-limit og org-låsen.
//
// HVORFOR MOCKEN FILTRERER PÅ EKTE: en mock som bare returnerer en fast
// medlemsrad ville vært like grønn med og uten skjæringen — den ville testet at
// ruten leser et svar, ikke at den ber om riktige rader. `matching()` under
// kjører derfor .eq-filtrene mot et radlager, slik PostgREST ville gjort.
// Faller medlemsoppslaget bort i ruten, finner testene en skrevet rad.
//
// HVORFOR BÅDE STATUS OG SKRIVING ASSERTERES: en test som bare sjekker 403
// ville fortsatt vært grønn hvis raden ble skrevet og noe feilet etterpå.
// `state.writes` er de faktiske upsert-/delete-kallene mot excluded_members.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger
// (alle fire kjørt og verifisert 9. september 2026):
//   • medlemsoppslaget + `(memberRows ?? []).length === 0` fjernes →
//     «ikke medlem»-testene (org og liga) ryker: 200 og en skrevet rad.
//   • 503-grenen ved memberErr fjernes → «medlemsoppslaget feiler» ryker:
//     ruten går videre med tomt resultat og svarer 403 i stedet for 503.
//   • hvitelisten fjernes → «ugyldig scope_type» ryker: fri tekst når
//     auth-grenene, som ikke setter `authed`, og svaret blir 403 i stedet
//     for 400. (På admin-stien ville den nådd skrivingen.)
//   • requireUnlockedOrg fjernes → «låst org» ryker: 200 og en skrevet rad.
//   • rate-limiten fjernes → «rate-limit» ryker: kall nr. 21 svarer 200.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ORG    = 'a1b2c3d4-1111-4222-8333-444444444444'
const LIGA   = 'f0e1d2c3-1111-4222-8333-000000000000'
const ADMIN  = 'b2c3d4e5-1111-4222-8333-555555555555'
const MEDLEM = 'c3d4e5f6-1111-4222-8333-666666666666'
/** Finnes som konto og er medlem ET ANNET sted — men ikke i ORG/LIGA. */
const FREMMED = 'e5f6a7b8-1111-4222-8333-888888888888'

type Row = Record<string, unknown>
type QueryResult = { data: unknown; error: { message: string } | null }

type Write = { table: string; op: 'upsert' | 'delete'; payload: Row }

const state: {
  /** Kalleren sin rolle i ORG. */
  callerRole: string | null
  orgMembers: Row[]
  leagueMembers: Row[]
  /** Feil fra medlemsoppslaget (det med .limit) — ikke fra rollesjekken. */
  memberLookupError: { message: string } | null
  orgLocked: boolean
  rateLimitOk: boolean
  /** Skrivinger mot excluded_members. Tom = ingen rad rørt. */
  writes: Write[]
} = {
  callerRole: 'admin',
  orgMembers: [],
  leagueMembers: [],
  memberLookupError: null,
  orgLocked: false,
  rateLimitOk: true,
  writes: [],
}

function makeBuilder(table: string) {
  const eqs: Record<string, unknown> = {}
  let limited = false
  let pendingWrite: Write | null = null

  const rowsOf = (): Row[] => {
    if (table === 'organization_members') return state.orgMembers
    if (table === 'league_members') return state.leagueMembers
    if (table === 'leagues') return [{ id: LIGA, owner_id: ADMIN }]
    return []
  }

  const matching = (): Row[] =>
    rowsOf().filter(r => Object.entries(eqs).every(([k, v]) => r[k] === v))

  const run = (): QueryResult => {
    if (pendingWrite !== null) {
      // Delete-formen samler .eq-filtrene sine først, så payloaden leses her.
      const w = pendingWrite
      state.writes.push({ ...w, payload: w.op === 'delete' ? { ...eqs } : w.payload })
      return { data: null, error: null }
    }
    // Feilen injiseres kun i medlemsoppslaget (det eneste med .limit), ikke i
    // rollesjekken — de to er ulike kall i ruten, og en feil i rollesjekken
    // ville gitt 403 i stedet for 503.
    if (limited && state.memberLookupError !== null) {
      return { data: null, error: state.memberLookupError }
    }
    return { data: matching(), error: null }
  }

  const builder = {
    select() { return builder },
    upsert(payload: Row) { pendingWrite = { table, op: 'upsert', payload }; return builder },
    delete() { pendingWrite = { table, op: 'delete', payload: {} }; return builder },
    eq(col: string, val: unknown) { eqs[col] = val; return builder },
    limit() { limited = true; return builder },
    async maybeSingle(): Promise<QueryResult> {
      return { data: matching()[0] ?? null, error: null }
    },
    then<TR1 = QueryResult, TR2 = never>(
      onfulfilled?: ((value: QueryResult) => TR1 | PromiseLike<TR1>) | null,
      onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null,
    ): PromiseLike<TR1 | TR2> {
      return Promise.resolve().then(run).then(onfulfilled, onrejected)
    },
  }
  return builder
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: ADMIN } }, error: null }) },
      from: (table: string) => makeBuilder(table),
    },
  },
})

// Admin-hemmeligheten er ALDRI med i disse kallene: hele poenget med ruten er
// bearer-stien, og en alltid-sann verifyAdminRequest ville hoppet over den.
mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => false },
})

mock.module('@/lib/rate-limit', {
  namedExports: {
    rateLimit: () => ({ success: state.rateLimitOk, remaining: state.rateLimitOk ? 19 : 0 }),
  },
})

mock.module('@/lib/org-lock-guard', {
  namedExports: {
    requireUnlockedOrg: async () =>
      state.orgLocked
        ? { ok: false as const, status: 403, body: { error: 'låst', code: 'org_locked' } }
        : { ok: true as const, org: { id: ORG } },
    ORG_LOCKED_CODE: 'org_locked',
    ORG_LOCKED_ERROR: 'låst',
  },
})

const { POST } = await import('@/app/api/admin/exclude-member/route')

const call = (body: Record<string, unknown>) =>
  POST(
    new Request('https://quizkanonen.no/api/admin/exclude-member', {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  )

const excludeInOrg = (userId: string) =>
  call({ scope_type: 'organization', scope_id: ORG, user_id: userId, action: 'exclude' })

const excludeInLeague = (userId: string) =>
  call({ scope_type: 'league', scope_id: LIGA, user_id: userId, action: 'exclude' })

beforeEach(() => {
  state.callerRole = 'admin'
  state.memberLookupError = null
  state.orgLocked = false
  state.rateLimitOk = true
  state.writes = []
  state.orgMembers = [
    { organization_id: ORG, user_id: ADMIN,  role: 'admin' },
    { organization_id: ORG, user_id: MEDLEM, role: 'member' },
    // FREMMED er medlem av EN ANNEN org: id-en finnes, men ikke her. Uten
    // organization_id-filteret i ruten ville denne raden sluppet forbi.
    { organization_id: 'ff000000-1111-4222-8333-999999999999', user_id: FREMMED, role: 'member' },
  ]
  state.leagueMembers = [
    { league_id: LIGA, user_id: ADMIN },
    { league_id: LIGA, user_id: MEDLEM },
    { league_id: 'ff000000-2222-4222-8333-999999999999', user_id: FREMMED },
  ]
})

// ── 1. Normalveien ──────────────────────────────────────────────────────────

test('org-medlem ekskluderes: 200, og raden skrives', async () => {
  const res = await excludeInOrg(MEDLEM)

  assert.equal(res.status, 200)
  // Raden ble faktisk skrevet — ellers ville testene under vært grønne fordi
  // ingenting noensinne skrives, ikke fordi vaktene virker.
  assert.equal(state.writes.length, 1)
  assert.equal(state.writes[0].table, 'excluded_members')
  assert.equal(state.writes[0].op, 'upsert')
  assert.equal(state.writes[0].payload.scope_type, 'organization')
  assert.equal(state.writes[0].payload.scope_id, ORG)
  assert.equal(state.writes[0].payload.user_id, MEDLEM)
})

test('liga-medlem ekskluderes: 200, og raden skrives', async () => {
  const res = await excludeInLeague(MEDLEM)

  assert.equal(res.status, 200)
  assert.equal(state.writes.length, 1)
  assert.equal(state.writes[0].payload.scope_type, 'league')
  assert.equal(state.writes[0].payload.scope_id, LIGA)
})

test('unexclude av et medlem: 200, og raden slettes', async () => {
  const res = await call({ scope_type: 'organization', scope_id: ORG, user_id: MEDLEM, action: 'unexclude' })

  assert.equal(res.status, 200)
  assert.equal(state.writes.length, 1)
  assert.equal(state.writes[0].op, 'delete')
  assert.deepEqual(state.writes[0].payload, { scope_type: 'organization', scope_id: ORG, user_id: MEDLEM })
})

// ── 2. Medlemskrav — hovedpoenget ───────────────────────────────────────────

test('user_id er IKKE medlem av orgen: 403, og ingen rad skrevet', async () => {
  const res = await excludeInOrg(FREMMED)
  const body = await res.json() as { error?: string; code?: string }

  assert.equal(res.status, 403)
  assert.equal(body.code, 'not_a_member')
  assert.match(body.error ?? '', /ikke medlem/)
  assert.deepEqual(state.writes, [])
})

test('user_id er IKKE medlem av ligaen: 403, og ingen rad skrevet', async () => {
  const res = await excludeInLeague(FREMMED)
  const body = await res.json() as { code?: string }

  assert.equal(res.status, 403)
  assert.equal(body.code, 'not_a_member')
  assert.deepEqual(state.writes, [])
})

test('unexclude av en ikke-medlem: 403, og ingen sletting', async () => {
  // Vakten gjelder BEGGE handlingene — ellers ville delete-grenen vært en
  // uvoktet inngang til samme tabell.
  const res = await call({ scope_type: 'organization', scope_id: ORG, user_id: FREMMED, action: 'unexclude' })

  assert.equal(res.status, 403)
  assert.deepEqual(state.writes, [])
})

// ── 3. Ikke fått svar betyr UKJENT, aldri «ikke medlem» ─────────────────────

test('medlemsoppslaget feiler: 503, og ingen rad skrevet', async () => {
  state.memberLookupError = { message: 'timeout' }

  const res = await excludeInOrg(MEDLEM)
  const body = await res.json() as { error?: string }

  assert.equal(res.status, 503)
  assert.match(body.error ?? '', /bekrefte medlemskapet/)
  assert.deepEqual(state.writes, [])
})

// ── 4. Hviteliste på scope_type ─────────────────────────────────────────────

test('ugyldig scope_type: 400, og ingen rad skrevet', async () => {
  const res = await call({ scope_type: 'global', scope_id: ORG, user_id: MEDLEM, action: 'exclude' })
  const body = await res.json() as { error?: string }

  assert.equal(res.status, 400)
  assert.match(body.error ?? '', /scope_type/)
  assert.deepEqual(state.writes, [])
})

test('fritekst i scope_type: 400, og ingen rad skrevet', async () => {
  const res = await call({ scope_type: 'noe_helt_annet', scope_id: ORG, user_id: MEDLEM, action: 'exclude' })

  assert.equal(res.status, 400)
  assert.deepEqual(state.writes, [])
})

// ── 5. Låst org ─────────────────────────────────────────────────────────────

test('låst org: 403 org_locked, og ingen rad skrevet', async () => {
  state.orgLocked = true

  const res = await excludeInOrg(MEDLEM)
  const body = await res.json() as { code?: string }

  assert.equal(res.status, 403)
  assert.equal(body.code, 'org_locked')
  assert.deepEqual(state.writes, [])
})

test('låsen gjelder ikke ligaer — de har ingen', async () => {
  // `leagues` har verken subscription_status eller et isLeagueLocked-begrep.
  // Skulle noen legge org-låsen på liga-grenen ved en feil, ryker denne.
  state.orgLocked = true

  const res = await excludeInLeague(MEDLEM)

  assert.equal(res.status, 200)
  assert.equal(state.writes.length, 1)
})

// ── 6. Rate-limit ───────────────────────────────────────────────────────────

test('over rate-limit: 429, og ingen rad skrevet', async () => {
  state.rateLimitOk = false

  const res = await excludeInOrg(MEDLEM)

  assert.equal(res.status, 429)
  assert.deepEqual(state.writes, [])
})

// ── 7. Rollesjekken skal fortsatt stå foran alt ─────────────────────────────

test('ikke admin i orgen: 403, og ingen rad skrevet', async () => {
  state.orgMembers = state.orgMembers.map(m =>
    m.user_id === ADMIN ? { ...m, role: 'member' } : m)

  const res = await excludeInOrg(MEDLEM)

  assert.equal(res.status, 403)
  assert.deepEqual(state.writes, [])
})

test('ikke eier av ligaen: 403, og ingen rad skrevet', async () => {
  const res = await call({ scope_type: 'league', scope_id: 'cc000000-3333-4222-8333-999999999999', user_id: MEDLEM, action: 'exclude' })

  assert.equal(res.status, 403)
  assert.deepEqual(state.writes, [])
})
