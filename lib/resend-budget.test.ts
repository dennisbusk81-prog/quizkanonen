// Kjøres med:  npm test
//
// Det delte Resend-sendebudsjettet (10/s per KONTO) — reservasjonen, ventingen
// og fail-open. All I/O er injisert: klokke, sleep, fetch og rapportør.
//
// MUTASJONSBEVIS (kjørt 16. august 2026):
//   • `parsed.count > RESEND_MAX_PER_SECOND` byttet til `>=` → «nøyaktig nr. 10
//     får plass» ryker (grensen ble 9/s, ikke 10/s).
//   • INCRBY-argumentet hardkodet til '1' i buildBudgetCommands → «kommandoene
//     bruker INCRBY med riktig antall» ryker.
//   • `await sleep(...)` fjernet fra acquire-løkken → «25 samtidige fordeles
//     10+10+5 over tre sekunder» ryker: alle 25 hamrer samme sekund-nøkkel og
//     15 gir opp.
//   • Nøkkelen gjort fast (`resend:0` i stedet for epokesekundet) → samme test
//     ryker: telleren nullstilles aldri og ingen etter de 10 første kommer inn.
//   • `if (attempt >= MAX_WAIT_ROUNDS) return { ok: false }` fjernet → «gir opp
//     etter taket» henger evig (testen har endelig antall scriptede svar og
//     kaster når de er brukt opp).
//   • Fail-open-grenen for kastet fetch fjernet → «nettverksfeil faller åpent»
//     ryker med en uhåndtert rejection i stedet for 'ok'.

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { TimerApi } from './with-timeout'
import {
  reserveResendSlots,
  acquireResendSlot,
  __resetResendBudgetReportGate,
  RESEND_MAX_PER_SECOND,
  RESEND_SLOT_TTL_MS,
  MAX_WAIT_ROUNDS,
} from './resend-budget'

const ENV = { url: 'https://eu2-example.upstash.io', token: 'tok_abc' }

// Timere som aldri fyrer: fetch-promiset avgjør, ingen ekte timer holder
// event-loopen i live. Samme mønster som rate-limit-shared.test.ts.
const neverTimers: TimerApi = { setTimeout: () => 1, clearTimeout: () => {} }

const immediateTimers: TimerApi = {
  setTimeout: (fn: () => void) => { fn(); return 1 },
  clearTimeout: () => {},
}

beforeEach(() => {
  __resetResendBudgetReportGate()
})

// ── Simulert klokke: sleep flytter klokka til MÅLET beregnet ved kalltid ────
// (ikke additivt — 15 samtidige ventere som alle vil til samme sekundgrense
// skal ende på grensen én gang, ikke skyve klokka 15 sekunder fram).
function fakeClock(startMs = 0) {
  let ms = startMs
  const sleeps: number[] = []
  return {
    now: () => ms,
    sleep: async (delta: number) => {
      sleeps.push(delta)
      const target = ms + delta // beregnet VED KALLTID, samme tick som now()
      await Promise.resolve()
      ms = Math.max(ms, target)
    },
    sleeps,
  }
}

// ── Simulert Upstash: en EKTE teller som håndhever SET…NX og INCRBY ─────────
// Da beviser testene at kommandoene virker mot Redis-semantikken, ikke bare at
// vi sendte noen strenger.
function fakeStore() {
  const store = new Map<string, number>()
  const calls: string[][][] = []
  const impl = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? 'null')) as string[][]
    calls.push(body)
    const results: unknown[] = []
    for (const cmd of body) {
      if (cmd[0] === 'SET') {
        const key = cmd[1]
        const hasNX = cmd.includes('NX')
        if (hasNX && store.has(key)) {
          results.push({ result: null })
        } else {
          store.set(key, Number(cmd[2]))
          results.push({ result: 'OK' })
        }
      } else if (cmd[0] === 'INCRBY') {
        const key = cmd[1]
        const next = (store.get(key) ?? 0) + Number(cmd[2])
        store.set(key, next)
        results.push({ result: next })
      } else {
        results.push({ error: `ukjent kommando ${cmd[0]}` })
      }
    }
    return { ok: true, status: 200, json: async () => results } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls, store }
}

/** Scriptede svar: hvert kall svarer som om telleren nå står på neste tall. */
function scriptedCounts(counts: number[]) {
  let i = 0
  const calls: string[][][] = []
  const impl = (async (_url: string | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? 'null')))
    if (i >= counts.length) throw new Error('scriptedCounts: flere kall enn scriptet')
    const count = counts[i++]
    return {
      ok: true,
      status: 200,
      json: async () => [{ result: count === 1 ? 'OK' : null }, { result: count }],
    } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

