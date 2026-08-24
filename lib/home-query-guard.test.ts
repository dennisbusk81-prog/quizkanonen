// Kjøres med:  npm test
//
// Ren logikk-test av lib/home-query-guard. Wiringen (at forsiden faktisk kaller
// dem, og på riktige spørringer) felles av lib/home-error-guards.test.ts; at et
// kast ikke kan caches av lib/home-cache-poisoning.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertHomeQuery, logHomeQuery, HomeDataUnavailableError } from './home-query-guard'

test('assertHomeQuery slipper gjennom når det ikke er feil', () => {
  assert.doesNotThrow(() => assertHomeQuery('aktiv quiz', null))
  assert.doesNotThrow(() => assertHomeQuery('aktiv quiz', undefined))
})

test('assertHomeQuery kaster ved feil, med spørringens navn i beskjeden', () => {
  assert.throws(
    () => assertHomeQuery('aktiv quiz', { message: 'connection timed out' }),
    (err: unknown) => {
      assert.ok(err instanceof HomeDataUnavailableError)
      assert.equal(err.query, 'aktiv quiz')
      // Navnet må stå i teksten — den havner i Vercel-loggen, og «noe feilet»
      // uten å si HVA er ubrukelig når ni spørringer kan være synderen.
      assert.match(err.message, /aktiv quiz/)
      assert.match(err.message, /connection timed out/)
      return true
    },
  )
})

test('assertHomeQuery kaster også når feilobjektet mangler message', () => {
  // En avbrutt fetch trenger ikke ha message. En feil uten tekst er fortsatt en
  // feil — den må ikke gli gjennom som «ingen feil» og bli til «ingen quiz».
  assert.throws(() => assertHomeQuery('kommende quiz', {}), HomeDataUnavailableError)
  assert.throws(() => assertHomeQuery('kommende quiz', { message: null }), HomeDataUnavailableError)
})

test('en TOM message faller tilbake på «ukjent lesefeil»', () => {
  // Ikke hypotetisk: en feil fra en `head: true`-telling har message: '' —
  // det finnes ingen body å hente teksten fra. Målt 24. august 2026 ved å
  // peke quiz-tellingen i computeFounderStoryStats mot en kolonne som ikke
  // finnes: loggen sa «forsidens delte bundel: «quizer gjennomført» feilet — »
  // og stoppet der. `??` slipper den tomme strengen gjennom; `||` gjør ikke.
  assert.throws(
    () => assertHomeQuery('quizer gjennomført', { message: '' }),
    (err: unknown) => err instanceof HomeDataUnavailableError && err.message.includes('ukjent lesefeil'),
  )

  const original = console.error
  const linjer: unknown[][] = []
  console.error = (...args: unknown[]) => { linjer.push(args) }
  try {
    assert.equal(logHomeQuery('siste stengte quiz', { message: '' }), true)
  } finally {
    console.error = original
  }
  assert.equal(linjer.length, 1, 'logHomeQuery logget ikke')
  assert.notEqual(linjer[0][1], '', 'den tomme meldingen ble logget som tom — grunnen mangler i loggen')
})

test('logHomeQuery returnerer false og logger ingenting uten feil', () => {
  const original = console.error
  let kalt = 0
  console.error = () => { kalt++ }
  try {
    assert.equal(logHomeQuery('siste stengte quiz', null), false)
    assert.equal(logHomeQuery('siste stengte quiz', undefined), false)
  } finally {
    console.error = original
  }
  assert.equal(kalt, 0, 'logHomeQuery loggførte uten at noe feilet')
})

test('logHomeQuery logger og returnerer true ved feil', () => {
  const original = console.error
  const linjer: unknown[][] = []
  console.error = (...args: unknown[]) => { linjer.push(args) }
  try {
    assert.equal(logHomeQuery('deltakerantall (attempts)', { message: 'nede' }), true)
  } finally {
    console.error = original
  }
  assert.equal(linjer.length, 1, 'kosmetiske feil skal fortsatt etterlate et loggspor')
  const tekst = linjer[0].map(String).join(' ')
  assert.match(tekst, /\[forside\]/, 'prefikset er det man greper etter i Vercel-loggen')
  assert.match(tekst, /deltakerantall \(attempts\)/)
  assert.match(tekst, /nede/)
})

test('logHomeQuery kaster ALDRI — den er degraderingsstien', () => {
  // Kastet den, ville et kosmetisk oppslag felt hele forsiden. Hele poenget
  // med to funksjoner er at valget mellom dem er eksplisitt på kallstedet.
  const original = console.error
  console.error = () => {}
  try {
    assert.doesNotThrow(() => logHomeQuery('x', { message: 'boom' }))
  } finally {
    console.error = original
  }
})
