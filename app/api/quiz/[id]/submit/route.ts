import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { calculateStreak } from '@/lib/ranking'

// ── Service-role scoring for ukens quiz ──────────────────────────────────────
// Klienten sender KUN rå svar (selectedAnswer + timeMs per spørsmål). Serveren
// slår opp fasiten og beregner correct_answers, correct_streak og total_time_ms
// selv — klienten kan ikke lenger sette vilkårlige score-verdier. Erstatter den
// gamle klient-UPDATE-en på attempts (app/quiz/[id]/page.tsx finishQuiz).

type IncomingAnswer = { questionId: string; selectedAnswer: string; timeMs: number }

type QuestionRow = {
  id: string
  correct_answer: string | null
  correct_answers: string[] | null
  time_limit_seconds: number | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ error: 'Mangler quiz-id' }, { status: 400 })

  let body: { attemptId?: unknown; deviceId?: unknown; answers?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const attemptId = typeof body.attemptId === 'string' ? body.attemptId : null
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : null
  if (!attemptId) return NextResponse.json({ error: 'Mangler attemptId' }, { status: 400 })
  if (!Array.isArray(body.answers)) {
    return NextResponse.json({ error: 'Mangler svar' }, { status: 400 })
  }

  const answers: IncomingAnswer[] = (body.answers as unknown[])
    .filter((a): a is IncomingAnswer =>
      !!a && typeof a === 'object' &&
      typeof (a as IncomingAnswer).questionId === 'string' &&
      typeof (a as IncomingAnswer).selectedAnswer === 'string' &&
      typeof (a as IncomingAnswer).timeMs === 'number',
    )

  // ── 1. Hent attempt-raden og verifiser eierskap ────────────────────────────
  const { data: attempt, error: attErr } = await supabaseAdmin
    .from('attempts')
    .select('id, quiz_id, user_id, correct_answers, submitted_at')
    .eq('id', attemptId)
    .maybeSingle()

  if (attErr || !attempt) {
    return NextResponse.json({ error: 'Forsøk ikke funnet' }, { status: 404 })
  }
  if (attempt.quiz_id !== quizId) {
    return NextResponse.json({ error: 'Forsøk hører ikke til denne quizen' }, { status: 403 })
  }

  // Eierskap: innlogget → token-bruker må eie raden; gjest → raden må være gjest
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (token) {
    const { data: authData } = await supabaseAdmin.auth.getUser(token)
    const userId = authData.user?.id ?? null
    if (!userId || attempt.user_id !== userId) {
      return NextResponse.json({ error: 'Ingen tilgang til dette forsøket' }, { status: 403 })
    }
  } else if (attempt.user_id !== null) {
    // Ingen token, men raden tilhører en innlogget bruker → avvis.
    return NextResponse.json({ error: 'Mangler autentisering' }, { status: 403 })
  }

  // Dobbel-scoring-vern: allerede scoret?
  if (attempt.submitted_at !== null || (attempt.correct_answers ?? 0) > 0) {
    return NextResponse.json({ error: 'Forsøket er allerede levert' }, { status: 403 })
  }

  // ── 2. Hent quiz + spørsmål (fasit) ─────────────────────────────────────────
  const [{ data: quiz }, { data: questionRows }] = await Promise.all([
    supabaseAdmin.from('quizzes').select('time_limit_seconds').eq('id', quizId).maybeSingle(),
    supabaseAdmin
      .from('questions')
      .select('id, correct_answer, correct_answers, time_limit_seconds')
      .eq('quiz_id', quizId),
  ])

  const quizTimeLimit = quiz?.time_limit_seconds ?? 30
  const qMap = new Map<string, QuestionRow>(
    ((questionRows ?? []) as QuestionRow[]).map(q => [q.id, q]),
  )

  // ── 3+4. Beregn is_correct, score, streak og clampet tid — server-side ──────
  type Scored = { questionId: string; selectedAnswer: string; isCorrect: boolean; timeMs: number }
  const scored: Scored[] = []
  for (const a of answers) {
    const q = qMap.get(a.questionId)
    if (!q) continue // ukjent spørsmål — telles ikke

    const isCorrect = q.correct_answers && q.correct_answers.length > 0
      ? q.correct_answers.includes(a.selectedAnswer)
      : a.selectedAnswer === q.correct_answer

    // Clamp tid til [0, time_limit*1000] — hindrer urealistisk lave/negative tider
    const limitMs = (q.time_limit_seconds ?? quizTimeLimit) * 1000
    const safeTime = Number.isFinite(a.timeMs) ? a.timeMs : limitMs
    const clampedMs = Math.min(Math.max(safeTime, 0), limitMs)

    scored.push({ questionId: a.questionId, selectedAnswer: a.selectedAnswer, isCorrect, timeMs: clampedMs })
  }

  const correctAnswers = scored.filter(s => s.isCorrect).length
  const correctStreak = calculateStreak(scored.map(s => ({ is_correct: s.isCorrect })))
  const totalTimeMs = scored.reduce((sum, s) => sum + s.timeMs, 0)

  // ── 5. Skriv: attempts-UPDATE, attempt_answers-INSERT, played_log ───────────
  const { error: updErr } = await supabaseAdmin
    .from('attempts')
    .update({
      correct_answers: correctAnswers,
      total_time_ms: totalTimeMs,
      correct_streak: correctStreak,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', attemptId)
    .is('submitted_at', null) // siste forsvar mot race: kun hvis ikke alt levert

  if (updErr) {
    return NextResponse.json({ error: 'Kunne ikke lagre resultatet' }, { status: 500 })
  }

  let answersWarning = false
  if (scored.length > 0) {
    const { error: ansErr } = await supabaseAdmin.from('attempt_answers').insert(
      scored.map(s => ({
        attempt_id: attemptId,
        question_id: s.questionId,
        selected_answer: s.selectedAnswer,
        is_correct: s.isCorrect,
        time_ms: s.timeMs,
      })),
    )
    if (ansErr) {
      console.error('[submit] attempt_answers insert feilet:', ansErr.message)
      answersWarning = true
    }
  }

  if (deviceId) {
    const { error: logErr } = await supabaseAdmin
      .from('played_log')
      .insert({ quiz_id: quizId, identifier: deviceId })
    // KJENT SVAKHET: hvis denne feiler kan brukeren spille quizen på nytt
    // (played_log brukes som deviceId-sjekk i quiz-siden). Score er lagret.
    if (logErr) console.error('[submit] played_log insert feilet:', logErr.message)
  }

  // ── 6. Returner server-beregnet score til resultatskjermen ──────────────────
  return NextResponse.json({ correctAnswers, totalTimeMs, correctStreak, answersWarning })
}
