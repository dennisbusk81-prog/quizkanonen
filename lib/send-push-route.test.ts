// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte send-push-cronen. `mock.module` bytter ut
// supabase-admin, web-push og waitUntil — ruten selv kjøres uendret.
//
// INGEN EKTE PUSH: `webpush.sendNotification` er mocket bort, så ingen
// varsler forlater maskinen. Mocken teller endepunkter i stedet.
//
// MUTASJONSBEVIS (verifisert ved å sette mekanismene tilbake midlertidig):
//   (a) Settes `.is('push_sent_at', null)` tilbake i quiz-oppslaget, feiler
//       «delvis varslet quiz med push_sent_at satt plukkes fortsatt opp» —
//       de gjenstående enhetene får da ALDRI varselet.
//   (b) Fjernes is_test/is_active-guardene, feiler «testquiz stjeler ikke
//       varselet fra den ekte quizen»: testquizen vinner sorteringen og den
//       ekte quizens push sendes aldri.
//   (c) Flyttes stemplingen ut av løkken, feiler «stemplingen skrives per
//       batch» (1 skriving i stedet for 3).
//   (d) Fjernes fratrekket mot varslingsloggen, feiler «kun restene får push».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'
process.env.VAPID_PUBLIC_KEY = 'test-public'
process.env.VAPID_PRIVATE_KEY = 'test-private'

const QUIZ_ID   = 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e'
const TEST_QUIZ = 'cccccccc-1111-2222-3333-444444444444'
const NIL_SCOPE = '00000000-0000-0000-0000-000000000000'

type QuizRow = {
  id: string; title: string | null; opens_at: string
  is_test: boolean; is_active: boolean; push_sent_at: string | null
}
type SubRow = { id: string; endpoint: string; p256dh: string; auth: string }
type LogRow = { quiz_id: string; channel: string; scope_id: string; recipient_id: string }

const db: {
  quizzes: QuizRow[]
  subs: SubRow[]
  log: LogRow[]
  pushedTo: string[]
  failWith: Map<string, number>
  upserts: LogRow[][]
  deletedEndpoints: string[]
  quizWrites: number
} = {
  quizzes: [], subs: [], log: [], pushedTo: [],
  failWith: new Map(), upserts: [], deletedEndpoints: [], quizWrites: 0,
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

let pending: Promise<unknown>[] = []
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})

// ── web-push: ingen ekte varsler ───────────────────────────────────────────
let vapidCalls = 0
mock.module('web-push', {
  defaultExport: {
    setVapidDetails: () => { vapidCalls++ },
    sendNotification: async (sub: { endpoint: string }) => {
      const status = db.failWith.get(sub.endpoint)
      if (status !== undefined) {
        // web-push kaster et feilobjekt med statusCode — 410/404 betyr at
        // abonnementet er dødt.
        throw Object.assign(new Error(`push failed ${status}`), { statusCode: status })
      }
      db.pushedTo.push(sub.endpoint)
      return { statusCode: 201 }
    },
  },
})

