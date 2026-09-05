// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Kanarien i cron/publish-quiz: pinget skal sendes fra `.finally()` — linje
// B sitt anker — KUN når feil=0, og som en del av waitUntil-løftet slik at
// funksjonen holdes i live til pinget er ute. Helperen er den EKTE; bare
// `fetch` og env er byttet ut.
//
// Hvorfor ikke ved responsen: publish-quiz svarer FØR oppgjøret i det hele
// tatt starter (det ligger i waitUntil). Et ping der ville vært grønt selv
// om hver eneste quiz feilet, og kanarien ville bare målt at cron-job.org
// når fram til Vercel.
//
// MUTASJONSBEVIS (kjørt, ikke antatt — se øktrapporten):
//   - fjernes `if (feil === 0)` → «oppgjøret feilet» og «resettle-oppslaget
//     feiler» ryker.
//   - flyttes pinget til request-scope før `return NextResponse.json` →
//     «feilet: ingen ping» ryker og «sist» ryker.
//   - droppes `return` foran sendHeartbeat i .finally() → «holder
//     bakgrunnsløftet» ryker (løftet settles før pinget er ferdig).
//   - fjernes pinget helt → alle feil=0-testene ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { HEARTBEAT_ENV } from '@/lib/cron-heartbeat'

process.env.CRON_SECRET = 'test-cron-secret'

const URL_PUBLISH = 'https://hc-ping.com/11111111-2222-3333-4444-555555555555'
const URL_AWARD = 'https://hc-ping.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

type QuizRow = {
  id: string
  title: string
  is_active: boolean
  is_test: boolean | null
  quiz_type: string
  scheduled_at: string | null
  opens_at: string | null
  closes_at: string | null
  season_points_awarded: boolean
}
type AttemptRow = {
  id: string
  quiz_id: string
  user_id: string | null
  is_team: boolean
  submitted_at: string | null
}

const db: {
  quizzes: QuizRow[]
  attempts: AttemptRow[]
  resettleLookupError: boolean
} = { quizzes: [], attempts: [], resettleLookupError: false }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

// processQuiz-utfall — settes per test.
let processError: string | null = null
const processQuizMock = mock.fn(async () => ({
  rows: 3, error: processError,
}))

const pending: Promise<unknown>[] = []

type Row = QuizRow | AttemptRow
type Pred = (r: Row) => boolean

function builder(table: string) {
  assert.ok(table === 'quizzes' || table === 'attempts', `uventet tabell: ${table}`)
  const preds: Pred[] = []
  let updatePatch: Partial<QuizRow> | null = null
  let limitN: number | null = null
  let single = false
  let asksSettled = false

  const val = (r: Row, col: string) => (r as unknown as Record<string, unknown>)[col]

  const rows = (): Row[] => {
    const src: Row[] = table === 'quizzes' ? db.quizzes : db.attempts
    let out = src.filter(r => preds.every(p => p(r)))
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    update(patch: Partial<QuizRow>) { updatePatch = patch; return b },
    select() { return b },
    eq(col: string, v: unknown) {
      if (col === 'season_points_awarded' && v === true) asksSettled = true
      preds.push(r => val(r, col) === v)
      return b
    },
    lte(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) <= v); return b },
    lt(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) < v); return b },
    gt(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) > v); return b },
    gte(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) >= v); return b },
    not(col: string, op: string, v: unknown) {
      assert.equal(op, 'is', 'mocken kjenner kun .not(col, "is", verdi)')
      preds.push(r => val(r, col) !== v)
      return b
    },
    in(col: string, values: readonly unknown[]) {
      preds.push(r => values.includes(val(r, col)))
      return b
    },
    or(expr: string) {
      const parts = expr.split(',').map(p => {
        const [col, op, ...rest] = p.split('.')
        const v = rest.join('.')
        if (op === 'is' && v === 'null') return (r: Row) => val(r, col) === null
        if (op === 'gte') return (r: Row) => val(r, col) !== null && String(val(r, col)) >= v
        throw new Error(`ukjent or-form i mock: ${p}`)
      })
      preds.push(r => parts.some(p => p(r)))
      return b
    },
    order() { return b },
    limit(n: number) { limitN = n; return b },
    maybeSingle() { single = true; return b },
    then(resolve: (v: unknown) => void) {
      if (db.resettleLookupError && table === 'quizzes' && asksSettled && !updatePatch) {
        return resolve({ data: null, error: { message: 'oppslag nede', code: '500' } })
      }
      if (updatePatch) {
        const hit = rows()
        for (const r of hit) Object.assign(r, updatePatch)
        return resolve({ data: hit.map(r => ({ id: (r as QuizRow).id, title: (r as QuizRow).title })), error: null })
      }
      if (single) return resolve({ data: rows()[0] ?? null, error: null })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})
