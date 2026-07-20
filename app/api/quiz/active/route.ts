import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Public — returns the id of the currently open quiz (same criteria as the
// homepage's quiz card), or null if none is open right now.
export async function GET() {
  const nowIso = new Date().toISOString()

  const { data } = await supabaseAdmin
    .from('quizzes')
    .select('id')
    .eq('is_test', false)
    .lte('opens_at', nowIso)
    .or(`closes_at.is.null,closes_at.gte.${nowIso}`)
    .order('opens_at', { ascending: false })
    .limit(1)

  const activeQuiz = (data ?? [])[0] ?? null
  return NextResponse.json({ id: activeQuiz?.id ?? null })
}