// ── Inert uten env ──────────────────────────────────────────────────────────

test('uten KV-env gjøres ingen nettverkskall og alt slipper gjennom', async () => {
  const { impl, calls } = fakeStore()
  const clock = fakeClock()

  const r = await acquireResendSlot({
    fetchImpl: impl, timers: neverTimers, now: clock.now, sleep: clock.sleep, env: {},
  })

  assert.equal(r.ok, true)
  assert.equal(calls.length, 0)
  assert.equal(clock.sleeps.length, 0, 'inert betyr også: ingen venting')
})

// ── Kommandoformen ──────────────────────────────────────────────────────────

test('reservasjonen bruker SET…PX…NX + INCRBY med riktig antall, på sekund-nøkkelen', async () => {
  const { impl, calls } = fakeStore()
  const clock = fakeClock(1_755_331_200_400) // et vilkårlig tidspunkt, 400 ms inn i sekundet

  await reserveResendSlots(8, {
    fetchImpl: impl, timers: neverTimers, now: clock.now, env: ENV,
  })

  const body = calls[0]
  const expectedKey = `rl:resend:${Math.floor(1_755_331_200_400 / 1000)}`
  assert.deepEqual(body[0], ['SET', expectedKey, '0', 'PX', String(RESEND_SLOT_TTL_MS), 'NX'])
  assert.deepEqual(body[1], ['INCRBY', expectedKey, '8'])
})

// ── Grensen — inklusiv, samme kontrakt som decideFromCount ──────────────────

test('nøyaktig nr. 10 får plass, nr. 11 avvises', async () => {
  const clock = fakeClock()

  const tiende = scriptedCounts([RESEND_MAX_PER_SECOND])
  const ellevte = scriptedCounts([RESEND_MAX_PER_SECOND + 1])

  assert.equal(
    await reserveResendSlots(1, { fetchImpl: tiende.impl, timers: neverTimers, now: clock.now, env: ENV }),
    'ok',
  )
  assert.equal(
    await reserveResendSlots(1, { fetchImpl: ellevte.impl, timers: neverTimers, now: clock.now, env: ENV }),
    'full',
  )
})

// ── Ventingen ───────────────────────────────────────────────────────────────

test('fullt sekund → vent til NESTE sekundgrense, der nøkkelen er en annen', async () => {
  // Starter 400 ms inn i sekundet: ventingen skal være 600 ms (til grensen),
  // ikke 1000 ms (fast intervall) — et fast intervall ville truffet samme
  // fulle sekund på nytt.
  const clock = fakeClock(10_400)
  const { impl, calls } = scriptedCounts([11, 1])

  const r = await acquireResendSlot({
    fetchImpl: impl, timers: neverTimers, now: clock.now, sleep: clock.sleep, env: ENV,
  })

  assert.equal(r.ok, true)
  assert.deepEqual(clock.sleeps, [600])
  assert.equal(calls[0][1][1], 'rl:resend:10', 'første forsøk i sekund 10')
  assert.equal(calls[1][1][1], 'rl:resend:11', 'andre forsøk i sekund 11 — fersk teller')
})

test('25 samtidige sendinger fordeles 10 + 10 + 5 over tre sekunder', async () => {
  // Kjernen i hele endringen: uansett hvor mange ruter som sender samtidig,
  // slipper maks 10 gjennom per sekund — resten venter på tur i stedet for å
  // treffe Resends 429.
  const clock = fakeClock(0)
  const { impl, store } = fakeStore()
  const deps = {
    fetchImpl: impl, timers: neverTimers, now: clock.now, sleep: clock.sleep, env: ENV,
  }

  const results = await Promise.all(
    Array.from({ length: 25 }, () => acquireResendSlot(deps))
  )

  assert.ok(results.every(r => r.ok), 'alle 25 skal til slutt få plass')
  // Ankomstene per sekund-nøkkel beviser fordelingen: 25 prøvde i sekund 0
  // (10 vant), de 15 taperne prøvde i sekund 1 (10 vant), de siste 5 i sekund 2.
  assert.equal(store.get('rl:resend:0'), 25)
  assert.equal(store.get('rl:resend:1'), 15)
  assert.equal(store.get('rl:resend:2'), 5)
  assert.equal(store.has('rl:resend:3'), false, 'ingen trengte et fjerde sekund')
})

