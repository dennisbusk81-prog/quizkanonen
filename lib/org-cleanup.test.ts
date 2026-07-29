// Kjøres med:  npm test
//
// Enhetstester av beslutningslogikken i lib/org-cleanup.ts. Selve ruten testes
// i lib/cleanup-orgs-route.test.ts (mutasjonsbeviset ligger der).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLEANUP_MIN_AGE_MS,
  decideOrgCleanup,
  isProtectingStatus,
  describeOrg,
  type CleanupCandidate,
} from './org-cleanup'

const org = (over: Partial<CleanupCandidate> = {}): CleanupCandidate => ({
  id: '26e5126f-4c40-4588-9646-aa81d0c6a082',
  name: 'Elkjøp Nordic',
  slug: 'a1b2c3d4',
  created_at: '2026-07-01T10:00:00.000Z',
  stripe_customer_id: null,
  subscription_status: 'active',
  memberCount: 1,
  ...over,
})

test('vinduet er 72 timer, ikke 24 — Stripe retryer webhooks i inntil 3 døgn', () => {
  assert.equal(CLEANUP_MIN_AGE_MS, 72 * 60 * 60 * 1000)
})

test('forlatt checkout-forsøk uten abonnement slettes', () => {
  const v = decideOrgCleanup(org(), { ok: true, subscriptions: [] })
  assert.equal(v.action, 'delete')
})

test('levende abonnement beskytter org-en selv om lokal kobling mangler', () => {
  const v = decideOrgCleanup(org(), {
    ok: true,
    subscriptions: [{ id: 'sub_live', status: 'active' }],
  })
  assert.equal(v.action, 'skip')
  assert.equal(v.action === 'skip' && v.reason, 'live_subscription')
  assert.match(v.action === 'skip' ? v.detail : '', /sub_live/)
})

test('trialing beskytter — Elkjøp står som trialing i prod', () => {
  const v = decideOrgCleanup(org(), {
    ok: true,
    subscriptions: [{ id: 'sub_trial', status: 'trialing' }],
  })
  assert.equal(v.action, 'skip')
})

test('past_due og unpaid beskytter — betalingsproblem er ikke det samme som forlatt', () => {
  for (const status of ['past_due', 'unpaid', 'paused', 'incomplete']) {
    const v = decideOrgCleanup(org(), { ok: true, subscriptions: [{ id: 'sub_x', status }] })
    assert.equal(v.action, 'skip', `${status} skulle beskyttet org-en`)
  }
})

test('canceled og incomplete_expired beskytter ikke — de er terminale', () => {
  for (const status of ['canceled', 'incomplete_expired']) {
    const v = decideOrgCleanup(org(), { ok: true, subscriptions: [{ id: 'sub_x', status }] })
    assert.equal(v.action, 'delete', `${status} skulle ikke beskyttet org-en`)
  }
})

test('ett levende blant flere døde er nok til å beskytte', () => {
  const v = decideOrgCleanup(org(), {
    ok: true,
    subscriptions: [
      { id: 'sub_dead', status: 'canceled' },
      { id: 'sub_dead2', status: 'incomplete_expired' },
      { id: 'sub_live', status: 'active' },
    ],
  })
  assert.equal(v.action, 'skip')
  assert.equal(v.action === 'skip' && v.reason, 'live_subscription')
})

test('Stripe-feil feiler LUKKET — org-en beholdes', () => {
  const v = decideOrgCleanup(org(), { ok: false, error: 'connection reset' })
  assert.equal(v.action, 'skip')
  assert.equal(v.action === 'skip' && v.reason, 'stripe_unverified')
})

test('manglende Stripe-oppslag feiler LUKKET — aldri «slett fordi vi ikke spurte»', () => {
  const v = decideOrgCleanup(org(), null)
  assert.equal(v.action, 'skip')
  assert.equal(v.action === 'skip' && v.reason, 'stripe_unverified')
})

test('org med flere medlemmer skjermes uten at Stripe trenger å svare', () => {
  const v = decideOrgCleanup(org({ memberCount: 29 }), null)
  assert.equal(v.action, 'skip')
  assert.equal(v.action === 'skip' && v.reason, 'has_members')
})

test('ett medlem alene skjermer ikke — det er signaturen på et forlatt forsøk', () => {
  const v = decideOrgCleanup(org({ memberCount: 1 }), { ok: true, subscriptions: [] })
  assert.equal(v.action, 'delete')
})

test('subscription_status kan ikke brukes som signal — DEFAULT er «active»', () => {
  // Et forlatt checkout-forsøk står som 'active' i basen fordi kolonnen har
  // DEFAULT 'active'. Statusen skal derfor ikke påvirke utfallet i det hele tatt.
  const forlatt = decideOrgCleanup(org({ subscription_status: 'active' }), { ok: true, subscriptions: [] })
  assert.equal(forlatt.action, 'delete')
})

test('isProtectingStatus kjenner ikke ukjente statuser som beskyttende', () => {
  assert.equal(isProtectingStatus('active'), true)
  assert.equal(isProtectingStatus('canceled'), false)
  assert.equal(isProtectingStatus('noe_helt_annet'), false)
})

test('describeOrg tar med navn, slug og opprettelsestidspunkt', () => {
  const linje = describeOrg(org())
  assert.match(linje, /Elkjøp Nordic/)
  assert.match(linje, /a1b2c3d4/)
  assert.match(linje, /2026-07-01/)
})
