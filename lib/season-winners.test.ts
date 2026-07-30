// Kjøres med:  npm test
//
// Vokter at et feilet vinner-oppslag IKKE kollapser til «Ikke kåret ennå».
// Fram til 30. juli gjorde loadWinners
//   .then(r => r.ok ? r.json() : { entries: [] }).catch(() => ({ entries: [] }))
// per periode, slik at en feilet henting ga tom entries-liste → ingen vinner →
// kortet påsto at ingen hadde vunnet. To ulike verdener, én tekst.
//
// MUTASJONSBEVIS — endre linjen, og navngitt test skal feile:
//   1. I lib/fetch-result.ts: `if (!res.ok) return { ok: false }`
//      → `{ ok: true, value: extract(...) }` eller la den falle gjennom
//      → «feilet henting blir ikke til «ikke kåret ennå»» feiler
//   2. I lib/fetch-result.ts: fjern try/catch
//      → «nettverksfeil på én periode …» feiler
//   3. I toPeriodWinners: `entries[0] ? … : null` → alltid null
//      → «vellykket henting med vinner gir vinneren» feiler
//   4. I fetchSeasonWinners: la ÉN feilet periode felle alle tre
//      → «periodene feiler uavhengig av hverandre» feiler
//   5. I toPeriodWinners: `entries.slice(0, 3)` → `entries`
//      → «top3 er maks tre» feiler
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchSeasonWinners,
  toPeriodWinners,
  WINNER_PERIODS,
  type WinnerApiEntry,
  type WinnerPeriod,
} from '@/lib/season-winners'

const entry = (displayName: string, points: number): WinnerApiEntry =>
  ({ displayName, avatarUrl: null, points })

const ok = (entries: WinnerApiEntry[]) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ entries }) })
const fail = () => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'boom' }) })

// ── Kjernen: feil ≠ «ikke kåret ennå» ─────────────────────────────────────────

test('feilet henting blir ikke til «ikke kåret ennå»', async () => {
  const state = await fetchSeasonWinners(() => fail())

  for (const period of WINNER_PERIODS) {
    assert.equal(state[period].ok, false, `${period}: en feilet henting er «vet ikke»`)
    // Nettopp dette skillet manglet: uten det ville kortet hatt en vinner-verdi
    // (null) å rendre, og null betyr «ingen kåret».
    assert.ok(!('value' in state[period]), `${period}: det skal ikke finnes en vinner-verdi å rendre`)
  }
})

test('«ingen kåret ennå» og «kunne ikke hentes» er skillbare', async () => {
  // Regresjonsvakten for hele feilklassen. Begge ga før winner === null.
  const empty = await fetchSeasonWinners(() => ok([]))
  const failed = await fetchSeasonWinners(() => fail())

  assert.equal(empty.month.ok, true, 'et tomt, vellykket svar er reelt «ingen kåret ennå»')
  assert.equal(empty.month.ok && empty.month.value.winner, null)
  assert.equal(failed.month.ok, false)
  assert.notEqual(empty.month.ok, failed.month.ok, 'de to utfallene må være skillbare')
})

test('nettverksfeil på én periode blir ikke til «ikke kåret ennå»', async () => {
  const state = await fetchSeasonWinners(period =>
    period === 'year' ? Promise.reject(new Error('offline')) : ok([entry('Anne', 40)])
  )

  assert.equal(state.year.ok, false)
  assert.equal(state.month.ok, true)
})

test('ugyldig JSON blir ikke til «ikke kåret ennå»', async () => {
  const state = await fetchSeasonWinners(() =>
    Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('ikke JSON')) })
  )

  assert.equal(state.month.ok, false)
})

// ── Uavhengighet mellom periodene ─────────────────────────────────────────────

test('periodene feiler uavhengig av hverandre', async () => {
  // Måneden skal fortsatt vises selv om året feiler — det er hele grunnen til
  // at tilstanden er per periode og ikke én global.
  const state = await fetchSeasonWinners(period =>
    period === 'quarter' ? fail() : ok([entry('Anne', 40)])
  )

  assert.equal(state.month.ok, true, 'måneden lyktes og skal vises')
  assert.equal(state.quarter.ok, false, 'kvartalet feilet')
  assert.equal(state.year.ok, true, 'året lyktes og skal vises')
  assert.equal(state.month.ok && state.month.value.winner?.displayName, 'Anne')
})

test('hver periode spørres én gang, med sin egen periode', async () => {
  const asked: WinnerPeriod[] = []
  await fetchSeasonWinners(period => { asked.push(period); return ok([]) })

  assert.deepEqual(asked, ['month', 'quarter', 'year'])
})

// ── Den rene transformasjonen ─────────────────────────────────────────────────

test('vellykket henting med vinner gir vinneren', async () => {
  const state = await fetchSeasonWinners(() => ok([entry('Anne', 40), entry('Bjørn', 30)]))

  assert.equal(state.month.ok, true)
  assert.equal(state.month.ok && state.month.value.winner?.displayName, 'Anne')
  assert.equal(state.month.ok && state.month.value.winner?.points, 40)
})

test('top3 er maks tre, i mottatt rekkefølge', () => {
  const { top3 } = toPeriodWinners([
    entry('Anne', 40), entry('Bjørn', 30), entry('Cato', 20), entry('Dina', 10),
  ])

  assert.deepEqual(top3.map(e => e.displayName), ['Anne', 'Bjørn', 'Cato'])
})

test('manglende avatarUrl blir null, ikke undefined', () => {
  const { winner } = toPeriodWinners([{ displayName: 'Anne', points: 40 } as WinnerApiEntry])

  assert.equal(winner?.avatarUrl, null)
})

test('tom entries-liste gir vinner null og tom top3', () => {
  const { winner, top3 } = toPeriodWinners([])

  assert.equal(winner, null)
  assert.deepEqual(top3, [])
})

test('200 uten entries-felt er reelt «ingen kåret ennå», ikke en feil', async () => {
  // En bedrift KAN ha null poeng i perioden. Det er en sannhet vi har lov til
  // å vise — overkorrigering ville gitt feilboks på en helt normal ny bedrift.
  const state = await fetchSeasonWinners(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  )

  assert.equal(state.month.ok, true)
  assert.equal(state.month.ok && state.month.value.winner, null)
})
