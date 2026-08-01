// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAnswerTimeIntegrity,
  MIN_ANSWER_MS,
  IMPOSSIBLE_AVG_MS,
  CLOCK_SKEW_SLACK_MS,
} from './answer-time-integrity'

const LIMIT = 15_000 // vanlig tidsgrense i ms

/** n spørsmål med samme rapporterte tid. */
function reported(n: number, timeMs: number, limitMs = LIMIT) {
  return Array.from({ length: n }, () => ({ timeMs, limitMs }))
}

// ── (a) Ekte spillere skal ikke straffes ────────────────────────────────────

test('naturlig rask spiller (1,2 s per spørsmål) røres ikke', () => {
  const r = applyAnswerTimeIntegrity(reported(10, 1200), 120_000)
  assert.equal(r.clampedCount, 0)
  assert.equal(r.totalMs, 12_000)
  assert.equal(r.totalMs, r.rawTotalMs)
  assert.equal(r.reject, false)
  assert.equal(r.suspicious, false)
})

test('svært rask spiller rett over gulvet røres ikke', () => {
  // 401 ms er urealistisk raskt for et menneske, men vi straffer det likevel
  // ikke — gulvet skal ligge under alt en ekte spiller kan treffe.
  const r = applyAnswerTimeIntegrity(reported(10, MIN_ANSWER_MS + 1), 60_000)
  assert.equal(r.clampedCount, 0)
  assert.equal(r.totalMs, 10 * (MIN_ANSWER_MS + 1))
  assert.equal(r.suspicious, false)
})

test('lang pause midt i quizen er ikke mistenkelig', () => {
  // Det viktigste falsk-positiv-tilfellet: mellomskjermen mellom spørsmålene
  // gjør at forløpt tid kan være mange ganger summen av svartidene. Blir det
  // noen gang lagt inn et forholdstall-gulv mot elapsedMs, ryker denne.
  const r = applyAnswerTimeIntegrity(reported(10, 2_000), 20 * 60 * 1000)
  assert.equal(r.suspicious, false)
  assert.equal(r.reject, false)
  assert.equal(r.totalMs, 20_000)
})

test('blandet quiz med timeout-svar og ett kjapt svar er ren', () => {
  const r = applyAnswerTimeIntegrity(
    [
      { timeMs: LIMIT, limitMs: LIMIT }, // gikk ut på tid
      { timeMs: 620, limitMs: LIMIT },   // kjapp, men menneskelig
      { timeMs: 4_300, limitMs: LIMIT },
    ],
    90_000,
  )
  assert.equal(r.clampedCount, 0)
  assert.equal(r.reject, false)
  assert.equal(r.totalMs, LIMIT + 620 + 4_300)
})

test('tom innsending avvises ikke', () => {
  // Ingen svar = ingenting å vurdere. En divisjon eller en `< 0`-sammenligning
  // som slår ut på tom liste ville avvist en helt vanlig kant-situasjon.
  const r = applyAnswerTimeIntegrity([], 5_000)
  assert.equal(r.reject, false)
  assert.equal(r.suspicious, false)
  assert.equal(r.totalMs, 0)
})

// ── (b) Angrepet fanges ─────────────────────────────────────────────────────

test('timeMs 0 på alle spørsmål avvises', () => {
  const r = applyAnswerTimeIntegrity(reported(10, 0), 300_000)
  assert.equal(r.reject, true)
  assert.equal(r.suspicious, true)
  assert.ok(r.reasons.includes('impossible_avg'))
})

test('timeMs 0 gir aldri total_time_ms 0 hvis avvisningen skulle bortfalle', () => {
  // To lag rundt samme invariant: selv om avvisningen over ble fjernet, skal
  // den lagrede tiden ikke kunne bli 0 og gi garantert 1. plass.
  const r = applyAnswerTimeIntegrity(reported(10, 0), 300_000)
  assert.equal(r.totalMs, 10 * MIN_ANSWER_MS)
  assert.equal(r.clampedCount, 10)
})

test('negativ tid trekker ikke ned totalen', () => {
  const r = applyAnswerTimeIntegrity(reported(5, -60_000), 300_000)
  assert.equal(r.totalMs, 5 * MIN_ANSWER_MS)
  assert.ok(r.totalMs > 0)
})

test('NaN koster full tidsgrense, ikke null', () => {
  const r = applyAnswerTimeIntegrity(reported(3, NaN), 300_000)
  assert.equal(r.totalMs, 3 * LIMIT)
  assert.equal(r.reject, false)
  assert.equal(r.clampedCount, 0)
})

test('tid over tidsgrensen kappes ned til grensen', () => {
  const r = applyAnswerTimeIntegrity(reported(2, 999_999), 10_000_000)
  assert.equal(r.totalMs, 2 * LIMIT)
})

test('sniking rett under gulvet korrigeres opp, men avvises ikke', () => {
  // 200 ms i snitt er over IMPOSSIBLE_AVG_MS, så innsendingen slipper gjennom —
  // men tiden løftes til gulvet og hendelsen logges.
  const r = applyAnswerTimeIntegrity(reported(10, 200), 300_000)
  assert.equal(r.reject, false)
  assert.equal(r.suspicious, true)
  assert.deepEqual(r.reasons, ['floor_clamped'])
  assert.equal(r.totalMs, 10 * MIN_ANSWER_MS)
})

