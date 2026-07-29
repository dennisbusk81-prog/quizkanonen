import { supabaseAdmin } from '@/lib/supabase-admin'

// Server-only. Avgjør om en bruker har aktiv Premium-dekning via en ORGANISASJON —
// altså premium som IKKE avhenger av brukerens eventuelle personlige Stripe-abonnement.
//
// Dekning regnes som aktiv hvis:
//   1. Brukeren er inne i en org-premium grace-periode (org_premium_grace_until frem i tid), eller
//   2. Brukeren er medlem av minst én organisasjon med subscription_status 'active' eller 'trialing', eller
//   3. Brukeren er medlem av en LÅST org som er inne i lås-grace
//      (organizations.member_grace_until frem i tid — se lib/org-lock-grace.ts).
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

  // 3. Lås-grace (29. juli 2026). En org som ble låst ufrivillig — utløpt trial
  //    eller avvist kort — beholder de ansattes Premium i 7 dager. Se
  //    lib/org-lock-grace.ts for hvorfor de to tilfellene skiller lag fra en
  //    bevisst oppsigelse.
  //
  //    EGEN SPØRRING, ikke en utvidelse av den over, og det er med vilje: går
  //    denne i stå — typisk fordi migrasjon 20260737000000 ikke er kjørt ennå —
  //    faller dekningen tilbake til nøyaktig dagens oppførsel i stedet for at
  //    hele org-dekningen forsvinner for alle medlemmer samtidig. Det er den
  //    ene feilen vi ikke har råd til her.
  const lockGraceUntil = await getLockGraceUntil(memberOrgIds)

  return {
    orgIds: (orgs ?? []).map(o => o.id),
    orgNames: (orgs ?? []).map(o => o.name).filter(Boolean),
    // Den lengstlevende grace-perioden gjelder. En bruker kan i prinsippet ha
    // begge samtidig: fjernet fra én org (profil-grace) mens en annen org de er
    // medlem av blir låst.
    graceUntil: laterOf(graceUntil, lockGraceUntil),
  }
}

/**
 * Siste tidspunkt en av brukerens låste organisasjoner fortsatt dekker dem.
 *
 * Returnerer null både når ingen org har grace og når spørringen feilet — men
 * en feil logges. Fail-safe mot dagens oppførsel, se merknaden hos kalleren.
 */
async function getLockGraceUntil(orgIds: string[]): Promise<string | null> {
  const nowIso = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('member_grace_until')
    .in('id', orgIds)
    .eq('subscription_status', 'locked')
    .gt('member_grace_until', nowIso)

  if (error) {
    console.error('[org-premium] kunne ikke lese lås-grace:', error.code, error.message)
    return null
  }

  return (data ?? []).reduce<string | null>(
    (latest, row) => laterOf(latest, row.member_grace_until as string | null),
    null,
  )
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return new Date(a) > new Date(b) ? a : b
}
