// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAnswerTimeIntegrity,
  MIN_ANSWER_MS,
  FLOOR_AVG_MS,
  FLOOR_LIMIT_RATIO,
  SUSPICIOUS_AVG_MS,
  CLOCK_SKEW_SLACK_MS,
} from './answer-time-integrity'

const LIMIT = 15_000 // vanlig tidsgrense i ms

/** n spørsmål med samme rapporterte tid. */
function reported(n: number, timeMs: number, limitMs = LIMIT) {
  return Array.from({ length: n }, () => ({ timeMs, limitMs }))
}

// ── Ekte spillere skal ikke røres ───────────────────────────────────────────

test('typisk spiller (4,5 s per spørsmål — prod-medianen) røres ikke', () => {
  const r = applyAnswerTimeIntegrity(reported(15, 4_500), 150_000)
  assert.equal(r.clampedCount, 0)
  assert.equal(r.substituted, false)
  assert.equal(r.suspicious, false)
  assert.equal(r.totalMs, 15 * 4_500)
  assert.equal(r.totalMs, r.rawTotalMs)
})

test('raskeste målte ekte spiller (2,68 s snitt) røres ikke og logges ikke', () => {
  // 2 683 ms/spørsmål er det raskeste ekte snittet målt i prod (200 forsøk).
  // Denne spilleren skal verken substitueres ELLER havne i observasjonsbåndet
  // — båndet ligger bevisst rett under henne, ikke på henne.
  const r = applyAnswerTimeIntegrity(reported(15, 2_683), 82_000)
  assert.equal(r.substituted, false)
  assert.equal(r.suspicious, false)
  assert.equal(r.totalMs, 15 * 2_683)
})

test('lang pause midt i quizen er ikke mistenkelig', () => {
  // Det viktigste falsk-positiv-tilfellet: mellomskjermen mellom spørsmålene
  // gjør at forløpt tid kan være mange ganger summen av svartidene. Blir det
  // noen gang lagt inn et forholdstall-gulv mot elapsedMs, ryker denne.
  const r = applyAnswerTimeIntegrity(reported(10, 3_000), 20 * 60 * 1000)
  assert.equal(r.suspicious, false)
  assert.equal(r.substituted, false)
  assert.equal(r.totalMs, 30_000)
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
  assert.equal(r.substituted, false)
  assert.equal(r.totalMs, LIMIT + 620 + 4_300)
})

test('tom innsending substitueres ikke', () => {
  // Ingen svar = ingenting å vurdere. En divisjon eller en `< 0`-sammenligning
  // som slår ut på tom liste ville rammet en helt vanlig kant-situasjon.
  const r = applyAnswerTimeIntegrity([], 5_000)
  assert.equal(r.substituted, false)
  assert.equal(r.suspicious, false)
  assert.equal(r.totalMs, 0)
})

// ── (a) Grensen er PER SPØRSMÅL og skalerer med antallet ────────────────────

test('samme snitt under gulvet fanges likt for 10 og 20 spørsmål', () => {
  const ti = applyAnswerTimeIntegrity(reported(10, FLOOR_AVG_MS - 100), 300_000)
  const tjue = applyAnswerTimeIntegrity(reported(20, FLOOR_AVG_MS - 100), 300_000)
  assert.equal(ti.substituted, true)
  assert.equal(tjue.substituted, true)
})

test('samme TOTALSUM gir ulikt utfall for 10 og 20 spørsmål — beviser at grensen ikke er en fast sum', () => {
  // 25 s totalt: over 10 spørsmål er det 2,5 s i snitt (ekte-spiller-territorium),
  // over 20 spørsmål er det 1,25 s i snitt (under gulvet). En fast totalsum-grense
  // ville behandlet de to likt.
  const perQ10 = 2_500
  const perQ20 = 1_250
  const ti = applyAnswerTimeIntegrity(reported(10, perQ10), 300_000)
  const tjue = applyAnswerTimeIntegrity(reported(20, perQ20), 300_000)
  assert.equal(ti.rawTotalMs, tjue.rawTotalMs) // premiss: identisk sum
  assert.equal(ti.substituted, false)
  assert.equal(tjue.substituted, true)
})

