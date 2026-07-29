import type { OrgPlanId } from '@/lib/org-plan'
import { isOrgPlanId } from '@/lib/org-plan'

// SERVER-ONLY. Kobler planene i lib/org-plan.ts til Stripe-pris-id-ene i
// miljøvariablene. Ligger separat nettopp fordi lib/org-plan.ts importeres av
// admin-panelet (klient) — env-lesing hører ikke hjemme der.
//
// Kartet var tidligere kopiert ordrett i BÅDE org-checkout og
// org-founders-activate. Nå bor det ett sted, slik at en ny plan ikke kan bli
// lagt til det ene stedet og glemt det andre.

export const PLAN_PRICES: Record<string, string | undefined> = {
  starter:  process.env.STRIPE_ORG_STARTER_PRICE_ID,
  standard: process.env.STRIPE_ORG_STANDARD_PRICE_ID,
  pro:      process.env.STRIPE_ORG_PRO_PRICE_ID,
}

export function priceIdForPlan(plan: string | null | undefined): string | undefined {
  return plan ? PLAN_PRICES[plan] : undefined
}

/**
 * Omvendt oppslag: hvilken plan hører denne Stripe-prisen til?
 *
 * SIKKERHETSNETT FOR WEBHOOKEN. `organizations.plan` ble fram til 29. juli 2026
 * kun skrevet ved opprettelse — webhooken rørte den aldri. Endret noen prisen
 * på abonnementet et annet sted (Stripe-dashbordet, en fremtidig portal-
 * konfigurasjon), ble kolonnen stående feil for alltid. Det ga feil MRR i
 * admin-dashbordet, feil gating av ukesrapporten, og — etter at
 * medlemsgrensene ble håndhevet — feil grense for kunden.
 *
 * Returnerer null for ukjente priser, slik at en pris vi ikke kjenner igjen
 * aldri overskriver en plan vi vet er riktig.
 */
export function planFromPriceId(priceId: string | null | undefined): OrgPlanId | null {
  if (!priceId) return null
  for (const [plan, id] of Object.entries(PLAN_PRICES)) {
    if (id && id === priceId && isOrgPlanId(plan)) return plan
  }
  return null
}
