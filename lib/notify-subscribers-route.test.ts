// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte notify-subscribers-cronen. `mock.module` bytter
// ut supabase-admin, lib/email og waitUntil — ruten selv kjøres uendret,
// inkludert quiz-vinduet, abonnentfilteret og stemplingen.
//
// INGEN EKTE E-POST: `sendEmail` er mocket bort, så verken Resend eller
// nettverket røres. Mocken teller kall i stedet.
//
// Mocken implementerer `.or(...)`-filteret ekte, ikke bare signaturen. Uten
// det ville testen «allerede varslede hoppes over» bestått også med filteret
// fjernet fra ruten.
//
// MUTASJONSBEVIS (verifisert ved å sette mekanismene tilbake midlertidig):
//   (a) Legges den gamle «er quizen allerede varslet?»-sjekken tilbake øverst
//       i ruten, feiler «delvis varslet quiz: kun restene får e-post» —
//       ruten hopper da over hele kjøringen og de to gjenstående får ALDRI
//       e-posten (stille undersending).
//   (b) Fjernes `.or(...)`-filteret fra abonnenthentingen, feiler samme test
//       motsatt vei: den alt varslede får e-posten på nytt.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'
process.env.NEXT_PUBLIC_SITE_URL = 'https://www.quizkanonen.no'

const QUIZ_ID = 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e'
const ANNEN_QUIZ = '11111111-2222-3333-4444-555555555555'

type SubRow = { id: string; email: string; notified_at: string | null; notified_quiz_id: string | null }
type QuizRow = { id: string; title: string | null; opens_at: string }

const db: {
  quizzes: QuizRow[]
  subs: SubRow[]
  sentTo: string[]
  sendFailsFor: Set<string>
  updates: { ids: string[]; quizId: string }[]
} = { quizzes: [], subs: [], sentTo: [], sendFailsFor: new Set(), updates: [] }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

// ── waitUntil: fang bakgrunnsjobben så testen kan vente på den ──────────────
let pending: Promise<unknown>[] = []
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})

// ── e-post: ingen ekte utsending ───────────────────────────────────────────
mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to }: { to: string }) => {
      if (db.sendFailsFor.has(to)) throw new Error('Resend sa nei')
      db.sentTo.push(to)
      return { id: 'mock' }
    },
  },
})

