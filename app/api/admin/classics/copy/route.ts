import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { question_id, target_quiz_id } = body
  if (!question_id || !target_quiz_id) {
    return NextResponse.json({ error: 'Mangler question_id eller target_quiz_id' }, { status: 400 })
  }

  const { data: src, error: srcErr } = await supabaseAdmin
    .from('questions')
    .select('question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, category, time_limit_seconds, shuffle_options, usage_count')
    .eq('id', question_id)
    .single()

  if (srcErr || !src) return NextResponse.json({ error: 'Spørsmål ikke funnet' }, { status: 404 })

  const now = new Date().toISOString()
  const { usage_count: srcUsageCount, ...srcFields } = src

  // order_index beregnes fra en fersk COUNT — ikke atomisk. To samtidige kall
  // mot SAMME quiz kan begge lese samme telling FØR noen av innsettingene har
  // committet, og dermed forsøke å bruke identisk order_index. UI-en (de tre
  // admin-sidene som kaller denne ruten) har nå en synkron sperre som hindrer
  // dette fra samme nettleser-fane, men to faner/enheter kan fortsatt kollidere.
  // Reforsøker derfor ÉN gang med en fersk telling hvis innsettingen feiler på
  // UNIQUE(quiz_id, order_index) (23505) — se migrasjonen for den constraint-en.
  async function insertWithFreshOrderIndex() {
    const { count } = await supabaseAdmin
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('quiz_id', target_quiz_id)

    return supabaseAdmin.from('questions').insert({
      ...srcFields,
      quiz_id: target_quiz_id,
      order_index: (count ?? 0) + 1,
      is_classic: false,
      usage_count: 1,
      last_used_at: now,
    })
  }

  let { error: insErr } = await insertWithFreshOrderIndex()
  if (insErr?.code === '23505') {
    ({ error: insErr } = await insertWithFreshOrderIndex())
  }
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  const { error: srcUpdateErr } = await supabaseAdmin.from('questions').update({
    usage_count: (srcUsageCount ?? 0) + 1,
    last_used_at: now,
  }).eq('id', question_id)

  if (srcUpdateErr) return NextResponse.json({ error: srcUpdateErr.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
