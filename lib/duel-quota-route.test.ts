// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte POST /api/rivalries. `mock.module` bytter ut
// supabase-admin, e-post og rate-limit, slik at produksjonskoden kjøres uendret.
//
// SAKEN: lib/duel-cooldown.ts stopper 3 utfordringer per døgn mot SAMME
// mottaker, men ingenting stoppet én konto fra å gå gjennom mottakerlista. Med
// ~400 medlemmer var det reelle taket per konto ~1200 e-poster i døgnet.
//
// MUTASJONSBEVIS (begge kjørt):
//   • Fjernes senderQuota-sjekken fra ruten → «taket stopper løkken» får 201 på
//     utfordring nr. 11 og 12, og e-postene fortsetter. 3 tester ryker.
//   • Fjernes bokføringen (insert i admin_actions) → telleren står på 0 for
//     alltid, taket slår aldri inn. Samme 3 tester ryker.
//   • Byttes `sentCountError`-grenen til å slippe gjennom → «fail closed»-testen
//     ryker (utfordringen sendes selv om forbruket ikke kan bekreftes).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { DUEL_SENDER_MAX_PER_DAY, DUEL_SENT_ACTION } from '@/lib/duel-quota'

const ME = '11111111-1111-4111-8111-111111111111'
/** Distinkte mottakere — poenget er nettopp at angriperen bytter offer. */
const rival = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

type Row = { id: string; challenger_id: string; rival_id: string; status: string; created_at: string }
type ActionRow = { action_type: string; user_id: string; scope_type: string; scope_id: string; created_at: string }

const state: {
  rows: Row[]
  actions: ActionRow[]
  sent: Array<{ to: string; subject: string }>
  nextId: number
  /** Settes for å simulere at admin_actions-tellingen feiler. */
  countFails: boolean
} = { rows: [], actions: [], sent: [], nextId: 1, countFails: false }

const timerSiden = (t: number) => new Date(Date.now() - t * 3600_000).toISOString()

// Minimal PostgREST-etterligning. I motsetning til lib/duel-cooldown-route.test.ts
// må denne også kunne telle (`count: 'exact', head: true`) og skille tabellene,
// siden hele saken handler om bokføring i admin_actions.
function builder(table: string) {
  const filters: Array<(r: Record<string, string>) => boolean> = []
  let orFilter: ((r: Row) => boolean) | null = null
  let counting = false
  let insertedRow: Row | null = null

  const b: Record<string, unknown> = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.count) counting = true
      return b
    },
    eq(col: string, val: string) {
      filters.push(r => r[col] === val)
      return b
    },
    in(col: string, vals: string[]) {
      filters.push(r => vals.includes(r[col]))
      return b
    },
    gte(col: string, val: string) {
      filters.push(r => r[col] >= val)
      return b
    },
    neq(col: string, val: string) {
      filters.push(r => r[col] !== val)
      return b
    },
    limit() { return b },
    or(expr: string) {
      const ids = [...expr.matchAll(/(?:challenger_id|rival_id)\.eq\.([0-9a-f-]+)/g)].map(m => m[1])
      orFilter = r => ids.includes(r.challenger_id) || ids.includes(r.rival_id)
      return b
    },
    insert(row: Record<string, string>) {
      if (table === 'admin_actions') {
        state.actions.push({ ...row, created_at: new Date().toISOString() } as ActionRow)
        return Promise.resolve({ error: null })
      }
      insertedRow = {
        ...row,
        id: `row-${state.nextId++}`,
        created_at: new Date().toISOString(),
      } as unknown as Row
      state.rows.push(insertedRow)
      return b
    },
    delete() {
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
      if (table === 'admin_actions') {
        if (state.countFails) {
          return resolve({ data: null, count: null, error: { message: 'simulert DB-feil' } })
        }
        const hits = state.actions.filter(a =>
          filters.every(f => f(a as unknown as Record<string, string>))
        )
        return resolve({ data: counting ? null : hits, count: hits.length, error: null })
      }
      if (table !== 'rivalries') return resolve({ data: [], error: null })
      let out = state.rows
      if (orFilter) out = out.filter(orFilter)
      for (const f of filters) out = out.filter(f as (r: Row) => boolean)
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

// IP-bremsen er et eget lag (modul-lokal Map, lever per serverless-instans) og
// slås av med vilje: taket per avsender skal virke UAVHENGIG av den.
mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

const { POST } = await import('@/app/api/rivalries/route')

function utfordre(rivalId: string) {
  const request = new Request('https://quizkanonen.no/api/rivalries', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ rival_id: rivalId }),
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
  state.actions = []
  state.sent = []
  state.nextId = 1
  state.countFails = false
})

