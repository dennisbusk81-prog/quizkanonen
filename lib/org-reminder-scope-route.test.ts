// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av POST /api/org/[slug]/send-reminder.
//
// BAKGRUNN (F1, 9. september 2026): rollesjekken og låsesjekken var riktige,
// men `userIds` fra body ble aldri målt mot organization_members — kun mot
// «maks 50». Bruker-UUID-er er offentlige (/api/toppliste returnerer dem uten
// auth), så en gratis konto kunne opprette en trial-org, bli admin i den og
// sende «Husk fredagsquizen» fra hei@quizkanonen.no til 50 vilkårlige kontoer.
//
// HVORFOR MOCKEN FILTRERER PÅ EKTE: en mock som bare returnerer en fast
// medlemsrad ville vært like grønn med og uten skjæringen — den ville testet at
// ruten leser et svar, ikke at den ber om riktige rader. `matching()` under
// kjører derfor .eq- og .in-filtrene mot et radlager, slik PostgREST ville
// gjort. Faller skjæringen bort i ruten, finner testene e-post som er sendt.
//
// HVORFOR BÅDE STATUS OG UTSENDING ASSERTERES: en test som bare sjekker 403
// ville fortsatt vært grønn hvis e-posten gikk ut og noe feilet etterpå.
// `state.sentTo` er derfor de faktiske mottakerne sendEmail ble kalt med.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • medlemsskjæringen (.in-oppslaget + `requestedIds.some(...)`) fjernes →
//     «én fremmed» og «ingen medlemmer» ryker: 200 og e-post til utenforstående.
//   • skjæringen byttes til STILLE FILTRERING (send til de som er medlemmer) →
//     «én fremmed» ryker fortsatt: status blir 200 og medlemmet får e-post.
//   • 503-grenen ved memberErr fjernes → «oppslaget feiler» ryker: ruten går
//     videre med tom medlemsmengde og svarer 403 i stedet for 503 (og med
//     skjæringen fjernet i tillegg: e-post til alle).
//   • døgnkvoten fjernes → «døgnkvoten er brukt opp» ryker: 200 og e-post.
//   • admin-sjekken fjernes → «ikke admin» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ORG      = 'a1b2c3d4-1111-4222-8333-444444444444'
const ADMIN    = 'b2c3d4e5-1111-4222-8333-555555555555'
const MEDLEM_A = 'c3d4e5f6-1111-4222-8333-666666666666'
const MEDLEM_B = 'd4e5f6a7-1111-4222-8333-777777777777'
const FREMMED  = 'e5f6a7b8-1111-4222-8333-888888888888'

const EPOST: Record<string, string> = {
  [ADMIN]:    'admin@elkjop.example',
  [MEDLEM_A]: 'a@elkjop.example',
  [MEDLEM_B]: 'b@elkjop.example',
  [FREMMED]:  'fremmed@example.com',
}

type Row = Record<string, unknown>
type QueryResult = { data: unknown; count?: number | null; error: { message: string } | null }

const state: {
  /** Kalleren sin rolle i orgen. */
  callerRole: string | null
  members: Row[]
  /** Feil fra medlemsoppslaget (det med .in) — ikke fra tellingen. */
  memberLookupError: { message: string } | null
  /** Antall påminnelser bokført siste døgn. */
  dayCount: number
  dayCountError: { message: string } | null
  /** Adressene sendEmail faktisk ble kalt med. Tom = ingen e-post gikk ut. */
  sentTo: string[]
  /** Rader skrevet til admin_actions. */
  loggedActions: number
} = {
  callerRole: 'admin',
  members: [],
  memberLookupError: null,
  dayCount: 0,
  dayCountError: null,
  sentTo: [],
  loggedActions: 0,
}

function makeBuilder(table: string) {
  const eqs: Record<string, unknown> = {}
  let inFilter: { col: string; vals: unknown[] } | null = null
  let inserted: Row[] | null = null

  const rowsOf = (): Row[] => (table === 'organization_members' ? state.members : [])

  // Ekte filtrering: dette er hele grunnen til at fila vokter noe.
  const matching = (): Row[] =>
    rowsOf().filter(r =>
      Object.entries(eqs).every(([k, v]) => r[k] === v) &&
      (inFilter === null || inFilter.vals.includes(r[inFilter.col])))

  const run = (): QueryResult => {
    if (inserted !== null) {
      state.loggedActions += inserted.length
      return { data: null, error: null }
    }
    if (table === 'admin_actions') {
      return { data: null, count: state.dayCount, error: state.dayCountError }
    }
    // Feilen injiseres kun i oppslaget som skjærer mot de forespurte id-ene,
    // ikke i medlemstellingen — de to er ulike kall i ruten.
    if (inFilter !== null && state.memberLookupError !== null) {
      return { data: null, count: null, error: state.memberLookupError }
    }
    const treff = matching()
    return { data: treff, count: treff.length, error: null }
  }

  const builder = {
    select() { return builder },
    insert(rows: Row[]) { inserted = rows; return builder },
    eq(col: string, val: unknown) { eqs[col] = val; return builder },
    in(col: string, vals: unknown[]) { inFilter = { col, vals }; return builder },
    gte() { return builder },
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
      auth: {
        getUser: async () => ({ data: { user: { id: ADMIN } }, error: null }),
        admin: {
          listUsers: async () => ({
            data: { users: Object.entries(EPOST).map(([id, email]) => ({ id, email })) },
            error: null,
          }),
        },
      },
      from: (table: string) => makeBuilder(table),
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to }: { to: string }) => { state.sentTo.push(to) },
  },
})