test('gulvet skalerer også med spørsmålets tidsgrense — hurtigquiz rammes ikke', () => {
  // En quiz med 3 s per spørsmål TVINGER ærlige spillere til raske svar. Med et
  // fast 1,5 s-gulv ville et ærlig snitt på 1 s blitt substituert. Gulvet per
  // spørsmål er min(FLOOR_AVG_MS, tidsgrense * FLOOR_LIMIT_RATIO) = 300 ms her.
  const r = applyAnswerTimeIntegrity(reported(15, 1_000, 3_000), 60_000)
  assert.equal(r.substituted, false)
  // …mens et script som rapporterer nær null på samme quiz fortsatt fanges.
  const script = applyAnswerTimeIntegrity(reported(15, 100, 3_000), 60_000)
  assert.equal(script.substituted, true)
})

test('for standardgrensen (15 s) er tidsgrense-taket uten virkning', () => {
  // min(FLOOR_AVG_MS, 15 000 * 0,1) = FLOOR_AVG_MS — de to konstruksjonene er
  // identiske for alle dagens quizer. Endres ratioen eller gulvet slik at taket
  // begynner å bite på standardgrensen, er kalibreringen ikke lenger den
  // dokumenterte.
  assert.ok(LIMIT * FLOOR_LIMIT_RATIO >= FLOOR_AVG_MS)
})

// ── (b) Kort elapsedMs mot ekte tider rammes ikke ───────────────────────────

test('kort elapsedMs mot ekte tider gir verken substitusjon eller endret total', () => {
  // Tilfellet het «gjenopptatt gjest» til 24. august 2026, da gjeste-veien ble
  // stengt. Navnet var uansett for smalt: en spiller som tar pause på
  // mellomskjermen produserer nøyaktig samme forhold, og det er DEN
  // begrunnelsen som består. Substitusjonen skal utløses av lav RAPPORTERT sum
  // alene — aldri av forholdet mellom sum og elapsed.
  const r = applyAnswerTimeIntegrity(reported(15, 4_000), 10_000)
  assert.equal(r.substituted, false)
  assert.equal(r.totalMs, 15 * 4_000) // totalen står urørt
  assert.ok(r.reasons.includes('sum_over_elapsed')) // kun logging
  assert.equal(r.suspicious, true)
})

test('sum over forløpt tid korrigeres ALDRI ned', () => {
  // En nedjustering ville gitt bedre plassering til den som overrapporterer —
  // og ville straffet den gjenopptatte gjesten over.
  const r = applyAnswerTimeIntegrity(reported(10, 10_000), 5_000)
  assert.equal(r.totalMs, 100_000)
  assert.equal(r.substituted, false)
})

test('klokkeavvik innenfor slingringsmonnet logges ikke', () => {
  const sum = 30_000
  const r = applyAnswerTimeIntegrity(
    reported(10, 3_000),
    sum - CLOCK_SKEW_SLACK_MS + 1,
  )
  assert.equal(r.suspicious, false)
})

// ── (c) Substitusjonen gir dårligere tid, aldri avvisning ───────────────────

test('timeMs 0 på alle spørsmål: totalen blir veggklokka, ikke 6 sekunder', () => {
  // Før 2. august ga dette 403; før 1. august total_time_ms = 0. Nå: forsøket
  // BEHOLDES, men tiden settes til forløpt veggklokketid — scriptet som ventet
  // 80 s får 80 s registrert og taper mot raskeste ekte spiller (40,3 s målt).
  const elapsed = 80_000
  const r = applyAnswerTimeIntegrity(reported(15, 0), elapsed)
  assert.equal(r.substituted, true)
  assert.ok(r.reasons.includes('below_floor_substituted'))
  assert.equal(r.totalMs, elapsed)
  assert.ok(r.totalMs > 15 * MIN_ANSWER_MS) // dårligere enn per-svar-gulvet alene
})

test('substitusjonen kan ikke brukes som snarvei: lyn-innsending får minst gulv-terskelen', () => {
  // Et script som OGSÅ leverer raskt (lav elapsedMs) skal ikke kunne bruke
  // veggklokka som en bedre tid enn gulvet. 15 spørsmål à 0 ms med 3 s forløpt
  // gir gulv-terskelen (15 * 1 500 = 22,5 s), aldri 3 s.
  const r = applyAnswerTimeIntegrity(reported(15, 0), 3_000)
  assert.equal(r.substituted, true)
  assert.equal(r.totalMs, 15 * FLOOR_AVG_MS)
  assert.ok(r.totalMs > 3_000)
})

