import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/org/my-orgs
// Returnerer alle organisasjoner brukeren er medlem av (uavhengig av rolle).
export async function GET() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Route handlers kan ikke sette cookies
        },
      },
    }
  )

  const { data: { user }, error: authErr } = await supabase.auth.getUser()

  if (authErr || !user) {
    console.log('[my-orgs] ingen bruker i cookie-session:', authErr?.message)
    return NextResponse.json({ orgs: [] })
  }

  console.log('[my-orgs] bruker id:', user.id)

  const { data: memberships, error: memErr } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)

  if (memErr) {
    console.error('[my-orgs] memberships feil:', memErr)
    return NextResponse.json({ orgs: [] })
  }

  console.log('[my-orgs] memberships:', memberships)

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ orgs: [] })
  }

  const orgIds = memberships.map(m => m.organization_id).filter(Boolean)

  const { data: orgs, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .in('id', orgIds)

  if (orgErr) {
    console.error('[my-orgs] orgs feil:', orgErr)
    return NextResponse.json({ orgs: [] })
  }

  console.log('[my-orgs] orgs funnet:', orgs)

  const roleByOrg = new Map(memberships.map(m => [m.organization_id, m.role]))

  const result = (orgs ?? []).map(o => ({
    orgId:   o.id,
    orgName: o.name,
    orgSlug: o.slug,
    isAdmin: roleByOrg.get(o.id) === 'admin',
  }))

  console.log('[my-orgs] returnerer:', result)
  return NextResponse.json({ orgs: result })
}
