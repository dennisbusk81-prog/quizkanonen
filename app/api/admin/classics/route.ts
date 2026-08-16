import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('questions')
    .select('id, question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, category, quiz_id')
    .eq('is_classic', true)
    .order('question_text', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolve quiz titles
  const quizIds = [...new Set((data ?? []).map(q => q.quiz_id))]
  const { data: quizData } = await supabaseAdmin
    .from('quizzes')
    .select('id, title')
    .in('id', quizIds)

  const quizTitleMap = Object.fromEntries((quizData ?? []).map(q => [q.id, q.title]))

  const questions = (data ?? []).map(q => ({
    ...q,
    quiz_title: quizTitleMap[q.quiz_id] ?? null,
  }))

  return NextResponse.json({ questions })
}