test('ett enkelt kjapt svar i en ellers ekte runde løftes uten å avvise runden', () => {
  const r = applyAnswerTimeIntegrity(
    [
      { timeMs: 0, limitMs: LIMIT },
      ...reported(9, 3_000),
    ],
    150_000,
  )
  assert.equal(r.reject, false)
  assert.equal(r.clampedCount, 1)
  assert.equal(r.times[0], MIN_ANSWER_MS)
  assert.equal(r.times[1], 3_000)
})

// ── Grensene, eksplisitt ────────────────────────────────────────────────────

test('avvisningsgrensen er eksklusiv — nøyaktig på grensen slipper gjennom', () => {
  const at = applyAnswerTimeIntegrity(reported(10, IMPOSSIBLE_AVG_MS), 300_000)
  assert.equal(at.reject, false)

  const under = applyAnswerTimeIntegrity(reported(10, IMPOSSIBLE_AVG_MS - 1), 300_000)
  assert.equal(under.reject, true)
})

test('gulvet er eksklusivt — nøyaktig på gulvet korrigeres ikke', () => {
  const r = applyAnswerTimeIntegrity(reported(4, MIN_ANSWER_MS), 60_000)
  assert.equal(r.clampedCount, 0)
  assert.equal(r.suspicious, false)
})

test('gulvet legges aldri over spørsmålets egen tidsgrense', () => {
  // Et spørsmål med 0,2 s grense skal ikke kunne få 0,4 s registrert — da ville
  // sjekken produsert en tid som er umulig ifølge quizens egne regler.
  const r = applyAnswerTimeIntegrity([{ timeMs: 0, limitMs: 200 }], 30_000)
  assert.equal(r.times[0], 200)
  assert.ok(r.times[0] <= 200)
})

test('tidsgrense 0 gir tid 0, ikke gulvet', () => {
  const r = applyAnswerTimeIntegrity([{ timeMs: 5_000, limitMs: 0 }], 30_000)
  assert.equal(r.times[0], 0)
})

test('avvisningen leser rapportert sum, ikke den korrigerte', () => {
  // Gulvet løfter alt til 400 ms. Leste avvisningssjekken den KORRIGERTE
  // summen, ville 400 ms snitt alltid ligget over IMPOSSIBLE_AVG_MS og
  // avvisningen aldri slått til i det hele tatt.
  const r = applyAnswerTimeIntegrity(reported(10, 0), 300_000)
  assert.equal(r.rawTotalMs, 0)
  assert.equal(r.totalMs, 10 * MIN_ANSWER_MS)
  assert.equal(r.reject, true)
})

// ── Veggklokke: kun logging ─────────────────────────────────────────────────

test('rapportert sum over forløpt tid logges', () => {
  const r = applyAnswerTimeIntegrity(reported(10, 10_000), 5_000)
  assert.ok(r.reasons.includes('sum_over_elapsed'))
  assert.equal(r.suspicious, true)
})

test('sum over forløpt tid korrigeres IKKE ned', () => {
  // En nedjustering her ville gitt bedre plassering til den som overrapporterer
  // — altså belønnet manipulasjonen sjekken skal fange.
  const r = applyAnswerTimeIntegrity(reported(10, 10_000), 5_000)
  assert.equal(r.totalMs, 100_000)
  assert.equal(r.reject, false)
})

test('klokkeavvik innenfor slingringsmonnet logges ikke', () => {
  const sum = 30_000
  const r = applyAnswerTimeIntegrity(
    reported(10, 3_000),
    sum - CLOCK_SKEW_SLACK_MS + 1,
  )
  assert.equal(r.suspicious, false)
})

// ── Rekkefølge og form ──────────────────────────────────────────────────────

test('times har samme lengde og rekkefølge som input', () => {
  const r = applyAnswerTimeIntegrity(
    [
      { timeMs: 5_000, limitMs: LIMIT },
      { timeMs: 0, limitMs: LIMIT },
      { timeMs: 2_500, limitMs: LIMIT },
    ],
    60_000,
  )
  assert.equal(r.times.length, 3)
  assert.deepEqual(r.times, [5_000, MIN_ANSWER_MS, 2_500])
  assert.equal(r.totalMs, 5_000 + MIN_ANSWER_MS + 2_500)
})

test('totalMs er alltid summen av times', () => {
  const r = applyAnswerTimeIntegrity(
    [
      { timeMs: -1, limitMs: LIMIT },
      { timeMs: NaN, limitMs: 8_000 },
      { timeMs: 99_999, limitMs: 8_000 },
      { timeMs: 1_234, limitMs: LIMIT },
    ],
    200_000,
  )
  assert.equal(r.totalMs, r.times.reduce((s, t) => s + t, 0))
})

// ── Konstantene ─────────────────────────────────────────────────────────────

test('gulvet ligger over avvisningsgrensen', () => {
  // Korrigering skal være normalveien og avvisning unntaket. Snur dette seg,
  // avvises alt som ellers bare ville blitt løftet.
  assert.ok(MIN_ANSWER_MS > IMPOSSIBLE_AVG_MS)
})

test('gulvet er lavt nok til å ikke røre ekte spill', () => {
  // Et halvt sekund er allerede raskere enn et menneske rekker å lese fire
  // alternativer. Skyves gulvet over dette, begynner vi å endre ekte tider.
  assert.ok(MIN_ANSWER_MS <= 500)
})
