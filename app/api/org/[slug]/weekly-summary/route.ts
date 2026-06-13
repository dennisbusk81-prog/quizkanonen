import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { computeWeeklySummary, buildWeeklyShareText } from '@/lib/weekly-report'

export const dynamic = 'force-dynamic'

// GET /api/org/[slug]/weekly-summary — ukens oppsummering for admin-panelet.
// Krever org-admin. Returnerer kun denne orgens egne data.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-weekly-summary:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, plan')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })
  }

  const summary = await computeWeeklySummary(org.id)
  if (!summary) {
    return NextResponse.json({ summary: null, shareText: null })
  }

  return NextResponse.json({ summary, shareText: buildWeeklyShareText(summary) })
}
