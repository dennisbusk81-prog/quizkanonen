// Kjøres med:  npm test
//
// Testene her vokter to ULIKE tak som begge feiler stille:
//   1. PostgREST returnerer maks 1000 rader per spørring uten range().
//   2. .in(kolonne, ids) sprenger URL-lengden et sted mellom 380 og 400 id-er
//      (målt mot prod 26. juli 2026).
//
// Fakene under HÅNDHEVER begge takene, slik at en test feiler hvis koden slutter
// å paginere eller slutter å chunke — ikke bare hvis den kaster.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllRows, fetchAllRowsChunked } from '@/lib/paginate'

const PG_ROW_CAP = 1000
const URL_KEY_CAP = 390 // målt: 380 OK, 400 feiler

type Row = { id: number; key: string }

const makeRows = (n: number, key = 'k'): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, key }))

/**
 * Fake som oppfører seg som PostgREST: respekterer range(), men returnerer
 * ALDRI mer enn 1000 rader i ett svar. Teller kallene så vi kan skille
 * «paginerte» fra «tok bare første side».
 */
function cappedSource(rows: Row[]) {
  const calls: Array<{ from: number; to: number }> = []
  return {
    calls,
    query(from: number, to: number) {
      calls.push({ from, to })
      const window = rows.slice(from, to + 1)
      return Promise.resolve({ data: window.slice(0, PG_ROW_CAP), error: null })
    },
  }
}

// ── fetchAllRows ─────────────────────────────────────────────────────────────

test('fetchAllRows henter forbi 1000-taket; ett rått kall gjør det ikke', async () => {
  const rows = makeRows(2500)
  const src = cappedSource(rows)

  const all = await fetchAllRows<Row>((from, to) => src.query(from, to))
  assert.equal(all.length, 2500, 'skal hente alle radene, ikke bare første side')
  assert.deepEqual(all.map(r => r.id).slice(0, 3), [0, 1, 2])
  assert.equal(all[all.length - 1].id, 2499, 'siste rad skal være med')
  assert.ok(src.calls.length >= 3, `forventet flere sider, fikk ${src.calls.length}`)

  // Mutasjonsbevis: nøyaktig det ett upaginert kall ville gitt.
  const single = await cappedSource(rows).query(0, PG_ROW_CAP - 1)
  assert.equal(single.data.length, 1000)
  assert.notEqual(single.data.length, all.length, 'fiksen må faktisk endre resultatet')
})

test('fetchAllRows terminerer når totalen er et eksakt multiplum av pageSize', async () => {
  const src = cappedSource(makeRows(2000))
  const all = await fetchAllRows<Row>((from, to) => src.query(from, to))
  assert.equal(all.length, 2000)
  // 2 fulle sider + 1 tom side som avslutter løkka
  assert.equal(src.calls.length, 3)
})

test('fetchAllRows gir tom liste uten å loope når kilden er tom', async () => {
  const src = cappedSource([])
  assert.deepEqual(await fetchAllRows<Row>((from, to) => src.query(from, to)), [])
  assert.equal(src.calls.length, 1)
})

test('fetchAllRows kaster ved feil i stedet for å returnere delvis resultat', async () => {
  await assert.rejects(
    () => fetchAllRows<Row>(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    /boom/
  )
})

// ── fetchAllRowsChunked ──────────────────────────────────────────────────────

/**
 * Fake som håndhever BEGGE takene: kaster hvis en bit er for stor for URL-en
 * (slik ekte PostgREST gjør), og kutter ved 1000 rader.
 */
function chunkedSource(rowsByKey: Map<string, Row[]>) {
  const chunkSizes: number[] = []
  return {
    chunkSizes,
    query(chunk: string[], from: number, to: number) {
      chunkSizes.push(chunk.length)
      if (chunk.length > URL_KEY_CAP) {
        return Promise.resolve({
          data: null,
          error: { message: `Bad Request: URL for lang (${chunk.length} id-er)` },
        })
      }
      const matched = chunk.flatMap(k => rowsByKey.get(k) ?? [])
      return Promise.resolve({ data: matched.slice(from, to + 1).slice(0, PG_ROW_CAP), error: null })
    },
  }
}

test('fetchAllRowsChunked holder hver bit under URL-grensen', async () => {
  const keys = Array.from({ length: 500 }, (_, i) => 'u' + i)
  const rowsByKey = new Map(keys.map(k => [k, [{ id: 1, key: k }]]))
  const src = chunkedSource(rowsByKey)

  const all = await fetchAllRowsChunked<Row>(keys, (chunk, from, to) => src.query(chunk, from, to))

  assert.equal(all.length, 500, 'alle nøklene skal være representert')
  assert.equal(Math.max(...src.chunkSizes), 200, 'ingen bit skal overstige chunkSize 200')
  assert.ok(
    src.chunkSizes.every(n => n <= URL_KEY_CAP),
    'ingen bit skal kunne sprenge URL-grensen'
  )
})

test('fetchAllRowsChunked ville feilet uten chunking — mutasjonsbevis', async () => {
  // Samme 500 nøkler sendt som ÉN bit er nøyaktig det ikke-chunkede kallet gjør.
  const keys = Array.from({ length: 500 }, (_, i) => 'u' + i)
  const src = chunkedSource(new Map())
  const res = await src.query(keys, 0, 999)
  assert.ok(res.error, 'en usplittet liste på 500 id-er må avvises av faken')
  assert.match(res.error.message, /URL for lang/)
})

test('fetchAllRowsChunked paginerer OGSÅ innad i en bit', async () => {
  // Én nøkkel med 2500 treff: chunking alene er ikke nok, biten må pagineres.
  const rowsByKey = new Map([['heavy', makeRows(2500, 'heavy')]])
  const src = chunkedSource(rowsByKey)

  const all = await fetchAllRowsChunked<Row>(['heavy'], (chunk, from, to) => src.query(chunk, from, to))

  assert.equal(all.length, 2500, 'begge takene må håndteres i samme kall')
})

test('fetchAllRowsChunked med tom nøkkelliste gjør ingen spørring', async () => {
  const src = chunkedSource(new Map())
  assert.deepEqual(await fetchAllRowsChunked<Row>([], (c, f, t) => src.query(c, f, t)), [])
  assert.equal(src.chunkSizes.length, 0, 'ingen nøkler = ingen kall')
})

test('fetchAllRowsChunked propagerer feil fra en bit', async () => {
  await assert.rejects(
    () =>
      fetchAllRowsChunked<Row>(['a', 'b'], () =>
        Promise.resolve({ data: null, error: { message: 'nede' } })
      ),
    /nede/
  )
})
