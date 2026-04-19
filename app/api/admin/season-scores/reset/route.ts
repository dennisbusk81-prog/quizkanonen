import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

// POST /api/admin/season-scores/reset
// Body: { scope: 'all' | 'test' }
// Beskyttet med admin-passord.
export async function POST(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { scope?: string }
  try { body = await request.json() } catch { body = {} }
  const scope = body.scope === 'test' ? 'test' : 'all'

  if (scope === 'all') {
    const { error: delErr } = await supabaseAdmin
      .from('season_scores')
      .delete()
      .in('scope_type', ['global', 'league', 'organization'])

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    const { error: upErr } = await supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: false })
      .not('id', 'is', null)

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  } else {
    // Slett kun for quizer med "test" i tittelen
    const { data: testQuizzes } = await supabaseAdmin
      .from('quizzes')
      .select('id')
      .ilike('title', '%test%')

    if (testQuizzes && testQuizzes.length > 0) {
      const ids = testQuizzes.map((q: { id: string }) => q.id)

      const { error: delErr } = await supabaseAdmin
        .from('season_scores')
        .delete()
        .in('quiz_id', ids)

      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

      await supabaseAdmin
        .from('quizzes')
        .update({ season_points_awarded: false })
        .in('id', ids)
    }
  }

  // Logg handlingen (ignorer feil hvis tabellen ikke finnes ennå)
  try {
    await supabaseAdmin.from('admin_actions').insert({
      action_type: `season_reset_${scope}`,
      scope_type: 'global',
      scope_id: null,
    })
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, scope })
}
