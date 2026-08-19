import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoDismissMs, ADMIN_FEEDBACK_SUCCESS_MS } from './admin-feedback'

// ── MUTASJONER SOM SKAL GI RØDT ─────────────────────────────────────────────
//   1. "type === 'error' ? null : ADMIN_FEEDBACK_SUCCESS_MS"
//      → "ADMIN_FEEDBACK_SUCCESS_MS"      (tilbake til gammel oppførsel)
//   2. samme uttrykk → "null"             (også kvitteringer blir stående)
//   3. "? null :" → "? 30000 :"           (feil «løst» med en lengre timer)

test('en kvittering forsvinner av seg selv — uendret', () => {
  assert.equal(autoDismissMs('success'), ADMIN_FEEDBACK_SUCCESS_MS)
})

test('en FEIL får ingen timer i det hele tatt', () => {
  // Kjernen i fiksen. null, ikke «lenge» — se kommentaren i kilden.
  assert.equal(autoDismissMs('error'), null)
})

test('feil får ALDRI et tall, uansett hvor stort', () => {
  // Denne feller «vi løser det med 30 sekunder i stedet». En feilmelding som
  // rekker å forsvinne er den samme feilen, bare tregere.
  const ms = autoDismissMs('error')
  assert.equal(typeof ms, 'object', `fikk ${ms} — en timer er ikke svaret`)
})

test('de to typene behandles ULIKT — det er hele poenget', () => {
  assert.notEqual(autoDismissMs('error'), autoDismissMs('success'))
})