test('substituert total kappes ved summen av tidsgrensene', () => {
  // En innlogget spiller-rad kan være dager gammel (gjenbruk av uferdig
  // forsøk). Substitusjonen skal aldri registrere mer enn det en spiller som
  // gikk ut på tid på ALT ville fått.
  const fourDays = 4 * 24 * 60 * 60 * 1000
  const r = applyAnswerTimeIntegrity(reported(15, 0), fourDays)
  assert.equal(r.substituted, true)
  assert.equal(r.totalMs, 15 * LIMIT)
})

test('substitusjonen gir aldri bedre total enn den korrigerte summen', () => {
  // Kort-grense-quiz der per-svar-gulvet (min(400, limit)) ligger over
  // gulv-terskelen (limit * 0,1): korrigert sum er da størst og skal vinne.
  const r = applyAnswerTimeIntegrity(reported(10, 0, 2_000), 500)
  assert.equal(r.substituted, true)
  const correctedSum = r.times.reduce((s, t) => s + t, 0)
  assert.ok(r.totalMs >= correctedSum)
})

test('negativ elapsedMs (klokkeskjevhet) gir aldri lavere total enn gulv-terskelen', () => {
  const r = applyAnswerTimeIntegrity(reported(15, 0), -60_000)
  assert.equal(r.substituted, true)
  assert.equal(r.totalMs, 15 * FLOOR_AVG_MS)
})

test('ingen avvisning finnes lenger — resultatet har ikke noe reject-felt', () => {
  // Beslutning 2. august: en feilklassifisering skal koste en dårligere tid,
  // aldri et tapt forsøk. Kommer et reject-felt tilbake, er den beslutningen
  // reversert uten at denne testen ble oppdatert bevisst.
  const r = applyAnswerTimeIntegrity(reported(15, 0), 80_000)
  assert.ok(!('reject' in r))
})

// ── Observasjonsbåndet: logging uten straff ─────────────────────────────────

test('snitt mellom gulvet og observasjonsgrensen logges men røres ikke', () => {
  const perQ = 2_000 // over FLOOR_AVG_MS (1 500), under SUSPICIOUS_AVG_MS (2 500)
  const r = applyAnswerTimeIntegrity(reported(15, perQ), 120_000)
  assert.equal(r.substituted, false)
  assert.equal(r.suspicious, true)
  assert.deepEqual(r.reasons, ['suspicious_low_avg'])
  assert.equal(r.totalMs, 15 * perQ) // ingen korrigering — kun logging
})

test('båndene er disjunkte: under gulvet gir substitusjonsgrunnen, ikke begge', () => {
  const r = applyAnswerTimeIntegrity(reported(15, 1_000), 120_000)
  assert.ok(r.reasons.includes('below_floor_substituted'))
  assert.ok(!r.reasons.includes('suspicious_low_avg'))
})

// ── Per-svar-gulvet (uendret fra 1. august) ─────────────────────────────────

test('ett enkelt kjapt svar i en ellers ekte runde løftes uten å substituere runden', () => {
  const r = applyAnswerTimeIntegrity(
    [
      { timeMs: 0, limitMs: LIMIT },
      ...reported(9, 3_000),
    ],
    150_000,
  )
  assert.equal(r.substituted, false)
  assert.equal(r.clampedCount, 1)
  assert.equal(r.times[0], MIN_ANSWER_MS)
  assert.equal(r.times[1], 3_000)
})

test('negativ tid trekker ikke ned totalen', () => {
  const r = applyAnswerTimeIntegrity(reported(5, -60_000), 300_000)
  assert.ok(r.totalMs >= 5 * MIN_ANSWER_MS)
  assert.deepEqual(r.times, Array(5).fill(MIN_ANSWER_MS))
})

test('NaN koster full tidsgrense, ikke null', () => {
  const r = applyAnswerTimeIntegrity(reported(3, NaN), 300_000)
  assert.equal(r.totalMs, 3 * LIMIT)
  assert.equal(r.substituted, false)
  assert.equal(r.clampedCount, 0)
})

test('tid over tidsgrensen kappes ned til grensen', () => {
  const r = applyAnswerTimeIntegrity(reported(2, 999_999), 10_000_000)
  assert.equal(r.totalMs, 2 * LIMIT)
})

