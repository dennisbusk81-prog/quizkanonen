import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

export async function GET(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [{ count: quizzes }, { count: attempts }, { count: codes }] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('attempts').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('access_codes').select('*', { count: 'exact', head: true }),
  ])
  return NextResponse.json({ quizzes: quizzes ?? 0, attempts: attempts ?? 0, codes: codes ?? 0 })
}
