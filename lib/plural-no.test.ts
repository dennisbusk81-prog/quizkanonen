// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluralNo } from './plural-no'

test('1 gir entall, alt annet flertall', () => {
  assert.equal(pluralNo(1, 'riktig', 'riktige'), 'riktig')
  assert.equal(pluralNo(0, 'riktig', 'riktige'), 'riktige')
  assert.equal(pluralNo(2, 'riktig', 'riktige'), 'riktige')
  assert.equal(pluralNo(15, 'riktig', 'riktige'), 'riktige')
})
