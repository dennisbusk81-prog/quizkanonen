import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`answer-dist:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const { id: quizId } = await params

  // Only available after quiz closes
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('closes_at, num_options, time_limit_seconds')
    .eq('id', quizId)
    .maybeSingle()

  if (!quiz) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  if (new Date(quiz.closes_at) > new Date()) {
    return NextResponse.json({ error: 'Quiz er ikke stengt ennå' }, { status: 403 })
  }

  const numOptions = quiz.num_options ?? 4

  // Fetch questions
  const { data: questions } = await supabaseAdmin
    .from('questions')
    .select('id, question_text, correct_answer, option_a, option_b, option_c, option_d, order_index')
    .eq('quiz_id', quizId)
    .order('order_index')

  if (!questions || questions.length === 0) {
    return NextResponse.json({ questions: [] })
  }

  // Fetch all answers for this quiz
  const { data: answers } = await supabaseAdmin
    .from('attempt_answers')
    .select('question_id, selected_answer')
    .in('question_id', questions.map(q => q.id))

  // Count answers per question per option
  const opts = ['A', 'B', 'C', 'D'].slice(0, numOptions)
  type CountMap = Record<string, number>
  const countsByQuestion = new Map<string, CountMap>()
  for (const q of questions) {
    countsByQuestion.set(q.id, Object.fromEntries(opts.map(o => [o, 0])))
  }

  for (const a of (answers ?? []) as { question_id: string; selected_answer: string | null }[]) {
    const counts = countsByQuestion.get(a.question_id)
    if (counts && a.selected_answer && counts[a.selected_answer] !== undefined) {
      counts[a.selected_answer]++
    }
  }

  const result = questions.map(q => {
    const counts = countsByQuestion.get(q.id) ?? {}
    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    const optionLabels: Record<string, string> = { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d }
    const distribution = opts.map(o => ({
      option: o,
      label: optionLabels[o] ?? '',
      count: counts[o] ?? 0,
      percent: total > 0 ? Math.round(((counts[o] ?? 0) / total) * 100) : 0,
    }))
    return {
      questionId: q.id,
      questionText: q.question_text,
      correctAnswer: q.correct_answer,
      totalAnswers: total,
      distribution,
    }
  })

  return NextResponse.json(
    { questions: result },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } }
  )
}
