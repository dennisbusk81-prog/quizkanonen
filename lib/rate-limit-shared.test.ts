// Kjøres med:  npm test
//
// Orkestreringen: samspillet mellom in-memory-laget, nettverkskallet og
// fail-open. All I/O er injisert, så testene er raske og uten nettverk.
//
// MUTASJONSBEVIS (kjørt, ikke antatt):
//   • Fjern `if (!outcome.ok) return failOpen(...)` → 5 tester feiler. Merk
//     HVORDAN: `outcome.value` er undefined ved timeout, så ruten kaster en
//     TypeError i stedet for å svare. Uten fail-open-grenen er en treg Upstash
//     altså ikke «litt slappere grense», men en 500 på innlogging og innsending.
//   • Fjern `if (!local.success) return local` → «lokalt avslag koster ingen
//     rundtur» feiler: fetch kalles 3 ganger i stedet for 2.
//   • Returner `local` i stedet for `decideFromCount(...)` → «delt teller
//     avviser selv når lokal teller sier ja» feiler: success er true.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { TimerApi } from './with-timeout'
import {
  rateLimitShared,
  __resetFailOpenReportGate,
  type FailOpenInfo,
} from './rate-limit-shared'

const ENV = { url: 'https://eu2-example.upstash.io', token: 'tok_abc' }

// Timere som ALDRI fyrer: da avgjør fetch-promiset løpet, og ingen ekte timer
// holder event-loopen i live etter at testen er ferdig.
const neverTimers: TimerApi = { setTimeout: () => 1, clearTimeout: () => {} }

// Timere som fyrer med én gang: tvinger fram timeout-grenen deterministisk,
// uten å vente et helt sekund.
const immediateTimers: TimerApi = {
  setTimeout: (fn: () => void) => { fn(); return 1 },
  clearTimeout: () => {},
}

type Call = { url: string; body: unknown; headers: Record<string, string> }

function fakeFetch(handler: () => Promise<unknown> | never) {
  const calls: Call[] = []
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? 'null')),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    return handler()
  }) as unknown as typeof fetch
  return { impl, calls }
}

/** Minimalt Response-lignende objekt — kun det modulen faktisk leser. */
function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response
}

/** Svar som om dette er kall nr. `count` i vinduet. */
function counterResponse(count: number) {
  return jsonResponse([{ result: count === 1 ? 'OK' : null }, { result: count }])
}

let uniqueKeyCounter = 0
/** Fersk nøkkel per test — Map-en i lib/rate-limit.ts lever på tvers av dem. */
function freshKey(name: string): string {
  uniqueKeyCounter += 1
  return `${name}:test-${uniqueKeyCounter}`
}

beforeEach(() => {
  __resetFailOpenReportGate()
})

// ── Inert uten env ──────────────────────────────────────────────────────────

test('uten KV_REST_API_URL gjøres INGEN nettverkskall', async () => {
  // Lokalt (og i enhver deploy der variabelen er fjernet) skal modulen oppføre
  // seg nøyaktig som lib/rate-limit.ts. Env-variabelen ER funksjonsbryteren.
  const { impl, calls } = fakeFetch(async () => jsonResponse([]))

  const r = await rateLimitShared(freshKey('inert'), 5, 60_000, {
    fetchImpl: impl,
    timers: neverTimers,
    env: {},
  })

  assert.equal(calls.length, 0)
  assert.equal(r.success, true)
  assert.equal(r.remaining, 4)
})

test('token uten url (og omvendt) regnes som ukonfigurert, ikke halvveis på', async () => {
  const { impl, calls } = fakeFetch(async () => jsonResponse([]))

  await rateLimitShared(freshKey('halv'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: { url: ENV.url },
  })
  await rateLimitShared(freshKey('halv'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: { token: ENV.token },
  })

  assert.equal(calls.length, 0)
})

// ── Den varme stien ─────────────────────────────────────────────────────────

