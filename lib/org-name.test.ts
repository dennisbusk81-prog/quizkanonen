// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateOrgName, ORG_NAME_MAX } from './org-name'

test('godtar ekte firmanavn', () => {
  for (const name of [
    'Elkjøp Nordic',
    'Müller & Sønn AS',
    'Bok/Papir (Oslo)',
    'Firma 2 AS',
    "O'Brien Consulting",
    'Rørlegger Hansen, avd. Vest',
    'Nord – Sør AS',
    'Quizkanonen: Bedrift',
  ]) {
    const res = validateOrgName(name)
    assert.equal(res.ok, true, `${name} skulle vært godtatt`)
    if (res.ok) assert.equal(res.value, name)
  }
})

test('trimmer og kollapser whitespace', () => {
  const res = validateOrgName('  Elkjøp   Nordic \n')
  assert.deepEqual(res, { ok: true, value: 'Elkjøp Nordic' })
})

test('avviser markup og kontrolltegn', () => {
  for (const name of [
    '<b>Elkjøp</b>',
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    'Kontrolltegn' + String.fromCharCode(0) + 'i navn',
    'Firma "AS"',
  ]) {
    assert.equal(validateOrgName(name).ok, false, `${JSON.stringify(name)} skulle vært avvist`)
  }
})

test('avviser for kort, for langt og feil type', () => {
  assert.equal(validateOrgName('A').ok, false)
  assert.equal(validateOrgName('  ').ok, false)
  assert.equal(validateOrgName('A'.repeat(ORG_NAME_MAX + 1)).ok, false)
  assert.equal(validateOrgName('A'.repeat(ORG_NAME_MAX)).ok, true)
  assert.equal(validateOrgName(undefined).ok, false)
  assert.equal(validateOrgName(42).ok, false)
})
