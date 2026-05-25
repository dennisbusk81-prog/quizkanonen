import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id: orgId } = await params

  // Verify admin
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen admin-tilgang' }, { status: 403 })
  }

  // Get org member IDs
  const { data: orgMembers } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)

  const memberIds = ((orgMembers ?? []) as { user_id: string }[]).map(m => m.user_id)
  if (memberIds.length === 0) {
    return NextResponse.json({ error: 'Ingen medlemmer' }, { status: 404 })
  }

  // Most recent closed quiz that actually has attempt_answers
  const { data: closedQuiz } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, attempts!inner(id, attempt_answers!inner(id))')
    .lt('closes_at', new Date().toISOString())
    .not('closes_at', 'is', null)
    .order('closes_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!closedQuiz) {
    return NextResponse.json({ error: 'Ingen stengt quiz' }, { status: 404 })
  }

  const cq = closedQuiz as { id: string; title: string }

  // Attempt IDs for org members on this quiz (is_team = false)
  const { data: quizAttempts } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('quiz_id', cq.id)
    .in('user_id', memberIds)
    .eq('is_team', false)

  const attemptIds = ((quizAttempts ?? []) as { id: string }[]).map(a => a.id)
  if (attemptIds.length < 2) {
    return NextResponse.json({ error: 'For lite data' }, { status: 404 })
  }

  // All answers for those attempts
  const { data: answers } = await supabaseAdmin
    .from('attempt_answers')
    .select('question_id, is_correct')
    .in('attempt_id', attemptIds)

  if (!answers || answers.length === 0) {
    return NextResponse.json({ error: 'Ingen svar' }, { status: 404 })
  }

  // Aggregate per question
  const statsMap = new Map<string, { total: number; correct: number }>()
  for (const a of answers as { question_id: string; is_correct: boolean }[]) {
    const s = statsMap.get(a.question_id) ?? { total: 0, correct: 0 }
    s.total++
    if (a.is_correct) s.correct++
    statsMap.set(a.question_id, s)
  }

  // Filter questions with >= 2 answers, sort by correctPct desc
  const qualified = [...statsMap.entries()]
    .filter(([, s]) => s.total >= 2)
    .map(([qId, s]) => ({ questionId: qId, correctPct: Math.round((s.correct / s.total) * 100) }))
    .sort((a, b) => b.correctPct - a.correctPct)

  if (qualified.length < 2) {
    return NextResponse.json({ error: 'For lite data' }, { status: 404 })
  }

  // Fetch question texts
  const { data: questions } = await supabaseAdmin
    .from('questions')
    .select('id, question_text')
    .in('id', qualified.map(q => q.questionId))

  const textMap = new Map(
    ((questions ?? []) as { id: string; question_text: string }[]).map(q => [q.id, q.question_text])
  )

  const withText = qualified
    .map(q => ({ questionText: textMap.get(q.questionId) ?? '', correctPct: q.correctPct }))
    .filter(q => q.questionText)

  if (withText.length < 2) {
    return NextResponse.json({ error: 'Mangler spørsmålstekster' }, { status: 404 })
  }

  // Easiest = highest correctPct; Hardest = lowest 3
  const easiest = withText[0]
  const hardest = withText.slice(-Math.min(3, withText.length)).reverse()

  return NextResponse.json({
    quizTitle: cq.title,
    easiest: { questionText: easiest.questionText, correctPct: easiest.correctPct },
    hardest: hardest.map(q => ({ questionText: q.questionText, correctPct: q.correctPct })),
  })
}
