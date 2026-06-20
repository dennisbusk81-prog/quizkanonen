import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

// POST /api/org/[slug]/league-preference
// Body: { opt_out: boolean }
// Lar en bruker sette sitt EGET global_league_opt_out for en org de er medlem av.
// Krever kun medlemskap — ikke admin. Org-policyen (allow_global_league) er
// fortsatt taket: et fravalg (true) blokkerer global synlighet, men et tilvalg
// (false) gir ikke global synlighet hvis org har allow_global_league=false.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`league-pref:${ip}`, 20, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  let body: { opt_out?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }
  if (typeof body.opt_out !== 'boolean') {
    return NextResponse.json({ error: 'opt_out må være boolean' }, { status: 400 })
  }

  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  // Verifiser at brukeren faktisk er medlem av organisasjonen
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  const { error: updateErr } = await supabaseAdmin
    .from('organization_members')
    .update({ global_league_opt_out: body.opt_out })
    .eq('organization_id', org.id)
    .eq('user_id', user.id)

  if (updateErr) {
    return NextResponse.json({ error: 'Kunne ikke lagre valget' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, opt_out: body.opt_out })
}
