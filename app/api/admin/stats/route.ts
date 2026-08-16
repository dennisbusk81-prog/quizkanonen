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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: quizzes },
    { count: attempts },
    { count: codes },
    { count: players },
    { count: active30d },
    premiumRows,
  ] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('attempts').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('access_codes').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).gte('last_seen_at', thirtyDaysAgo),
    // Trenger nedbrytning per premium_source (ikke bare et totaltall), derfor
    // paginert full henting — dette er nærmeste tingen appen har til et
    // inntekts-proxy-tall Dennis følger, og skal aldri stille flate ut ved
    // 1000 rader mens betalende base faktisk vokser.
    fetchAllRows<{ premium_source: string | null }>((from, to) =>
      supabaseAdmin
        .from('profiles')
        .select('premium_source')
        .eq('premium_status', true)
        .range(from, to)
    ),
  ])

  // Nedbrutt på premium_source i stedet for kun ett totaltall, slik at
  // "94 Premium-brukere" kan leses som f.eks. Founders-trial vs. betalende.
  const premiumBySource: Record<string, number> = {}
  for (const row of premiumRows) {
    const key = row.premium_source ?? 'ukjent'
    premiumBySource[key] = (premiumBySource[key] ?? 0) + 1
  }

  return NextResponse.json({
    quizzes: quizzes ?? 0,
    attempts: attempts ?? 0,
    codes: codes ?? 0,
    players: players ?? 0,
    active30d: active30d ?? 0,
    premium: premiumRows.length,
    premiumBySource,
  })
}
