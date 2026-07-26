// Kjøres med:  npm test
//
// Dekker HVER rad i beslutningstabellen Dennis godkjente 26. juli 2026:
//
//   A  ingen dekning + kode        → start nå
//   B  Founders-trial + kode       → stables på trial-slutt, abonnement pauses
//   C  kode aktiv + ny kode        → avvis med dato
//   D  betalt abonnement + kode    → stables på periodeslutt, abonnement pauses
//   F  org-medlemskap + kode       → avvis, koden bevares, org-navn i meldingen
//
// Rad E (kode aktiv → abonnement startes) ligger i checkout-ruten og dekkes av
// lib/premium-checkout-route.test.ts.
//
// MUTASJONSBEVIS er notert per blokk: hva som må endres i lib/premium-state.ts
// for at nettopp den assert-en skal ryke.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidePremiumState,
  decideRedemption,
  type CodeCoverage,
  type OrgCoverage,
  type StripeCoverage,
} from './premium-state'

const NOW = new Date('2026-07-26T12:00:00Z')
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const code = (over: Partial<CodeCoverage> = {}): CodeCoverage =>
  ({ redemptionId: 'r1', codeId: 'c1', expiresAt: daysFromNow(30), ...over })

const foundersTrial = (over: Partial<StripeCoverage> = {}): StripeCoverage =>
  ({ subscriptionId: 'sub_founders', status: 'trialing', trialEnd: daysFromNow(20), currentPeriodEnd: null, pauseResumesAt: null, ...over })

const paidSub = (over: Partial<StripeCoverage> = {}): StripeCoverage =>
  ({ subscriptionId: 'sub_paid', status: 'active', trialEnd: null, currentPeriodEnd: daysFromNow(12), pauseResumesAt: null, ...over })

const orgCover = (over: Partial<OrgCoverage> = {}): OrgCoverage =>
  ({ orgIds: ['org-1'], orgNames: ['Elkjøp Nordic'], graceUntil: null, ...over })

const state = (input: { code?: CodeCoverage | null; stripe?: StripeCoverage | null; org?: OrgCoverage | null }) =>
  decidePremiumState({ code: input.code ?? null, stripe: input.stripe ?? null, org: input.org ?? null, now: NOW })

// ── Tilstandsutledning ──────────────────────────────────────────────────────

test('ingen kilder = ikke premium', () => {
  const s = state({})
  assert.equal(s.isPremium, false)
  assert.equal(s.effectiveUntil, null)
  assert.equal(s.whatHappensAtExpiry, 'nothing')
})

test('utløpt kode teller ikke som dekning', () => {
  const s = state({ code: code({ expiresAt: daysFromNow(-1) }) })
  assert.equal(s.isPremium, false)
})

test('kode over et levende abonnement: faller tilbake til abonnementet ved utløp', () => {
  // MUTASJONSBEVIS: fjernes `codeActive` fra survivesViaStripe i
  // decidePremiumState, blir dette 'loses_premium' og assert-en ryker.
  const s = state({ code: code(), stripe: paidSub() })
  assert.equal(s.isPremium, true)
  assert.equal(s.whatHappensAtExpiry, 'falls_back_to_stripe')
})

test('org-dekning vinner som fallback over alt annet', () => {
  const s = state({ code: code(), stripe: paidSub(), org: orgCover() })
  assert.equal(s.whatHappensAtExpiry, 'falls_back_to_org')
})

test('kode alene som utløper = mister premium', () => {
  const s = state({ code: code() })
  assert.equal(s.whatHappensAtExpiry, 'loses_premium')
  assert.equal(s.effectiveUntil, daysFromNow(30))
})

test('permanent kode har ingen utløpsdato', () => {
  const s = state({ code: code({ expiresAt: null }) })
  assert.equal(s.isPremium, true)
  assert.equal(s.effectiveUntil, null)
  assert.equal(s.whatHappensAtExpiry, 'nothing')
})

test('kansellert abonnement gir ingen dekning', () => {
  const s = state({ stripe: paidSub({ status: 'canceled' }) })
  assert.equal(s.isPremium, false)
})

test('effectiveUntil er den lengstvarende kilden', () => {
  // Koden varer til dag 30, abonnementet til dag 12.
  const s = state({ code: code(), stripe: paidSub() })
  assert.equal(s.effectiveUntil, daysFromNow(30))
})

// ── Rad A: ingen dekning + kode ─────────────────────────────────────────────

test('RAD A — kode uten eksisterende dekning starter nå', () => {
  const d = decideRedemption(state({}), 60, NOW)
  assert.equal(d.action, 'grant')
  if (d.action !== 'grant') return
  assert.equal(d.startsAt, NOW.toISOString())
  assert.equal(d.expiresAt, daysFromNow(60))
  assert.equal(d.pause, null, 'ingenting å pause')
})

test('RAD A — permanent kode gir ingen utløpsdato', () => {
  const d = decideRedemption(state({}), null, NOW)
  assert.equal(d.action, 'grant')
  if (d.action !== 'grant') return
  assert.equal(d.expiresAt, null)
})

// ── Rad B: Founders-trial + kode (stabling) ─────────────────────────────────

test('RAD B — kode stables PÅ TOPPEN av Founders-trialen, ikke fra nå', () => {
  // MUTASJONSBEVIS: endres startsAt-utledningen i decideRedemption til alltid
  // `now`, blir expiresAt dag 60 i stedet for dag 80, og begge assert-ene ryker.
  const d = decideRedemption(state({ stripe: foundersTrial() }), 60, NOW)
  assert.equal(d.action, 'grant')
  if (d.action !== 'grant') return
  assert.equal(d.startsAt, daysFromNow(20), 'starter ved trial-slutt')
  assert.equal(d.expiresAt, daysFromNow(80), '20 dager trial + 60 dager kode')
})

