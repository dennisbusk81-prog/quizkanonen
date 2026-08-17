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

const state = (input: {
  code?: CodeCoverage | null
  stripe?: StripeCoverage | null
  org?: OrgCoverage | null
  personalGrace?: string | null
}) =>
  decidePremiumState({
    code: input.code ?? null,
    stripe: input.stripe ?? null,
    org: input.org ?? null,
    personalGrace: input.personalGrace ?? null,
    now: NOW,
  })

// En kunde midt i dunning: abonnementet lever hos Stripe, men er ikke `active`
// eller `trialing`, så getStripeCoverage finner det ikke. Karensen er da den
// eneste dekningen som står igjen.
const dunningGrace = () => daysFromNow(14)

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

// ── Karensperiode ved ufrivillig betalingsfeil (17. august 2026) ────────────
//
// MUTASJONSBEVIS for hele blokken: fjernes `|| personalGraceActive` fra
// isPremium i decidePremiumState, feiler de tre første testene her. Fjernes
// `personalGraceActive` fra candidates-listen, feiler effectiveUntil-testen.
// Settes `sources.stripe` til abonnementet også under karens, feiler
// «karens gjør IKKE abonnementet levende for kode-stabling».

test('karensperiode alene gir Premium — det er hele poenget', () => {
  const s = state({ personalGrace: dunningGrace() })
  assert.equal(s.isPremium, true)
  assert.equal(s.sources.personalGrace, dunningGrace())
})

test('utløpt karensperiode gir INGEN dekning — tilgangen opphører faktisk', () => {
  // Krav 3: når Stripe gir opp etter 14 dager, skal tilgangen ta slutt.
  const s = state({ personalGrace: daysFromNow(-1) })
  assert.equal(s.isPremium, false)
  assert.equal(s.sources.personalGrace, null)
})

test('ingen karens = uendret oppførsel for alle som ikke er i dunning', () => {
  const s = state({ personalGrace: null })
  assert.equal(s.isPremium, false)
  assert.equal(s.sources.personalGrace, null)
})

test('karensen er effectiveUntil når den er eneste dekning', () => {
  const s = state({ personalGrace: dunningGrace() })
  assert.equal(s.effectiveUntil, daysFromNow(14))
  assert.equal(s.whatHappensAtExpiry, 'loses_premium')
})

test('betaler brukeren underveis, er det abonnementet som gjelder — ikke karensen', () => {
  // Krav 2: tilgangen fortsetter uten avbrudd. Webhooken rydder karensen ved
  // reaktivering, men selv om ryddingen skulle feile, skal ikke en gjenstående
  // karensdato overstyre abonnementets egen periode.
  const s = state({ stripe: paidSub(), personalGrace: dunningGrace() })
  assert.equal(s.isPremium, true)
  assert.equal(s.effectiveUntil, daysFromNow(12), 'abonnementets periode, ikke karensen')
  assert.equal(s.whatHappensAtExpiry, 'nothing')
})

test('karens gjør IKKE abonnementet levende for kode-stabling', () => {
  // Uten dette skillet ville rad D slått inn under en betalingsfeil: koden
  // hadde stablet seg etter en periode som ikke blir betalt, og vi ville
  // pauset innkrevingen på et abonnement Stripe akkurat prøver å redde.
  const s = state({ personalGrace: dunningGrace() })
  assert.equal(s.sources.stripe, null)

  const d = decideRedemption(s, 60, NOW)
  assert.equal(d.action, 'grant')
  if (d.action !== 'grant') return
  assert.equal(d.startsAt, NOW.toISOString(), 'koden starter nå, ikke etter karensen')
  assert.equal(d.pause, null, 'ingenting skal pauses')
})

