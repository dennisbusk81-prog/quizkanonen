import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { processQuiz } from '@/lib/award-season-points'

const BATCH_SIZE = 10

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  // Finn ubehandlede quizer som har stengt
  const { data: quizzes, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .order('closes_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (quizError) {
    console.error('[award-season-points] Klarte ikke hente quizer:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 500 })
  }

  if (!quizzes || quizzes.length === 0) {
    return NextResponse.json({ processed: 0, totalRows: 0, quizzes: [] })
  }

  const results: Array<{ quizId: string; title: string; rows: number; error: string | null }> = []
  let totalRows = 0

  for (const quiz of quizzes as { id: string; title: string; closes_at: string }[]) {
    console.log(`[award-season-points] Behandler: "${quiz.title}" (${quiz.id})`)
    const { rows, error } = await processQuiz(quiz.id, quiz.closes_at)
    totalRows += rows
    results.push({ quizId: quiz.id, title: quiz.title, rows, error })
    if (error) {
      console.error(`[award-season-points] Feil på "${quiz.title}":`, error)
    } else {
      console.log(`[award-season-points] Ferdig: "${quiz.title}" — ${rows} rader totalt`)
    }
  }

  return NextResponse.json({ processed: results.length, totalRows, quizzes: results })
}