// ── Supabase ───────────────────────────────────────────────────────────────
function builder(table: string) {
  let lteCol: string | null = null, lteVal: string | null = null
  let gteCol: string | null = null, gteVal: string | null = null
  let orExpr: string | null = null
  let limitN: number | null = null
  let rangeFrom = 0, rangeTo = Number.MAX_SAFE_INTEGER
  let updating: Record<string, string> | null = null
  let inCol: string | null = null, inVals: string[] = []
  // `.eq` brukes ikke av ruten slik den står nå. Mocken støtter den likevel,
  // slik at mutasjonsbevis (a) — å sette den gamle alt-eller-intet-sjekken
  // tilbake — måler ruten og ikke en manglende mock-metode.
  const eqs: Record<string, unknown> = {}

  /** Speiler PostgREST sitt `.or('a.is.null,a.neq.X')`. */
  const matchesOr = (row: Record<string, unknown>): boolean => {
    if (!orExpr) return true
    return orExpr.split(',').some(clause => {
      const [col, op, val] = clause.split('.')
      const cell = row[col]
      if (op === 'is' && val === 'null') return cell === null || cell === undefined
      if (op === 'neq') return cell !== val
      return false
    })
  }

  const rows = (): Record<string, unknown>[] => {
    const source: Record<string, unknown>[] =
      table === 'quizzes' ? (db.quizzes as unknown as Record<string, unknown>[])
      : table === 'quiz_notifications' ? (db.subs as unknown as Record<string, unknown>[])
      : []

    let out = source.filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (lteCol && lteVal !== null && String(r[lteCol]) > lteVal) return false
      if (gteCol && gteVal !== null && String(r[gteCol]) < gteVal) return false
      if (!matchesOr(r)) return false
      return true
    })
    if (limitN !== null) out = out.slice(0, limitN)
    return out.slice(rangeFrom, rangeTo + 1)
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    update(patch: Record<string, string>) { updating = patch; return b },
    lte(col: string, val: string) { lteCol = col; lteVal = val; return b },
    gte(col: string, val: string) { gteCol = col; gteVal = val; return b },
    or(expr: string) { orExpr = expr; return b },
    order() { return b },
    limit(n: number) { limitN = n; return b },
    range(from: number, to: number) { rangeFrom = from; rangeTo = to; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals; return b },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
    then(resolve: (v: unknown) => void) {
      if (updating && table === 'quiz_notifications' && inCol) {
        db.updates.push({ ids: [...inVals], quizId: String(updating.notified_quiz_id) })
        for (const s of db.subs) {
          if (inVals.includes(s.id)) {
            s.notified_at = updating.notified_at
            s.notified_quiz_id = updating.notified_quiz_id
          }
        }
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

const routeModule = await import('@/app/api/cron/notify-subscribers/route')
const { GET } = routeModule

async function call(secret = 'test-cron-secret') {
  pending = []
  const request = new Request('https://quizkanonen.no/api/cron/notify-subscribers', {
    headers: { authorization: `Bearer ${secret}` },
  })
  const res = await GET(request as never)
  await Promise.all(pending) // vent på waitUntil-jobben
  return res
}

const sub = (id: string, over: Partial<SubRow> = {}): SubRow => ({
  id,
  email: `${id}@example.com`,
  notified_at: null,
  notified_quiz_id: null,
  ...over,
})

beforeEach(() => {
  db.quizzes = [{ id: QUIZ_ID, title: 'Ukens quiz', opens_at: minutesAgo(3) }]
  db.subs = []
  db.sentTo = []
  db.sendFailsFor = new Set()
  db.updates = []
})

// ── maxDuration ─────────────────────────────────────────────────────────────

test('ruten setter maxDuration eksplisitt', () => {
  // Uten denne arvet ruten standardbudsjettet, mens søsterrutene sto på 60.
  assert.equal((routeModule as { maxDuration?: number }).maxDuration, 60)
})

// ── Grunnflyt ───────────────────────────────────────────────────────────────

test('alle uvarslede abonnenter får e-post og stemples', async () => {
  db.subs = [sub('a'), sub('b'), sub('c')]

  const res = await call()
  assert.equal(res.status, 200)

  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com', 'c@example.com'])
  assert.equal(db.subs.every(s => s.notified_quiz_id === QUIZ_ID), true)
  assert.equal(db.subs.every(s => s.notified_at !== null), true)
})

test('ingen quiz i vinduet → ingen e-post', async () => {
  db.quizzes = [{ id: QUIZ_ID, title: 'Gammel', opens_at: minutesAgo(120) }]
  db.subs = [sub('a')]

  await call()
  assert.deepEqual(db.sentTo, [])
})

test('feil hemmelighet gir 401 og sender ingenting', async () => {
  db.subs = [sub('a')]
  const res = await call('feil-hemmelighet')

  assert.equal(res.status, 401)
  assert.deepEqual(db.sentTo, [])
})

// ── Gjenopptakelse: kjernen i F4 ────────────────────────────────────────────

test('delvis varslet quiz: kun restene får e-post, ingen duplikat', async () => {
  // Slik ser verden ut etter en kjøring som ble drept midt i løkken: 'a' er
  // levert OG stemplet, 'b' og 'c' er ikke.
  db.subs = [
    sub('a', { notified_at: minutesAgo(1), notified_quiz_id: QUIZ_ID }),
    sub('b'),
    sub('c'),
  ]

  await call()

  // 'a' skal IKKE få e-posten på nytt ...
  assert.equal(db.sentTo.includes('a@example.com'), false, 'allerede varslet skal ikke få duplikat')
  // ... og 'b'/'c' skal IKKE bli hoppet over.
  assert.deepEqual(db.sentTo.sort(), ['b@example.com', 'c@example.com'])
  assert.equal(db.subs.every(s => s.notified_quiz_id === QUIZ_ID), true)
})

test('en abonnent varslet om en ANNEN quiz får e-post om den nye', async () => {
  db.subs = [
    sub('a', { notified_at: minutesAgo(9000), notified_quiz_id: ANNEN_QUIZ }),
    sub('b'),
  ]

  await call()
  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com'])
})

test('alle alt varslet → ingen e-post og ingen skriving', async () => {
  db.subs = [
    sub('a', { notified_at: minutesAgo(1), notified_quiz_id: QUIZ_ID }),
    sub('b', { notified_at: minutesAgo(1), notified_quiz_id: QUIZ_ID }),
  ]

  await call()
  assert.deepEqual(db.sentTo, [])
  assert.deepEqual(db.updates, [])
})

test('to kjøringer på rad gir nøyaktig én e-post per abonnent', async () => {
  db.subs = [sub('a'), sub('b'), sub('c')]

  await call()
  await call()

  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com', 'c@example.com'])
})

// ── Feilede sendinger ───────────────────────────────────────────────────────

test('en feilet sending stemples ikke og forsøkes på nytt neste kjøring', async () => {
  db.subs = [sub('a'), sub('b')]
  db.sendFailsFor = new Set(['b@example.com'])

  await call()
  assert.deepEqual(db.sentTo, ['a@example.com'])
  assert.equal(db.subs.find(s => s.id === 'b')!.notified_quiz_id, null, 'feilet skal stå ustemplet')

  // Neste kjøring, nå uten feil: kun 'b' forsøkes igjen.
  db.sendFailsFor = new Set()
  db.sentTo = []
  await call()

  assert.deepEqual(db.sentTo, ['b@example.com'])
  assert.equal(db.subs.find(s => s.id === 'b')!.notified_quiz_id, QUIZ_ID)
})

// ── Stemplingen skjer per batch, også gjennom ruten ─────────────────────────

test('stemplingen skrives per batch, ikke som én skriving til slutt', async () => {
  // 20 abonnenter = 3 batcher (8/8/4) → 3 separate UPDATE-kall.
  db.subs = Array.from({ length: 20 }, (_, i) => sub(`s${i}`))

  await call()

  assert.equal(db.updates.length, 3, 'én skriving per batch')
  assert.deepEqual(db.updates.map(u => u.ids.length), [8, 8, 4])
  assert.equal(db.updates.every(u => u.quizId === QUIZ_ID), true)
  assert.equal(db.sentTo.length, 20)
})
