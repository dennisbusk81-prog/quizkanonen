import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { getOptionCountsByQuestions } from '@/lib/attempt-answer-stats'
import { readStoredKey } from '@/lib/answer-key-correction'

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
    .select('id, question_text, correct_answer, correct_answers, option_a, option_b, option_c, option_d, order_index')
    .eq('quiz_id', quizId)
    .order('order_index')

  if (!questions || questions.length === 0) {
    return NextResponse.json({ questions: [] })
  }

  // Fetch answer counts per question per option
  const optionCounts = await getOptionCountsByQuestions(questions.map(q => q.id))

  const opts = ['A', 'B', 'C', 'D'].slice(0, numOptions)
  type CountMap = Record<string, number>
  const countsByQuestion = new Map<string, CountMap>()
  for (const q of questions) {
    const perQ = optionCounts.get(q.id)
    const counts = Object.fromEntries(opts.map(o => [o, perQ?.get(o) ?? 0]))
    countsByQuestion.set(q.id, counts)
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
      // readStoredKey(): correct_answers[] vinner når den har innhold, ellers
      // faller den tilbake på correct_answer — samme mønster som scoringen i
      // submit/route.ts og fasitrettingen i admin/correct-answer/route.ts.
      correctAnswers: readStoredKey(q),
      totalAnswers: total,
      distribution,
    }
  })

  return NextResponse.json(
    { questions: result },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } }
  )
}