test('kode og org overstyrer fortsatt — karensen endrer ingenting for dem', () => {
  // Krav 4: en bruker med annen dekning er upåvirket av karens-mekanismen.
  const withCode = state({ code: code(), personalGrace: dunningGrace() })
  assert.equal(withCode.effectiveUntil, daysFromNow(30), 'koden varer lengst')

  const withOrg = state({ org: orgCover(), personalGrace: dunningGrace() })
  assert.equal(withOrg.isPremium, true)
  assert.equal(withOrg.effectiveUntil, null, 'org-medlemskap er ubestemt dekning')
  assert.equal(withOrg.whatHappensAtExpiry, 'nothing')

  const orgRejection = decideRedemption(withOrg, 60, NOW)
  assert.equal(orgRejection.action, 'reject', 'rad F er uendret')
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

// ── Rad G: permanent kode + levende abonnement ──────────────────────────────
//
// Denne raden ERSTATTER en tidligere test som het «RAD D — permanent kode pauser
// abonnementet uten gjenopptaksdato» og som slo fast at `pause.resumesAt` skulle
// være null. Den oppførselen var buggen: en pause uten gjenopptaksdato stopper
// innkrevingen for ALLTID. Den gamle testen låste altså feilen på plass.
//
// MUTASJONSBEVIS: fjernes rad G-blokken i decideRedemption, faller kallet
// tilbake til B/D-stablingen og svarer `grant` med `pause.resumesAt: null` —
// da ryker alle testene under.

test('RAD G — permanent kode over et betalende abonnement AVVISES', () => {
  const d = decideRedemption(state({ stripe: paidSub() }), null, NOW)
  assert.equal(d.action, 'reject')
  if (d.action !== 'reject') throw new Error('forventet reject')
  assert.equal(d.reason, 'permanent_code_paid_sub')
})

test('RAD G — abonnementet pauses IKKE, verken med eller uten gjenopptaksdato', () => {
  // Kjernen i saken: en `grant` her ville satt pause_collection uten resumes_at
  // i ruten, og kunden hadde sluttet å betale for godt uten at noen så det.
  const d = decideRedemption(state({ stripe: paidSub() }), null, NOW)
  assert.ok(!('pause' in d), 'en avvisning skal ikke bære med seg et pause-oppdrag')
})

test('RAD G — treffer også duration_days = 0, ikke bare null', () => {
  // 0 regnes som permanent av expiresAt-utregningen. Ble vakten skrevet som
  // `durationDays === null` alene, ville nøyaktig denne verdien sluppet forbi og
  // pauset abonnementet for alltid. isPermanentCode er delt for å hindre det.
  const d = decideRedemption(state({ stripe: paidSub() }), 0, NOW)
  assert.equal(d.action, 'reject')
  if (d.action !== 'reject') throw new Error('forventet reject')
  assert.equal(d.reason, 'permanent_code_paid_sub')
})

test('RAD G — gjelder også en Founders-trial, ikke bare et betalt abonnement', () => {
  // `state.sources.stripe` er satt for både 'active' og 'trialing'. En trial som
  // senere konverterer til betalende ville arvet den evige pausen.
  const d = decideRedemption(state({ stripe: foundersTrial() }), null, NOW)
  assert.equal(d.action, 'reject')
})

test('RAD G — meldingen er rolig og forklarende, uten teknikk', () => {
  const d = decideRedemption(state({ stripe: paidSub() }), null, NOW)
  if (d.action !== 'reject') throw new Error('forventet reject')

  assert.match(d.message, /ubestemt tid/)
  assert.match(d.message, /ikke brukt opp/, 'brukeren må få vite at koden er i behold')
  assert.match(d.message, /ta kontakt/i, 'brukeren må få en vei videre')
  // Ingen lekkasje av interne begreper — samme tone som rad F.
  assert.ok(
    !/pause_collection|Stripe|subscription|duration_days|null/i.test(d.message),
    `teknisk begrep lekket til brukeren: ${d.message}`,
  )
})

test('RAD G — koden er permanent, men brukeren har INGEN dekning: grant som før', () => {
  // Vakten skal treffe kombinasjonen, ikke permanente koder som sådan. Rad A
  // med en permanent kode er den vanlige, legitime bruken.
  const d = decideRedemption(state({}), null, NOW)
  assert.equal(d.action, 'grant')
  if (d.action !== 'grant') throw new Error('forventet grant')
  assert.equal(d.expiresAt, null, 'permanent kode gir fortsatt permanent Premium')
  assert.equal(d.pause, null, 'ingenting å pause')
})

test('RAD G — tidsbegrenset kode over et abonnement er UPÅVIRKET (rad D lever)', () => {
  const d = decideRedemption(state({ stripe: paidSub() }), 30, NOW)
  assert.equal(d.action, 'grant')
  if (d.action !== 'grant') throw new Error('forventet grant')
  assert.deepEqual(d.pause, { subscriptionId: 'sub_paid', resumesAt: daysFromNow(42) })
})

test('RAD G viker for rad F — org-dekning gir den mer presise beskjeden', () => {
  const d = decideRedemption(state({ stripe: paidSub(), org: orgCover() }), null, NOW)
  if (d.action !== 'reject') throw new Error('forventet reject')
  assert.equal(d.reason, 'org_covered', 'rekkefølgen i tabellen er snudd')
})

test('RAD G viker for rad C — aktiv kode gir den mer presise beskjeden', () => {
  const d = decideRedemption(state({ stripe: paidSub(), code: code() }), null, NOW)
  if (d.action !== 'reject') throw new Error('forventet reject')
  assert.equal(d.reason, 'code_active', 'rekkefølgen i tabellen er snudd')
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
