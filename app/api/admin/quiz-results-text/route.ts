import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

function formatTime(ms: number): string {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${(s % 60).toString().padStart(2, '0')}` : `${s}s`
}

type AttemptRow = {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_time_ms: number
}

export async function POST(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { quizId?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const quizId = typeof body.quizId === 'string' ? body.quizId : null
  if (!quizId) return NextResponse.json({ error: 'quizId mangler' }, { status: 400 })

  // 1. Quiz info
  const { data: quizRaw } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .eq('id', quizId)
    .single()

  if (!quizRaw) return NextResponse.json({ error: 'Quiz ikke funnet' }, { status: 404 })
  const quiz = quizRaw as { id: string; title: string; closes_at: string | null }

  // 2. Total count (non-team attempts)
  const { count: totalCount } = await supabaseAdmin
    .from('attempts')
    .select('*', { count: 'exact', head: true })
    .eq('quiz_id', quizId)
    .eq('is_team', false)

  const total = totalCount ?? 0

  // 3. Top 10 players (sorted by correct DESC, time ASC)
  const { data: top10Raw } = await supabaseAdmin
    .from('attempts')
    .select('id, user_id, player_name, correct_answers, total_time_ms')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .order('correct_answers', { ascending: false })
    .order('total_time_ms', { ascending: true })
    .limit(10)

  const top10Attempts = (top10Raw ?? []) as AttemptRow[]

  // 4. Midpoint person
  let midAttempt: AttemptRow | null = null
  let midRank = 0
  if (total >= 3) {
    const midIdx = Math.floor(total / 2)
    midRank = midIdx + 1
    const { data: midRaw } = await supabaseAdmin
      .from('attempts')
      .select('id, user_id, player_name, correct_answers, total_time_ms')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .order('correct_answers', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .range(midIdx, midIdx)
    midAttempt = ((midRaw ?? []) as AttemptRow[])[0] ?? null
  }

  // Resolve display names via profiles (separate query — no direct FK in PostgREST)
  const allAttempts = midAttempt
    ? [...top10Attempts, midAttempt]
    : top10Attempts
  const userIds = [...new Set(allAttempts.map(a => a.user_id).filter((id): id is string => !!id))]

  const profileMap = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profileRows } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .in('id', userIds)
    for (const p of (profileRows ?? []) as { id: string; display_name: string | null }[]) {
      if (p.display_name) profileMap.set(p.id, p.display_name)
    }
  }

  const nameOf = (a: AttemptRow) =>
    (a.user_id && profileMap.get(a.user_id)) ?? a.player_name ?? '?'

  // 5. Easiest / hardest questions (via attempt_answers aggregation)
  const { data: attemptIdRows } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('is_team', false)

  const attemptIds = ((attemptIdRows ?? []) as { id: string }[]).map(a => a.id)

  let easiestText: string | null = null
  let easiestPct: number | null = null
  let hardestText: string | null = null
  let hardestPct: number | null = null

  if (attemptIds.length >= 2) {
    const { data: answers } = await supabaseAdmin
      .from('attempt_answers')
      .select('question_id, is_correct')
      .in('attempt_id', attemptIds)

    if (answers && answers.length > 0) {
      const statsMap = new Map<string, { total: number; correct: number }>()
      for (const a of answers as { question_id: string; is_correct: boolean }[]) {
        const s = statsMap.get(a.question_id) ?? { total: 0, correct: 0 }
        s.total++
        if (a.is_correct) s.correct++
        statsMap.set(a.question_id, s)
      }

      const qualified = [...statsMap.entries()]
        .filter(([, s]) => s.total >= 2)
        .map(([qId, s]) => ({ questionId: qId, pct: Math.round((s.correct / s.total) * 100) }))
        .sort((a, b) => b.pct - a.pct)

      if (qualified.length >= 1) {
        const { data: questionRows } = await supabaseAdmin
          .from('questions')
          .select('id, question_text')
          .in('id', qualified.map(q => q.questionId))

        const textMap = new Map(
          ((questionRows ?? []) as { id: string; question_text: string }[]).map(q => [q.id, q.question_text])
        )
        const withText = qualified
          .map(q => ({ text: textMap.get(q.questionId) ?? '', pct: q.pct }))
          .filter(q => q.text)

        if (withText.length >= 1) { easiestText = withText[0].text; easiestPct = withText[0].pct }
        if (withText.length >= 2) {
          easiestText = withText[0].text; easiestPct = withText[0].pct
          hardestText = withText[withText.length - 1].text; hardestPct = withText[withText.length - 1].pct
        }
      }
    }
  }

  // Format closing date
  const closedDate = quiz.closes_at ? new Date(quiz.closes_at) : new Date()
  const dateStr = closedDate.toLocaleDateString('nb-NO', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Oslo',
  })

  // Build text
  const medals = ['🥇', '🥈', '🥉']
  const lines: string[] = []

  lines.push(`Resultat ${quiz.title} ${dateStr}`)
  lines.push('')
  lines.push(`${total} deltakere var med i dag!`)
  lines.push('')

  if (easiestText !== null && easiestPct !== null) {
    lines.push(`Ukens letteste: "${easiestText}" — ${easiestPct}% visste det.`)
  }
  if (hardestText !== null && hardestPct !== null) {
    lines.push(`Ukens vanskeligste: "${hardestText}" — kun ${hardestPct}% fikk det til.`)
  }
  if (easiestText !== null || hardestText !== null) {
    lines.push('')
  }

  top10Attempts.forEach((a, i) => {
    const prefix = i < 3 ? medals[i] : `${i + 1}.`
    lines.push(`${prefix} ${nameOf(a)} — ${a.correct_answers} riktige · ${formatTime(a.total_time_ms)}`)
  })

  if (midAttempt) {
    lines.push('')
    lines.push(
      `Midt på treet: ${nameOf(midAttempt)} på ${midRank}. plass - ${midAttempt.correct_answers} riktige · ${formatTime(midAttempt.total_time_ms)}`
    )
  }

  lines.push('')
  lines.push('Gratulerer! Ha en fantastisk helg! 🎉')

  return NextResponse.json({ text: lines.join('\n') })
}
