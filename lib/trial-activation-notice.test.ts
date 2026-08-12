// Kjøres med:  npm test
//
// decideActivationNotice — hvilken tekst /premium viser når aktiveringen av
// prøveperioden ikke gikk gjennom.
//
// BAKGRUNN
// Under en lokal klikktest 12. august 2026 svarte founders-activate 500 med
// «Founders price not configured» (STRIPE_PRICE_FOUNDERS manglet i .env.local).
// UI-et sendte den strengen rett ut — teknisk engelsk, plassert nede ved «Gå
// til betaling», uten ramme. Brukeren klikket fire ganger.
//
// HVA TESTENE VOKTER
//  1. At rutens EGEN tekst fortsatt vises der den er skrevet for mennesker.
//     409-teksten er den viktigste: den er hele den rolige forklaringen på at
//     prøveperioden er brukt opp, og den er live-beviset på sperren.
//  2. At 500 ALDRI lekker serverteksten ut til brukeren.
//  3. At et manglende, tomt eller ikke-streng `error`-felt gir vår egen tekst
//     — aldri en tom melding, som ville blitt en synlig ramme uten innhold.
//
// MUTASJONSBEVIS (alle kjørt 12. august 2026 — se rapporten):
//   • 500 lagt til i RUTETEKST_STATUSER → «500 lekker ikke serverteksten» ryker
//   • statussjekken fjernet (rutetekst brukt uansett) → samme test ryker
//   • `typeof error !== 'string'`-vakten fjernet → «ukjent form» ryker
//   • tom-streng-vakten fjernet → «tom streng» ryker
//   • rutetekst byttet mot generisk for ALLE statuser → 409/503-testene ryker

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activationLogLevel, decideActivationNotice, GENERISK_AKTIVERINGSFEIL } from './trial-activation-notice'

// Ordrett teksten founders-activate svarer med når has_used_trial er true.
const RUTENS_409 =
  'Du har allerede hatt en gratis prøveperiode på denne kontoen. ' +
  'Prøveperioden kan brukes én gang per konto, men du kan starte et ' +
  'vanlig Premium-abonnement når du vil.'

test('409: rutens egen tekst vises ordrett', () => {
  assert.equal(
    decideActivationNotice({ status: 409, error: RUTENS_409 }),
    RUTENS_409,
  )
})

test('409 fra den ANDRE grenen (aktiv prøveperiode) vises også ordrett', () => {
  const tekst = 'Du har allerede en aktiv Founders-prøveperiode.'
  assert.equal(decideActivationNotice({ status: 409, error: tekst }), tekst)
})

test('503: fail-closed-tekstene er skrevet for brukere og beholdes', () => {
  const tekst = 'Vi får ikke bekreftet kontoen din akkurat nå. Prøv igjen om et par minutter.'
  assert.equal(decideActivationNotice({ status: 503, error: tekst }), tekst)
})

test('400 og 429 beholder også rutens tekst', () => {
  assert.equal(decideActivationNotice({ status: 400, error: 'Du har allerede Premium' }), 'Du har allerede Premium')
  assert.equal(decideActivationNotice({ status: 429, error: 'For mange forespørsler' }), 'For mange forespørsler')
})

test('500 LEKKER IKKE serverteksten — det konkrete tilfellet fra 12. august', () => {
  const notice = decideActivationNotice({ status: 500, error: 'Founders price not configured' })
  assert.equal(notice, GENERISK_AKTIVERINGSFEIL)
  assert.ok(!/Founders price/i.test(notice), 'den tekniske engelske teksten nådde brukeren')
  assert.ok(!/not configured/i.test(notice))
})

test('500 med rutens vage «Noe gikk galt» erstattes også', () => {
  // Norsk, men intetsigende — og den sier ingenting om at kontoen er uberørt.
  assert.equal(decideActivationNotice({ status: 500, error: 'Noe gikk galt' }), GENERISK_AKTIVERINGSFEIL)
})

test('401 får den generiske teksten (bevisst utenfor lista)', () => {
  assert.equal(decideActivationNotice({ status: 401, error: 'Ikke innlogget' }), GENERISK_AKTIVERINGSFEIL)
})

