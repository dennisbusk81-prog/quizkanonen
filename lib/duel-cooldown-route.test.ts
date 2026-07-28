// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte POST /api/rivalries. `mock.module` bytter ut
// supabase-admin, e-post og rate-limit, slik at produksjonskoden kjøres uendret.
//
// FUNN 3.3 (høy) — spam-løkken utfordre → kanseller → utfordre. DELETE setter
// status 'cancelled', og opprettelsessperren teller kun 'pending'/'active', så
// løkken var fri og hver runde sendte en ny e-post til offeret.
//
// MUTASJONSBEVIS: fjernes hasExhaustedChallengesToRecipient-sjekken fra ruten,
// sender «spam-løkken stoppes» 5 e-poster i stedet for 3, og assert-en feiler.
//
// FUNN 2.2 dekkes også her, på rutenivå: en utløpt pending-rad skal ikke lenger
// gi 409. Fjernes blocksNewDuel-filtreringen, feiler den testen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ME = '11111111-1111-4111-8111-111111111111'
const RIVAL = '22222222-2222-4222-8222-222222222222'

type Row = { id: string; challenger_id: string; rival_id: string; status: string; created_at: string }

const state: {
  rows: Row[]
  sent: Array<{ to: string; subject: string }>
  nextId: number
} = { rows: [], sent: [], nextId: 1 }

const timerSiden = (t: number) => new Date(Date.now() - t * 3600_000).toISOString()

// Minimal PostgREST-etterligning: nok til at ruten kjører uendret.
// Filtrene samles opp og brukes på state.rows når spørringen awaites.
function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let orFilter: ((r: Row) => boolean) | null = null
  let insertedRow: Row | null = null

  const b: Record<string, unknown> = {
    select() { return b },
    eq(col: string, val: string) {
      filters.push(r => (r as unknown as Record<string, string>)[col] === val)
      return b
    },
    in(col: string, vals: string[]) {
      filters.push(r => vals.includes((r as unknown as Record<string, string>)[col]))
      return b
    },
    gte(col: string, val: string) {
      filters.push(r => (r as unknown as Record<string, string>)[col] >= val)
      return b
    },
    neq(col: string, val: string) {
      filters.push(r => (r as unknown as Record<string, string>)[col] !== val)
      return b
    },
    limit() { return b },
    // Ruten bruker .or() med uttrykk som «challenger_id.eq.X,rival_id.eq.X» og
    // and(...)-varianter. Vi trenger bare å vite hvilke bruker-id-er som nevnes.
    or(expr: string) {
      const ids = [...expr.matchAll(/(?:challenger_id|rival_id)\.eq\.([0-9a-f-]+)/g)].map(m => m[1])
      orFilter = r => ids.includes(r.challenger_id) || ids.includes(r.rival_id)
      return b
    },
    insert(row: Omit<Row, 'id' | 'created_at'>) {
      insertedRow = {
        ...row,
        id: `row-${state.nextId++}`,
        created_at: new Date().toISOString(),
      } as Row
      state.rows.push(insertedRow)
      return b
    },
    delete() {
      // .delete().eq('id', x) — filteret registreres etterpå, så vi utfører ved await
      return {
        eq(col: string, val: string) {
          state.rows = state.rows.filter(r => (r as unknown as Record<string, string>)[col] !== val)
          return Promise.resolve({ error: null })
        },
      }
    },
    single() {
      if (table === 'profiles') {
        return Promise.resolve({ data: { display_name: 'Rival Rivalsen', email_duel_notifications: true }, error: null })
      }
      if (insertedRow) return Promise.resolve({ data: { id: insertedRow.id }, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    then(resolve: (v: unknown) => void) {
      if (table !== 'rivalries') return resolve({ data: [], error: null })
      let out = state.rows
      if (orFilter) out = out.filter(orFilter)
      for (const f of filters) out = out.filter(f)
      return resolve({ data: out, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => ({ data: { user: { id: ME, email: 'meg@test.no' } }, error: null }),
        admin: { getUserById: async () => ({ data: { user: { email: 'offer@test.no' } } }) },
      },
      from: (table: string) => builder(table),
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (opts: { to: string; subject: string }) => { state.sent.push(opts) },
  },
})

// IP-rate-limiten er en egen sak og ville ellers slått inn etter 5 kall her.
// Den slås av med vilje, nettopp for å bevise at sperren mot samme mottaker
// virker UAVHENGIG av den.
mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

const { POST } = await import('@/app/api/rivalries/route')

function utfordre() {
  const request = new Request('https://quizkanonen.no/api/rivalries', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ rival_id: RIVAL }),
  })
  return POST(request as never)
}

