import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { resolveOrgAdminAction, removeOrgMemberById } from '@/lib/org-member-removal'

// Fjern et org-medlem NÅ.
//
// Selve fjerningen (sletting, grace-periode, e-post) og aktør-vaktene bor i
// lib/org-member-removal.ts, slik at cronen for PLANLAGT fjerning kan kalle
// nøyaktig samme kodesti i stedet for å ha sin egen kopi. Oppførselen her er
// uendret fra før uttrekket.
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `org-member-remove:${ip}`
  if (!rateLimit(rlKey, 20, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 20, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id: membershipId } = await params

  const guard = await resolveOrgAdminAction(membershipId, user.id)
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error, ...(guard.code ? { code: guard.code } : {}) }, { status: guard.status })
  }

  const result = await removeOrgMemberById(membershipId)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.reason === 'not_found' ? 404 : 500 },
    )
  }

  // Spor handlingen på orgen. Aldri blokkerende, aldri stille — samme form som
  // resten av admin_actions-bruken.
  try {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      user_id: user.id,
      action_type: 'org_member_removed',
      scope_type: 'organization',
      scope_id: guard.membership.organization_id,
    })
    if (logErr) console.error('[remove-member] admin_actions-logging feilet', guard.membership.organization_id, logErr.message)
  } catch (err) {
    console.error('[remove-member] admin_actions-logging kastet', guard.membership.organization_id, err)
  }

  return NextResponse.json({ ok: true })
}
