// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Kanarien i cron/award-season-points: hvor pinget sendes, og når det IKKE
// sendes. Helperen (lib/cron-heartbeat.ts) er den EKTE — kun `fetch` og env
// er byttet ut — så testen måler den faktiske ledningen fra rute til
// nettverk, ikke en mock av den.
//
// Hele poenget er plasseringen: pinget skal komme SIST, etter summeringslinja,
// KUN når feil=0, og i waitUntil så cron-job.org aldri venter på det. Et ping
// ved responsen ville vært grønt selv om oppgjøret feilet.
//
// MUTASJONSBEVIS (kjørt, ikke antatt — se øktrapporten):
//   - fjernes `if (failed === 0)` → «feil>0: ingen ping» ryker.
//   - legges et ping inn i 503-grenen for oppslagsfeil → «oppslaget feiler:
//     ingen ping» ryker.
//   - byttes waitUntil(...) med await → «i waitUntil» ryker (GET venter på
//     et fetch som aldri svarer, testen når timeout).
//   - flyttes pinget FØR loggOppgjor → «sist» ryker.
//   - fjernes pinget i tom-grenen → «ingenting å gjøre» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { HEARTBEAT_ENV } from '@/lib/cron-heartbeat'

process.env.CRON_SECRET = 'test-cron-secret'

const URL_AWARD = 'https://hc-ping.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const URL_PUBLISH = 'https://hc-ping.com/11111111-2222-3333-4444-555555555555'

type QuizRow = {
  id: string; title: string; closes_at: string
  season_points_awarded: boolean
  is_test: boolean | null
  quiz_type: string
  is_active: boolean
}

const db: {
  quizzes: QuizRow[]
  failFor: Map<string, string>
  quizError: string | null
} = { quizzes: [], failFor: new Map(), quizError: null }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

mock.module('@/lib/award-season-points', {
  namedExports: {
    processQuiz: async (quizId: string) => {
      const failure = db.failFor.get(quizId)
      return failure ? { rows: 0, error: failure } : { rows: 1, error: null }
    },
  },
})

function builder(table: string) {
  if (table !== 'quizzes') throw new Error(`ukjent tabell i mock: ${table}`)
  const eqs: Record<string, unknown> = {}
  let ltCol: string | null = null, ltVal: string | null = null
  let limitN: number | null = null
  const preds: ((q: QuizRow) => boolean)[] = []
  const val = (q: QuizRow, col: string) => (q as unknown as Record<string, unknown>)[col]

  const rows = (): QuizRow[] => {
    let out = db.quizzes.filter(q => {
      for (const [k, v] of Object.entries(eqs)) if (val(q, k) !== v) return false
      if (ltCol && ltVal !== null && String(val(q, ltCol)) >= ltVal) return false
      return preds.every(p => p(q))
    })
    out = [...out].sort((a, b) => a.closes_at.localeCompare(b.closes_at))
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    select() { return b },
    eq(col: string, v: unknown) { eqs[col] = v; return b },
    lt(col: string, v: string) { ltCol = col; ltVal = v; return b },
    not(col: string, op: string, v: unknown) {
      assert.equal(op, 'is', 'mocken kjenner kun .not(col, "is", verdi)')
      preds.push(q => val(q, col) !== v)
      return b
    },
    in(col: string, values: readonly unknown[]) { preds.push(q => values.includes(val(q, col))); return b },
    order() { return b },
    limit(n: number) { limitN = n; return b },
    then(resolve: (v: unknown) => void) {
      if (db.quizError) return resolve({ data: null, error: { message: db.quizError } })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

// waitUntil samles opp så testen kan skille «pinget ble sendt i bakgrunnen»
// fra «ruten ventet på pinget før den svarte».
const pending: Promise<unknown>[] = []
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})

const { GET } = await import('@/app/api/cron/award-season-points/route')

// Hendelsesrekkefølgen i én kjøring: logglinjer og fetch-kall, i den
// rekkefølgen de skjedde. Det er den som beviser «sist».
const hendelser: string[] = []
type FetchCall = { url: string; method: string | undefined }
const fetchCalls: FetchCall[] = []

// Hva den stubbede fetch-en skal gjøre — settes per test.
let fetchImpl: (url: string) => Promise<Response> = async () => new Response('OK')

const ekteFetch = globalThis.fetch
const ekteLog = console.log
const ekteWarn = console.warn

const call = async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), method: init?.method })
    hendelser.push('ping')
    return fetchImpl(String(input))
  }) as unknown as typeof globalThis.fetch
  console.log = (...args: unknown[]) => { hendelser.push('log:' + args.map(String).join(' ')) }
  console.warn = (...args: unknown[]) => { hendelser.push('warn:' + args.map(String).join(' ')) }
  try {
    return await GET(new Request('https://quizkanonen.no/api/cron/award-season-points', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }) as never)
  } finally {
    globalThis.fetch = ekteFetch
    console.log = ekteLog
    console.warn = ekteWarn
  }
}

