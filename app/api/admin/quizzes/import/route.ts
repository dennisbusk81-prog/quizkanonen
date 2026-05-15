import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

type ImportQuestion = {
  question_text: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
  time_limit_seconds: number | null
  shuffle_options: boolean
  category: string | null
}

export async function POST(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { title, questions }: { title: string; questions: ImportQuestion[] } = body

  if (!title || !questions?.length) {
    return NextResponse.json({ error: 'Mangler tittel eller spørsmål.' }, { status: 400 })
  }

  const now = new Date()
  const opens = new Date(now.getTime() + 60 * 60 * 1000)   // +1 time
  const closes = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // +7 dager

  const { data: quiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .insert({
      title,
      description: '',
      opens_at: opens.toISOString(),
      closes_at: closes.toISOString(),
      time_limit_seconds: 20,
      num_options: 4,
      is_active: false,
      show_leaderboard: true,
      hide_leaderboard_until_closed: true,
      show_live_placement: true,
      show_answer_explanation: true,
      randomize_questions: false,
      allow_teams: true,
      requires_access_code: false,
    })
    .select()
    .single()

  if (quizError) return NextResponse.json({ error: quizError.message }, { status: 500 })

  const rows = questions.map((q, i) => {
    let timeSec: number | null = null
    if (q.time_limit_seconds !== null) {
      timeSec = Math.min(60, Math.max(5, q.time_limit_seconds))
    }
    return {
      quiz_id: quiz.id,
      question_text: q.question_text,
      option_a: q.option_a,   // riktig svar er alltid option_a (kolonne B i Excel)
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_answer: 'A',    // kolonne B i Excel er alltid riktig
      time_limit_seconds: timeSec,
      shuffle_options: q.shuffle_options,
      category: q.category || null,
      order_index: i + 1,
    }
  })

  const { error: qError } = await supabaseAdmin.from('questions').insert(rows)
  if (qError) {
    await supabaseAdmin.from('quizzes').delete().eq('id', quiz.id)
    return NextResponse.json({ error: qError.message }, { status: 500 })
  }

  return NextResponse.json({ quizId: quiz.id })
}