mock.module('next/cache', {
  namedExports: { revalidateTag: () => {} },
})
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})
mock.module('@/lib/award-season-points', {
  namedExports: { processQuiz: processQuizMock },
})

const { GET } = await import('@/app/api/cron/publish-quiz/route')

const hendelser: string[] = []
type FetchCall = { url: string; method: string | undefined }
const fetchCalls: FetchCall[] = []
let fetchImpl: (url: string) => Promise<Response> = async () => new Response('OK')

const ekteFetch = globalThis.fetch
const ekteLog = console.log
const ekteWarn = console.warn

// Setter stubbene, kaller GET, og lar dem stå til `ferdig()` — bakgrunns-
// arbeidet (og pinget) skjer ETTER at GET har svart, og trenger stubbene da.
const start = async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), method: init?.method })
    hendelser.push('ping')
    return fetchImpl(String(input))
  }) as unknown as typeof globalThis.fetch
  console.log = (...args: unknown[]) => { hendelser.push('log:' + args.map(String).join(' ')) }
  console.warn = (...args: unknown[]) => { hendelser.push('warn:' + args.map(String).join(' ')) }
  return GET(new Request('https://quizkanonen.no/api/cron/publish-quiz', {
    headers: { authorization: 'Bearer test-cron-secret' },
  }) as never)
}
const ferdig = async () => {
  try {
    return await Promise.allSettled(pending.splice(0))
  } finally {
    globalThis.fetch = ekteFetch
    console.log = ekteLog
    console.warn = ekteWarn
  }
}

const quiz = (min: number, over: Partial<QuizRow> = {}): QuizRow => ({
  id: 'q1', title: 'Fredagsquiz', is_active: true, is_test: false, quiz_type: 'weekly',
  scheduled_at: null, opens_at: minutesAgo(min + 240), closes_at: minutesAgo(min),
  season_points_awarded: false,
  ...over,
})

beforeEach(() => {
  db.quizzes = []
  db.attempts = []
  db.resettleLookupError = false
  processError = null
  processQuizMock.mock.resetCalls()
  pending.length = 0
  hendelser.length = 0
  fetchCalls.length = 0
  fetchImpl = async () => new Response('OK')
  process.env[HEARTBEAT_ENV['publish-quiz']] = URL_PUBLISH
  process.env[HEARTBEAT_ENV['award-season-points']] = URL_AWARD
})

// ── feil=0 → ping ───────────────────────────────────────────────────────────

test('ingenting å gjøre: ett ping til publish-kanariens URL', async () => {
  const res = await start()
  await ferdig()
  assert.equal(res.status, 200)
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url, URL_PUBLISH, 'skal pinge sin EGEN sjekk, ikke award sin')
  assert.equal(fetchCalls[0].method, 'POST')
})

test('gjorde opp uten feil: ett ping', async () => {
  db.quizzes = [quiz(3)]
  const res = await start()
  await ferdig()
  assert.equal(res.status, 200)
  assert.equal(processQuizMock.mock.calls.length, 1, 'forutsetning: oppgjøret kjørte')
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url, URL_PUBLISH)
})

