// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isStaleSubscriptionEvent,
  shouldSendCancellationEmail,
  LIVE_SUBSCRIPTION_STATUSES,
} from './subscription-lifecycle'

const SUB_CURRENT = 'sub_current'
const SUB_OLD = 'sub_old'

// ── isStaleSubscriptionEvent — feltet er SATT (uendret oppførsel) ───────────

test('feltet peker på samme abonnement som hendelsen → ikke stale', () => {
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: SUB_CURRENT, eventSubId: SUB_CURRENT, liveSubIds: null,
  }), false)
})

test('feltet peker på et ANNET abonnement → stale (uendret vern fra FIX 3)', () => {
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: SUB_CURRENT, eventSubId: SUB_OLD, liveSubIds: null,
  }), true)
})

test('et satt felt er autoritativt — Stripe-oppslaget overstyrer det ikke', () => {
  // liveSubIds sier noe annet, men feltet vinner: det er den eksplisitte
  // «gjeldende abonnement»-pekeren vår.
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: SUB_CURRENT, eventSubId: SUB_CURRENT, liveSubIds: [SUB_OLD],
  }), false)
})

// ── HULL 1: feltet er NULL (det tvetydige tilfellet) ───────────────────────

test('HULL 1 — NULL felt + et annet LEVENDE abonnement finnes → stale, hendelsen ignoreres', () => {
  // Nøyaktig regresjonen: feltet ble nullet av en tidligere terminal hendelse,
  // brukeren har siden fått et nytt abonnement. Den sene deleted-hendelsen for
  // det gamle skal ikke røre premium eller sende «Premium avsluttet».
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: null, eventSubId: SUB_OLD, liveSubIds: [SUB_CURRENT],
  }), true)
})

test('HULL 1 — NULL felt + INGEN andre levende abonnement → ikke stale (ekte kansellering)', () => {
  // Magnus-tilfellet: kortløs trial løper ut, feltet er nullet av
  // subscription.updated, og deleted gjelder hans faktiske abonnement.
  // Denne SKAL behandles — det er kun e-postvalget (hull 2) som var feil.
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: null, eventSubId: SUB_OLD, liveSubIds: [],
  }), false)
})

test('HULL 1 — NULL felt + hendelsens eget abonnement er det eneste levende → ikke stale', () => {
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: null, eventSubId: SUB_CURRENT, liveSubIds: [SUB_CURRENT],
  }), false)
})

// ── Fail-safe-oppførsel ────────────────────────────────────────────────────

test('Stripe-oppslaget feilet (null) → ikke stale, gammel oppførsel beholdes', () => {
  // Å tie om en ekte kansellering fordi et API-kall glapp er verre enn en
  // sjelden overflødig e-post.
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: null, eventSubId: SUB_OLD, liveSubIds: null,
  }), false)
})

test('hendelsen mangler subscription-id → aldri stale (ingenting å sammenligne)', () => {
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: SUB_CURRENT, eventSubId: null, liveSubIds: ['x'],
  }), false)
  assert.equal(isStaleSubscriptionEvent({
    storedSubId: null, eventSubId: null, liveSubIds: [SUB_CURRENT],
  }), false)
})

test('past_due og unpaid regnes som levende — et abonnement under innkreving kan supersede', () => {
  assert.ok(LIVE_SUBSCRIPTION_STATUSES.includes('past_due'))
  assert.ok(LIVE_SUBSCRIPTION_STATUSES.includes('unpaid'))
  assert.ok(LIVE_SUBSCRIPTION_STATUSES.includes('active'))
  assert.ok(LIVE_SUBSCRIPTION_STATUSES.includes('trialing'))
  assert.ok(!(LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes('canceled'))
})

// ── HULL 2: shouldSendCancellationEmail ────────────────────────────────────

test('HULL 2 — kortløs + payment_failed → UNDERTRYKK («Premium avsluttet» er misvisende)', () => {
  // Magnus: Founders-trial han aldri betalte for. Han har allerede fått
  // «Prøveperioden din er over» fra invoice.payment_failed.
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: 'payment_failed', hasPaymentMethod: false,
  }), false)
})

test('HULL 2 — kortløs + UKJENT grunn → undertrykk (Stripe garanterer ikke reason)', () => {
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: null, hasPaymentMethod: false,
  }), false)
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: undefined, hasPaymentMethod: false,
  }), false)
})

test('brukeren ba SELV om å avslutte → send alltid, også uten kort', () => {
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: 'cancellation_requested', hasPaymentMethod: false,
  }), true)
})

test('har kort + payment_failed → send (ekte dunning-kansellering, ingen regresjon)', () => {
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: 'payment_failed', hasPaymentMethod: true,
  }), true)
})

test('har kort + selv-kansellert → send (normalflyten, uendret)', () => {
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: 'cancellation_requested', hasPaymentMethod: true,
  }), true)
})

test('kortoppslaget feilet (null) → send (fail-safe mot å tie om en ekte avslutning)', () => {
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: 'payment_failed', hasPaymentMethod: null,
  }), true)
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: null, hasPaymentMethod: null,
  }), true)
})

test('payment_disputed uten kort → undertrykk; med kort → send', () => {
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: 'payment_disputed', hasPaymentMethod: false,
  }), false)
  assert.equal(shouldSendCancellationEmail({
    cancellationReason: 'payment_disputed', hasPaymentMethod: true,
  }), true)
})