const quiz = (over: Partial<QuizRow> = {}): QuizRow => ({
  id: 'q1', title: 'Fredagsquiz', closes_at: minutesAgo(30),
  season_points_awarded: false, is_test: false, quiz_type: 'weekly', is_active: true,
  ...over,
})

beforeEach(() => {
  db.quizzes = []
  db.failFor = new Map()
  db.quizError = null
  pending.length = 0
  hendelser.length = 0
  fetchCalls.length = 0
  fetchImpl = async () => new Response('OK')
  process.env[HEARTBEAT_ENV['award-season-points']] = URL_AWARD
  process.env[HEARTBEAT_ENV['publish-quiz']] = URL_PUBLISH
})

// ── feil=0 → ping ───────────────────────────────────────────────────────────

test('ingenting å gjøre: vellykket kjøring, ett ping til award-kanariens URL', async () => {
  const res = await call()
  await Promise.all(pending)
  assert.equal(res.status, 200)
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url, URL_AWARD, 'skal pinge sin EGEN sjekk, ikke publish-quiz sin')
  assert.equal(fetchCalls[0].method, 'POST')
})

test('gjorde opp uten feil: ett ping', async () => {
  db.quizzes = [quiz(), quiz({ id: 'q2', closes_at: minutesAgo(10) })]
  const res = await call()
  await Promise.all(pending)
  assert.equal(res.status, 200)
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url, URL_AWARD)
})

// ── feil>0 → INGEN ping ─────────────────────────────────────────────────────

test('feil>0 (503): ingen ping — en uoppgjort quiz skal aldri se vellykket ut for kanarien', async () => {
  db.quizzes = [quiz(), quiz({ id: 'q2', closes_at: minutesAgo(10) })]
  db.failFor.set('q2', 'upstream request timeout')
  const res = await call()
  await Promise.all(pending)
  assert.equal(res.status, 503, 'forutsetning: 503-designet står uendret')
  assert.equal(fetchCalls.length, 0)
})

test('oppslaget feiler (503-grenen): ingen ping', async () => {
  db.quizError = '521: Web server is down'
  const res = await call()
  await Promise.all(pending)
  assert.equal(res.status, 503)
  assert.equal(fetchCalls.length, 0)
})

// ── Plassering: sist, og i waitUntil ────────────────────────────────────────

test('pinget kommer SIST — etter summeringslinja', async () => {
  db.quizzes = [quiz()]
  await call()
  await Promise.all(pending)
  const logg = hendelser.findIndex(h => h.includes('oppgjor:'))
  const ping = hendelser.indexOf('ping')
  assert.ok(logg >= 0, `fant ingen oppgjor-linje:\n${hendelser.join('\n')}`)
  assert.ok(ping >= 0, `fant ingen ping:\n${hendelser.join('\n')}`)
  assert.ok(ping > logg, `pinget skal komme etter loggen, ikke før:\n${hendelser.join('\n')}`)
})

test('pinget ligger i waitUntil: ruten svarer FØR pinget er ferdig', { timeout: 2_000 }, async () => {
  let losne: (r: Response) => void = () => {}
  fetchImpl = () => new Promise<Response>(resolve => { losne = resolve })
  db.quizzes = [quiz()]
  const res = await call()
  // GET har svart mens fetch fortsatt henger — det er beviset for at ruten
  // ikke venter på kanarien (cron-job.org kutter ved 30 s).
  assert.equal(res.status, 200)
  assert.equal(fetchCalls.length, 1, 'pinget skal være underveis når responsen går')
  assert.equal(pending.length, 1, 'nøyaktig ett bakgrunnsløfte: pinget')
  let settled = false
  void pending[0].then(() => { settled = true })
  await new Promise(r => setTimeout(r, 0))
  assert.equal(settled, false, 'bakgrunnsløftet skal holde til pinget er ferdig')
  losne(new Response('OK'))
  await Promise.all(pending)
  assert.equal(settled, true)
})

// ── Fail-open ───────────────────────────────────────────────────────────────

test('fetch avviser: ruten svarer 200 likevel, og bakgrunnsløftet settles rent', async () => {
  fetchImpl = () => Promise.reject(new TypeError('fetch failed'))
  db.quizzes = [quiz()]
  const res = await call()
  assert.equal(res.status, 200)
  const utfall = await Promise.allSettled(pending)
  assert.deepEqual(utfall.map(u => u.status), ['fulfilled'], 'helperen skal ha svelget feilen')
})

test('fetch kaster synkront: samme utfall', async () => {
  fetchImpl = () => { throw new Error('boom') }
  const res = await call()
  assert.equal(res.status, 200)
  const utfall = await Promise.allSettled(pending)
  assert.deepEqual(utfall.map(u => u.status), ['fulfilled'])
})

test('uten env: ingen fetch, ingen warn, ruten uendret', async () => {
  delete process.env[HEARTBEAT_ENV['award-season-points']]
  db.quizzes = [quiz()]
  const res = await call()
  await Promise.all(pending)
  assert.equal(res.status, 200)
  assert.equal(fetchCalls.length, 0)
  assert.equal(hendelser.filter(h => h.startsWith('warn:')).length, 0,
    `manglende env skal være stille:\n${hendelser.join('\n')}`)
})
