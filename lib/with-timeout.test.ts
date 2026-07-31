// Kjøres med:  npm test
//
// Testene her vokter fire ting som alle feiler STILLE hvis de ryker:
//   1. Et promise som aldri settles må gi et utfall likevel (selve frys-buggen).
//   2. Timeren må ryddes når promiset rekker fram først — ellers holder en
//      9 sekunders timer event-loopen i live etter at svaret er på plass.
//   3. `onTimeout` (abort) må kalles ved timeout og ALDRI ellers.
//   4. En rejection som lander ETTER timeouten må være ufarlig — den hengende
//      fetchen rejecter typisk først når vi aborter den, altså etter at vi har
//      gitt opp. (Promise.race konsumerer den i dagens implementasjon; testen
//      vokter oppførselen, ikke mekanismen, hvis noen skriver om funksjonen.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTimeout, withTimeoutOrNull } from '@/lib/with-timeout'
import type { TimerApi } from '@/lib/with-timeout'

/**
 * Manuell timer-kontroll: ingen ventetid i testene, og vi kan bevise at
 * clearTimeout faktisk ble kalt med det samme handtaket som ble utstedt.
 */
function fakeTimers() {
  const pending = new Map<number, () => void>()
  const cleared: unknown[] = []
  let next = 1
  const timers: TimerApi = {
    setTimeout(fn) {
      const id = next++
      pending.set(id, fn)
      return id
    },
    clearTimeout(handle) {
      cleared.push(handle)
      pending.delete(handle as number)
    },
  }
  return {
    timers,
    cleared,
    get pendingCount() { return pending.size },
    // Fyrer av alle utestående timere, som om deadline var nådd.
    fire() { for (const fn of [...pending.values()]) fn() },
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

// ── Normal vei ───────────────────────────────────────────────────────────────

test('promise som rekker fram gir verdien, og timeren ryddes', async () => {
  const t = fakeTimers()
  let aborted = 0
  const outcome = await withTimeout(Promise.resolve('svar'), {
    ms: 9000,
    onTimeout: () => { aborted++ },
    timers: t.timers,
  })

  assert.deepEqual(outcome, { ok: true, value: 'svar' })
  assert.equal(aborted, 0, 'abort skal ikke kalles når kallet rakk fram')
  assert.equal(t.cleared.length, 1, 'timeren må ryddes')
  assert.equal(t.pendingCount, 0)
})

test('rejection skilles fra timeout og aborter ikke', async () => {
  const t = fakeTimers()
  let aborted = 0
  const outcome = await withTimeout(Promise.reject(new Error('questions 500')), {
    ms: 9000,
    onTimeout: () => { aborted++ },
    timers: t.timers,
  })

  assert.deepEqual(outcome, { ok: false, timedOut: false })
  assert.equal(aborted, 0, 'en ekte feil er ikke en timeout — ingen abort')
  assert.equal(t.cleared.length, 1)
})

// ── Selve frys-buggen ────────────────────────────────────────────────────────

test('promise som aldri settles gir timeout-utfall og kaller abort én gang', async () => {
  const t = fakeTimers()
  let aborted = 0
  // Aldri resolve, aldri reject — nøyaktig tilstanden Carlos satt fast i.
  const hanging = new Promise<string>(() => {})
  const race = withTimeout(hanging, {
    ms: 9000,
    onTimeout: () => { aborted++ },
    timers: t.timers,
  })

  await flush()
  assert.equal(t.pendingCount, 1, 'deadline-timeren må være satt')
  t.fire()

  assert.deepEqual(await race, { ok: false, timedOut: true })
  assert.equal(aborted, 1, 'det hengende kallet må avbrytes, nøyaktig én gang')
})

test('sen resolve etter timeout endrer ikke utfallet', async () => {
  const t = fakeTimers()
  let resolveLate: (v: string) => void = () => {}
  const late = new Promise<string>(r => { resolveLate = r })
  const race = withTimeout(late, { ms: 9000, timers: t.timers })

  await flush()
  t.fire()
  const outcome = await race
  resolveLate('for sent')
  await flush()

  assert.deepEqual(outcome, { ok: false, timedOut: true })
})

test('sen rejection etter timeout gir ingen uhåndtert rejection', async () => {
  const seen: unknown[] = []
  const onUnhandled = (reason: unknown) => { seen.push(reason) }
  process.on('unhandledRejection', onUnhandled)
  try {
    const t = fakeTimers()
    let rejectLate: (e: Error) => void = () => {}
    const late = new Promise<string>((_, rej) => { rejectLate = rej })
    const race = withTimeout(late, { ms: 9000, timers: t.timers })

    await flush()
    t.fire()
    await race
    // Slik en abortet fetch oppfører seg: den rejecter FØRST etter at vi har
    // gitt opp.
    rejectLate(new Error('AbortError'))
    await flush()
    await flush()

    assert.deepEqual(seen, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

// ── withTimeoutOrNull ────────────────────────────────────────────────────────

test('withTimeoutOrNull gir verdien når kallet rekker fram', async () => {
  const t = fakeTimers()
  const value = await withTimeoutOrNull(Promise.resolve({ userRank: 4 }), {
    ms: 9000,
    timers: t.timers,
  })
  assert.deepEqual(value, { userRank: 4 })
})

test('withTimeoutOrNull degraderer til null ved timeout — ikke til en hengende await', async () => {
  const t = fakeTimers()
  let aborted = 0
  const race = withTimeoutOrNull(new Promise<{ userRank: number }>(() => {}), {
    ms: 9000,
    onTimeout: () => { aborted++ },
    timers: t.timers,
  })

  await flush()
  t.fire()

  assert.equal(await race, null)
  assert.equal(aborted, 1)
})

test('withTimeoutOrNull skiller ikke null fra feil — begge er «ingen rangering»', async () => {
  const t = fakeTimers()
  assert.equal(await withTimeoutOrNull(Promise.resolve(null), { ms: 9000, timers: t.timers }), null)
  assert.equal(await withTimeoutOrNull(Promise.reject(new Error('x')), { ms: 9000, timers: t.timers }), null)
})
