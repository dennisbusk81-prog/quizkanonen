// ── Opprydding av foreldreløse organisasjoner — beslutningslogikken ─────────
//
// Ren logikk, uten I/O, slik at hver gren kan testes direkte. Kalles fra
// app/api/cron/cleanup-orgs/route.ts, som gjør oppslagene og selve slettingen.
//
// BAKGRUNN: cronen slettet tidligere ENHVER org med `stripe_subscription_id IS
// NULL` eldre enn 24 timer — uten å se på noe annet. Den lokale kolonnen skrives
// KUN av webhooken (checkout.session.completed), så en org der webhooken feilet
// eller kom for sent så nøyaktig ut som et forlatt checkout-forsøk. Da ble en
// betalende bedrift slettet med alle medlemmer og invitasjoner, mens Stripe
// fortsatte å fakturere.
//
// INVARIANT: en org slettes KUN når vi har fått bekreftet fra Stripe at det
// ikke finnes noe levende abonnement for den. Kan vi ikke bekrefte det —
// nettverksfeil, manglende nøkkel, hva som helst — beholdes org-en. Å la et
// forlatt checkout-forsøk ligge en dag ekstra koster ingenting; å slette en
// ekte kunde kan ikke angres.

/** Hvor gammel en org må være før den i det hele tatt vurderes for sletting. */
//
// 72 timer, ikke 24: Stripe retryer webhooks i inntil 3 døgn. Et kortere vindu
// betyr at vi kan rekke å slette org-en midt i Stripes egen gjenoppretting —
// altså mens systemet er i ferd med å reparere seg selv.
export const CLEANUP_MIN_AGE_MS = 72 * 60 * 60 * 1000

// Statuser som beskytter org-en mot sletting. Bevisst bredere enn
// LIVE_STRIPE_STATUSES i lib/premium-state.ts: der avgjøres «har kunden
// Premium nå», her avgjøres «kan vi trygt slette bedriften permanent». De to
// spørsmålene tåler ulik feilmargin.
//
// `incomplete` er med fordi et abonnement der første betaling ikke er fullført
// fortsatt kan bli fullført. Stripe flytter det selv til `incomplete_expired`
// etter 24 timer, og da er org-en uansett eldre enn CLEANUP_MIN_AGE_MS neste
// gang cronen ser den. Kun `canceled` og `incomplete_expired` regnes som døde.
export const PROTECTING_SUB_STATUSES = [
  'trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete',
] as const

export type StripeSubLike = { id: string; status: string }

export type CleanupCandidate = {
  id: string
  name: string | null
  slug: string | null
  created_at: string | null
  stripe_customer_id: string | null
  subscription_status: string | null
  /** Antall rader i organization_members for org-en. */
  memberCount: number
}

/**
 * Resultatet av Stripe-oppslaget for én org.
 * `null` = oppslaget ble bevisst ikke gjort (org-en var allerede skjermet av en
 * billigere vakt). Havner den likevel fram til Stripe-grenen, feiler vi lukket.
 */
export type StripeLookup =
  | { ok: true; subscriptions: StripeSubLike[] }
  | { ok: false; error: string }
  | null

export type CleanupVerdict =
  | { action: 'delete'; reason: 'no_live_subscription' }
  | {
      action: 'skip'
      reason: 'has_members' | 'live_subscription' | 'stripe_unverified'
      detail: string
    }

export function isProtectingStatus(status: string): boolean {
  return (PROTECTING_SUB_STATUSES as readonly string[]).includes(status)
}

/**
 * Avgjør om én kandidat-org kan slettes.
 *
 * Rekkefølgen er bevisst: den gratis vakten (medlemstall) først, slik at ruten
 * kan hoppe over Stripe-kallet helt for orger som uansett er skjermet.
 */
export function decideOrgCleanup(
  org: CleanupCandidate,
  lookup: StripeLookup,
): CleanupVerdict {
  // ── 1. Faktisk bruk ────────────────────────────────────────────────────────
  // Et forlatt checkout-forsøk har nøyaktig ett medlem: den som startet det, og
  // som ble lagt inn som admin før Stripe-checkouten. Er det flere, har noen
  // faktisk tatt i bruk org-en — da er den ikke foreldreløs uansett hva
  // Stripe-koblingen sier. Samme «dyrt å forfalske»-prinsipp som
  // lib/invite-quota.ts: alder og reelle medlemmer er signaler en angriper må
  // betale for, og som en ekte bedrift får gratis.
  if (org.memberCount > 1) {
    return {
      action: 'skip',
      reason: 'has_members',
      detail: `${org.memberCount} medlemmer — org-en er i bruk`,
    }
  }

  // ── 2. Stripe må ha svart ──────────────────────────────────────────────────
  if (lookup === null) {
    return {
      action: 'skip',
      reason: 'stripe_unverified',
      detail: 'Stripe-oppslag ble ikke utført',
    }
  }

  if (!lookup.ok) {
    return {
      action: 'skip',
      reason: 'stripe_unverified',
      detail: `Stripe-oppslag feilet: ${lookup.error}`,
    }
  }

  // ── 3. Levende abonnement ──────────────────────────────────────────────────
  const live = lookup.subscriptions.filter(s => isProtectingStatus(s.status))
  if (live.length > 0) {
    return {
      action: 'skip',
      reason: 'live_subscription',
      detail: live.map(s => `${s.id} (${s.status})`).join(', '),
    }
  }

  return { action: 'delete', reason: 'no_live_subscription' }
}

/**
 * Logglinje for en org som skal slettes. Cronen logget tidligere KUN antall, så
 * slettet den en ekte kunde fantes det null spor etterpå — verken navn, slug
 * eller opprettelsestidspunkt.
 */
export function describeOrg(org: CleanupCandidate): string {
  return (
    `org=${org.id} navn=${JSON.stringify(org.name ?? 'ukjent')} slug=${org.slug ?? 'ukjent'} ` +
    `opprettet=${org.created_at ?? 'ukjent'} status=${org.subscription_status ?? 'ukjent'} ` +
    `kunde=${org.stripe_customer_id ?? 'ingen'} medlemmer=${org.memberCount}`
  )
}