test('gulvet legges aldri over spørsmålets egen tidsgrense', () => {
  const r = applyAnswerTimeIntegrity([{ timeMs: 0, limitMs: 200 }], 30_000)
  assert.equal(r.times[0], 200)
})

test('tidsgrense 0 gir tid 0, ikke gulvet', () => {
  const r = applyAnswerTimeIntegrity([{ timeMs: 5_000, limitMs: 0 }], 30_000)
  assert.equal(r.times[0], 0)
})

// ── Grensene, eksplisitt ────────────────────────────────────────────────────

test('substitusjonsgrensen er eksklusiv — nøyaktig på grensen slipper gjennom', () => {
  const paa = applyAnswerTimeIntegrity(reported(10, FLOOR_AVG_MS), 300_000)
  assert.equal(paa.substituted, false)

  const under = applyAnswerTimeIntegrity(reported(10, FLOOR_AVG_MS - 1), 300_000)
  assert.equal(under.substituted, true)
})

test('substitusjonen leser rapportert sum, ikke den korrigerte', () => {
  // Per-svar-gulvet løfter alt til 400 ms — fortsatt under 1 500-terskelen, så
  // dette skiller ikke i dag. Men leses den KORRIGERTE summen, blir sjekken
  // avhengig av MIN_ANSWER_MS på en udokumentert måte. rawTotalMs skal være det
  // klienten faktisk påsto.
  const r = applyAnswerTimeIntegrity(reported(10, 0), 300_000)
  assert.equal(r.rawTotalMs, 0)
  assert.equal(r.substituted, true)
})

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
})

test('uten substitusjon er totalMs alltid summen av times', () => {
  const r = applyAnswerTimeIntegrity(
    [
      { timeMs: 3_000, limitMs: LIMIT },
      { timeMs: NaN, limitMs: 8_000 },
      { timeMs: 99_999, limitMs: 8_000 },
      { timeMs: 4_234, limitMs: LIMIT },
    ],
    200_000,
  )
  assert.equal(r.substituted, false)
  assert.equal(r.totalMs, r.times.reduce((s, t) => s + t, 0))
})

test('ved substitusjon bevarer times fortsatt de korrigerte per-svar-tidene', () => {
  // attempt_answers-radene er det forensiske sporet av hva klienten rapporterte
  // (gulv-korrigert). Substitueres OGSÅ per-svar-tidene, mister vi beviset.
  const r = applyAnswerTimeIntegrity(reported(15, 0), 80_000)
  assert.equal(r.substituted, true)
  assert.deepEqual(r.times, Array(15).fill(MIN_ANSWER_MS))
  assert.notEqual(r.totalMs, r.times.reduce((s, t) => s + t, 0))
})

// ── Konstantene ─────────────────────────────────────────────────────────────

test('gulvet ligger under raskeste målte ekte spiller med god margin', () => {
  // Raskeste ekte snitt målt i prod (2. august 2026, 200 forsøk): 2 683 ms.
  // Kravet er margin også ved 5–10x vekst i brukerbasen — gulvet skal ligge på
  // maks 60 % av dagens raskeste, ikke rett under henne.
  const FASTEST_REAL_AVG_MS = 2_683
  assert.ok(FLOOR_AVG_MS <= FASTEST_REAL_AVG_MS * 0.6)
})

test('gulvet ligger i det besluttede spennet 1500–2000 ms', () => {
  assert.ok(FLOOR_AVG_MS >= 1_500 && FLOOR_AVG_MS <= 2_000)
})

test('observasjonsbåndet ligger over gulvet og under raskeste målte spiller', () => {
  // Under gulvet: substitusjon. Mellom gulvet og båndet: logging. Over båndet:
  // stillhet. Kollapser ordningen, forsvinner enten dataene eller stillheten.
  assert.ok(SUSPICIOUS_AVG_MS > FLOOR_AVG_MS)
  assert.ok(SUSPICIOUS_AVG_MS < 2_683)
})

test('per-svar-gulvet er lavt nok til å ikke røre ekte enkeltsvar', () => {
  // Et halvt sekund er allerede raskere enn et menneske rekker å lese fire
  // alternativer. Skyves gulvet over dette, begynner vi å endre ekte tider.
  assert.ok(MIN_ANSWER_MS <= 500)
})
