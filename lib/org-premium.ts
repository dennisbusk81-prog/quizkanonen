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
  // 1. Grace-periode etter tapt org-Premium (samme felt som /api/profile/premium-status leser)
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('org_premium_grace_until')
    .eq('id', userId)
    .maybeSingle()

  if (profile?.org_premium_grace_until && new Date(profile.org_premium_grace_until) > new Date()) {
    return true
  }

  // 2. Aktivt/trialing org-medlemskap. To trinn for å unngå tvetydig embed-filtrering.
  const { data: memberships } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)

  const orgIds = (memberships ?? []).map(m => m.organization_id)
  if (orgIds.length === 0) return false

  const { count } = await supabaseAdmin
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .in('id', orgIds)
    .in('subscription_status', ['active', 'trialing'])

  return (count ?? 0) > 0
}
