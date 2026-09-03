// Kjøres med:  npm test
//
// lib/billing-interval.ts — hvor webhooken leser måned/år fra, per hendelse.
// Regelen som voktes: UKJENT er null, aldri 'month'. Se fila for hvorfor.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  intervalForPriceSymbol,
  intervalFromCheckoutMetadata,
  intervalFromInvoiceLine,
  invoiceLineFacts,
} from './billing-interval'

const ENV = { STRIPE_PRICE_PREMIUM_MONTHLY: 'price_m', STRIPE_PRICE_PREMIUM_YEARLY: 'price_y' }
const DAY = 24 * 60 * 60

test('pris-symbol → intervall, alt annet → null', () => {
  assert.equal(intervalForPriceSymbol('STRIPE_PRICE_PREMIUM_MONTHLY'), 'month')
  assert.equal(intervalForPriceSymbol('STRIPE_PRICE_PREMIUM_YEARLY'), 'year')
  assert.equal(intervalForPriceSymbol('STRIPE_PRICE_FOUNDERS'), null)
  assert.equal(intervalForPriceSymbol(''), null)
})

test('checkout-metadata: kun de to verdiene slipper gjennom', () => {
  assert.equal(intervalFromCheckoutMetadata({ userId: 'u', interval: 'year' }), 'year')
  assert.equal(intervalFromCheckoutMetadata({ userId: 'u', interval: 'month' }), 'month')
  // Sesjon fra før utrullingen: feltet finnes ikke → ukjent, ikke måned.
  assert.equal(intervalFromCheckoutMetadata({ userId: 'u' }), null)
  assert.equal(intervalFromCheckoutMetadata(null), null)
  assert.equal(intervalFromCheckoutMetadata(undefined), null)
  assert.equal(intervalFromCheckoutMetadata({ interval: 'weekly' }), null)
})

test('fakturalinje: pris-id-en avgjør først', () => {
  assert.equal(intervalFromInvoiceLine({ priceId: 'price_y', periodStart: null, periodEnd: null }, ENV), 'year')
  assert.equal(intervalFromInvoiceLine({ priceId: 'price_m', periodStart: null, periodEnd: null }, ENV), 'month')
})

test('fakturalinje: pris-id vinner over en periode som sier noe annet', () => {
  // Skulle ikke skje, men rekkefølgen er en del av kontrakten: id-en er eksakt.
  const line = { priceId: 'price_y', periodStart: 0, periodEnd: 30 * DAY }
  assert.equal(intervalFromInvoiceLine(line, ENV), 'year')
})

test('fakturalinje: ukjent pris-id faller til periodelengden', () => {
  assert.equal(intervalFromInvoiceLine({ priceId: 'price_gammel', periodStart: 0, periodEnd: 365 * DAY }, ENV), 'year')
  assert.equal(intervalFromInvoiceLine({ priceId: 'price_gammel', periodStart: 0, periodEnd: 31 * DAY }, ENV), 'month')
  // Skuddår og februar ligger innenfor båndene.
  assert.equal(intervalFromInvoiceLine({ priceId: null, periodStart: 0, periodEnd: 366 * DAY }, ENV), 'year')
  assert.equal(intervalFromInvoiceLine({ priceId: null, periodStart: 0, periodEnd: 28 * DAY }, ENV), 'month')
})

test('fakturalinje: uten env-variabler er det bare perioden som kan svare', () => {
  assert.equal(intervalFromInvoiceLine({ priceId: 'price_y', periodStart: null, periodEnd: null }, {}), null)
  assert.equal(intervalFromInvoiceLine({ priceId: 'price_y', periodStart: 0, periodEnd: 365 * DAY }, {}), 'year')
})

test('fakturalinje: alt utenfor de to båndene er UKJENT — aldri måned', () => {
  assert.equal(intervalFromInvoiceLine(null, ENV), null)
  assert.equal(intervalFromInvoiceLine({ priceId: null, periodStart: null, periodEnd: null }, ENV), null)
  // Én dag (forholdsmessig linje ved planbytte) og 90 dager (et kvartal
  // finnes ikke som pris) skal ikke gjettes til noe.
  assert.equal(intervalFromInvoiceLine({ priceId: null, periodStart: 0, periodEnd: 1 * DAY }, ENV), null)
  assert.equal(intervalFromInvoiceLine({ priceId: null, periodStart: 0, periodEnd: 90 * DAY }, ENV), null)
})

test('invoiceLineFacts leser Stripes payload-form (Basil: pricing.price_details)', () => {
  const facts = invoiceLineFacts({
    pricing: { type: 'price_details', price_details: { price: 'price_y', product: 'prod_1' } },
    period: { start: 100, end: 100 + 365 * DAY },
  })
  assert.deepEqual(facts, { priceId: 'price_y', periodStart: 100, periodEnd: 100 + 365 * DAY })
})

test('invoiceLineFacts tåler ekspandert pris-objekt og manglende felt', () => {
  assert.deepEqual(
    invoiceLineFacts({ pricing: { price_details: { price: { id: 'price_m' } } } }),
    { priceId: 'price_m', periodStart: null, periodEnd: null },
  )
  assert.equal(invoiceLineFacts(undefined), null)
  assert.equal(invoiceLineFacts(null), null)
  assert.deepEqual(invoiceLineFacts({}), { priceId: null, periodStart: null, periodEnd: null })
})