test('gir opp etter taket — og antall forsøk er nøyaktig 1 + MAX_WAIT_ROUNDS', async () => {
  const clock = fakeClock(0)
  // Alltid fullt: nøyaktig så mange scriptede svar som taket tillater forsøk.
  // Ett forsøk mer ville kastet «flere kall enn scriptet» — det er beviset for
  // at taket faktisk stopper løkken.
  const { impl, calls } = scriptedCounts(
    Array.from({ length: 1 + MAX_WAIT_ROUNDS }, () => 99)
  )

  const r = await acquireResendSlot({
    fetchImpl: impl, timers: neverTimers, now: clock.now, sleep: clock.sleep, env: ENV,
  })

  assert.equal(r.ok, false)
  assert.equal(calls.length, 1 + MAX_WAIT_ROUNDS)
  assert.equal(clock.sleeps.length, MAX_WAIT_ROUNDS, 'ingen venting etter siste forsøk')
})

// ── Fail-open ───────────────────────────────────────────────────────────────

test('nettverksfeil faller åpent — e-posten sendes som i dag, uten budsjett', async () => {
  const reports: { reason: string; timedOut: boolean }[] = []
  const impl = (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
  const clock = fakeClock()

  const r = await acquireResendSlot({
    fetchImpl: impl, timers: neverTimers, now: clock.now, sleep: clock.sleep, env: ENV,
    onFailOpen: info => reports.push(info),
  })

  assert.equal(r.ok, true)
  assert.equal(clock.sleeps.length, 0, 'fail-open skal ikke koste noen venting')
  assert.equal(reports.length, 1)
  assert.equal(reports[0].timedOut, false)
})

test('timeout faller åpent og rapporteres som timeout', async () => {
  const reports: { reason: string; timedOut: boolean }[] = []
  const impl = (() => new Promise<never>(() => {})) as unknown as typeof fetch

  const r = await reserveResendSlots(1, {
    fetchImpl: impl, timers: immediateTimers, env: ENV,
    onFailOpen: info => reports.push(info),
  })

  assert.equal(r, 'ok')
  assert.equal(reports[0].timedOut, true)
})

test('HTTP-feil fra Upstash faller åpent', async () => {
  const impl = (async () => ({
    ok: false, status: 401, json: async () => ({ error: 'unauthorized' }),
  } as unknown as Response)) as unknown as typeof fetch

  const r = await reserveResendSlots(1, {
    fetchImpl: impl, timers: neverTimers, env: ENV, onFailOpen: () => {},
  })

  assert.equal(r, 'ok')
})

test('feil INNE i transaksjonen faller åpent — telleren er ikke til å stole på', async () => {
  const impl = (async () => ({
    ok: true, status: 200,
    json: async () => [{ error: 'ERR syntax' }, { result: 99 }],
  } as unknown as Response)) as unknown as typeof fetch

  const r = await reserveResendSlots(1, {
    fetchImpl: impl, timers: neverTimers, env: ENV, onFailOpen: () => {},
  })

  // 99 > 10 ville betydd 'full' hvis tallet var blitt trodd. Det skal det ikke
  // — en upålitelig teller skal aldri kunne HOLDE TILBAKE en e-post.
  assert.equal(r, 'ok')
})

test('gjentatte fail-open rapporteres kun én gang per minutt', async () => {
  const reports: unknown[] = []
  const impl = (async () => { throw new Error('nede') }) as unknown as typeof fetch
  const at = (ms: number) => ({
    fetchImpl: impl, timers: neverTimers, env: ENV, now: () => ms,
    onFailOpen: (i: unknown) => reports.push(i),
  })

  await reserveResendSlots(1, at(1_000))
  await reserveResendSlots(1, at(2_000))
  await reserveResendSlots(1, at(30_000))
  assert.equal(reports.length, 1, 'et utfall under en utsending skal ikke bli hundre Sentry-events')

  await reserveResendSlots(1, at(70_000))
  assert.equal(reports.length, 2)
})

test('en rapportør som kaster velter ikke sendingen', async () => {
  const impl = (async () => { throw new Error('nede') }) as unknown as typeof fetch

  const r = await reserveResendSlots(1, {
    fetchImpl: impl, timers: neverTimers, env: ENV,
    onFailOpen: () => { throw new Error('Sentry nede også') },
  })

  assert.equal(r, 'ok')
})
