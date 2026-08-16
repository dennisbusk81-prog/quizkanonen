import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Replay-sjekk via service_role ────────────────────────────────────────────
// Klienten kan ikke lenger lese egne uferdige attempts eller user_id direkte
// (RLS rad-policy + kolonne-lås fra 20260616190001_attempts_hide_user_id.sql).
// Denne ruten gjenoppretter mount-tidens replay-sperre på server-siden:
//   - played=true        → bruker har et INNSENDT forsøk (allerede spilt)
//   - unfinishedAttemptId → et påbegynt, ikke-innsendt forsøk finnes (kan fortsette)
// Ingen fasit eller andres user_id lekkes — kun status for den autentiserte brukeren.

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ played: false })

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ played: false })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ played: false })

  // Innsendt forsøk? → allerede spilt
  const { data: submitted } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('user_id', user.id)
    .not('submitted_at', 'is', null)
    .limit(1)
    .maybeSingle()

  if (submitted) {
    return NextResponse.json({ played: true, attemptId: submitted.id })
  }

  // Uferdig (påbegynt, ikke innsendt) forsøk? → kan fortsette
  const { data: unfinished } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('user_id', user.id)
    .is('submitted_at', null)
    .order('completed_at', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ played: false, unfinishedAttemptId: unfinished?.id ?? null })
}
