// Kjøres med:  npm test
//
// Prislinja på /profil sitt abonnementskort skal si det abonnementet FAKTISK
// koster, ikke en hardkodet månedspris.
//
// Fram til 30. august 2026 sto «kr 49/mnd · Avslutt når du vil» hardkodet i
// app/profil/page.tsx. Da årsprisen kom (kr 399/år, e18eac6) ble den setningen
// direkte usann for enhver årsabonnent — feil beløp OG feil intervall, på
// kundens egen abonnementsside.
//
// MUTASJONSBEVIS — kjørt, ikke antatt:
//   • Hardkod linja tilbake i app/profil/page.tsx («kr 49/mnd · Avslutt når du
//     vil» i stedet for {planLine}) → «prislinja er avledet, ikke hardkodet»
//     + «siden henter abonnementet» ryker.
//   • La 'year' falle til månedsformen i describePersonalPlan
//     → «årsabonnent får årstekst» ryker.
//   • La ukjent/manglende intervall falle til månedsformen
//     → alle fire null-testene ryker (det er selve «ukjent er ikke månedlig»).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describePersonalPlan, formatKroner } from './personal-plan-label'

// ── Begge veier — kjernen i bestillingen ───────────────────────────────────

test('månedsabonnent får månedstekst', () => {
  assert.equal(
    describePersonalPlan({ interval: 'month', amountOre: 4900 }),
    'kr 49/mnd · Avslutt når du vil',
  )
})

test('årsabonnent får årstekst — ikke månedsprisen', () => {
  const linje = describePersonalPlan({ interval: 'year', amountOre: 39900 })
  assert.equal(linje, 'kr 399/år · Fornyes automatisk')
  // Den konkrete regresjonen: årsabonnenten skal ALDRI se månedsformen.
  assert.ok(!linje!.includes('/mnd'), 'årsplanen viser månedsintervall')
  assert.ok(!linje!.includes('49'), 'årsplanen viser månedsprisen')
})

test('«Avslutt når du vil» står kun på månedsplanen', () => {
  // På en årsplan er det en halvsannhet: du kan avslutte, men det betalte året
  // kommer ikke tilbake. Samme uavklarte spørsmål som org/join-refusjonen (8b).
  assert.ok(describePersonalPlan({ interval: 'month', amountOre: 4900 })!.includes('Avslutt når du vil'))
  assert.ok(!describePersonalPlan({ interval: 'year', amountOre: 39900 })!.includes('Avslutt når du vil'))
})

// ── UKJENT er ikke «månedlig» ──────────────────────────────────────────────
// Fire veier til «vi vet ikke». Alle skal gi null → ingen prislinje vises,
// framfor en gjetning servert som et faktum.

test('ingen fakta i det hele tatt (ruten feilet) → ingen linje', () => {
  assert.equal(describePersonalPlan(null), null)
})

test('manglende intervall → ingen linje', () => {
  assert.equal(describePersonalPlan({ interval: null, amountOre: 4900 }), null)
})

test('manglende beløp → ingen linje', () => {
  assert.equal(describePersonalPlan({ interval: 'month', amountOre: null }), null)
})

test('ukjent intervall (Stripe har også day/week) presses ikke inn i en form', () => {
  assert.equal(describePersonalPlan({ interval: 'week', amountOre: 2500 }), null)
  assert.equal(describePersonalPlan({ interval: 'day', amountOre: 500 }), null)
})

test('null-beløp og negative verdier gir ingen linje', () => {
  assert.equal(describePersonalPlan({ interval: 'month', amountOre: 0 }), null)
  assert.equal(describePersonalPlan({ interval: 'month', amountOre: -100 }), null)
})

// ── Beløpsformatering ──────────────────────────────────────────────────────

test('øre regnes om til kroner', () => {
  assert.equal(formatKroner(4900), '49')
  assert.equal(formatKroner(39900), '399')
  assert.equal(formatKroner(4950), '49,50')
  assert.equal(formatKroner(39905), '399,05')
})

// ── Binding til den faktiske kildekoden ────────────────────────────────────
// Uten denne delen kunne linja hardkodes tilbake i page.tsx uten at én eneste
// test ble rød — den rene funksjonen ville stått grønn og ubrukt.

const SIDE = readFileSync('app/profil/page.tsx', 'utf8')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const AKTIV = stripComments(SIDE)

test('kommentarstrippen virker (positiv kontroll)', () => {
  // Uten denne kunne en ødelagt strip gjort testene under grønne ved å fjerne
  // hele fila. Ett anker fra prosa som SKAL forsvinne, ett fra kode som SKAL
  // overleve.
  assert.ok(SIDE.includes('en gal pris på kundens egen'), 'ankerkommentaren finnes i fila')
  assert.ok(!AKTIV.includes('en gal pris på kundens egen'), 'kommentar ble strippet')
  assert.ok(AKTIV.includes('describePersonalPlan('), 'kode overlevde strippen')
})

test('prislinja er avledet, ikke hardkodet', () => {
  assert.ok(
    !/kr 49\/mnd/.test(AKTIV),
    'en aktiv «kr 49/mnd» finnes i app/profil/page.tsx — det er den hardkodede påstanden som ble usann av årsprisen',
  )
  assert.ok(
    /\{planLine && <p/.test(AKTIV),
    'prislinja rendres ikke lenger betinget av planLine — en ukjent pris ville da vist noe',
  )
})

test('siden henter abonnementet den utleder linja fra', () => {
  assert.ok(
    /fetch\('\/api\/stripe\/subscription'/.test(AKTIV),
    'app/profil/page.tsx henter ikke /api/stripe/subscription — planLine ville alltid vært null',
  )
  assert.ok(
    /describePersonalPlan\(\{ interval: json\.interval/.test(AKTIV),
    'svaret mates ikke inn i describePersonalPlan',
  )
})

test('ruten leverer feltene siden leser', () => {
  // Den andre halvdelen av koblingen: siden leser json.interval og
  // json.amount_ore, og ruten må faktisk sende dem.
  const RUTE = stripComments(readFileSync('app/api/stripe/subscription/route.ts', 'utf8'))
  assert.ok(/interval: item\?\.price\?\.recurring\?\.interval/.test(RUTE), 'ruten sender ikke interval')
  assert.ok(/amount_ore: item\?\.price\?\.unit_amount/.test(RUTE), 'ruten sender ikke amount_ore')
  // Ingen NYE Stripe-kall: ruten skal fortsatt kun ha de to list()-kallene den
  // alltid har hatt, og lese pris/intervall ut av det samme svaret.
  const listKall = (RUTE.match(/stripe\.subscriptions\.list\(/g) ?? []).length
  assert.equal(listKall, 2, `ruten gjør ${listKall} subscriptions.list-kall — pris/intervall skal komme fra abonnementet som allerede hentes`)
  assert.ok(
    !/stripe\.prices\.retrieve|stripe\.subscriptions\.retrieve/.test(RUTE),
    'et nytt Stripe-oppslag er lagt til — pris og intervall ligger allerede i list()-svaret',
  )
})