// ── feil>0 → INGEN ping ─────────────────────────────────────────────────────

test('oppgjøret feilet: ingen ping — selv om ruten svarte 200', async () => {
  db.quizzes = [quiz(3)]
  processError = 'upstream request timeout'
  const res = await start()
  await ferdig()
  assert.equal(res.status, 200, 'forutsetning: responsen er uendret 200, oppgjøret ligger i waitUntil')
  assert.equal(processQuizMock.mock.calls.length, 1)
  assert.equal(fetchCalls.length, 0,
    'her ligger hele forskjellen på «cron-job.org når Vercel» og «oppgjøret virker»')
})

test('resettle-oppslaget feiler (grenen returnerer): ingen ping', async () => {
  db.resettleLookupError = true
  const res = await start()
  await ferdig()
  assert.equal(res.status, 200)
  assert.equal(fetchCalls.length, 0)
})

// ── Plassering: sist, og som del av waitUntil-løftet ────────────────────────

test('pinget kommer SIST — etter linje B', async () => {
  db.quizzes = [quiz(3)]
  await start()
  await ferdig()
  const linjeB = hendelser.findIndex(h => h.includes('oppgjor:'))
  const ping = hendelser.indexOf('ping')
  assert.ok(linjeB >= 0, `fant ingen linje B:\n${hendelser.join('\n')}`)
  assert.ok(ping >= 0, `fant ingen ping:\n${hendelser.join('\n')}`)
  assert.ok(ping > linjeB, `pinget skal komme etter linje B:\n${hendelser.join('\n')}`)
})

test('waitUntil-løftet holder til pinget er ferdig — og ruten har svart lenge før', { timeout: 2_000 }, async () => {
  let losne: (r: Response) => void = () => {}
  fetchImpl = () => new Promise<Response>(resolve => { losne = resolve })
  const res = await start()
  assert.equal(res.status, 200, 'ruten svarer uten å vente på noe i bakgrunnen')
  // La bakgrunnsløpet komme fram til pinget.
  for (let i = 0; i < 10 && fetchCalls.length === 0; i++) await new Promise(r => setTimeout(r, 0))
  assert.equal(fetchCalls.length, 1, 'pinget skal være underveis')
  let settled = false
  void Promise.all(pending).then(() => { settled = true })
  await new Promise(r => setTimeout(r, 0))
  assert.equal(settled, false,
    'løftet waitUntil holder skal ikke settle før pinget er ute — ellers kan funksjonen fryses midt i sendingen')
  losne(new Response('OK'))
  await ferdig()
  assert.equal(settled, true)
})

// ── Fail-open ───────────────────────────────────────────────────────────────

test('fetch avviser: waitUntil-løftet settles fulfilled, ruten svarte 200', async () => {
  fetchImpl = () => Promise.reject(new TypeError('fetch failed'))
  const res = await start()
  const utfall = await ferdig()
  assert.equal(res.status, 200)
  assert.deepEqual(utfall.map(u => u.status), ['fulfilled'], 'helperen skal ha svelget feilen')
})

test('fetch kaster synkront: samme utfall', async () => {
  fetchImpl = () => { throw new Error('boom') }
  const res = await start()
  const utfall = await ferdig()
  assert.equal(res.status, 200)
  assert.deepEqual(utfall.map(u => u.status), ['fulfilled'])
})

test('uten env: ingen fetch, ingen warn, oppgjøret går som før', async () => {
  delete process.env[HEARTBEAT_ENV['publish-quiz']]
  db.quizzes = [quiz(3)]
  const res = await start()
  await ferdig()
  assert.equal(res.status, 200)
  assert.equal(processQuizMock.mock.calls.length, 1)
  assert.equal(fetchCalls.length, 0)
  assert.equal(hendelser.filter(h => h.startsWith('warn:')).length, 0,
    `manglende env skal være stille:\n${hendelser.join('\n')}`)
})
