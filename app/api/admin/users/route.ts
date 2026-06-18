import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

export async function GET(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. All profiles, newest first
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, nickname, premium_status, created_at, suspended_until')
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

  // 3. Attempt counts per user (single query, aggregate in JS)
  const { data: attempts } = await supabaseAdmin
    .from('attempts')
    .select('user_id')
    .not('user_id', 'is', null)

  const attemptCountMap = new Map<string, number>()
  for (const a of attempts ?? []) {
    if (a.user_id) {
      attemptCountMap.set(a.user_id, (attemptCountMap.get(a.user_id) ?? 0) + 1)
    }
  }

  // 4. Build auth map keyed by user id
  const authMap = new Map(authUsers.map(u => [u.id, u]))

  // 5. Merge
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
      quiz_count: attemptCountMap.get(p.id) ?? 0,
      is_premium: p.premium_status === true,
      suspended_until: p.suspended_until ?? null,
    }
  })

  return NextResponse.json({ users })
}
