import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const quizId = searchParams.get('quizId')

  if (!quizId) {
    return NextResponse.json([], {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  }

  const { data: attempts } = await supabaseAdmin
    .from('attempts')
    .select('correct_answers, total_questions')
    .eq('quiz_id', quizId)

  if (!attempts || attempts.length === 0) {
    return NextResponse.json([], {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  }

  const scores = attempts
    .map(a => (a.total_questions > 0 ? a.correct_answers : null))
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b)

  const total = scores.length

  // For each unique score, compute percentile = % of players scoring strictly below
  const uniqueScores = [...new Set(scores)]
  const result = uniqueScores.map(score => {
    const below = scores.filter(s => s < score).length
    const percentile = Math.round((below / total) * 100)
    return { score, percentile }
  })

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
