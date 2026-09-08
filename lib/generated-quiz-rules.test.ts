// Kjøres med:  npm test
//
// De RENE reglene for generering («kanonkuler»). Kvoten er pengelogikk, så
// hver gren i decideGeneration har en test som blir rød hvis grenen fjernes.
//
// MUTASJONSBEVIS (kjørt 8. september 2026 og revertert, stagede filer,
// verifisert med git diff FØR hvert testresultat ble tolket):
//   • fjern `if (used >= quota)`-grenen         → «kvote brukt»-testene røde
//   • `>=` → `>`                                → «nøyaktig taket»-testen rød
//   • fjern `plan === 'free'` i kategorisperren → «premium med kategori»-testen rød
//   • fjern hele kategorisperren                → «gratis med kategori»-testen rød
//   • `!input.premium.ok` → alltid false        → «plan ukjent»-testen rød
//   • bytt rekkefølge kvote/kategori            → «tom for kuler før kategori»-testen rød
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GENERATION_QUOTA,
  GENERATION_CATEGORY_PREMIUM_ERROR,
  GENERATION_QUOTA_ERROR,
  GENERATION_UNKNOWN_ERROR,
  decideGeneration,
  planFromPremium,
} from '@/lib/generated-quiz-rules'

const PREMIUM = { ok: true as const, value: true }
const GRATIS = { ok: true as const, value: false }
const UKJENT = { ok: false as const }
const brukt = (n: number) => ({ ok: true as const, value: n })

// ── Konstantene er beslutningen, ikke en tilfeldighet ───────────────────────

test('kvoten er 2 for gratis og 30 for premium (Dennis-beslutning)', () => {
  assert.equal(GENERATION_QUOTA.free, 2)
  assert.equal(GENERATION_QUOTA.premium, 30)
})

test('planFromPremium: true → premium, false → free', () => {
  assert.equal(planFromPremium(true), 'premium')
  assert.equal(planFromPremium(false), 'free')
})

// ── 1. Planen: «vet ikke» er 503, aldri en dom ──────────────────────────────

test('plan ukjent → 503, ikke gratis og ikke premium', () => {
  const d = decideGeneration({ premium: UKJENT, generatedThisMonth: brukt(0), category: null })
  assert.deepEqual(d, {
    allowed: false, status: 503, reason: 'plan-ukjent', error: GENERATION_UNKNOWN_ERROR,
  })
})

test('plan ukjent slår gjennom SELV OM tellingen sier 0 og ingen kategori er valgt', () => {
  // Den mest gunstige inngangen ellers — skal likevel ikke slippe gjennom.
  const d = decideGeneration({ premium: UKJENT, generatedThisMonth: brukt(0), category: null })
  assert.equal(d.allowed, false)
})

// ── 2. Tellingen: samme retning ─────────────────────────────────────────────

test('telling ukjent → 503, også for premium', () => {
  const d = decideGeneration({ premium: PREMIUM, generatedThisMonth: UKJENT, category: null })
  assert.deepEqual(d, {
    allowed: false, status: 503, reason: 'telling-ukjent', error: GENERATION_UNKNOWN_ERROR,
  })
})

// ── 3. Kvoten ───────────────────────────────────────────────────────────────

test('gratis: 0 brukt → tillatt, 1 igjen etter denne', () => {
  const d = decideGeneration({ premium: GRATIS, generatedThisMonth: brukt(0), category: null })
  assert.deepEqual(d, { allowed: true, plan: 'free', remainingAfter: 1 })
})

test('gratis: 1 brukt → tillatt, 0 igjen etter denne (siste kule)', () => {
  const d = decideGeneration({ premium: GRATIS, generatedThisMonth: brukt(1), category: null })
  assert.deepEqual(d, { allowed: true, plan: 'free', remainingAfter: 0 })
})

test('gratis: nøyaktig taket (2 brukt) → 429 (grensen er >=, ikke >)', () => {
  const d = decideGeneration({ premium: GRATIS, generatedThisMonth: brukt(2), category: null })
  assert.deepEqual(d, {
    allowed: false, status: 429, reason: 'kvote-brukt', error: GENERATION_QUOTA_ERROR,
  })
})

test('gratis: over taket → 429', () => {
  const d = decideGeneration({ premium: GRATIS, generatedThisMonth: brukt(7), category: null })
  assert.equal(d.allowed, false)
  assert.equal(!d.allowed && d.status, 429)
})

test('premium: 29 brukt → tillatt (siste), 30 brukt → 429', () => {
  const ok = decideGeneration({ premium: PREMIUM, generatedThisMonth: brukt(29), category: null })
  assert.deepEqual(ok, { allowed: true, plan: 'premium', remainingAfter: 0 })
  const nei = decideGeneration({ premium: PREMIUM, generatedThisMonth: brukt(30), category: null })
  assert.equal(nei.allowed, false)
  assert.equal(!nei.allowed && nei.reason, 'kvote-brukt')
})

test('premium får IKKE gratis-kvoten og gratis får IKKE premium-kvoten', () => {
  // 5 brukt: over gratis (2), under premium (30). Planen må avgjøre.
  const p = decideGeneration({ premium: PREMIUM, generatedThisMonth: brukt(5), category: null })
  const g = decideGeneration({ premium: GRATIS, generatedThisMonth: brukt(5), category: null })
  assert.equal(p.allowed, true)
  assert.equal(g.allowed, false)
})

// ── 4. Kategorisperren for gratis ───────────────────────────────────────────

test('gratis med kategori → 403, selv med kuler igjen', () => {
  const d = decideGeneration({ premium: GRATIS, generatedThisMonth: brukt(0), category: 'Sport' })
  assert.deepEqual(d, {
    allowed: false,
    status: 403,
    reason: 'kategori-krever-premium',
    error: GENERATION_CATEGORY_PREMIUM_ERROR,
  })
})

test('premium med kategori → tillatt', () => {
  const d = decideGeneration({ premium: PREMIUM, generatedThisMonth: brukt(3), category: 'Sport' })
  assert.deepEqual(d, { allowed: true, plan: 'premium', remainingAfter: 26 })
})

test('gratis uten kategori (blandet) → tillatt', () => {
  const d = decideGeneration({ premium: GRATIS, generatedThisMonth: brukt(0), category: null })
  assert.equal(d.allowed, true)
})

test('rekkefølge: gratis som er TOM for kuler og velger kategori får «tom for kuler», ikke «krever Premium»', () => {
  // Det første er sant uansett hva hun velger; det andre ville sendt henne
  // til betaling for noe hun uansett ikke kunne gjort denne måneden.
  const d = decideGeneration({ premium: GRATIS, generatedThisMonth: brukt(2), category: 'Sport' })
  assert.equal(!d.allowed && d.reason, 'kvote-brukt')
})
