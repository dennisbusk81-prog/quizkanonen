import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { fetchAllRows } from '@/lib/paginate'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. All profiles, newest first
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, nickname, premium_status, premium_source, created_at, last_seen_at, suspended_until')
    .order('created_at', { ascending: false })

  if (profilesError) {
    console.error('profiles fetch failed:', profilesError)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // 2. Auth users (service role — gets email + metadata).
  // Paginate through all users in case there are more than 1000.
  type AuthUser = Awaited<ReturnType<typeof supabaseAdmin.auth.admin.listUsers>>['data']['users'][number]
  const authUsers: AuthUser[] = []
  let listPage = 1
  while (true) {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({
      page: listPage,
      perPage: 1000,
    })
    if (authError) { console.error('auth.admin.listUsers failed:', authError); break }
    const batch = authData?.users ?? []
    authUsers.push(...batch)
    if (batch.length < 1000) break
    listPage++
  }

  // 3. Attempt counts per user — paginert full henting (samme mønster som
  // auth.admin.listUsers()-løkken over: én enkelt .select() her kutter
  // stille ved 1000 rader uten feilmelding). Feiler "myk" som listUsers over
  // — attempt_count er en tilleggsstatistikk, ikke kritisk for siden.
  let attempts: { user_id: string }[] = []
  try {
    attempts = await fetchAllRows<{ user_id: string }>((from, to) =>
      supabaseAdmin
        .from('attempts')
        .select('user_id')
        .not('user_id', 'is', null)
        .range(from, to)
    )
  } catch (e) {
    console.error('attempts fetch failed:', e)
  }

  const attemptCountMap = new Map<string, number>()
  for (const a of attempts) {
    if (a.user_id) {
      attemptCountMap.set(a.user_id, (attemptCountMap.get(a.user_id) ?? 0) + 1)
    }
  }

  // 4. Org-medlemskap — kun HVILKE user_id-er som er medlem noe sted, for
  // "Tilhørighet"-filteret på /admin/users. Paginert av samme grunn som
  // attempts over.
  let orgMembers: { user_id: string }[] = []
  try {
    orgMembers = await fetchAllRows<{ user_id: string }>((from, to) =>
      supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .range(from, to)
    )
  } catch (e) {
    console.error('organization_members fetch failed:', e)
  }
  const orgMemberIds = new Set(orgMembers.map(m => m.user_id))

  // 5. Build auth map keyed by user id
  const authMap = new Map(authUsers.map(u => [u.id, u]))

  // 6. Merge
  const users = (profiles ?? []).map(p => {
    const au = authMap.get(p.id)
    const meta = au?.user_metadata ?? {}
    return {
      id: p.id,
      display_name: p.display_name ?? null,
      nickname: (p as { nickname?: string | null }).nickname ?? null,
      email: au?.email ?? null,
      google_name: (meta.full_name ?? meta.name ?? null) as string | null,
      created_at: p.created_at ?? null,
      last_seen_at: p.last_seen_at ?? null,
      quiz_count: attemptCountMap.get(p.id) ?? 0,
      is_premium: p.premium_status === true,
      premium_source: p.premium_source ?? null,
      suspended_until: p.suspended_until ?? null,
      has_org_membership: orgMemberIds.has(p.id),
    }
  })

  return NextResponse.json({ users })
}