test('forespørselen går til /multi-exec med Bearer-token og begge kommandoene', async () => {
  const { impl, calls } = fakeFetch(async () => counterResponse(1))

  await rateLimitShared('submit:1.2.3.4', 20, 600_000, {
    fetchImpl: impl, timers: neverTimers, env: ENV,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://eu2-example.upstash.io/multi-exec')
  assert.equal(calls[0].headers.Authorization, 'Bearer tok_abc')

  // TTL og teller i ett og samme kall — ikke to rundturer.
  const body = calls[0].body as string[][]
  assert.equal(body.length, 2)
  assert.equal(body[0][0], 'SET')
  assert.ok(body[0].includes('PX'))
  assert.ok(body[0].includes('NX'))
  assert.equal(body[1][0], 'INCR')
})

test('avsluttende skråstrek i url gir ikke dobbel skråstrek', async () => {
  const { impl, calls } = fakeFetch(async () => counterResponse(1))

  await rateLimitShared(freshKey('slash'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: { ...ENV, url: 'https://eu2-example.upstash.io/' },
  })

  assert.equal(calls[0].url, 'https://eu2-example.upstash.io/multi-exec')
})

test('delt teller avviser selv når lokal teller sier ja', async () => {
  // Kjernen i hele endringen: denne instansen har bare sett ett kall, men de
  // andre instansene har brukt opp kvoten. Uten Redis-svaret ville dette
  // sluppet gjennom.
  const { impl } = fakeFetch(async () => counterResponse(6))

  const r = await rateLimitShared(freshKey('delt'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: ENV,
  })

  assert.equal(r.success, false)
  assert.equal(r.remaining, 0)
})

test('lokalt avslag koster ingen rundtur', async () => {
  // Lokal teller kan aldri være høyere enn den delte, så et lokalt avslag er
  // alltid også et delt avslag. Da skal vi ikke betale for en rundtur.
  const key = freshKey('kortslutt')
  let n = 0
  const { impl, calls } = fakeFetch(async () => { n += 1; return counterResponse(n) })

  const a = await rateLimitShared(key, 2, 60_000, { fetchImpl: impl, timers: neverTimers, env: ENV })
  const b = await rateLimitShared(key, 2, 60_000, { fetchImpl: impl, timers: neverTimers, env: ENV })
  const c = await rateLimitShared(key, 2, 60_000, { fetchImpl: impl, timers: neverTimers, env: ENV })

  assert.equal(a.success, true)
  assert.equal(b.success, true)
  assert.equal(c.success, false)
  assert.equal(calls.length, 2, 'tredje kall skal stoppes lokalt, uten nettverk')
})

// ── Fail-open ───────────────────────────────────────────────────────────────

test('timeout faller åpent og rapporteres som timeout', async () => {
  // Et fetch som aldri settles må ikke kunne holde en innlogging eller en
  // quiz-innsending åpen. Fristen avgjør, og utfallet er «slipp gjennom».
  const reports: FailOpenInfo[] = []
  const { impl } = fakeFetch(() => new Promise<never>(() => {}))

  const r = await rateLimitShared('submit:81.166.20.4', 5, 60_000, {
    fetchImpl: impl,
    timers: immediateTimers,
    env: ENV,
    onFailOpen: info => reports.push(info),
  })

  assert.equal(r.success, true, 'fail-open: tjenesten skal ikke stoppe fordi Upstash er treg')
  assert.equal(reports.length, 1)
  assert.equal(reports[0].timedOut, true)
  assert.equal(reports[0].keyPrefix, 'submit', 'kun prefikset — aldri IP-en')
})

test('nettverksfeil faller åpent', async () => {
  const reports: FailOpenInfo[] = []
  const { impl } = fakeFetch(async () => { throw new Error('ECONNRESET') })

  const r = await rateLimitShared(freshKey('nettfeil'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: ENV, onFailOpen: i => reports.push(i),
  })

  assert.equal(r.success, true)
  assert.equal(reports[0].timedOut, false)
})

test('HTTP-feil fra Upstash faller åpent', async () => {
  const reports: FailOpenInfo[] = []
  const { impl } = fakeFetch(async () => jsonResponse({ error: 'unauthorized' }, 401))

  const r = await rateLimitShared(freshKey('http'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: ENV, onFailOpen: i => reports.push(i),
  })

  assert.equal(r.success, true)
  assert.match(reports[0].reason, /401/)
})

test('ugyldig JSON faller åpent', async () => {
  const { impl } = fakeFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token') },
  } as unknown as Response))

  const r = await rateLimitShared(freshKey('json'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: ENV,
    onFailOpen: () => {},
  })

  assert.equal(r.success, true)
})

test('feil INNE i transaksjonen faller åpent — telleren er ikke til å stole på', async () => {
  const { impl } = fakeFetch(async () => jsonResponse([{ error: 'ERR syntax' }, { result: 9 }]))

  const r = await rateLimitShared(freshKey('txfeil'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: ENV, onFailOpen: () => {},
  })

  // 9 > 5 ville betydd avslag hvis tallet var blitt trodd. Det skal det ikke.
  assert.equal(r.success, true)
})

test('fail-open bruker den LOKALE tellerstanden, ikke blank frihet', async () => {
  // Faller vi åpent, er in-memory fortsatt et forsvar. Det må faktisk gjelde.
  const key = freshKey('lokalbrems')
  const { impl } = fakeFetch(async () => { throw new Error('nede') })
  const deps = { fetchImpl: impl, timers: neverTimers, env: ENV, onFailOpen: () => {} }

  await rateLimitShared(key, 2, 60_000, deps)
  await rateLimitShared(key, 2, 60_000, deps)
  const third = await rateLimitShared(key, 2, 60_000, deps)

  assert.equal(third.success, false, 'in-memory skal bære alene når Upstash er nede')
})

test('gjentatte fail-open rapporteres kun én gang per minutt', async () => {
  const reports: FailOpenInfo[] = []
  const { impl } = fakeFetch(async () => { throw new Error('nede') })
  const at = (ms: number) => ({
    fetchImpl: impl, timers: neverTimers, env: ENV, now: () => ms,
    onFailOpen: (i: FailOpenInfo) => reports.push(i),
  })

  await rateLimitShared(freshKey('støy'), 5, 60_000, at(1_000))
  await rateLimitShared(freshKey('støy'), 5, 60_000, at(2_000))
  await rateLimitShared(freshKey('støy'), 5, 60_000, at(30_000))
  assert.equal(reports.length, 1, 'ett utfall skal ikke bli tusen Sentry-events')

  await rateLimitShared(freshKey('støy'), 5, 60_000, at(70_000))
  assert.equal(reports.length, 2, 'etter intervallet skal tilstanden meldes igjen')
})

test('en rapportør som kaster velter ikke forespørselen', async () => {
  const { impl } = fakeFetch(async () => { throw new Error('nede') })

  const r = await rateLimitShared(freshKey('kastende'), 5, 60_000, {
    fetchImpl: impl, timers: neverTimers, env: ENV,
    onFailOpen: () => { throw new Error('Sentry nede også') },
  })

  assert.equal(r.success, true)
})
