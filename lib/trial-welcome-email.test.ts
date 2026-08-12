// Kjøres med:  npm test
//
// trialWelcomeEmail — bekreftelsen som går ut ved vellykket aktivering av den
// gratis prøveperioden (app/api/stripe/founders-activate).
//
// BAKGRUNN
// Fram til 12. august 2026 sendte ruten foundersWelcomeEmail: emne «Founders
// Access aktivert», åpning «Du er blant de første. Det betyr noe.» Founders
// ble avviklet som brukersynlig inngang i 526b9dc, så hver nye bruker fikk en
// bekreftelse som viste til et program de aldri hadde vært del av.
//
// HVA TESTENE VOKTER
//  1. At lengden ALDRI hardkodes. Malen har to kilder — Stripes faktiske
//     `trial_end` og site_settings-tallet ruten opprettet abonnementet med —
//     og fire utfall etter hva som er kjent. Et innebygd «14» ville blitt
//     usant i samme øyeblikk Dennis endrer nøkkelen, på flaten som bekrefter
//     hva brukeren nettopp fikk.
//  2. At Founders-språket ikke kommer tilbake, og at malen ikke lenker til
//     /founders (som nå bare er en redirect).
//  3. At ruten faktisk kaller den nye malen — en mal ingen sender er ikke en
//     rettet e-post.
//
// MUTASJONSBEVIS (alle kjørt 12. august 2026 — se rapporten):
//   • `dager` hardkodet til 14 → «tallet kommer fra parameteren» ryker
//   • sluttdato-grenen fjernet → «dato når trial_end er kjent» ryker
//   • fallback-teksten byttet til «i 14 dager» → «uten kjent lengde» ryker
//   • overskriften satt tilbake til «Founders Access aktivert» → «ingen
//     Founders-språk» ryker
//   • kallstedet rullet tilbake til foundersWelcomeEmail → «ruten sender den
//     nye malen» ryker

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { trialWelcomeEmail } from './email-templates'

// 26. august 2026 kl. 12:00 UTC = 14:00 i Oslo (CEST, UTC+2).
const TRIAL_END = Math.floor(Date.UTC(2026, 7, 26, 12, 0, 0) / 1000)

test('begge kilder kjent: dagtall, sluttdato OG klokkeslett', () => {
  const html = trialWelcomeEmail(TRIAL_END, 14)
  assert.match(html, /i 14 dager — fram til 26\. august 2026 kl\. 14:00/)
})

test('«fram til», ikke «til og med» — sluttpunktet er midt i døgnet', () => {
  // Målt mot live-Stripe 12. august 2026: trial_period_days gir
  // trial_end = trial_start + N×24t på sekundet, ingen avrunding til
  // døgnslutt. «Til og med 26. august» ville lovet et døgn brukeren ikke har
  // — og aktiverer man kl. 09:00, er Premium borte før fredagsquizen åpner
  // kl. 12:00 på dag 14.
  const html = trialWelcomeEmail(TRIAL_END, 14)
  assert.ok(!/til og med/.test(html), 'malen lover hele sluttdøgnet igjen')
  assert.match(html, /kl\. \d{2}:\d{2}/, 'sluttpunktet mangler klokkeslett')
})

test('KLOKKESLETTET ER OSLO-TID, ikke UTC', () => {
  // Denne feilen er usynlig store deler av døgnet og treffer bare kvelden:
  // 26. august 22:30 UTC er 27. august kl. 00:30 i Norge. Uten
  // timeZone: 'Europe/Oslo' ville malen skrevet «26. august» på Vercel,
  // som kjører i UTC.
  const sentPåKvelden = Math.floor(Date.UTC(2026, 7, 26, 22, 30, 0) / 1000)
  const html = trialWelcomeEmail(sentPåKvelden, 14)
  assert.match(html, /27\. august 2026 kl\. 00:30/,
    'sluttidspunktet rendres i UTC — en kveldsaktivering får feil dato')
  assert.ok(!/26\. august/.test(html), 'UTC-datoen lekker inn i teksten')
})

