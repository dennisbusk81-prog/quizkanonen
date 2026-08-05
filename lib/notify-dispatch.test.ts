// Kjøres med:  npm test
//
// F4 fra lastmålingsrapporten 5. august 2026: `cron/notify-subscribers`
// stemplet `notified_at` først ETTER hele sendeløkken. Et tidsavbrudd midt i
// løkken etterlot da null stemplinger — også for de som faktisk hadde fått
// e-posten — og neste kjøring sendte alt på nytt til alle.
//
// INGEN ekte e-post sendes her. `send` er en ren funksjon i testen; verken
// lib/email eller Resend importeres.
//
// HVORDAN AVBRUDDET ETTERLIGNES
// Et Vercel-tidsavbrudd gir ingen exception og ingen catch — koden slutter
// bare å kjøre. Det nærmeste vi kommer i en test er en `send` som kaster
// SYNKRONT: da kastes den fra `batch.map(...)`, altså FØR Promise.allSettled
// får se den, og feilen forplanter seg ut av løkken i stedet for å bli svelget
// per element. Løkken stopper midt i, uten opprydding — akkurat som et drap.
// Samme mekanisme brukes på begge implementasjonene, så de måles likt.
//
// MUTASJONSBEVIS: testene «GAMMEL FORM» og «NY FORM» kjører samme scenario
// mot henholdsvis den gamle og den nye implementasjonen. Gammel form gir 8
// duplikater, ny form gir 0. Endrer man dispatchInBatches tilbake til å
// stemple etter løkken, feiler NY FORM-testen.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { dispatchInBatches } = await import('@/lib/notify-dispatch')

type Sub = { id: string; email: string }

const makeSubs = (n: number): Sub[] =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, email: `p${i}@example.com` }))

/** Falsk klokke. `sleep` flytter klokka i stedet for å vente. */
function fakeClock(startMs = 0) {
  let t = startMs
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms },
    advance: (ms: number) => { t += ms },
  }
}

/**
 * Verden vi sender til: hvilke rader som er stemplet, og hvor mange e-poster
 * hver mottaker har fått. `remainingSubscribers` speiler filteret ruten bruker
 * — `.or('notified_quiz_id.is.null,notified_quiz_id.neq.<quizId>')`.
 */
function makeWorld(subs: Sub[]) {
  const notifiedForQuiz = new Set<string>()
  const deliveries = new Map<string, number>()
  return {
    notifiedForQuiz,
    deliveries,
    remainingSubscribers: () => subs.filter(s => !notifiedForQuiz.has(s.id)),
    record: (s: Sub) => deliveries.set(s.id, (deliveries.get(s.id) ?? 0) + 1),
    stamp: async (delivered: Sub[]) => {
      for (const d of delivered) notifiedForQuiz.add(d.id)
    },
    duplicates: () => [...deliveries.values()].filter(n => n > 1).length,
  }
}

class Killed extends Error {}

/**
 * En `send` som leverer de `killAt` første og deretter kaster synkront —
 * altså slutter å kjøre midt i løkken. Bevisst IKKE `async`: en async-funksjon
 * ville returnert et avvist promise, som allSettled svelger.
 */
function killingSend(world: ReturnType<typeof makeWorld>, killAt: number) {
  let n = 0
  return (s: Sub): Promise<void> => {
    if (n++ >= killAt) throw new Killed('funksjonen drept midt i løkken')
    world.record(s)
    return Promise.resolve()
  }
}

const OPTS = { batchSize: 8, minBatchIntervalMs: 1_000, budgetMs: 50_000 }

// ── Grunnoppførsel ──────────────────────────────────────────────────────────

test('alle mottakere sendes til og stemples når ingenting går galt', async () => {
  const subs = makeSubs(20)
  const world = makeWorld(subs)
  const clock = fakeClock()

  const res = await dispatchInBatches<Sub>(subs, {
    send: async s => world.record(s),
    stamp: world.stamp,
    now: clock.now,
    sleep: clock.sleep,
  }, OPTS)

  assert.equal(res.sent, 20)
  assert.equal(res.failed, 0)
  assert.equal(res.remaining, 0)
  assert.equal(world.notifiedForQuiz.size, 20)
  assert.equal(world.duplicates(), 0)
})

test('stemplingen skjer per batch, ikke til slutt', async () => {
  // Direkte observasjon av invarianten: når batch 2 starter, skal de 8 første
  // allerede være stemplet.
  const subs = makeSubs(24)
  const world = makeWorld(subs)
  const clock = fakeClock()
  const stampedAtBatchStart: number[] = []
  let seen = 0

  await dispatchInBatches<Sub>(subs, {
    send: async s => {
      if (seen % 8 === 0) stampedAtBatchStart.push(world.notifiedForQuiz.size)
      seen++
      world.record(s)
    },
    stamp: world.stamp,
    now: clock.now,
    sleep: clock.sleep,
  }, OPTS)

  assert.deepEqual(stampedAtBatchStart, [0, 8, 16])
})