test('SPAM-LØKKE PÅ TVERS AV MOTTAKERE: taket stopper løkken etter døgnkvoten', async () => {
  // Angrepet: utfordre → kanseller → utfordre NESTE person. Mottaker-sperren
  // (maks 3 per person) treffer aldri, fordi offeret byttes hver runde.
  const statuser: number[] = []
  for (let i = 0; i < DUEL_SENDER_MAX_PER_DAY + 2; i++) {
    statuser.push((await utfordre(rival(i))).status)
    kanseller()
  }

  const gjennom = statuser.filter(s => s === 201).length
  const avvist = statuser.filter(s => s === 429).length

  assert.equal(gjennom, DUEL_SENDER_MAX_PER_DAY, 'nøyaktig døgnkvoten skal slippe gjennom')
  assert.equal(avvist, 2, 'resten skal avvises med 429')
  assert.equal(state.sent.length, DUEL_SENDER_MAX_PER_DAY, 'ingen e-post ut over kvoten')
  assert.equal(state.rows.length, DUEL_SENDER_MAX_PER_DAY, 'ingen duell-rad ut over kvoten')
})

test('avvisningen forklarer at kontoen må vente, ikke at mottakeren er problemet', async () => {
  for (let i = 0; i < DUEL_SENDER_MAX_PER_DAY; i++) {
    await utfordre(rival(i))
    kanseller()
  }
  const res = await utfordre(rival(99))
  assert.equal(res.status, 429)
  assert.match((await res.json()).error, /Du har sendt mange utfordringer/)
})

test('hver sendt utfordring bokføres i admin_actions med avsenderens user_id', async () => {
  await utfordre(rival(1))
  kanseller()
  await utfordre(rival(2))

  assert.equal(state.actions.length, 2)
  for (const a of state.actions) {
    assert.equal(a.action_type, DUEL_SENT_ACTION, 'må ha egen action_type, ellers blandes tellingene')
    assert.equal(a.user_id, ME, 'tellingen skjer per AVSENDER — user_id er nøkkelen')
  }
})

test('bokføring eldre enn et døgn teller ikke — kvoten er rullerende', async () => {
  state.actions = Array.from({ length: DUEL_SENDER_MAX_PER_DAY }, () => ({
    action_type: DUEL_SENT_ACTION,
    user_id: ME,
    scope_type: 'rivalry',
    scope_id: rival(1),
    created_at: timerSiden(25),
  }))

  const res = await utfordre(rival(50))
  assert.equal(res.status, 201, 'utfordringer eldre enn 24 timer skal ha falt ut av vinduet')
  assert.equal(state.sent.length, 1)
})

test('bokføring fra en ANNEN konto teller ikke mot meg', async () => {
  state.actions = Array.from({ length: DUEL_SENDER_MAX_PER_DAY + 5 }, () => ({
    action_type: DUEL_SENT_ACTION,
    user_id: '99999999-9999-4999-8999-999999999999',
    scope_type: 'rivalry',
    scope_id: rival(2),
    created_at: new Date().toISOString(),
  }))

  const res = await utfordre(rival(51))
  assert.equal(res.status, 201, 'en annen brukers forbruk skal ikke låse meg ute')
})

test('annen bokføring i admin_actions teller ikke med (org-invitasjoner, kode-bom)', async () => {
  // Tabellen deles med lib/invite-quota.ts og lib/redeem-throttle.ts. Et for
  // løst filter her ville gitt en org-admin null dueller etter en invitasjonsrunde.
  state.actions = Array.from({ length: DUEL_SENDER_MAX_PER_DAY + 5 }, () => ({
    action_type: 'org_invite_email',
    user_id: ME,
    scope_type: 'organization',
    scope_id: rival(3),
    created_at: new Date().toISOString(),
  }))

  const res = await utfordre(rival(52))
  assert.equal(res.status, 201, 'kun duell-bokføring skal telle mot duell-kvoten')
})

test('FAIL CLOSED: kan ikke forbruket telles, sendes ingen utfordring', async () => {
  state.countFails = true

  const res = await utfordre(rival(7))
  assert.equal(res.status, 503, 'en DB-feil skal ikke være omveien rundt grensen')
  assert.equal(state.rows.length, 0, 'ingen duell-rad opprettet')
  assert.equal(state.sent.length, 0, 'ingen e-post sendt')
})

test('TILLEGG, IKKE ERSTATNING: mottaker-sperren på 3 står urørt', async () => {
  // Døgnkvoten er 10, så den kan ikke være grunnen til at nr. 4 avvises her.
  const statuser: number[] = []
  for (let i = 0; i < 4; i++) {
    statuser.push((await utfordre(rival(1))).status)
    kanseller()
  }

  assert.deepEqual(statuser, [201, 201, 201, 429], 'maks 3 mot samme mottaker, som før')
  assert.match(
    (await (await utfordre(rival(1))).json()).error,
    /Rival Rivalsen/,
    'meldingen skal fortsatt være den mottaker-spesifikke'
  )
  assert.equal(state.sent.length, 3)
})
