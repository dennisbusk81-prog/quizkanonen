// Gjenbrukbar tilgangssjekk for organisasjoner.
//
// En org låses (subscription_status = 'locked') når en B2B-trial utløper uten at
// betaling er registrert. Låsen gater KUN de org-spesifikke sidene
// (bedrifts-leaderboard + admin-panel) — den påvirker ikke ansattes mulighet til
// å spille den ukentlige quizen som vanlig, og sletter/skjuler ingen data.

export type OrgSubscriptionStatus = 'trialing' | 'active' | 'locked'

// Tolererer både snake_case (admin-data: subscription_status) og camelCase
// (my-orgs: subscriptionStatus), siden de to API-rutene navngir feltet ulikt.
export function isOrgLocked(
  org: { subscription_status?: string | null; subscriptionStatus?: string | null } | null | undefined
): boolean {
  const status = org?.subscription_status ?? org?.subscriptionStatus
  return status === 'locked'
}
