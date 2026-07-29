/**
 * Grace-periode ved org-lås, differensiert etter årsak (29. juli 2026).
 *
 * PROBLEMET: `subscription_status = 'locked'` skrives i dag for tre helt ulike
 * hendelser — en trial som løper ut uten kort, et kort som blir avvist, og en
 * admin som selv sier opp — og alle tre fikk samme utfall: hver ansatt mistet
 * Premium i samme sekund. De to første er ikke beslutninger noen har tatt.
 *
 * REGELEN (besluttet av Dennis 29. juli):
 *   trial utløpt uten kort        → 7 dagers grace + påminnelse
 *   ufrivillig betalingsfeil      → 7 dagers grace + påminnelse
 *   admin kansellerer aktivt      → ingen grace, som i dag
 *
 * Ren logikk, ingen I/O — samme deling som lib/premium-state.ts (ren) +
 * lib/premium-state-io.ts, og lib/subscription-lifecycle.ts.
 */

/** Hvor lenge ansattes Premium overlever en ufrivillig lås. */
export const LOCK_GRACE_DAYS = 7

/** Hvor mange dager før grace utløper påminnelsen sendes. */
export const GRACE_REMINDER_DAYS_BEFORE = 2

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Statuser der Stripe fortsatt driver innkreving. Abonnementet er ikke
 * avsluttet — betalingen har bare ikke gått gjennom, og det er per definisjon
 * ufrivillig. Speiler DUNNING_LOCK_STATUSES i lib/org-lock-notify.ts, som
 * bruker samme skille til å avgjøre hvilken e-post ADMIN skal ha.
 */
export const DUNNING_STATUSES: readonly string[] = ['past_due', 'unpaid']

export type LockGraceReason = 'trial_expired' | 'payment_failed' | 'unknown'

export type LockGraceDecision =
  /** Bevisst oppsigelse — tilgangen forsvinner umiddelbart, som før. */
  | { grace: false; reason: 'voluntary_cancel' }
  /** Ufrivillig — ansatte beholder Premium til `until`. */
  | { grace: true; reason: LockGraceReason; until: string }

export type LockGraceInput = {
  /**
   * `organizations.subscription_status` slik den var FØR denne hendelsen.
   * Webhooken snapshotter den i SELECT-en før den skriver, og bruker den
   * allerede som overgangsvakt for varslingen.
   */
  previousOrgStatus: string | null | undefined
  /** `subscription.status` på hendelsens abonnement. */
  stripeStatus: string | null | undefined
  /** `subscription.cancellation_details?.reason`. */
  cancellationReason: string | null | undefined
  now?: Date
}

/**
 * Skal de ansatte få grace når org-en låses nå?
 *
 * TO SIGNALER, fordi ingen av dem holder alene:
 *
 *  A. `cancellation_details.reason`. Feltet finnes og er typet i API-versjonen
 *     vi kjører (2026-03-25.dahlia), og leses allerede av
 *     shouldSendCancellationEmail(). Men Stripe GARANTERER ikke at det er satt
 *     — særlig ikke for en trial som avsluttes automatisk av
 *     `trial_settings.end_behavior.missing_payment_method: 'cancel'`, som er
 *     nøyaktig slik org-trials opprettes i org-founders-activate.
 *
 *  B. Org-ens egen status før hendelsen. Sto den som `trialing`, var dette en
 *     prøveperiode som tok slutt — uansett hva Stripe måtte ha fylt inn i A.
 *
 * KONSERVATIV I TVIL: kun `cancellation_requested` nekter grace. Ukjent eller
 * manglende grunn gir grace. Kostnaden ved å ta feil den veien er 7 ekstra
 * Premium-dager for noen ansatte; kostnaden den andre veien er at en hel
 * bedrift mister tilgangen på minuttet fordi et kort utløp.
 *
 * REKKEFØLGEN er betydningsfull. `cancellation_requested` sjekkes FØR
 * trial-signalet, fordi en admin som sier opp midt i prøveperioden har tatt en
 * bevisst beslutning — det er ikke en trial som «løp ut».
 */
export function decideLockGrace(input: LockGraceInput): LockGraceDecision {
  const { previousOrgStatus, stripeStatus, cancellationReason } = input
  const now = input.now ?? new Date()
  const until = new Date(now.getTime() + LOCK_GRACE_DAYS * DAY_MS).toISOString()

  // Stripe purrer fortsatt på pengene. Abonnementet er ikke sagt opp av noen,
  // og det finnes ingen cancellation_details å tolke i det hele tatt.
  if (stripeStatus && DUNNING_STATUSES.includes(stripeStatus)) {
    return { grace: true, reason: 'payment_failed', until }
  }

  // Noen ba aktivt om å avslutte. Det eneste signalet som nekter grace.
  if (cancellationReason === 'cancellation_requested') {
    return { grace: false, reason: 'voluntary_cancel' }
  }

  // Prøveperioden tok slutt. Ingen har bedt om noe; kortet ble bare aldri lagt inn.
  if (previousOrgStatus === 'trialing') {
    return { grace: true, reason: 'trial_expired', until }
  }

  if (cancellationReason === 'payment_failed' || cancellationReason === 'payment_disputed') {
    return { grace: true, reason: 'payment_failed', until }
  }

  // Ukjent grunn — `null`, `canceled_by_retention_policy`, eller noe Stripe
  // innfører senere. Vi vet ikke at dette var en beslutning, så vi antar det ikke.
  return { grace: true, reason: 'unknown', until }
}

// ── Grace-periodens livsløp (leses av /api/cron/expire-grace-periods) ────────

export type GraceRow = {
  member_grace_until: string | null
  member_grace_reminded_at: string | null
}

/**
 * Skal påminnelsen sendes for denne org-en nå?
 *
 * Tre betingelser: grace finnes og er fortsatt levende, den utløper snart, og
 * påminnelsen er ikke sendt før. Cronen kjører daglig, så uten
 * `member_grace_reminded_at` ville hele bedriften fått den samme e-posten to
 * dager på rad.
 *
 * Er grace allerede utløpt, sendes INGEN påminnelse — da er det utløps-grenen
 * som eier beskjeden, og «tilgangen din utløper snart» ville vært direkte feil.
 */
export function shouldRemindDuringGrace(row: GraceRow, now: Date = new Date()): boolean {
  if (!row.member_grace_until) return false
  if (row.member_grace_reminded_at) return false

  const until = new Date(row.member_grace_until).getTime()
  if (Number.isNaN(until)) return false

  const msLeft = until - now.getTime()
  if (msLeft <= 0) return false

  return msLeft <= GRACE_REMINDER_DAYS_BEFORE * DAY_MS
}

/** Har grace-perioden løpt ut? NULL er ingen grace, ikke en utløpt grace. */
export function isGraceExpired(graceUntil: string | null, now: Date = new Date()): boolean {
  if (!graceUntil) return false
  const until = new Date(graceUntil).getTime()
  if (Number.isNaN(until)) return false
  return until <= now.getTime()
}

/**
 * Kolonneverdiene som nullstiller grace. Brukes både når perioden løper ut og
 * ved enhver reaktivering — én definisjon, så de tre stedene ikke kan komme i
 * utakt om hvilke felter som hører til.
 */
export const CLEARED_GRACE = {
  member_grace_until: null,
  member_grace_reason: null,
  member_grace_reminded_at: null,
} as const
