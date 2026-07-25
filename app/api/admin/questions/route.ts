import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

// Hele spørsmålsbanken — ALLE spørsmål noensinne lagret i en quiz, ikke kun
// dem merket is_classic (det er /api/admin/classics, som filtrerer på det
// flagget og forblir urørt/ubrukt av denne siden). Filtrering på "kun
// klassikere" gjøres client-side i /admin/sporsmal ved å lese is_classic her.
export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('questions')
    .select('id, question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, category, quiz_id, is_classic, usage_count, last_used_at, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
