// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beatenPercent, placementPercentLine } from './placement-percent'

// ── Kjernen i saken: nevneren i «bedre enn» ─────────────────────────────────
// Dennis' funn 30. juli 2026 — nr. 2 av 2 fikk «Topp 100 % · bedre enn 0 %».
// Den gamle formelen var (total − rank) / TOTAL. Med to spillere ga den 50 %
// til vinneren, som hadde slått 1 av 1 andre = 100 %.

test('to spillere: vinneren slo alle de andre (1 av 1) → 100 %', () => {
  assert.equal(beatenPercent(1, 2), 100)
  // MUTASJONSVAKT: med gammel nevner (total) ville dette vært 50.
  assert.notEqual(beatenPercent(1, 2), 50)
})

test('to spillere: sisteplass slo ingen → 0 %, og det er nå sant', () => {
  assert.equal(beatenPercent(2, 2), 0)
})

test('tre spillere: midterste slo nøyaktig halvparten av de andre', () => {
  assert.equal(beatenPercent(2, 3), 50)
  // MUTASJONSVAKT: gammel nevner ga (3−2)/3 = 33.
  assert.notEqual(beatenPercent(2, 3), 33)
})

test('mange spillere: førsteplass slo alle, sisteplass slo ingen', () => {
  assert.equal(beatenPercent(1, 55), 100)
  assert.equal(beatenPercent(55, 55), 0)
})

test('typisk midtfelt: 10 av 55 → slo 83 % av de andre', () => {
  assert.equal(beatenPercent(10, 55), 83) // (55−10)/54 = 83,3
})

// ── Alene i quizen: ingen å sammenligne seg med ─────────────────────────────
// Visningen er allerede gated på total > 1, men funksjonen skal ikke kunne
// dele på null om noen kaller den et annet sted.

test('alene i quizen: «bedre enn» finnes ikke → null, ikke 0 og ikke 100', () => {
  assert.equal(beatenPercent(1, 1), null)
  // MUTASJONSVAKT: uten others-vakten blir (1−1)/0 = NaN, som ikke er null.
  assert.notEqual(beatenPercent(1, 1), 0)
  assert.notEqual(beatenPercent(1, 1), 100)
})

// ── Avrunding skal aldri påstå noe usant ────────────────────────────────────

test('stort felt: andreplass blir aldri «bedre enn 100 %»', () => {
  // (201−2)/200 = 99,5 % → Math.round gir 100 uten taket. Men noen slo deg.
  assert.equal(beatenPercent(2, 201), 99)
  assert.notEqual(beatenPercent(2, 201), 100)
})

test('stort felt: nest sist blir aldri «bedre enn 0 %»', () => {
  // (201−200)/200 = 0,5 % → Math.round gir 0 uten gulvet. Men du slo én.
  assert.equal(beatenPercent(200, 201), 1)
  assert.notEqual(beatenPercent(200, 201), 0)
})

test('100 % og 0 % er forbeholdt faktisk første- og sisteplass', () => {
  for (const total of [2, 3, 10, 55, 201]) {
    for (let rank = 1; rank <= total; rank++) {
      const b = beatenPercent(rank, total)
      if (b === 100) assert.equal(rank, 1, `bedre enn 100 % kun for rang 1 (n=${total})`)
      if (b === 0) assert.equal(rank, total, `bedre enn 0 % kun for sisteplass (n=${total})`)
    }
  }
})

// ── Ugyldige inn-verdier ────────────────────────────────────────────────────

test('ugyldige verdier gir null, ikke et tall som ser ekte ut', () => {
  assert.equal(beatenPercent(0, 10), null)   // rang under 1
  assert.equal(beatenPercent(11, 10), null)  // rang utenfor feltet
  assert.equal(beatenPercent(1, 0), null)    // tomt felt
  assert.equal(beatenPercent(NaN, 10), null)
  assert.equal(beatenPercent(1, NaN), null)
})

test('monotoni: bedre plassering gir aldri lavere «bedre enn»-tall', () => {
  const total = 55
  let forrige = -1
  for (let rank = total; rank >= 1; rank--) {
    const b = beatenPercent(rank, total)
    assert.ok(b !== null)
    assert.ok(b >= forrige, `rang ${rank} ga ${b}, lavere enn rang ${rank + 1}`)
    forrige = b
  }
})

// ── Linja som helhet: skjules ved sisteplass ────────────────────────────────
// «Bedre enn 0 % av deltakerne» er sant etter nevner-fiksen, men ikke hyggelig
// lesning. Vakten ligger i placementPercentLine, ikke hos kalleren.

test('sisteplass: linja skjules helt', () => {
  assert.equal(placementPercentLine(2, 2), null)
  assert.equal(placementPercentLine(10, 10), null)
  assert.equal(placementPercentLine(55, 55), null)
  assert.equal(placementPercentLine(201, 201), null)
})

test('sisteplass: beatenPercent svarer fortsatt ærlig — det er LINJA som skjules', () => {
  assert.equal(beatenPercent(55, 55), 0)
  assert.equal(placementPercentLine(55, 55), null)
})

test('nest sist: linja vises fortsatt', () => {
  assert.equal(placementPercentLine(54, 55), 2)
  // MUTASJONSVAKT: en vakt som feilaktig traff «nesten sist» ville gitt null.
  assert.notEqual(placementPercentLine(54, 55), null)
})

test('to spillere: vinneren får linje, taperen ikke', () => {
  assert.equal(placementPercentLine(1, 2), 100)
  assert.equal(placementPercentLine(2, 2), null)
})

test('førsteplass og midtfelt gir linje', () => {
  assert.equal(placementPercentLine(1, 55), 100)
  assert.equal(placementPercentLine(10, 55), 83)
  assert.equal(placementPercentLine(28, 55), 50)
})

test('alene i quizen: ingen linje (arver others-vakten)', () => {
  assert.equal(placementPercentLine(1, 1), null)
})

test('ugyldige verdier gir ingen linje', () => {
  assert.equal(placementPercentLine(0, 10), null)
  assert.equal(placementPercentLine(11, 10), null)
  assert.equal(placementPercentLine(NaN, 10), null)
})

test('linja viser ALDRI «bedre enn 0 %»', () => {
  for (const total of [2, 3, 10, 55, 201]) {
    for (let rank = 1; rank <= total; rank++) {
      const linje = placementPercentLine(rank, total)
      if (linje === null) continue
      assert.notEqual(linje, 0, `bedre enn 0 % sluppet gjennom (r=${rank}, n=${total})`)
    }
  }
})
