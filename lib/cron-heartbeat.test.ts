// Kjøres med:  npm test
//
// Kanarien i lib/cron-heartbeat.ts, isolert: hva den gjør med og uten env,
// og at den ALDRI kaster — uansett hva fetch finner på. Kallstedene i de to
// rutene dekkes av lib/cron-heartbeat-publish-route.test.ts og
// lib/cron-heartbeat-award-route.test.ts.
//
// MUTASJONSBEVIS (kjørt, ikke antatt — se øktrapporten):
//   - fjernes `if (!url) return 'skipped'` → «uten env» ryker (fetch kalles
//     med undefined).
//   - fjernes den ytre try/catch → «fetch kaster synkront» og «fetch
//     avviser» ryker med et kast ut av helperen.
//   - fjernes `if (!res.ok)` → «ikke-2xx» ryker.
//   - fjernes `controller.abort()` i timeren → «henger» ryker (testen når
//     aldri fram til et utfall).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sendHeartbeat, HEARTBEAT_ENV, HEARTBEAT_TIMEOUT_MS } from '@/lib/cron-heartbeat'

const URL_PUBLISH = 'https://hc-ping.com/11111111-2222-3333-4444-555555555555'
const URL_AWARD = 'https://hc-ping.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const bothEnv = {
  [HEARTBEAT_ENV['publish-quiz']]: URL_PUBLISH,
  [HEARTBEAT_ENV['award-season-points']]: URL_AWARD,
}

type Call = { url: string; init: RequestInit | undefined }

/** En fetch-stub som registrerer kallene og svarer slik testen sier. */
function fakeFetch(respond: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init }
    calls.push(call)
    return respond(call)
  }) as unknown as typeof globalThis.fetch
  return { fn, calls }
}

/** Fanger console.warn for én kjøring. */
async function medWarn<T>(fn: () => Promise<T>): Promise<{ value: T; warned: string[] }> {
  const ekte = console.warn
  const warned: string[] = []
  console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(' ')) }
  try {
    return { value: await fn(), warned }
  } finally {
    console.warn = ekte
  }
}

// ── Env styrer om det pinges i det hele tatt ────────────────────────────────

test('uten env: hopper over stille — ingen fetch, ingen warn', async () => {
  const f = fakeFetch(() => new Response('OK'))
  const { value, warned } = await medWarn(() =>
    sendHeartbeat('publish-quiz', { fetch: f.fn, env: {} }))
  assert.equal(value, 'skipped')
  assert.equal(f.calls.length, 0, 'fetch skal ikke kalles uten URL')
  assert.deepEqual(warned, [], 'manglende env er normaltilstand lokalt, ikke en feil')
})

test('tom streng i env teller som manglende', async () => {
  const f = fakeFetch(() => new Response('OK'))
  const value = await sendHeartbeat('publish-quiz', {
    fetch: f.fn, env: { [HEARTBEAT_ENV['publish-quiz']]: '' },
  })
  assert.equal(value, 'skipped')
  assert.equal(f.calls.length, 0)
})

test('med env: POST-er til nøyaktig kanariens egen URL', async () => {
  const f = fakeFetch(() => new Response('OK'))
  const value = await sendHeartbeat('award-season-points', { fetch: f.fn, env: bothEnv })
  assert.equal(value, 'sent')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, URL_AWARD, 'award-kanarien skal ikke pinge publish-quiz sin sjekk')
  assert.equal(f.calls[0].init?.method, 'POST')
  assert.ok(f.calls[0].init?.signal instanceof AbortSignal, 'kallet skal bære et abort-signal')
})

test('de to kanariene leser hver sin nøkkel — publish-quiz uten egen env hopper over selv om award har', async () => {
  const f = fakeFetch(() => new Response('OK'))
  const value = await sendHeartbeat('publish-quiz', {
    fetch: f.fn, env: { [HEARTBEAT_ENV['award-season-points']]: URL_AWARD },
  })
  assert.equal(value, 'skipped')
  assert.equal(f.calls.length, 0)
})

// ── Aldri kast ──────────────────────────────────────────────────────────────

test('ikke-2xx fra tjenesten: failed, logget, ikke kastet', async () => {
  const f = fakeFetch(() => new Response('nope', { status: 500 }))
  const { value, warned } = await medWarn(() =>
    sendHeartbeat('publish-quiz', { fetch: f.fn, env: bothEnv }))
  assert.equal(value, 'failed')
  assert.equal(warned.length, 1)
  assert.ok(warned[0].includes('500'), warned[0])
})

test('fetch avviser: failed, aldri kastet videre', async () => {
  const f = fakeFetch(() => Promise.reject(new TypeError('fetch failed: ' + URL_PUBLISH)))
  const { value, warned } = await medWarn(() =>
    sendHeartbeat('publish-quiz', { fetch: f.fn, env: bothEnv }))
  assert.equal(value, 'failed')
  assert.equal(warned.length, 1)
})

test('fetch kaster SYNKRONT: fortsatt failed, aldri kastet videre', async () => {
  const fn = (() => { throw new Error('boom ' + URL_PUBLISH) }) as unknown as typeof globalThis.fetch
  const { value } = await medWarn(() =>
    sendHeartbeat('publish-quiz', { fetch: fn, env: bothEnv }))
  assert.equal(value, 'failed')
})

test('henger: abortes ved fristen og gir failed — holder aldri kalleren', { timeout: 2_000 }, async () => {
  let aborted = false
  const f = fakeFetch(call => new Promise<Response>((_, reject) => {
    call.init?.signal?.addEventListener('abort', () => {
      aborted = true
      reject(new DOMException('The operation was aborted', 'AbortError'))
    })
  }))
  const { value, warned } = await medWarn(() =>
    sendHeartbeat('publish-quiz', { fetch: f.fn, env: bothEnv, timeoutMs: 20 }))
  assert.equal(value, 'failed')
  assert.ok(aborted, 'signalet skal faktisk ha blitt abortert')
  assert.ok(warned[0].includes('AbortError'), warned[0])
})

test('standardfristen er kort nok til å ikke true maxDuration', () => {
  assert.ok(HEARTBEAT_TIMEOUT_MS <= 5_000, `${HEARTBEAT_TIMEOUT_MS} ms`)
})

// ── Personvern: URL-en er en hemmelighet og skal ikke i loggen ──────────────

test('varsellinjene inneholder aldri ping-URL-en', async () => {
  const cases: Array<() => Promise<unknown>> = [
    () => sendHeartbeat('publish-quiz', {
      fetch: fakeFetch(() => new Response('x', { status: 503 })).fn, env: bothEnv,
    }),
    () => sendHeartbeat('publish-quiz', {
      fetch: fakeFetch(() => Promise.reject(new TypeError('fetch failed: ' + URL_PUBLISH))).fn, env: bothEnv,
    }),
  ]
  for (const run of cases) {
    const { warned } = await medWarn(run)
    for (const w of warned) {
      assert.ok(!w.includes('hc-ping.com'), `URL lekket i loggen: ${w}`)
      assert.ok(!w.includes('11111111'), `URL-id lekket i loggen: ${w}`)
    }
  }
})
