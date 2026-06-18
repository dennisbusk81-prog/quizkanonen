import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

type AttemptRaw = {
  id: string
  user_id: string | null
  player_name: string | null
  correct_answers: number
  total_questions: number
  total_time_ms: number
  completed_at: string
  is_team: boolean
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const [
    { data: quiz, error: e1 },
    { data: questions, error: e2 },
    { data: attempts, error: e3 },
  ] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*').eq('id', id).single(),
    supabaseAdmin.from('questions').select('*').eq('quiz_id', id).order('order_index'),
    supabaseAdmin.from('attempts').select('*').eq('quiz_id', id),
  ])
  const err = e1 ?? e2 ?? e3
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  // Kallenavn for alle innloggede spillere i quizen (admin ser hvem som er hvem)
  const allUserIds = [...new Set(((attempts ?? []) as AttemptRaw[]).map(a => a.user_id).filter((uid): uid is string => !!uid))]
  const nickByUser = new Map<string, string | null>()
  if (allUserIds.length > 0) {
    const { data: nickRows } = await supabaseAdmin
      .from('profiles')
      .select('id, nickname')
      .in('id', allUserIds)
    for (const p of (nickRows ?? []) as { id: string; nickname: string | null }[]) {
      nickByUser.set(p.id, p.nickname ?? null)
    }
  }

  let answers: unknown[] = []
  const ids = (attempts ?? []).map((a: { id: string }) => a.id)
  if (ids.length > 0) {
    const { data: answerData, error: e4 } = await supabaseAdmin
      .from('attempt_answers')
      .select('question_id, is_correct, selected_answer, time_ms, attempt_id')
      .in('attempt_id', ids)
    if (e4) return NextResponse.json({ error: e4.message }, { status: 500 })
    const attemptPlayerMap: Record<string, string> = {}
    const attemptNickMap: Record<string, string | null> = {}
    for (const a of (attempts ?? [])) {
      const row = a as { id: string; player_name: string; user_id: string | null }
      attemptPlayerMap[row.id] = row.player_name || ''
      attemptNickMap[row.id] = row.user_id ? (nickByUser.get(row.user_id) ?? null) : null
    }
    answers = (answerData ?? []).map((a: { question_id: string; is_correct: boolean; selected_answer: string | null; time_ms: number; attempt_id: string }) => ({
      question_id: a.question_id,
      is_correct: a.is_correct,
      selected_answer: a.selected_answer,
      time_ms: a.time_ms,
      player_name: attemptPlayerMap[a.attempt_id] || '',
      nickname: attemptNickMap[a.attempt_id] ?? null,
    }))
  }

  // Top 10 with emails (solo only, sorted best first)
  const soloAttempts = ((attempts ?? []) as AttemptRaw[]).filter(a => !a.is_team)
  const top10 = [...soloAttempts]
    .sort((a, b) => b.correct_answers - a.correct_answers || a.total_time_ms - b.total_time_ms)
    .slice(0, 50)

  // Resolve display names from profiles
  const top10UserIds = [...new Set(top10.map(a => a.user_id).filter((uid): uid is string => !!uid))]
  const profileMap = new Map<string, string>()
  if (top10UserIds.length > 0) {
    const { data: profileRows } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .in('id', top10UserIds)
    for (const p of (profileRows ?? []) as { id: string; display_name: string | null }[]) {
      if (p.display_name) profileMap.set(p.id, p.display_name)
    }
  }

  // Resolve emails via auth.admin API (service role only)
  const emailMap = new Map<string, string>()
  if (top10UserIds.length > 0) {
    const results = await Promise.all(top10UserIds.map(uid => supabaseAdmin.auth.admin.getUserById(uid)))
    for (const { data } of results) {
      if (data?.user?.email) emailMap.set(data.user.id, data.user.email)
    }
  }

  const topPlayers = top10.map((a, i) => ({
    rank: i + 1,
    attempt_id: a.id,
    name: (a.user_id && profileMap.get(a.user_id)) ?? a.player_name ?? '?',
    nickname: a.user_id ? (nickByUser.get(a.user_id) ?? null) : null,
    email: a.user_id ? (emailMap.get(a.user_id) ?? null) : null,
    correct_answers: a.correct_answers,
    total_questions: a.total_questions,
    total_time_ms: a.total_time_ms,
    user_id: a.user_id,
  }))

  return NextResponse.json({ quiz, questions: questions ?? [], attempts: attempts ?? [], answers, topPlayers })
}