// ── Supabase ───────────────────────────────────────────────────────────────
function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let lteCol: string | null = null, lteVal: string | null = null
  let gteCol: string | null = null, gteVal: string | null = null
  let isNullCol: string | null = null
  let inCol: string | null = null, inVals: string[] = []
  let limitN: number | null = null
  let rangeFrom = 0, rangeTo = Number.MAX_SAFE_INTEGER
  let orderCol: string | null = null
  let upserting: LogRow[] | null = null
  let deleting = false

  const source = (): Record<string, unknown>[] => {
    switch (table) {
      case 'quizzes':               return db.quizzes as unknown as Record<string, unknown>[]
      case 'push_subscriptions':    return db.subs as unknown as Record<string, unknown>[]
      case 'quiz_notification_log': return db.log as unknown as Record<string, unknown>[]
      default: throw new Error(`ukjent tabell i mock: ${table}`)
    }
  }

  const matching = (): Record<string, unknown>[] =>
    source().filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (lteCol && lteVal !== null && String(r[lteCol]) > lteVal) return false
      if (gteCol && gteVal !== null && String(r[gteCol]) < gteVal) return false
      if (isNullCol && r[isNullCol] !== null && r[isNullCol] !== undefined) return false
      if (inCol && !inVals.includes(String(r[inCol]))) return false
      return true
    })

  const rows = (): Record<string, unknown>[] => {
    let out = matching()
    // Ruten sorterer quiz-oppslaget synkende på opens_at og tar den første.
    if (orderCol === 'opens_at') {
      out = [...out].sort((a, b) => String(b.opens_at).localeCompare(String(a.opens_at)))
    }
    if (limitN !== null) out = out.slice(0, limitN)
    return out.slice(rangeFrom, rangeTo + 1)
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    is(col: string, val: unknown) { if (val === null) isNullCol = col; return b },
    lte(col: string, val: string) { lteCol = col; lteVal = val; return b },
    gte(col: string, val: string) { gteCol = col; gteVal = val; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals.map(String); return b },
    order(col: string, opts?: { ascending?: boolean }) {
      if (opts?.ascending === false) orderCol = col
      return b
    },
    limit(n: number) { limitN = n; return b },
    range(from: number, to: number) { rangeFrom = from; rangeTo = to; return b },
    update() { if (table === 'quizzes') db.quizWrites++; return b },
    delete() { deleting = true; return b },
    upsert(vals: LogRow[]) { upserting = vals; return b },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
    then(resolve: (v: unknown) => void) {
      if (upserting) {
        const fresh = upserting.filter(n => !db.log.some(e =>
          e.quiz_id === n.quiz_id && e.channel === n.channel &&
          e.scope_id === n.scope_id && e.recipient_id === n.recipient_id))
        db.upserts.push([...upserting])
        db.log.push(...fresh)
        return resolve({ error: null })
      }
      if (deleting && table === 'push_subscriptions') {
        const doomed = matching().map(r => String(r.endpoint))
        db.deletedEndpoints.push(...doomed)
        db.subs = db.subs.filter(s => !doomed.includes(s.endpoint))
        return resolve({ error: null })
      }
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const routeModule = await import('@/app/api/cron/send-push/route')
const { GET } = routeModule

async function call(secret = 'test-cron-secret') {
  pending = []
  const request = new Request('https://quizkanonen.no/api/cron/send-push', {
    headers: { authorization: `Bearer ${secret}` },
  })
  const res = await GET(request as never)
  await Promise.all(pending)
  return res
}

const quiz = (over: Partial<QuizRow> = {}): QuizRow => ({
  id: QUIZ_ID, title: 'Ukens quiz', opens_at: minutesAgo(3),
  is_test: false, is_active: true, push_sent_at: null,
  ...over,
})

const sub = (id: string, over: Partial<SubRow> = {}): SubRow => ({
  id, endpoint: `https://push.example/${id}`, p256dh: 'key', auth: 'auth', ...over,
})

const logged = (recipientId: string, over: Partial<LogRow> = {}): LogRow => ({
  quiz_id: QUIZ_ID, channel: 'quiz_open_push', scope_id: NIL_SCOPE,
  recipient_id: recipientId, ...over,
})

const subs = (n: number) => Array.from({ length: n }, (_, i) => sub(`s${i}`))

beforeEach(() => {
  db.quizzes = [quiz()]
  db.subs = []
  db.log = []
  db.pushedTo = []
  db.failWith = new Map()
  db.upserts = []
  db.deletedEndpoints = []
  db.quizWrites = 0
  vapidCalls = 0
})

// ── Rammeverk ───────────────────────────────────────────────────────────────

test('ruten setter maxDuration eksplisitt', () => {
  // Ruten hadde ingen i det hele tatt og arvet standardbudsjettet.
  assert.equal((routeModule as { maxDuration?: number }).maxDuration, 60)
})

test('feil hemmelighet gir 401 og sender ingen push', async () => {
  db.subs = subs(2)
  const res = await call('feil-hemmelighet')
  assert.equal(res.status, 401)
  assert.deepEqual(db.pushedTo, [])
  assert.equal(vapidCalls, 0)
})

// ── Grunnflyt ───────────────────────────────────────────────────────────────

test('alle abonnementer får push og én loggrad hver', async () => {
  db.subs = subs(3)

  const res = await call()
  assert.equal(res.status, 200)

  assert.equal(db.pushedTo.length, 3)
  assert.deepEqual(db.log.map(l => l.recipient_id).sort(), ['s0', 's1', 's2'])
  assert.equal(db.log.every(l => l.quiz_id === QUIZ_ID && l.channel === 'quiz_open_push'), true)
})

test('to enheter for samme bruker får begge push', async () => {
  // Enheten er ABONNEMENTET, ikke brukeren — derfor er recipient_id
  // push_subscriptions.id og ikke user_id.
  db.subs = [sub('mobil'), sub('laptop')]

  await call()
  assert.equal(db.pushedTo.length, 2)
  assert.deepEqual(db.log.map(l => l.recipient_id).sort(), ['laptop', 'mobil'])
})

test('ingen quiz i vinduet → ingen push', async () => {
  db.quizzes = [quiz({ opens_at: minutesAgo(120) })]
  db.subs = subs(2)

  await call()
  assert.deepEqual(db.pushedTo, [])
})

test('ingen abonnementer → ingenting skjer, og quizen stemples ikke', async () => {
  db.subs = []
  await call()
  assert.deepEqual(db.upserts, [])
  assert.equal(db.quizWrites, 0)
})

// ── is_test / is_active — nytt funn, samme feilklasse ───────────────────────

test('testquiz varsles ikke', async () => {
  db.quizzes = [quiz({ is_test: true })]
  db.subs = subs(2)

  await call()
  assert.deepEqual(db.pushedTo, [])
})

test('skjult quiz (is_active=false) varsles ikke', async () => {
  db.quizzes = [quiz({ is_active: false })]
  db.subs = subs(2)

  await call()
  assert.deepEqual(db.pushedTo, [])
})

test('testquiz stjeler ikke varselet fra den ekte quizen', async () => {
  // MUTASJONSBEVIS (b). Uten guardene vinner testquizen
  // `order('opens_at', desc)` fordi den åpnet sist, blir stemplet som
  // varslet, og den ekte quizens push sendes ALDRI — stille.
  db.quizzes = [
    quiz({ id: QUIZ_ID, opens_at: minutesAgo(8) }),
    quiz({ id: TEST_QUIZ, opens_at: minutesAgo(1), is_test: true, title: 'Testquiz' }),
  ]
  db.subs = subs(2)

  await call()

  assert.equal(db.pushedTo.length, 2)
  assert.equal(db.log.every(l => l.quiz_id === QUIZ_ID), true, 'loggen skal peke på den EKTE quizen')
})

// ── Gjenopptakelse ──────────────────────────────────────────────────────────

test('delvis varslet quiz: kun restene får push', async () => {
  db.subs = subs(3)
  db.log = [logged('s0')]

  await call()

  assert.equal(db.pushedTo.includes('https://push.example/s0'), false)
  assert.equal(db.pushedTo.length, 2)
  assert.deepEqual(db.log.map(l => l.recipient_id).sort(), ['s0', 's1', 's2'])
})

test('delvis varslet quiz med push_sent_at satt plukkes fortsatt opp', async () => {
  // MUTASJONSBEVIS (a).
  db.quizzes = [quiz({ push_sent_at: minutesAgo(2) })]
  db.subs = subs(3)
  db.log = [logged('s0')]

  await call()
  assert.equal(db.pushedTo.length, 2)
})

test('ruten skriver ikke lenger til quizzes', async () => {
  db.subs = subs(2)
  await call()
  assert.equal(db.quizWrites, 0, 'push_sent_at er død og skal ikke skrives')
})

test('to kjøringer på rad gir nøyaktig én push per abonnement', async () => {
  db.subs = subs(3)

  await call()
  await call()

  assert.equal(db.pushedTo.length, 3)
  assert.equal(db.log.length, 3)
})

test('alle alt varslet → ingen push og ingen skriving', async () => {
  db.subs = subs(2)
  db.log = [logged('s0'), logged('s1')]

  await call()
  assert.deepEqual(db.pushedTo, [])
  assert.deepEqual(db.upserts, [])
})

// ── Feil og døde abonnementer ───────────────────────────────────────────────

test('en feilet push stemples ikke og forsøkes på nytt neste kjøring', async () => {
  db.subs = subs(2)
  db.failWith = new Map([['https://push.example/s1', 500]])

  await call()
  assert.deepEqual(db.log.map(l => l.recipient_id), ['s0'])

  db.failWith = new Map()
  db.pushedTo = []
  await call()

  assert.deepEqual(db.pushedTo, ['https://push.example/s1'])
  assert.deepEqual(db.log.map(l => l.recipient_id).sort(), ['s0', 's1'])
})

test('410 sletter abonnementet og stempler det ikke', async () => {
  db.subs = subs(2)
  db.failWith = new Map([['https://push.example/s1', 410]])

  await call()

  assert.deepEqual(db.deletedEndpoints, ['https://push.example/s1'])
  assert.deepEqual(db.log.map(l => l.recipient_id), ['s0'])
  assert.deepEqual(db.subs.map(s => s.id), ['s0'], 'den døde raden skal være borte')
})

// ── Stempling per batch ─────────────────────────────────────────────────────

test('stemplingen skrives per batch, ikke som én skriving til slutt', async () => {
  // MUTASJONSBEVIS (c). 45 abonnementer = 3 batcher (20/20/5).
  db.subs = subs(45)

  await call()

  assert.equal(db.upserts.length, 3, 'én skriving per batch')
  assert.deepEqual(db.upserts.map(u => u.length), [20, 20, 5])
  assert.equal(db.pushedTo.length, 45)
})
