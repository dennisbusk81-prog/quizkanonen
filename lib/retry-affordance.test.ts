import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeRetry } from './retry-affordance'

// ── MUTASJONER SOM SKAL GI RØDT ─────────────────────────────────────────────
//   1. "if (input.refreshing) return 'pending'" → ""
//      (altså: tilbake til å bare kjenne failed/hidden)
//   2. Bytt om prioriteringen slik at failed sjekkes først.
//   3. "return input.failed ? 'idle' : 'hidden'" → "return 'hidden'"

test('ingen feil, ingenting på gang: ingen knapp', () => {
  assert.equal(describeRetry({ failed: false, refreshing: false }), 'hidden')
})

test('feilet og står stille: knappen tilbys', () => {
  assert.equal(describeRetry({ failed: true, refreshing: false }), 'idle')
})

test('INVARIANTEN: et forsøk underveis er aldri «hidden»', () => {
  // Dette er hele feilen som ble rettet. Klikk-øyeblikket er nettopp der
  // failed fortsatt er true OG refreshing er true — og der forsvant knappen.
  assert.equal(describeRetry({ failed: true, refreshing: true }), 'pending')
  // Og selv om feiltilstanden skulle rekke å nullstilles først (den gamle
  // rekkefølgen i refreshMyOrgs), skal vinduet fortsatt ha et navn.
  assert.equal(describeRetry({ failed: false, refreshing: true }), 'pending')
})

test('refreshing vinner over failed — ikke omvendt', () => {
  // Sjekkes `failed` først, blir svaret 'idle' her, og knappen ser ut som om
  // den venter på et trykk den allerede har fått. Brukeren trykker igjen.
  assert.notEqual(describeRetry({ failed: true, refreshing: true }), 'idle')
})

test('en knapp som prøver kan ikke også være skjult — alle fire kombinasjoner', () => {
  const seen = new Set<string>()
  for (const failed of [false, true]) {
    for (const refreshing of [false, true]) {
      const state = describeRetry({ failed, refreshing })
      seen.add(state)
      if (refreshing) {
        assert.equal(state, 'pending', `failed=${failed} refreshing=${refreshing}`)
      } else {
        assert.notEqual(state, 'pending', `failed=${failed} refreshing=${refreshing}`)
      }
    }
  }
  // Alle tre tilstandene må være nåbare — ellers er en av dem død kode.
  assert.deepEqual([...seen].sort(), ['hidden', 'idle', 'pending'])
})
