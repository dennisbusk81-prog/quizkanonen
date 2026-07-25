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
    .select('question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, category, time_limit_seconds, shuffle_options, usage_count')
    .eq('id', question_id)
    .single()

  if (srcErr || !src) return NextResponse.json({ error: 'Spørsmål ikke funnet' }, { status: 404 })

  const { count } = await supabaseAdmin
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('quiz_id', target_quiz_id)

  const now = new Date().toISOString()
  const { usage_count: srcUsageCount, ...srcFields } = src

  // Gjenbruk oppretter en HELT NY rad (ingen slektskap/FK til kilden) — så
  // usage_count telles på to steder: kilden får +1 (den er nå gjenbrukt igjen),
  // og den nye raden starter på 1 (dens egen første bruk, i målquizen).
  const [{ error: insErr }, { error: srcUpdateErr }] = await Promise.all([
    supabaseAdmin.from('questions').insert({
      ...srcFields,
      quiz_id: target_quiz_id,
      order_index: (count ?? 0) + 1,
      is_classic: false,
      usage_count: 1,
      last_used_at: now,
    }),
    supabaseAdmin.from('questions').update({
      usage_count: (srcUsageCount ?? 0) + 1,
      last_used_at: now,
    }).eq('id', question_id),
  ])

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  if (srcUpdateErr) return NextResponse.json({ error: srcUpdateErr.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