test('RAD B — Founders-abonnementet pauses fram til kodens slutt', () => {
  const d = decideRedemption(state({ stripe: foundersTrial() }), 60, NOW)
  if (d.action !== 'grant') throw new Error('forventet grant')
  assert.deepEqual(d.pause, { subscriptionId: 'sub_founders', resumesAt: daysFromNow(80) })
})

// ── Rad C: kode aktiv + ny kode (avvisning) ─────────────────────────────────

test('RAD C — ny kode avvises når en kode allerede er aktiv', () => {
  const d = decideRedemption(state({ code: code() }), 60, NOW)
  assert.equal(d.action, 'reject')
  if (d.action !== 'reject') return
  assert.equal(d.reason, 'code_active')
  assert.match(d.message, /allerede en aktiv kode til/)
  assert.match(d.message, /25\. august 2026/, 'skal oppgi den faktiske sluttdatoen')
})

test('RAD C — permanent aktiv kode avvises også, uten dato', () => {
  const d = decideRedemption(state({ code: code({ expiresAt: null }) }), 60, NOW)
  assert.equal(d.action, 'reject')
  if (d.action !== 'reject') return
  assert.match(d.message, /ubestemt tid/)
})

// ── Rad D: betalt abonnement + kode ─────────────────────────────────────────

test('RAD D — kode stables etter inneværende betalte periode', () => {
  const d = decideRedemption(state({ stripe: paidSub() }), 30, NOW)
  assert.equal(d.action, 'grant')
  if (d.action !== 'grant') return
  assert.equal(d.startsAt, daysFromNow(12), 'ingen betalt tid går tapt')
  assert.equal(d.expiresAt, daysFromNow(42))
})

test('RAD D — abonnementet pauses fram til kodens slutt, ikke kansellert', () => {
  // MUTASJONSBEVIS: settes pause til null i decideRedemption, ryker denne — og
  // det er nøyaktig feilen som ville latt kunden bli trukket i gratis-perioden.
  const d = decideRedemption(state({ stripe: paidSub() }), 30, NOW)
  if (d.action !== 'grant') throw new Error('forventet grant')
  assert.deepEqual(d.pause, { subscriptionId: 'sub_paid', resumesAt: daysFromNow(42) })
})

test('RAD D — permanent kode pauser abonnementet uten gjenopptaksdato', () => {
  const d = decideRedemption(state({ stripe: paidSub() }), null, NOW)
  if (d.action !== 'grant') throw new Error('forventet grant')
  assert.deepEqual(d.pause, { subscriptionId: 'sub_paid', resumesAt: null })
})

test('RAD D — et abonnement som allerede har utløpt periode stabler ikke bakover', () => {
  const d = decideRedemption(state({ stripe: paidSub({ currentPeriodEnd: daysFromNow(-3) }) }), 30, NOW)
  if (d.action !== 'grant') throw new Error('forventet grant')
  assert.equal(d.startsAt, NOW.toISOString(), 'starter nå, ikke i fortiden')
})

// ── Rad F: org-medlemskap + kode ────────────────────────────────────────────

test('RAD F — org-medlem avvises, og koden bevares', () => {
  const d = decideRedemption(state({ org: orgCover() }), 60, NOW)
  assert.equal(d.action, 'reject')
  if (d.action !== 'reject') return
  assert.equal(d.reason, 'org_covered')
  assert.match(d.message, /ikke brukt opp/, 'brukeren skal forstå at koden er i behold')
})

test('RAD F — meldingen viser brukerens EGEN organisasjon, ikke en hardkodet', () => {
  // MUTASJONSBEVIS: hardkodes org-navnet i decideRedemption, ryker denne.
  const d = decideRedemption(state({ org: orgCover({ orgNames: ['Rørlegger Hansen AS'] }) }), 60, NOW)
  if (d.action !== 'reject') throw new Error('forventet reject')
  assert.match(d.message, /Rørlegger Hansen AS/)
  assert.ok(!d.message.includes('Elkjøp'))
})

test('RAD F — flere organisasjoner listes begge', () => {
  const d = decideRedemption(state({ org: orgCover({ orgIds: ['a', 'b'], orgNames: ['Alfa AS', 'Beta AS'] }) }), 60, NOW)
  if (d.action !== 'reject') throw new Error('forventet reject')
  assert.match(d.message, /Alfa AS og Beta AS/)
})

test('RAD F — org uten navn faller tilbake på nøytral formulering', () => {
  const d = decideRedemption(state({ org: orgCover({ orgNames: [] }) }), 60, NOW)
  if (d.action !== 'reject') throw new Error('forventet reject')
  assert.match(d.message, /bedriften din/)
})

test('RAD F går foran RAD C — org sjekkes først', () => {
  const d = decideRedemption(state({ code: code(), org: orgCover() }), 60, NOW)
  if (d.action !== 'reject') throw new Error('forventet reject')
  assert.equal(d.reason, 'org_covered')
})

// ── Grace-periode ───────────────────────────────────────────────────────────

test('org-grace teller som dekning så lenge den varer', () => {
  const s = state({ org: orgCover({ orgIds: [], orgNames: [], graceUntil: daysFromNow(5) }) })
  assert.equal(s.isPremium, true)
  assert.equal(s.effectiveUntil, daysFromNow(5))
})

test('utløpt org-grace uten medlemskap gir ingen dekning', () => {
  const s = state({ org: orgCover({ orgIds: [], orgNames: [], graceUntil: daysFromNow(-1) }) })
  assert.equal(s.isPremium, false)
})
