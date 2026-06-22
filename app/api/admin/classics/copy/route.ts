import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { question_id, target_quiz_id } = body
  if (!question_id || !target_quiz_id) {
    return NextResponse.json({ error: 'Mangler question_id eller target_quiz_id' }, { status: 400 })
  }

  const { data: src, error: srcErr } = await supabaseAdmin
    .from('questions')
    .select('question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, category, time_limit_seconds, shuffle_options')
    .eq('id', question_id)
    .single()

  if (srcErr || !src) return NextResponse.json({ error: 'Spørsmål ikke funnet' }, { status: 404 })

  const { count } = await supabaseAdmin
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('quiz_id', target_quiz_id)

  const { error: insErr } = await supabaseAdmin
    .from('questions')
    .insert({
      ...src,
      quiz_id: target_quiz_id,
      order_index: (count ?? 0) + 1,
      is_classic: false,
    })

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