test('vintertid: CET er UTC+1, ikke +2', () => {
  // Samme kode må treffe på begge sider av sommertidsovergangen.
  const desember = Math.floor(Date.UTC(2026, 11, 4, 23, 30, 0) / 1000)
  const html = trialWelcomeEmail(desember, 14)
  assert.match(html, /5\. desember 2026 kl\. 00:30/)
})

test('tallet kommer fra parameteren, ikke fra malen', () => {
  // Settes founders_new_trial_days til 7, skal e-posten si 7.
  const html = trialWelcomeEmail(TRIAL_END, 7)
  assert.match(html, /i 7 dager/)
  assert.ok(!/i 14 dager/.test(html), 'malen skriver 14 uansett hva den får inn')
})

test('kun trial_end kjent: tidspunkt, ingen påstand om antall dager', () => {
  const html = trialWelcomeEmail(TRIAL_END, null)
  assert.match(html, /full tilgang til Premium fram til 26\. august 2026 kl\. 14:00/)
  assert.ok(!/\d+ dager/.test(html), 'fant et dagtall vi ikke har dekning for')
})

test('kun dagtall kjent: dager, ingen påstand om dato', () => {
  const html = trialWelcomeEmail(null, 14)
  assert.match(html, /full tilgang til Premium i 14 dager\./)
  assert.ok(!/fram til/.test(html), 'fant et sluttidspunkt vi ikke har dekning for')
  assert.ok(!/kl\. /.test(html), 'fant et klokkeslett vi ikke har dekning for')
})

test('uten kjent lengde: «i prøveperioden», aldri et gjettet tall', () => {
  const html = trialWelcomeEmail(null, null)
  assert.match(html, /full tilgang til Premium i prøveperioden/)
  assert.ok(!/\d+ dager/.test(html), 'malen gjetter et dagtall når den ikke vet noe')
})

test('ugyldige dagtall behandles som ukjent, ikke som tekst', () => {
  for (const ugyldig of [0, -3, 1.5, NaN]) {
    const html = trialWelcomeEmail(null, ugyldig)
    assert.match(html, /i prøveperioden/, `${ugyldig} slapp gjennom som lengde`)
  }
})

test('ingen Founders-språk og ingen lenke til /founders', () => {
  const html = trialWelcomeEmail(TRIAL_END, 14)
  assert.ok(!/Founders/i.test(html), 'Founders-språket er tilbake i aktiveringsmalen')
  assert.ok(!/blant de første/i.test(html), 'den gamle åpningslinjen er tilbake')
  assert.ok(!/\/founders/.test(html), 'malen lenker til /founders, som nå kun er en redirect')
  assert.match(html, /Prøveperioden din er i gang/)
})

test('designsystemet: kort, gull-primær og lovlig hint-farge', () => {
  const html = trialWelcomeEmail(TRIAL_END, 14)
  assert.match(html, /background:#21242e/, 'kort-bakgrunnen mangler')
  assert.match(html, /border-radius:20px/, 'kort-radius mangler')
  assert.match(html, /background:#c9a84c;border-radius:10px/, 'gull primærknapp mangler')
  for (const forbudt of ['#7a7873', '#9a9590', '#6a6860', '#8a8fa8']) {
    assert.ok(!html.includes(forbudt), `forbudt farge ${forbudt} i malen`)
  }
  assert.match(html, /color:#918f8a/, 'footeren bruker ikke systemets hint-farge')
})

test('ruten sender den nye malen, med begge kildene', () => {
  // Kommentarer strippes først. Ruten SKAL kunne forklare i prosa hva den
  // sendte før — påstanden gjelder aktiv kode, ikke omtale. Uten strippen
  // ville testen forbudt å dokumentere endringen på stedet der den skjedde.
  const rute = readFileSync('app/api/stripe/founders-activate/route.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  assert.match(rute, /trialWelcomeEmail\(subscription\.trial_end, trialPeriodDays\)/,
    'aktiveringsruten kaller ikke trialWelcomeEmail med både trial_end og dagtallet')
  assert.ok(!/foundersWelcomeEmail/.test(rute),
    'ruten sender fortsatt den gamle Founders-malen')
  assert.match(rute, /subject: 'Prøveperioden din er i gang — Quizkanonen'/,
    'emnefeltet er ikke oppdatert — det er det mottakeren ser først')
})
