// Kjøres med:  npm test
//
// Testene her vokter feilklassen som gjorde at fasitrettings-ruten kunne
// rapportere «alle rader oppdatert» mens skrivinger i virkeligheten feilet:
// Supabase-js kaster ikke ved DB-feil, den legger feilen i returverdien, så en
// `await Promise.all(...)` uten sjekk resolver også når alt gikk galt.
//
// Fake-skrivefunksjonene under speiler nettopp den formen: de RESOLVER med
// `{ error }` i stedet for å kaste — happy path alene ville ikke avslørt noe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBatchWithRetry } from '@/lib/batch-write'

const ok = () => Promise.resolve({ error: null })
const fails = (message: string) => () => Promise.resolve({ error: { message } })

test('alle skrivinger lykkes: ingenting rapporteres som feilet', async () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const res = await runBatchWithRetry(items, ok)

  assert.equal(res.succeeded.length, 3)
  assert.deepEqual(res.failed, [])
})

test('en skriving som resolver med { error } telles som FEILET, ikke vellykket', async () => {
  // Kjernen i feilklassen: uten denne sjekken ville kallet sett vellykket ut.
  const res = await runBatchWithRetry([{ id: 'a' }], fails('permission denied'), { retries: 0 })

  assert.equal(res.succeeded.length, 0)
  assert.equal(res.failed.length, 1)
  assert.equal(res.failed[0].message, 'permission denied')
})

test('delvis feil: vellykkede og feilede skilles korrekt fra hverandre', async () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const res = await runBatchWithRetry(
    items,
    item => (item.id === 'b' || item.id === 'd'
      ? Promise.resolve({ error: { message: 'connection reset' } })
      : Promise.resolve({ error: null })),
    { retries: 0 }
  )

  assert.deepEqual(res.succeeded.map(i => i.id), ['a', 'c'])
  assert.deepEqual(res.failed.map(f => f.item.id), ['b', 'd'])
})

test('en forbigående feil retryes og lykkes i andre forsøk', async () => {
  // Den realistiske feilmodusen: en kortvarig glipp, ikke en permanent feil.
  let calls = 0
  const res = await runBatchWithRetry([{ id: 'a' }], () => {
    calls++
    return calls === 1
      ? Promise.resolve({ error: { message: 'connection reset' } })
      : Promise.resolve({ error: null })
  })

  assert.equal(calls, 2)
  assert.equal(res.succeeded.length, 1)
  assert.deepEqual(res.failed, [])
})

test('retry gjelder KUN de radene som feilet — vellykkede skrives ikke på nytt', async () => {
  // Viktig for fasitretting: en dobbelt-skriving er ufarlig her, men en retry
  // som treffer alt ville skalert dårlig på en quiz med hundrevis av rader.
  const seen: string[] = []
  const items = [{ id: 'a' }, { id: 'b' }]
  await runBatchWithRetry(items, item => {
    seen.push(item.id)
    return item.id === 'b' && seen.filter(s => s === 'b').length === 1
      ? Promise.resolve({ error: { message: 'blip' } })
      : Promise.resolve({ error: null })
  })

  assert.deepEqual(seen, ['a', 'b', 'b'])
})

test('vedvarende feil gir opp etter retries og rapporteres', async () => {
  let calls = 0
  const res = await runBatchWithRetry([{ id: 'a' }], () => {
    calls++
    return Promise.resolve({ error: { message: 'PGRST204 column does not exist' } })
  }, { retries: 1 })

  assert.equal(calls, 2)
  assert.equal(res.failed.length, 1)
  assert.equal(res.failed[0].message, 'PGRST204 column does not exist')
})

test('en KASTET exception telles som feilet skriving, ikke som suksess', async () => {
  // Nettverksfeil kaster (i motsetning til DB-feil). Begge må fanges likt,
  // ellers ville en kastende rad tatt ned hele Promise.all-en i stedet.
  const res = await runBatchWithRetry(
    [{ id: 'a' }],
    () => Promise.reject(new Error('socket hang up')),
    { retries: 0 }
  )

  assert.equal(res.succeeded.length, 0)
  assert.equal(res.failed[0].message, 'socket hang up')
})

test('tom liste er trygg og gir tomt resultat', async () => {
  const res = await runBatchWithRetry([], ok)
  assert.deepEqual(res.succeeded, [])
  assert.deepEqual(res.failed, [])
})

test('rapportert antall lar seg bruke direkte som «faktisk oppdatert»', async () => {
  // Regresjonsvakt for selve symptomet: responsen skal aldri kunne si at 3
  // rader ble rettet når bare 1 faktisk ble skrevet.
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const res = await runBatchWithRetry(
    items,
    item => (item.id === 'a'
      ? Promise.resolve({ error: null })
      : Promise.resolve({ error: { message: 'nope' } })),
    { retries: 0 }
  )

  assert.equal(res.succeeded.length, 1)
  assert.notEqual(res.succeeded.length, items.length)
  assert.equal(res.failed.length, 2)
})
