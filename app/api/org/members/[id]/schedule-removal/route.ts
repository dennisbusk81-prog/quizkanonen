import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { resolveOrgAdminAction } from '@/lib/org-member-removal'
import { validateScheduledRemovalDate, formatRemovalDate } from '@/lib/scheduled-removal'

// Planlagt fjerning av et org-medlem.
//
//   POST   — sett eller ENDRE datoen (samme kall begge veier)
//   DELETE — avbryt planen
//
// Ruten planlegger kun; den fjerner ingen. Selve fjerningen skjer i
// /api/cron/scheduled-removals, som kaller den delte removeOrgMemberById() —
// samme kodesti som «Fjern nå». Aktør-vaktene deles med remove-ruten via
// resolveOrgAdminAction, så de to kan ikke komme i utakt om hvem som får gjøre
// hva (bl.a. at en admin ikke kan planlegge sin egen fjerning).

type Params = { params: Promise<{ id: string }> }

async function authorize(request: NextRequest, membershipId: string) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-schedule-removal:${ip}`, 20, 60_000).success) {
    return { error: NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 }) } as const
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) {
    return { error: NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 }) } as const
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) {
    return { error: NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 }) } as const
  }

  const guard = await resolveOrgAdminAction(membershipId, user.id)
  if (!guard.ok) {
    return {
      error: NextResponse.json(
        { error: guard.error, ...(guard.code ? { code: guard.code } : {}) },
        { status: guard.status },
      ),
    } as const
  }

  return { user, membership: guard.membership } as const
}

// Aldri blokkerende, aldri stille — samme form som resten av admin_actions.
async function logAction(userId: string, orgId: string, actionType: string) {
  try {
    const { error } = await supabaseAdmin.from('admin_actions').insert({
      user_id: userId,
      action_type: actionType,
      scope_type: 'organization',
      scope_id: orgId,
    })
    if (error) console.error(`[schedule-removal] admin_actions-logging feilet (${actionType})`, orgId, error.message)
  } catch (err) {
    console.error(`[schedule-removal] admin_actions-logging kastet (${actionType})`, orgId, err)
  }
}

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(request: NextRequest, { params }: Params) {
  const { id: membershipId } = await params
  const auth = await authorize(request, membershipId)
  if ('error' in auth) return auth.error

  let body: { scheduledFor?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const check = validateScheduledRemovalDate(body.scheduledFor)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 })
  }

  const { data: updatedRows, error: updateErr } = await supabaseAdmin
    .from('organization_members')
    .update({ scheduled_removal_at: check.at })
    .eq('id', membershipId)
    .select('id')

  // Samme mønster som fjerningen: både error OG antall matchede rader sjekkes,
  // så en rad som forsvant under oss aldri gir en falsk «planlagt»-kvittering
  // til admin — det verste utfallet her er å tro at noe er planlagt når det
  // ikke er det.
  if (updateErr || !updatedRows || updatedRows.length === 0) {
    console.error(
      `[schedule-removal] kunne ikke lagre dato — membership=${membershipId} org=${auth.membership.organization_id}:`,
      updateErr?.message ?? 'matchet 0 rader',
    )
    return NextResponse.json({ error: 'Kunne ikke lagre datoen. Prøv igjen.' }, { status: 500 })
  }

  await logAction(auth.user.id, auth.membership.organization_id, 'org_member_removal_scheduled')

  console.log(
    `[schedule-removal] user=${auth.membership.user_id} planlagt fjernet ${formatRemovalDate(check.at)} ` +
    `fra org=${auth.membership.organization_id} av ${auth.user.id}`,
  )

  return NextResponse.json({ ok: true, scheduledFor: check.at })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: membershipId } = await params
  const auth = await authorize(request, membershipId)
  if ('error' in auth) return auth.error

  const { data: updatedRows, error: updateErr } = await supabaseAdmin
    .from('organization_members')
    .update({ scheduled_removal_at: null })
    .eq('id', membershipId)
    .select('id')

  if (updateErr || !updatedRows || updatedRows.length === 0) {
    console.error(
      `[schedule-removal] kunne ikke avbryte plan — membership=${membershipId} org=${auth.membership.organization_id}:`,
      updateErr?.message ?? 'matchet 0 rader',
    )
    // KRITISK å ikke svare «avbrutt» her: admin ville trodd at fjerningen er
    // stoppet, mens cronen fortsatt ville utført den på datoen.
    return NextResponse.json({ error: 'Kunne ikke avbryte planen. Prøv igjen.' }, { status: 500 })
  }

  await logAction(auth.user.id, auth.membership.organization_id, 'org_member_removal_cancelled')

  return NextResponse.json({ ok: true })
}