mock.module('@/lib/rate-limit-shared', {
  namedExports: { rateLimitShared: async () => ({ success: true, remaining: 99 }) },
})

// Låsen har sin egen test (org-lock-guard); her skal den aldri være det som
// stopper kallet, ellers ville medlemsvakten aldri blitt nådd.
mock.module('@/lib/org-lock-guard', {
  namedExports: {
    requireUnlockedOrg: async () => ({ ok: true as const }),
    ORG_LOCKED_CODE: 'org_locked',
    ORG_LOCKED_ERROR: 'låst',
  },
})

const { POST } = await import('@/app/api/org/[slug]/send-reminder/route')

const sendReminder = (userIds: unknown) =>
  POST(
    new Request(`https://quizkanonen.no/api/org/${ORG}/send-reminder`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ userIds }),
    }) as never,
    { params: Promise.resolve({ slug: ORG }) },
  )

beforeEach(() => {
  state.callerRole = 'admin'
  state.memberLookupError = null
  state.dayCount = 0
  state.dayCountError = null
  state.sentTo = []
  state.loggedActions = 0
  state.members = [
    { id: 'm0', organization_id: ORG, user_id: ADMIN,    role: 'admin' },
    { id: 'm1', organization_id: ORG, user_id: MEDLEM_A, role: 'member' },
    { id: 'm2', organization_id: ORG, user_id: MEDLEM_B, role: 'member' },
    // FREMMED er medlem av EN ANNEN org: id-en finnes, men ikke her. Uten
    // organization_id-filteret i ruten ville denne raden sluppet forbi.
    { id: 'm3', organization_id: 'ff000000-1111-4222-8333-999999999999', user_id: FREMMED, role: 'member' },
  ]
})

// ── 1. Normalveien ──────────────────────────────────────────────────────────

test('alle mottakere er medlemmer: sender, og bokfører kvoten', async () => {
  const res = await sendReminder([MEDLEM_A, MEDLEM_B])
  const body = await res.json() as { sent?: number }

  assert.equal(res.status, 200)
  assert.equal(body.sent, 2)
  // E-posten gikk faktisk ut — ellers ville testene under vært grønne fordi
  // ingenting noensinne sendes, ikke fordi vakten virker.
  assert.deepEqual([...state.sentTo].sort(), [EPOST[MEDLEM_A], EPOST[MEDLEM_B]].sort())
  assert.equal(state.loggedActions, 2)
})

// ── 2. Fremmed mottaker — hovedpoenget ──────────────────────────────────────

test('én mottaker er IKKE medlem: 403, og ingen e-post sendt', async () => {
  const res = await sendReminder([MEDLEM_A, FREMMED])
  const body = await res.json() as { error?: string; code?: string; sent?: number }

  assert.equal(res.status, 403)
  assert.equal(body.code, 'not_a_member')
  assert.match(body.error ?? '', /medlemmer av bedriften/)
  assert.equal(body.sent, undefined)

  // Begge halvdelene: ingen e-post i det hele tatt — heller ikke til MEDLEM_A.
  // En stille filtrering ville sendt til de 49 andre og skjult forsøket.
  assert.deepEqual(state.sentTo, [])
  assert.equal(state.loggedActions, 0)
})

test('ingen mottakere er medlemmer: 403, ingen e-post', async () => {
  const res = await sendReminder([FREMMED])
  const body = await res.json() as { error?: string; code?: string }

  assert.equal(res.status, 403)
  assert.equal(body.code, 'not_a_member')
  assert.deepEqual(state.sentTo, [])
  assert.equal(state.loggedActions, 0)
})

// ── 3. Ikke fått svar betyr UKJENT, aldri «er medlem» ───────────────────────

test('medlemsoppslaget feiler: 503, og ingen e-post', async () => {
  state.memberLookupError = { message: 'timeout' }

  const res = await sendReminder([MEDLEM_A])
  const body = await res.json() as { error?: string }

  assert.equal(res.status, 503)
  assert.match(body.error ?? '', /bekrefte mottakerne/)
  assert.deepEqual(state.sentTo, [])
})

// ── 4. Døgnkvote per org ────────────────────────────────────────────────────

test('døgnkvoten er brukt opp: 429, og ingen e-post', async () => {
  // 3 medlemmer i ORG gir gulvet på 50 per døgn (se lib/reminder-quota.ts).
  state.dayCount = 50

  const res = await sendReminder([MEDLEM_A])
  const body = await res.json() as { error?: string; remaining?: number; dayLimit?: number }

  assert.equal(res.status, 429)
  assert.equal(body.remaining, 0)
  assert.equal(body.dayLimit, 50)
  assert.deepEqual(state.sentTo, [])
})

test('en DB-feil i tellingen stopper ikke en ekte utsendelse', async () => {
  // Bevisst motsatt av send-invite: mottakerne er allerede skåret mot
  // medlemslista, så taket er uansett bedriftens egne ansatte.
  state.dayCountError = { message: 'nede' }

  const res = await sendReminder([MEDLEM_A])

  assert.equal(res.status, 200)
  assert.deepEqual(state.sentTo, [EPOST[MEDLEM_A]])
})

// ── 5. Rollesjekken skal fortsatt stå foran alt ─────────────────────────────

test('ikke admin i orgen: 403, og ingen e-post', async () => {
  state.members = state.members.map(m =>
    m.user_id === ADMIN ? { ...m, role: 'member' } : m)

  const res = await sendReminder([MEDLEM_A])

  assert.equal(res.status, 403)
  assert.deepEqual(state.sentTo, [])
})
