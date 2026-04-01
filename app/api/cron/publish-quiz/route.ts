import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('quizzes')
    .update({ is_active: true })
    .eq('is_active', false)
    .lte('scheduled_at', now)
    .not('scheduled_at', 'is', null)
    .select('id, title')

  if (error) {
    console.error('[cron/publish-quiz] error:', error.code, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const count = data?.length ?? 0
  if (count > 0) {
    console.log('[cron/publish-quiz] published:', data?.map(q => q.title).join(', '))
  }

  return NextResponse.json({ published: count, quizzes: data })
}
