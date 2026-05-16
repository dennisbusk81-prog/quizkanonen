import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const adminPassword = request.headers.get('x-admin-password')
  if (!adminPassword || adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 401 })
  }

  let body: { questionId?: string; newCorrectAnswer?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { questionId, newCorrectAnswer } = body

  if (!questionId || !newCorrectAnswer || !['A', 'B', 'C', 'D'].includes(newCorrectAnswer)) {
    return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 })
  }

  // Fetch the question
  const { data: question, error: qErr } = await supabaseAdmin
    .from('questions')
    .select('id, question_text, quiz_id')
    .eq('id', questionId)
    .single()

  if (qErr || !question) {
    return NextResponse.json({ error: 'Spørsmål ikke funnet' }, { status: 404 })
  }

  // Update correct_answer on the question
  await supabaseAdmin
    .from('questions')
    .update({ correct_answer: newCorrectAnswer })
    .eq('id', questionId)

  // Fetch all attempt_answers for this question
  const { data: answers } = await supabaseAdmin
    .from('attempt_answers')
    .select('id, attempt_id, selected_answer')
    .eq('question_id', questionId)

  if (!answers || answers.length === 0) {
    return NextResponse.json({ updated: 0, question: question.question_text })
  }

  // Update is_correct for each answer
  await Promise.all(
    answers.map(a =>
      supabaseAdmin
        .from('attempt_answers')
        .update({ is_correct: a.selected_answer === newCorrectAnswer })
        .eq('id', a.id)
    )
  )

  // Recalculate scores for all affected attempts
  const attemptIds = [...new Set(answers.map(a => a.attempt_id))]

  // Get total questions count for this quiz
  const { count: totalQuestions } = await supabaseAdmin
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('quiz_id', question.quiz_id)

  await Promise.all(
    attemptIds.map(async (attemptId) => {
      const { count: correctCount } = await supabaseAdmin
        .from('attempt_answers')
        .select('*', { count: 'exact', head: true })
        .eq('attempt_id', attemptId)
        .eq('is_correct', true)

      const total = totalQuestions ?? 1
      const correct = correctCount ?? 0
      const score = Math.round((correct / total) * 100)

      await supabaseAdmin
        .from('attempts')
        .update({ correct_answers: correct, score })
        .eq('id', attemptId)
    })
  )

  return NextResponse.json({ updated: answers.length, question: question.question_text })
}