test('ukjent status og nettverksfeil (status 0) gir vår egen tekst', () => {
  assert.equal(decideActivationNotice({ status: 0 }), GENERISK_AKTIVERINGSFEIL)
  assert.equal(decideActivationNotice({ status: 418, error: 'te' }), GENERISK_AKTIVERINGSFEIL)
})

test('manglende error-felt gir vår egen tekst, ikke tom melding', () => {
  const notice = decideActivationNotice({ status: 409 })
  assert.equal(notice, GENERISK_AKTIVERINGSFEIL)
  assert.notEqual(notice.trim(), '')
})

test('error i ukjent form (objekt, tall, null) gir vår egen tekst', () => {
  for (const rar of [{ message: 'x' }, 42, null, undefined, ['a'], true]) {
    const notice = decideActivationNotice({ status: 409, error: rar })
    assert.equal(notice, GENERISK_AKTIVERINGSFEIL, `${JSON.stringify(rar)} slapp gjennom`)
  }
})

test('tom streng og bare mellomrom gir vår egen tekst — aldri en tom ramme', () => {
  assert.equal(decideActivationNotice({ status: 409, error: '' }), GENERISK_AKTIVERINGSFEIL)
  assert.equal(decideActivationNotice({ status: 409, error: '   ' }), GENERISK_AKTIVERINGSFEIL)
  assert.equal(decideActivationNotice({ status: 503, error: '\n\t' }), GENERISK_AKTIVERINGSFEIL)
})

test('resultatet er ALLTID en ikke-tom streng', () => {
  for (const status of [0, 200, 400, 401, 409, 429, 500, 503, 999]) {
    for (const error of [undefined, null, '', '  ', 'tekst', 7, {}]) {
      const notice = decideActivationNotice({ status, error })
      assert.equal(typeof notice, 'string')
      assert.notEqual(notice.trim(), '', `tom melding for status ${status}`)
    }
  }
})

// ── Loggnivå ───────────────────────────────────────────────────────────────

test('409 logges som info — sperren som virker er ikke en feil', () => {
  // Den vellykkede klikktesten 12. august endte med «1 Issue» i Next sitt
  // dev-overlay, utelukkende fordi et FORVENTET 409 ble logget som error.
  assert.equal(activationLogLevel(409), 'info')
})

test('500 og ukjente statuser er fortsatt error', () => {
  for (const status of [500, 0, 418, 502]) {
    assert.equal(activationLogLevel(status), 'error', `status ${status} ble nedgradert`)
  }
})

test('503, 400 og 429 beholder error — de betyr at noe ikke virket', () => {
  // 503 er fail-closed-utgangene (profil uleselig, Stripe nede, manglende
  // trial-lengde). De er transiente, men de er ekte driftsfeil, og de eneste
  // sporene av at noe var galt.
  for (const status of [503, 400, 429]) {
    assert.equal(activationLogLevel(status), 'error', `status ${status} ble nedgradert`)
  }
})

test('nivå og melding er uavhengige: 409 er info OG beholder rutens tekst', () => {
  // De to beslutningene bor i samme fil nettopp for å ikke drifte fra
  // hverandre — men de svarer på ulike spørsmål, og et 409 skal ha begge
  // deler: rolig tekst til brukeren, lavt nivå i konsollen.
  assert.equal(activationLogLevel(409), 'info')
  assert.equal(decideActivationNotice({ status: 409, error: RUTENS_409 }), RUTENS_409)
})

test('den generiske teksten sier at kontoen er uberørt', () => {
  // Ruten er fail-closed: alle utganger før det atomiske claimet lar
  // has_used_trial stå. Det er den ene opplysningen en bruker som nettopp
  // trykket på sin ENE prøveperiode faktisk trenger.
  assert.match(GENERISK_AKTIVERINGSFEIL, /kontoen din er ikke berørt/)
  assert.ok(!/[a-z]+ [a-z]*not [a-z]+/i.test(GENERISK_AKTIVERINGSFEIL), 'teksten ser engelsk ut')
})