test('kun leverte mottakere stemples — feilede forblir ustemplet', async () => {
  const subs = makeSubs(8)
  const world = makeWorld(subs)
  const clock = fakeClock()

  const res = await dispatchInBatches<Sub>(subs, {
    send: async s => {
      if (s.id === 'id-3') throw new Error('Resend sa nei')
      world.record(s)
    },
    stamp: world.stamp,
    now: clock.now,
    sleep: clock.sleep,
  }, OPTS)

  assert.equal(res.sent, 7)
  assert.equal(res.failed, 1)
  assert.equal(world.notifiedForQuiz.has('id-3'), false)
  assert.equal(world.notifiedForQuiz.size, 7)
})

// ── MUTASJONSBEVIS ──────────────────────────────────────────────────────────

/**
 * Den GAMLE implementasjonen, gjengitt her med vilje: send i batcher, samle
 * opp de leverte, stemple ÉN gang til slutt. Kopien finnes for å kunne kjøre
 * den mot nøyaktig samme avbrudd som den nye og måle forskjellen.
 */
async function legacyStampAtEnd<T>(
  items: readonly T[],
  deps: { send: (i: T) => Promise<unknown>; stamp: (d: T[]) => Promise<void>; batchSize: number },
): Promise<void> {
  const delivered: T[] = []
  for (let i = 0; i < items.length; i += deps.batchSize) {
    const batch = items.slice(i, i + deps.batchSize)
    const results = await Promise.allSettled(batch.map(x => deps.send(x)))
    results.forEach((r, idx) => { if (r.status === 'fulfilled') delivered.push(batch[idx]) })
  }
  // Nås aldri når løkken over avbrytes.
  if (delivered.length > 0) await deps.stamp(delivered)
}

test('MUTASJON — GAMMEL FORM: stempling etter løkken gir 8 duplikater ved avbrudd', async () => {
  const subs = makeSubs(24)          // 3 batcher a 8
  const world = makeWorld(subs)
  const send = killingSend(world, 8) // batch 1 leveres, drept først i batch 2

  await assert.rejects(
    () => legacyStampAtEnd<Sub>(subs, { send, stamp: world.stamp, batchSize: 8 }),
    Killed,
  )

  // 8 personer har beviselig fått e-post — men ingen er stemplet, fordi
  // stemplingen lå etter løkken og aldri ble nådd.
  assert.equal(world.deliveries.size, 8, 'gammel form: 8 har fått e-post')
  assert.equal(world.notifiedForQuiz.size, 0, 'gammel form: ingen er stemplet')

  // NESTE KJØRING: dedup-filteret finner ingen stemplet, så hele listen hentes
  // på nytt — og de 8 får e-posten en gang til.
  const remaining = world.remainingSubscribers()
  assert.equal(remaining.length, 24, 'gammel form: hele listen sendes på nytt')
  for (const s of remaining) world.record(s)

  assert.equal(world.duplicates(), 8, 'gammel form: 8 mottakere fikk duplikat')
})

test('MUTASJON — NY FORM: samme avbrudd gir 0 duplikater og alle får e-post', async () => {
  const subs = makeSubs(24)
  const world = makeWorld(subs)
  const clock = fakeClock()
  const send = killingSend(world, 8) // identisk avbruddspunkt

  await assert.rejects(
    () => dispatchInBatches<Sub>(subs, {
      send,
      stamp: world.stamp,
      now: clock.now,
      sleep: clock.sleep,
    }, OPTS),
    Killed,
  )

  // Batch 1 ER stemplet — fordi skrivingen skjedde inne i løkken, før drapet.
  assert.equal(world.deliveries.size, 8, 'ny form: 8 har fått e-post')
  assert.equal(world.notifiedForQuiz.size, 8, 'ny form: de 8 er stemplet underveis')

  // NESTE KJØRING henter kun de 16 som gjenstår.
  const remaining = world.remainingSubscribers()
  assert.equal(remaining.length, 16, 'ny form: kun restene sendes')
  for (const s of remaining) world.record(s)

  assert.equal(world.duplicates(), 0, 'ny form: ingen fikk duplikat')
  assert.equal(world.deliveries.size, 24, 'ny form: alle 24 har fått e-post til slutt')
  for (const [id, count] of world.deliveries) {
    assert.equal(count, 1, `${id} skal ha fått nøyaktig én e-post`)
  }
})

// ── Tidsbudsjett ────────────────────────────────────────────────────────────

