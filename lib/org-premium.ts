import { supabaseAdmin } from '@/lib/supabase-admin'

// Server-only. Avgjør om en bruker har aktiv Premium-dekning via en ORGANISASJON —
// altså premium som IKKE avhenger av brukerens eventuelle personlige Stripe-abonnement.
//
// Dekning regnes som aktiv hvis:
//   1. Brukeren er inne i en org-premium grace-periode (org_premium_grace_until frem i tid), eller
//   2. Brukeren er medlem av minst én organisasjon med subscription_status 'active' eller 'trialing'.
//
// Brukes for å unngå å sende betalingsfeil-/prøveperiode-påminnelse for et personlig
// abonnement når brukeren uansett beholder tilgang via org — da mister de ingenting
// reelt, og e-posten er bare forvirrende.
export async function hasActiveOrgPremium(userId: string): Promise<boolean> {
  const coverage = await getOrgCoverage(userId)
  return coverage.orgIds.length > 0
    || (!!coverage.graceUntil && new Date(coverage.graceUntil) > new Date())
}

/**
 * Samme dekningsspørsmål som hasActiveOrgPremium, men returnerer HVILKE
 * organisasjoner som dekker brukeren — og navnene deres.
 *
 * Navnene brukes i avvisningsmeldingen når et org-medlem prøver å løse inn en
 * verdikode («Du har allerede Premium via …»). Meldingen skal vise brukerens
 * egen organisasjon, ikke en hardkodet bedrift.
 */
export async function getOrgCoverage(userId: string): Promise<{
  orgIds: string[]
  orgNames: string[]
  graceUntil: string | null
}> {
  // 1. Grace-periode etter tapt org-Premium (samme felt som /api/profile/premium-status leser)
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('org_premium_grace_until')
    .eq('id', userId)
    .maybeSingle()

  const graceUntil = profile?.org_premium_grace_until ?? null

  // 2. Aktivt/trialing org-medlemskap. To trinn for å unngå tvetydig embed-filtrering.
  const { data: memberships } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)

  const memberOrgIds = (memberships ?? []).map(m => m.organization_id)
  if (memberOrgIds.length === 0) return { orgIds: [], orgNames: [], graceUntil }

  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .in('id', memberOrgIds)
    .in('subscription_status', ['active', 'trialing'])

  return {
    orgIds: (orgs ?? []).map(o => o.id),
    orgNames: (orgs ?? []).map(o => o.name).filter(Boolean),
    graceUntil,
  }
}
