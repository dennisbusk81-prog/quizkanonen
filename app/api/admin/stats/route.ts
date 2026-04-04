import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

export async function GET(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: quizzes },
    { count: attempts },
    { count: codes },
    { count: players },
    { count: active30d },
    { count: premium },
  ] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('attempts').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('access_codes').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).gte('last_seen_at', thirtyDaysAgo),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('premium_status', true),
  ])

  return NextResponse.json({
    quizzes: quizzes ?? 0,
    attempts: attempts ?? 0,
    codes: codes ?? 0,
    players: players ?? 0,
    active30d: active30d ?? 0,
    premium: premium ?? 0,
  })
}
