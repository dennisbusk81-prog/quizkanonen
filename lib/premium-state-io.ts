import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrgCoverage } from '@/lib/org-premium'
import {
  decidePremiumState,
  type CodeCoverage,
  type PremiumState,
  type StripeCoverage,
} from '@/lib/premium-state'

// I/O-laget for den autoritative premium-tilstanden. Reglene ligger i
// lib/premium-state.ts (ren, testdekket) — her hentes bare input. Samme deling
// som lib/answer-key-correction.ts (ren) og lib/resync-season-scores.ts (I/O).

const STRIPE_API_VERSION = '2026-03-25.dahlia'

/**
 * Aktiv kode-periode fra access_code_redemptions.
 *
 * expires_at på selve innløsningsraden er autoritativ, ikke
 * profiles.premium_expires_at: sistnevnte overskrives ikke av webhooken, men
 * premium_source gjør det, og da mistet vi sporet av at koden fortsatt gjaldt.
 */
export async function getCodeCoverage(userId: string): Promise<CodeCoverage | null> {
  const { data, error } = await supabaseAdmin
    .from('access_code_redemptions')
    .select('id, code_id, expires_at')
    .eq('user_id', userId)
    .order('redeemed_at', { ascending: false })
    .limit(20)

  if (error) {
    // Tabellen finnes ikke før migrasjonen er kjørt. Da har ingen kode-periode,
    // og null er riktig svar — men det skal logges, ikke skjules.
    console.error('[premium-state] kunne ikke lese kode-innløsninger:', error.message)
    return null
  }

  const now = Date.now()
  const active = (data ?? []).find(r => r.expires_at === null || new Date(r.expires_at).getTime() > now)
  if (!active) return null

  return { redemptionId: active.id, codeId: active.code_id, expiresAt: active.expires_at }
}

/**
 * Brukerens levende personlige abonnement, lest fra Stripe — ikke fra et
 * denormalisert flagg. Samme oppslag som /api/stripe/subscription har brukt
 * siden lenge: active og trialing hentes hver for seg fordi Stripes list()
 * ikke tar en array for status.
 */
export async function getStripeCoverage(
  customerId: string | null,
  stripeClient?: Stripe,
): Promise<StripeCoverage | null> {
  if (!customerId) return null

  const stripe = stripeClient ?? new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: STRIPE_API_VERSION })

  try {
    const [active, trialing] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, limit: 1, status: 'active' }),
      stripe.subscriptions.list({ customer: customerId, limit: 1, status: 'trialing' }),
    ])
    const sub = active.data[0] ?? trialing.data[0] ?? null
    if (!sub) return null

    const item = sub.items.data[0] as unknown as { current_period_end?: number } | undefined
    const periodEnd = item?.current_period_end ?? null

    return {
      subscriptionId: sub.id,
      status: sub.status,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      pauseResumesAt: sub.pause_collection?.resumes_at
        ? new Date(sub.pause_collection.resumes_at * 1000).toISOString()
        : null,
    }
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing') {
      // Ukjent customer (typisk live/test-mismatch) — samme håndtering som
      // /api/stripe/subscription: ikke en feil, brukeren har bare ikke noe hos oss.
      console.warn('[premium-state] ukjent Stripe-customer:', customerId)
      return null
    }
    // Stripe nede: vi VET ikke om det finnes et abonnement. Å returnere null
    // ville latt kalleren tro at brukeren er udekket — kast heller, så kalleren
    // kan velge å avbryte i stedet for å ta feil beslutning.
    throw err
  }
}

/**
 * Full premium-tilstand for én bruker, satt sammen av alle fire kildene.
 * Brukes av innløsning, checkout, cron og webhookenes nedgraderingsgrener.
 */
export async function getPremiumState(userId: string, stripeClient?: Stripe): Promise<PremiumState> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle()

  const [code, stripe, org] = await Promise.all([
    getCodeCoverage(userId),
    getStripeCoverage(profile?.stripe_customer_id ?? null, stripeClient),
    getOrgCoverage(userId),
  ])

  return decidePremiumState({ code, stripe, org })
}

/**
 * Skriver den utledede tilstanden tilbake til cache-feltene på profiles.
 *
 * Dette er erstatningen for de seks stedene som tidligere satte
 * `premium_status: false` uten å spørre om noen annen kilde fortsatt dekket
 * brukeren. Kall denne i stedet — den slår aldri av Premium for en bruker som
 * fortsatt har dekning fra en annen kilde.
 */
export async function syncPremiumCache(userId: string, stripeClient?: Stripe): Promise<PremiumState> {
  const state = await getPremiumState(userId, stripeClient)

  const source = state.sources.code ? 'code'
    : state.sources.org ? 'org'
    : state.sources.stripe ? 'personal'
    : null

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      premium_status: state.isPremium,
      premium_source: source,
      premium_expires_at: state.sources.code?.expiresAt ?? null,
    })
    .eq('id', userId)

  if (error) {
    console.error('[premium-state] kunne ikke synkronisere premium-cache for', userId, error.message)
  }

  return state
}
