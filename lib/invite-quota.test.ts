// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveInviteQuota } from './invite-quota'

const NOW = new Date('2026-07-26T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

test('Elkjøp Nordic (ekte prod-verdier) er etablert — ingen regresjon', () => {
  // Opprettet 19. juni 2026, 29 medlemmer, står i 'trialing' fram til 18. august.
  // En grense basert på betalingsstatus alene ville rammet dem.
  const q = resolveInviteQuota({
    subscriptionStatus: 'trialing',
    createdAt: '2026-06-19T07:29:42.701198+00:00',
    memberCount: 29,
    now: NOW,
  })
  assert.equal(q.tier, 'etablert')
  assert.equal(q.perCall, 50)
  assert.equal(q.perDay, 200)
})

test('fersk trial-org er «ny»', () => {
  const q = resolveInviteQuota({
    subscriptionStatus: 'trialing',
    createdAt: daysAgo(0),
    memberCount: 1,
    now: NOW,
  })
  assert.equal(q.tier, 'ny')
  assert.equal(q.perCall, 15)
  assert.equal(q.perDay, 40)
})

test('gammel org uten medlemmer forblir «ny» — spam-mottakere melder seg aldri inn', () => {
  const q = resolveInviteQuota({
    subscriptionStatus: 'trialing',
    createdAt: daysAgo(365),
    memberCount: 1,
    now: NOW,
  })
  assert.equal(q.tier, 'ny')
})

test('ung org med mange medlemmer er fortsatt «ny»', () => {
  const q = resolveInviteQuota({
    subscriptionStatus: 'trialing',
    createdAt: daysAgo(2),
    memberCount: 40,
    now: NOW,
  })
  assert.equal(q.tier, 'ny')
})

test('betalende org er etablert umiddelbart', () => {
  const q = resolveInviteQuota({
    subscriptionStatus: 'active',
    createdAt: daysAgo(0),
    memberCount: 1,
    now: NOW,
  })
  assert.equal(q.tier, 'etablert')
})

test('7 dager + 5 medlemmer er terskelen', () => {
  assert.equal(resolveInviteQuota({ subscriptionStatus: 'trialing', createdAt: daysAgo(7), memberCount: 5, now: NOW }).tier, 'etablert')
  assert.equal(resolveInviteQuota({ subscriptionStatus: 'trialing', createdAt: daysAgo(6.9), memberCount: 5, now: NOW }).tier, 'ny')
  assert.equal(resolveInviteQuota({ subscriptionStatus: 'trialing', createdAt: daysAgo(7), memberCount: 4, now: NOW }).tier, 'ny')
})

test('manglende created_at behandles som fersk', () => {
  assert.equal(resolveInviteQuota({ subscriptionStatus: null, createdAt: null, memberCount: 99, now: NOW }).tier, 'ny')
})
