import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'
import { calculateStreak } from '@/lib/ranking'

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
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

  // Fetch all attempt_answers for this question — paginert full henting.
  // Bundet til antall forsøk på quizen (ett svar per forsøk per spørsmål),
  // men uten eksplisitt grense kutter PostgREST stille ved 1000 rader —
  // ville latt noen spilleres poeng stå urettet uten varsel.
  const answers = await fetchAllRows<{ id: string; attempt_id: string; selected_answer: string | null }>((from, to) =>
    supabaseAdmin
      .from('attempt_answers')
      .select('id, attempt_id, selected_answer')
      .eq('question_id', questionId)
      .range(from, to)
  )

  if (answers.length === 0) {
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

  // Spørsmålene i quizen, i spillerekkefølge. correct_streak må beregnes over
  // hele rekken i order_index-rekkefølge — ikke over radene slik de tilfeldigvis
  // ligger i attempt_answers. (attempts.question_order er NULL for alle rader i
  // prod, så order_index ER den faktiske rekkefølgen spilleren så spørsmålene i.)
  const quizQuestions = await fetchAllRows<{ id: string; order_index: number }>((from, to) =>
    supabaseAdmin
      .from('questions')
      .select('id, order_index')
      .eq('quiz_id', question.quiz_id)
      .order('order_index', { ascending: true })
      .range(from, to)
  )

  // Alle svarrader for de berørte forsøkene, hentet i ÉN paginert spørring i
  // stedet for én COUNT-spørring per forsøk (den gamle løsningen gjorde N kall).
  const allRows = await fetchAllRows<{ attempt_id: string; question_id: string; is_correct: boolean }>((from, to) =>
    supabaseAdmin
      .from('attempt_answers')
      .select('attempt_id, question_id, is_correct')
      .in('attempt_id', attemptIds)
      .range(from, to)
  )
  const rowsByAttempt = new Map<string, Array<{ question_id: string; is_correct: boolean }>>()
  for (const r of allRows) {
    const list = rowsByAttempt.get(r.attempt_id) ?? []
    list.push({ question_id: r.question_id, is_correct: r.is_correct })
    rowsByAttempt.set(r.attempt_id, list)
  }

  await Promise.all(
    attemptIds.map(async (attemptId) => {
      const rows = rowsByAttempt.get(attemptId) ?? []

      // correct_answers telles over RÅ rader, nøyaktig som den tidligere
      // COUNT-spørringen gjorde. Bevisst uendret her: noen få forsøk har
      // duplikate svarrader, og å bytte til distinkt telling ville endret
      // lagrede poengsummer — og dermed plasseringer — som en utilsiktet
      // bieffekt av en fasitretting. Duplikatene håndteres som egen sak.
      const correct = rows.filter(r => r.is_correct).length

      // correct_streak ble tidligere ALDRI oppdatert her, så en fasitretting
      // etterlot en utdatert streak-verdi på hvert berørte forsøk.
      const gradeByQuestion = new Map(rows.map(r => [r.question_id, r.is_correct]))
      const correctStreak = calculateStreak(
        quizQuestions.map(q => ({ is_correct: gradeByQuestion.get(q.id) === true }))
      )

      // MERK: attempts har ingen 'score'-kolonne — har aldri hatt (bekreftet
      // i migrasjonen 20260401000002: "correct_answers is the score column").
      // Update-kallet skrev tidligere ["correct_answers", "score", ...] i ett
      // og samme kall; siden Postgres avviser en UPDATE med en ukjent kolonne
      // i sin helhet (PGRST204), feilet HELE denne skrivingen stille hver
      // eneste gang — verken correct_answers eller correct_streak ble noen
      // gang faktisk lagret av denne ruten.
      await supabaseAdmin
        .from('attempts')
        .update({ correct_answers: correct, correct_streak: correctStreak })
        .eq('id', attemptId)
    })
  )

  return NextResponse.json({ updated: answers.length, question: question.question_text })
}
