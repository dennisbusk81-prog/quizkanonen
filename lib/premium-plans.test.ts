// Kjøres med:  npm test
//
// BINDING mellom /premium sine planer og checkout-rutas hviteliste.
//
// Siden sender kun SYMBOLSKE navn; ruta oversetter via PRICE_ENV_BY_SYMBOL.
// De to filene deler ingen konstant, så en drift mellom dem er stille: et
// symbol på siden som ikke står i rutas mapping gir 400 «Ugyldig priceId» på
// et ekte kjøpsforsøk — ingen byggefeil, ingen typefeil.
//
// MUTASJONSBEVIS:
//   • Fjern STRIPE_PRICE_PREMIUM_YEARLY fra rutas mapping → «hvert symbol på
//     siden står i rutas hviteliste» ryker.
//   • Lim en ekte price-ID (price_1...) inn i PLANS → «ingen ekte price-ID»
//     ryker.
//   • Bytt checkout-kallet til noe annet enn plan.priceId → ankertesten ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SIDE = readFileSync('app/premium/page.tsx', 'utf8')
const RUTE = readFileSync('app/api/stripe/checkout/route.ts', 'utf8')

// Symbolene siden tilbyr: alle 'STRIPE_PRICE_*'-literaler i PLANS-blokka.
const sideSymboler = [...SIDE.matchAll(/priceId: '(STRIPE_PRICE_[A-Z_]+)'/g)].map(m => m[1])

// Nøklene i rutas mapping: `  NAVN: 'NAVN',` inne i PRICE_ENV_BY_SYMBOL.
const mappingBlokk = RUTE.match(/PRICE_ENV_BY_SYMBOL[^{]*\{([\s\S]*?)\}/)?.[1] ?? ''
const ruteNokler = [...mappingBlokk.matchAll(/(STRIPE_PRICE_[A-Z_]+):/g)].map(m => m[1])

test('siden tilbyr begge planene', () => {
  assert.deepEqual(
    [...sideSymboler].sort(),
    ['STRIPE_PRICE_PREMIUM_MONTHLY', 'STRIPE_PRICE_PREMIUM_YEARLY'],
    'PLANS skal bære nøyaktig måneds- og årsprisen',
  )
})

test('hvert symbol på siden står i rutas hviteliste', () => {
  assert.ok(ruteNokler.length >= 2, 'fant ikke PRICE_ENV_BY_SYMBOL-nøklene i ruta — er formen endret?')
  for (const symbol of sideSymboler) {
    assert.ok(
      ruteNokler.includes(symbol),
      `siden sender «${symbol}», men ruta ville svart 400 — symbolet mangler i PRICE_ENV_BY_SYMBOL`,
    )
  }
})

test('ingen ekte price-ID i klientkoden for /premium', () => {
  // Vakten hvitelisten hviler på: klienten kjenner aldri en ekte price-ID.
  assert.ok(!/price_1[A-Za-z0-9]+/.test(SIDE), 'en ekte Stripe price-ID ligger i page.tsx')
})

test('checkout-kallet sender planens eget symbol', () => {
  // Ankeret som binder valget til kallet: body-feltet leser plan.priceId,
  // ikke en hardkodet konstant som ville gjort planvalget kosmetisk.
  assert.ok(
    /priceId: plan\.priceId/.test(SIDE),
    'checkout-body leser ikke plan.priceId — sender valget faktisk noe?',
  )
})