/** Etterligner DELETE-ruten: setter status 'cancelled'. */
function kanseller() {
  const siste = state.rows.filter(r => r.status === 'pending').at(-1)
  if (siste) siste.status = 'cancelled'
}

beforeEach(() => {
  state.rows = []
  state.sent = []
  state.nextId = 1
})

test('SPAM-LØKKE: utfordre → kanseller → utfordre stoppes etter 3 e-poster', async () => {
  const statuser: number[] = []
  for (let i = 0; i < 5; i++) {
    const res = await utfordre()
    statuser.push(res.status)
    kanseller()
  }

  assert.deepEqual(statuser, [201, 201, 201, 429, 429], 'de tre første går gjennom, resten avvises')
  assert.equal(state.sent.length, 3, 'offeret skal maks få 3 e-poster per døgn — ikke én per runde')
})

test('avvisningen forklarer hvorfor, og nevner mottakeren', async () => {
  for (let i = 0; i < 3; i++) { await utfordre(); kanseller() }
  const res = await utfordre()
  assert.equal(res.status, 429)
  const json = await res.json()
  assert.match(json.error, /Rival Rivalsen/)
  assert.match(json.error, /siste døgnet/)
})

test('sperren gjelder per mottaker, ikke globalt — gamle forsøk faller ut', async () => {
  // Tre utfordringer, men de er over et døgn gamle.
  state.rows = [1, 2, 3].map((n, i) => ({
    id: `gammel-${i}`,
    challenger_id: ME,
    rival_id: RIVAL,
    status: 'cancelled',
    created_at: timerSiden(25 + n),
  }))
  const res = await utfordre()
  assert.equal(res.status, 201, 'forsøk eldre enn 24 timer skal ikke telle med')
  assert.equal(state.sent.length, 1)
})

test('DØDLÅS (FUNN 2.2): utløpt pending blokkerer ikke en ny utfordring', async () => {
  // Ubesvart utfordring fra tidligere i samme måned, 17 dager gammel.
  state.rows = [{
    id: 'dodlas',
    challenger_id: ME,
    rival_id: '33333333-3333-4333-8333-333333333333',
    status: 'pending',
    created_at: timerSiden(17 * 24),
  }]

  const res = await utfordre()
  assert.equal(res.status, 201, 'den utløpte raden skal ikke låse brukeren ute')
  assert.equal(state.sent.length, 1)
})

test('ugyldig rival_id avvises FØR noe database-arbeid (FUNN 5.5)', async () => {
  // Verdier som ikke er UUID-er skal aldri nå .or()-filterstrengene.
  for (const ond of ["abc", "x'); delete from rivalries; --", 'challenger_id.eq.hacket', '11111111-1111-4111-8111-11111111111Z']) {
    const request = new Request('https://quizkanonen.no/api/rivalries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ rival_id: ond }),
    })
    const res = await POST(request as never)
    assert.equal(res.status, 400, `"${ond}" skulle vært avvist`)
    assert.match((await res.json()).error, /Ugyldig rival_id/)
  }
  assert.equal(state.rows.length, 0, 'ingen rad skal ha blitt opprettet')
  assert.equal(state.sent.length, 0, 'ingen e-post skal ha gått ut')
})

test('en LEVENDE pending blokkerer fortsatt', async () => {
  state.rows = [{
    id: 'levende',
    challenger_id: ME,
    rival_id: '33333333-3333-4333-8333-333333333333',
    status: 'pending',
    created_at: timerSiden(2 * 24),
  }]

  const res = await utfordre()
  assert.equal(res.status, 409)
  assert.equal(state.sent.length, 0)
  assert.match((await res.json()).error, /allerede en aktiv eller ventende duell/)
})
