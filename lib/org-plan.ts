// Planmodellen for bedriftskunder — ren logikk, ingen I/O og ingen env-lesing,
// slik at BÅDE serverruter og admin-panelet (klient) kan importere den.
//
// Stripe-pris-id-ene bor i lib/org-plan-prices.ts, som er server-only.
//
// BAKGRUNN: «opptil 25/50 ansatte» sto kun som markedsføringstekst på
// /bedrift og i planvelgeren, uten en eneste kodesti som håndhevet det
// (bekreftet ved kartlegging 29. juli 2026). Tallene bor nå her, ett sted, og
// brukes både til visning og til faktisk håndheving.

export type OrgPlanId = 'starter' | 'standard' | 'pro' | 'enterprise'

export type OrgPlan = {
  id: OrgPlanId
  label: string
  priceNok: number
  /** null = ingen grense. Pro og Enterprise selges som «ubegrenset». */
  memberLimit: number | null
  /** Kjøpbar selvbetjent i planvelgeren? Pro/Enterprise avtales med oss. */
  selfServe: boolean
}

export const ORG_PLANS: Record<OrgPlanId, OrgPlan> = {
  starter:    { id: 'starter',    label: 'Starter',    priceNok: 499,  memberLimit: 25,   selfServe: true },
  standard:   { id: 'standard',   label: 'Standard',   priceNok: 899,  memberLimit: 50,   selfServe: true },
  pro:        { id: 'pro',        label: 'Pro',        priceNok: 1499, memberLimit: null, selfServe: false },
  enterprise: { id: 'enterprise', label: 'Enterprise', priceNok: 2499, memberLimit: null, selfServe: false },
}

/** Rekkefølge for opp-/nedgradering. Brukes til å avgjøre retningen. */
export const PLAN_ORDER: OrgPlanId[] = ['starter', 'standard', 'pro', 'enterprise']

export function isOrgPlanId(value: unknown): value is OrgPlanId {
  return typeof value === 'string' && value in ORG_PLANS
}

export function getPlan(plan: string | null | undefined): OrgPlan | null {
  return isOrgPlanId(plan) ? ORG_PLANS[plan] : null
}

/**
 * Grensen for en plan. Ukjent plan gir null (ingen grense) med vilje: en org
 * med en plan vi ikke kjenner igjen skal ikke bli stengt ute av en
 * håndheving som ikke vet hva den gjør.
 */
export function getMemberLimit(plan: string | null | undefined): number | null {
  return getPlan(plan)?.memberLimit ?? null
}

export type CapacityResult =
  | { ok: true; limit: number | null; remaining: number | null }
  | { ok: false; limit: number; memberCount: number; error: string }

/**
 * Er det plass til flere medlemmer?
 *
 * GRANDFATHERING: en org som allerede ligger over grensen (f.eks. fordi
 * grensen ble innført etter at de vokste) mister ingen medlemmer — den kan
 * bare ikke ta inn flere. Ingen kodesti fjerner noen på grunn av en grense.
 */
export function checkMemberCapacity(
  plan: string | null | undefined,
  memberCount: number,
): CapacityResult {
  const limit = getMemberLimit(plan)
  if (limit === null) return { ok: true, limit: null, remaining: null }

  if (memberCount >= limit) {
    const planLabel = getPlan(plan)?.label ?? plan ?? 'planen'
    return {
      ok: false,
      limit,
      memberCount,
      error: `${planLabel} rommer ${limit} medlemmer, og bedriften har ${memberCount}.`,
    }
  }

  return { ok: true, limit, remaining: limit - memberCount }
}

export type PlanChangeResult =
  | { ok: true; from: OrgPlanId; to: OrgPlanId; direction: 'up' | 'down' }
  | { ok: false; code: 'unknown_plan' | 'same_plan' | 'limit_exceeded'; error: string; limit?: number; memberCount?: number }

/**
 * Kan orgen bytte til `toPlan`?
 *
 * NEDGRADERING UNDER MEDLEMSTALLET BLOKKERES (besluttet 29. juli 2026). Vi
 * utfører ikke byttet i Stripe i det hele tatt — admin får vite nøyaktig hvor
 * mange som må fjernes først, og har både «Fjern» og «Planlegg fjerning» til
 * å komme under grensen. Alternativet — å la byttet gå gjennom og sperre nye
 * medlemmer etterpå — ville latt kunden betale for mindre enn de bruker, i en
 * tilstand som kan vare lenge.
 */
export function decidePlanChange(
  fromPlan: string | null | undefined,
  toPlan: unknown,
  memberCount: number,
): PlanChangeResult {
  const from = getPlan(fromPlan)
  const to = getPlan(typeof toPlan === 'string' ? toPlan : null)

  if (!to) {
    return { ok: false, code: 'unknown_plan', error: 'Ukjent plan.' }
  }
  if (!from) {
    return { ok: false, code: 'unknown_plan', error: 'Bedriften har ingen kjent plan å bytte fra. Ta kontakt med support.' }
  }
  if (from.id === to.id) {
    return { ok: false, code: 'same_plan', error: `Bedriften står allerede på ${to.label}.` }
  }

  if (to.memberLimit !== null && memberCount > to.memberLimit) {
    const maaFjernes = memberCount - to.memberLimit
    return {
      ok: false,
      code: 'limit_exceeded',
      limit: to.memberLimit,
      memberCount,
      error:
        `Bedriften har ${memberCount} medlemmer, og ${to.label} rommer ${to.memberLimit}. ` +
        `Fjern ${maaFjernes} medlem${maaFjernes === 1 ? '' : 'mer'} først, eller velg en større plan.`,
    }
  }

  const direction = PLAN_ORDER.indexOf(to.id) > PLAN_ORDER.indexOf(from.id) ? 'up' : 'down'
  return { ok: true, from: from.id, to: to.id, direction }
}
