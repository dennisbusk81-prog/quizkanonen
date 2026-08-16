import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/admin/season-scores/reset
// Body: { scope: 'all' | 'test' }
// Beskyttet med admin-passord.
// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

      // Samme feilsjekk som den globale grenen over: feiler denne stille,
      // står flagget igjen som true og poeng-cronen hopper over re-tildeling
      // etter nullstillingen.
      const { error: upErr } = await supabaseAdmin
        .from('quizzes')
        .update({ season_points_awarded: false })
        .in('id', ids)

      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    }
  }

  // Logg handlingen (ignorer feil hvis tabellen ikke finnes ennå)
  try {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      action_type: `season_reset_${scope}`,
      scope_type: 'global',
      scope_id: null,
    })
    if (logErr) console.error('[season-scores/reset] admin_actions-logging feilet', scope, logErr)
  } catch (err) {
    console.error('[season-scores/reset] admin_actions-logging kastet', scope, err)
  }

  return NextResponse.json({ ok: true, scope })
}