test('stopper på tidsbudsjettet og etterlater resten til neste kjøring', async () => {
  const subs = makeSubs(200)
  const world = makeWorld(subs)
  const clock = fakeClock()

  const res = await dispatchInBatches<Sub>(subs, {
    send: async s => world.record(s),
    stamp: async d => { clock.advance(500); await world.stamp(d) },
    now: clock.now,
    sleep: clock.sleep,
  }, { batchSize: 8, minBatchIntervalMs: 1_000, budgetMs: 5_000 })

  assert.equal(res.stoppedOnBudget, true)
  assert.ok(res.remaining > 0, 'noe skal gjenstå')
  assert.equal(res.sent + res.remaining, 200)
  // Alt som ble sendt, ble også stemplet — ingen kan bli sendt på nytt.
  assert.equal(world.notifiedForQuiz.size, res.sent)
  assert.equal(world.duplicates(), 0)
  assert.equal(world.remainingSubscribers().length, res.remaining)
})

test('en batch som er startet får alltid fullføre og bli stemplet', async () => {
  // Budsjettet sprenges MENS batch 1 kjører. Batchen skal likevel stemples.
  const subs = makeSubs(16)
  const world = makeWorld(subs)
  const clock = fakeClock()

  const res = await dispatchInBatches<Sub>(subs, {
    send: async s => { clock.advance(1_000); world.record(s) },
    stamp: world.stamp,
    now: clock.now,
    sleep: clock.sleep,
  }, { batchSize: 8, minBatchIntervalMs: 0, budgetMs: 2_000 })

  assert.equal(res.sent, 8)
  assert.equal(res.stoppedOnBudget, true)
  assert.equal(world.notifiedForQuiz.size, 8, 'batchen som rakk å starte er stemplet')
})

// ── Pacing ──────────────────────────────────────────────────────────────────

test('pacing holder minst ett intervall mellom batch-startene', async () => {
  const subs = makeSubs(24)
  const clock = fakeClock()
  const batchStarts: number[] = []
  let seen = 0

  await dispatchInBatches<Sub>(subs, {
    send: async () => { if (seen++ % 8 === 0) batchStarts.push(clock.now()) },
    stamp: async () => {},
    now: clock.now,
    sleep: clock.sleep,
  }, { batchSize: 8, minBatchIntervalMs: 1_000, budgetMs: 50_000 })

  assert.equal(batchStarts.length, 3)
  assert.ok(batchStarts[1] - batchStarts[0] >= 1_000, 'minst 1 s mellom batch 1 og 2')
  assert.ok(batchStarts[2] - batchStarts[1] >= 1_000, 'minst 1 s mellom batch 2 og 3')
})

test('pacing måles fra forrige batchs START, ikke slutt', async () => {
  // Tar batchen 400 ms, skal vi vente 600 ms — ikke 1000. Ellers ville
  // sendetiden lagt seg oppå intervallet og raten blitt lavere enn tiltenkt.
  const subs = makeSubs(16)
  const clock = fakeClock()
  const slept: number[] = []

  await dispatchInBatches<Sub>(subs, {
    send: async () => {},
    stamp: async () => { clock.advance(400) }, // batchen "tok" 400 ms
    now: clock.now,
    sleep: async ms => { slept.push(ms); clock.advance(ms) },
  }, { batchSize: 8, minBatchIntervalMs: 1_000, budgetMs: 50_000 })

  assert.deepEqual(slept, [600])
})

// ── Stemplingsfeil ──────────────────────────────────────────────────────────

test('feilet stempling stopper kjøringen i stedet for å sende videre ustemplet', async () => {
  const subs = makeSubs(32)
  const world = makeWorld(subs)
  const clock = fakeClock()
  let stampCalls = 0
  let stampErrors = 0

  const res = await dispatchInBatches<Sub>(subs, {
    send: async s => world.record(s),
    stamp: async delivered => {
      if (++stampCalls === 2) throw new Error('databasen sa nei')
      await world.stamp(delivered)
    },
    now: clock.now,
    sleep: clock.sleep,
    onStampError: () => { stampErrors++ },
  }, OPTS)

  assert.equal(res.stampFailed, true)
  assert.equal(stampErrors, 1)
  // Vi stoppet etter batch 2. Hadde vi fortsatt, ville 16 e-poster til gått ut
  // uten mulighet for å merkes — og alle ville blitt sendt på nytt.
  assert.equal(world.deliveries.size, 16)
  assert.equal(res.remaining, 16)
})

test('tom liste gjør ingenting', async () => {
  const clock = fakeClock()
  let stamps = 0

  const res = await dispatchInBatches<Sub>([], {
    send: async () => { throw new Error('skal ikke kalles') },
    stamp: async () => { stamps++ },
    now: clock.now,
    sleep: clock.sleep,
  }, OPTS)

  assert.deepEqual(
    { sent: res.sent, failed: res.failed, remaining: res.remaining, batches: res.batches },
    { sent: 0, failed: 0, remaining: 0, batches: 0 },
  )
  assert.equal(stamps, 0)
})
