import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Public — returns the id of the currently open quiz (same criteria as the
// homepage's quiz card), or null if none is open right now.
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

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
