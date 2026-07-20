import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: quizzes },
    { count: attempts },
    { count: codes },
    { count: players },
    { count: active30d },
    { data: premiumRows },
  ] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('attempts').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('access_codes').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).gte('last_seen_at', thirtyDaysAgo),
    supabaseAdmin.from('profiles').select('premium_source').eq('premium_status', true),
  ])

  // Nedbrutt på premium_source i stedet for kun ett totaltall, slik at
  // "94 Premium-brukere" kan leses som f.eks. Founders-trial vs. betalende.
  const premiumBySource: Record<string, number> = {}
  for (const row of premiumRows ?? []) {
    const key = row.premium_source ?? 'ukjent'
    premiumBySource[key] = (premiumBySource[key] ?? 0) + 1
  }

  return NextResponse.json({
    quizzes: quizzes ?? 0,
    attempts: attempts ?? 0,
    codes: codes ?? 0,
    players: players ?? 0,
    active30d: active30d ?? 0,
    premium: premiumRows?.length ?? 0,
    premiumBySource,
  })
}
