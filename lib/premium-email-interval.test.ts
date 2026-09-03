// Kjøres med:  npm test
//
// Kjøps- og fornyelsesbekreftelsen for personlig Premium skal si det
// intervallet kunden faktisk har — og INGENTING om intervall når det er ukjent.
//
// BAKGRUNN (3. september 2026)
// Begge malene sa «hver måned» / «for en ny måned» til alle. Årsprisen har
// vært live siden 30. august; b1130d4 rettet prisene i malene, ikke
// intervallsetningene. En årsabonnent fikk skriftlig at hun har et
// månedsabonnement.
//
// HVA TESTENE VOKTER
//  1. Månedsvarianten sier måned, årsvarianten sier år — og ingen av dem
//     lekker det andre ordet.
//  2. Ukjent intervall gir en setning som er sann for begge: automatisk
//     fornyelse nevnes fortsatt (det er den viktige opplysningen), men uten
//     periode-ord. Å defaulte til «hver måned» gjenskaper feilen.
//  3. orgRemovedEmail sitt oppsalg (ingen kjøp ennå) lover ikke lenger et
//     bestemt intervall.
//
// MUTASJONSBEVIS (kjørt 3. september 2026 — se rapporten):
//   • år-grenen i premiumWelcomeEmail byttet til «hver måned» →
//     «kjøpsbekreftelse: år» ryker
//   • år-grenen i premiumRenewalEmail byttet til «for en ny måned» →
//     «fornyelse: år» ryker
//   • ukjent-grenen i premiumWelcomeEmail byttet til «hver måned» →
//     «kjøpsbekreftelse: ukjent» ryker
//   • ukjent-grenen (uten dato) i premiumRenewalEmail byttet til «neste måned»
//     → «fornyelse: ukjent» ryker
//   Webhook-koblingen (at ruten faktisk sender intervallet inn) felles av
//   lib/stripe-webhook-route.test.ts; metadata-skrivingen i checkout-ruta av
//   lib/checkout-route.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { premiumWelcomeEmail, premiumRenewalEmail, orgRemovedEmail } from './email-templates'

const MÅNED = /hver måned|ny måned|neste måned/
const ÅR = /hvert år|nytt år|neste år/

test('kjøpsbekreftelse: måned', () => {
  const html = premiumWelcomeEmail('month')
  assert.match(html, /Abonnementet fornyes automatisk hver måned til du selv avslutter\./)
  assert.ok(!ÅR.test(html), 'månedskunden får års-ord')
})

test('kjøpsbekreftelse: år', () => {
  const html = premiumWelcomeEmail('year')
  assert.match(html, /Abonnementet fornyes automatisk hvert år til du selv avslutter\./)
  assert.ok(!MÅNED.test(html), 'årskunden får måneds-ord — det var feilen')
})

test('kjøpsbekreftelse: ukjent → nøytral setning, fornyelsen nevnes fortsatt', () => {
  for (const html of [premiumWelcomeEmail(), premiumWelcomeEmail(null)]) {
    assert.match(html, /Abonnementet fornyes automatisk til du selv avslutter\./)
    assert.ok(!MÅNED.test(html), 'ukjent ble til «måned»')
    assert.ok(!ÅR.test(html), 'ukjent ble til «år»')
  }
})

test('fornyelse: måned, med og uten neste betalingsdato', () => {
  const medDato = premiumRenewalEmail('3. oktober 2026', 'month')
  assert.match(medDato, /fornyet for en ny måned\./)
  assert.match(medDato, /3\. oktober 2026/)
  assert.ok(!ÅR.test(medDato))

  const utenDato = premiumRenewalEmail(undefined, 'month')
  assert.match(utenDato, /fornyet for en ny måned\./)
  assert.match(utenDato, /Abonnementet fornyes automatisk neste måned\./)
  assert.ok(!ÅR.test(utenDato))
})

test('fornyelse: år, med og uten neste betalingsdato', () => {
  const medDato = premiumRenewalEmail('3. september 2027', 'year')
  assert.match(medDato, /fornyet for et nytt år\./)
  assert.match(medDato, /3\. september 2027/)
  assert.ok(!MÅNED.test(medDato), 'årskunden får måneds-ord — det var feilen')

  const utenDato = premiumRenewalEmail(undefined, 'year')
  assert.match(utenDato, /fornyet for et nytt år\./)
  assert.match(utenDato, /Abonnementet fornyes automatisk neste år\./)
  assert.ok(!MÅNED.test(utenDato))
})

test('fornyelse: ukjent → «fornyet» uten periode-ord', () => {
  for (const html of [premiumRenewalEmail(), premiumRenewalEmail(undefined, null), premiumRenewalEmail('1. januar 2027', null)]) {
    assert.match(html, /Premium-abonnementet ditt er fornyet\. Du har fortsatt tilgang/)
    assert.ok(!MÅNED.test(html), 'ukjent ble til «måned»')
    assert.ok(!ÅR.test(html), 'ukjent ble til «år»')
  }
  // Uten dato OG uten intervall: reservesetningen er den nøytrale.
  assert.match(premiumRenewalEmail(), /Abonnementet fornyes automatisk til du selv avslutter\./)
})

test('orgRemovedEmail: oppsalget lover ikke lenger et bestemt intervall', () => {
  // Mottakeren har ikke kjøpt noe ennå — begge prisene er åpne for henne.
  for (const html of [orgRemovedEmail('Elkjøp Nordic'), orgRemovedEmail('Elkjøp Nordic', '2026-09-10T12:00:00Z')]) {
    assert.ok(!MÅNED.test(html), 'oppsalget lover månedsfornyelse')
    assert.match(html, /fornyes automatisk til du selv avslutter/)
  }
})
