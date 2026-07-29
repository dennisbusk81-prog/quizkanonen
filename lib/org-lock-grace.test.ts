// Kjøres med:  npm test
//
// Ren beslutningslogikk for grace ved org-lås. Ingen Stripe, ingen database.
// Integrasjonssiden — at webhooken FAKTISK skriver stempelet, og at en bevisst
// kansellering fortsatt låser umiddelbart — ligger i org-lock-webhook-route.test.ts.
//
// MUTASJONSBEVIS (verifisert manuelt):
//   * Byttes rekkefølgen slik at `trialing` sjekkes FØR cancellation_requested,
//     feiler «admin sier opp MIDT i prøveperioden».
//   * Endres fallbacken til `{ grace: false }`, feiler alle tre ukjent-testene.
//   * Fjernes DUNNING_STATUSES-grenen, feiler past_due/unpaid — de faller da til
//     ukjent-grenen og får riktig utfall av feil grunn, så testene sjekker
//     `reason`, ikke bare `grace`.
//   * Fjernes remindedAt-vakten i shouldRemindDuringGrace, feiler «påminnelsen
//     sendes kun én gang».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideLockGrace,
  shouldRemindDuringGrace,
  isGraceExpired,
  LOCK_GRACE_DAYS,
} from './org-lock-grace'

const NOW = new Date('2026-07-29T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString()
}

// ── Ufrivillig tap → grace ─────────────────────────────────────────────────

test('past_due gir grace, klassifisert som betalingsfeil', () => {
  const d = decideLockGrace({
    previousOrgStatus: 'active',
    stripeStatus: 'past_due',
    cancellationReason: null,
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'payment_failed')
  assert.equal(d.grace && d.until, daysFromNow(LOCK_GRACE_DAYS))
})

test('unpaid gir grace på samme grunnlag som past_due', () => {
  const d = decideLockGrace({
    previousOrgStatus: 'active',
    stripeStatus: 'unpaid',
    cancellationReason: null,
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'payment_failed')
})

test('trial som løper ut uten kort gir grace — også når Stripe ikke oppgir noen grunn', () => {
  // Nøyaktig profilen til org-founders-activate sin trial:
  // trial_settings.end_behavior.missing_payment_method = 'cancel'.
  const d = decideLockGrace({
    previousOrgStatus: 'trialing',
    stripeStatus: 'canceled',
    cancellationReason: null,
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'trial_expired')
})

test('cancellation_details.reason = payment_failed gir grace', () => {
  const d = decideLockGrace({
    previousOrgStatus: 'active',
    stripeStatus: 'canceled',
    cancellationReason: 'payment_failed',
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'payment_failed')
})

test('payment_disputed gir grace — kunden mistet betalingsmidlet, valgte ikke bort tjenesten', () => {
  const d = decideLockGrace({
    previousOrgStatus: 'active',
    stripeStatus: 'canceled',
    cancellationReason: 'payment_disputed',
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'payment_failed')
})

// ── Bevisst kansellering → ingen grace ─────────────────────────────────────

test('admin sier opp aktivt → INGEN grace, tilgangen forsvinner umiddelbart', () => {
  const d = decideLockGrace({
    previousOrgStatus: 'active',
    stripeStatus: 'canceled',
    cancellationReason: 'cancellation_requested',
    now: NOW,
  })
  assert.equal(d.grace, false)
  assert.equal(d.reason, 'voluntary_cancel')
})

test('admin sier opp MIDT i prøveperioden → fortsatt ingen grace', () => {
  // Rekkefølge-testen: previousOrgStatus er 'trialing', men noen ba faktisk om
  // å avslutte. En bevisst beslutning slår trial-signalet.
  const d = decideLockGrace({
    previousOrgStatus: 'trialing',
    stripeStatus: 'canceled',
    cancellationReason: 'cancellation_requested',
    now: NOW,
  })
  assert.equal(d.grace, false)
})

// ── Tvilstilfeller → grace (konservativt) ──────────────────────────────────

test('ukjent grunn på en aktiv org gir grace', () => {
  const d = decideLockGrace({
    previousOrgStatus: 'active',
    stripeStatus: 'canceled',
    cancellationReason: null,
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'unknown')
})

test('canceled_by_retention_policy gir grace — det er ikke kundens handling', () => {
  const d = decideLockGrace({
    previousOrgStatus: 'active',
    stripeStatus: 'canceled',
    cancellationReason: 'canceled_by_retention_policy',
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'unknown')
})

test('en fremtidig, ukjent Stripe-grunn gir grace i stedet for å låse ute', () => {
  const d = decideLockGrace({
    previousOrgStatus: 'active',
    stripeStatus: 'incomplete_expired',
    cancellationReason: 'noe_stripe_finner_pa_senere',
    now: NOW,
  })
  assert.equal(d.grace, true)
})

test('helt tomt hendelsesobjekt gir grace, ikke umiddelbar utestengelse', () => {
  const d = decideLockGrace({
    previousOrgStatus: null,
    stripeStatus: null,
    cancellationReason: undefined,
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'unknown')
})

// ── Påminnelsesvinduet ─────────────────────────────────────────────────────

test('påminnelse sendes når det er under to dager igjen', () => {
  assert.equal(
    shouldRemindDuringGrace({ member_grace_until: daysFromNow(1.5), member_grace_reminded_at: null }, NOW),
    true,
  )
})

test('påminnelse sendes IKKE tidlig i perioden', () => {
  assert.equal(
    shouldRemindDuringGrace({ member_grace_until: daysFromNow(6), member_grace_reminded_at: null }, NOW),
    false,
  )
})

test('påminnelsen sendes kun én gang, selv om cronen kjører hver dag', () => {
  assert.equal(
    shouldRemindDuringGrace(
      { member_grace_until: daysFromNow(1), member_grace_reminded_at: daysFromNow(-0.5) },
      NOW,
    ),
    false,
  )
})

test('utløpt grace gir ingen påminnelse — «utløper snart» ville vært feil', () => {
  assert.equal(
    shouldRemindDuringGrace({ member_grace_until: daysFromNow(-1), member_grace_reminded_at: null }, NOW),
    false,
  )
})

test('ingen grace gir ingen påminnelse', () => {
  assert.equal(
    shouldRemindDuringGrace({ member_grace_until: null, member_grace_reminded_at: null }, NOW),
    false,
  )
})

test('ugyldig dato behandles som ingen påminnelse, ikke som NaN-sammenligning', () => {
  assert.equal(
    shouldRemindDuringGrace({ member_grace_until: 'ikke-en-dato', member_grace_reminded_at: null }, NOW),
    false,
  )
})

// ── Utløp ──────────────────────────────────────────────────────────────────

test('isGraceExpired skiller utløpt, levende og fraværende grace', () => {
  assert.equal(isGraceExpired(daysFromNow(-1), NOW), true, 'utløpt')
  assert.equal(isGraceExpired(daysFromNow(1), NOW), false, 'levende')
  assert.equal(isGraceExpired(null, NOW), false, 'NULL er ingen grace, ikke en utløpt grace')
  assert.equal(isGraceExpired('tull', NOW), false, 'ugyldig dato skal ikke telle som utløpt')
})
