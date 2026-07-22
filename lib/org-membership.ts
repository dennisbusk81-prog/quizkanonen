import { supabaseAdmin } from './supabase-admin'

// ── Delt org-medlemskaps-gate ────────────────────────────────────────────────
// Resolverer en organisasjon via slug og verifiserer at bruker-en bak
// Bearer-tokenet faktisk er medlem (hvilken som helst rolle). Returnerer org-id
// + alle medlemmers user_id ved suksess. Deles av de org-scopede leaderboard-
// og prev-rank-rutene slik at BEGGE håndhever nøyaktig samme gate — uten den
// ville ?org=<slug> på prev-rank vært et hull rundt hovedrutens tilgangskontroll
// (enumerering av org-medlemskap uten gyldig medlemskap).

export type OrgMembershipResult =
  | { ok: true; orgId: string; memberIds: string[] }
  | { ok: false; status: 401 | 403; error: string }

export async function resolveOrgMembership(
  slug: string,
  token: string | undefined,
): Promise<OrgMembershipResult> {
  if (!token) return { ok: false, status: 401, error: 'Ikke innlogget' }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return { ok: false, status: 401, error: 'Ugyldig sesjon' }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (!org) return { ok: false, status: 403, error: 'Ikke tilgang' }

  const [membershipRes, membersRes] = await Promise.all([
    supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', org.id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id),
  ])

  if (!membershipRes.data) return { ok: false, status: 403, error: 'Ikke tilgang' }

  const memberIds = ((membersRes.data ?? []) as { user_id: string | null }[])
    .map(m => m.user_id)
    .filter((id): id is string => !!id)

  return { ok: true, orgId: org.id, memberIds }
}
