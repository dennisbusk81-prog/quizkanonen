import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { rankAttempts } from '@/lib/ranking'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-dashboard:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  // Get org
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  // Verify membership
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  // Get all member user_ids
  const { data: members } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)

  const memberUserIds = (members ?? []).map(m => m.user_id).filter(Boolean)
  if (memberUserIds.length === 0) {
    return NextResponse.json({ org: { name: org.name, plan: org.plan }, quiz: null, attempts: [], userRole: membership.role })
  }

  // Del 2 (Disk IO) — to-trinns i stedet for å hente ALLE medlems-attempts på
  // tvers av hele historikken (10 kolonner) bare for å finne siste quiz:
  //   1. Distinkte quiz-id-er medlemmene har spilt — indeks-only scan via
  //      (user_id, quiz_id)-indeksen (smal kolonne, ingen heap-lesing).
  //   2. Nyeste quiz etter created_at (samme kriterium som før).
  //   3. Hent KUN den quizens medlems-attempts (målrettet via quiz_id-indeks).
  // Output er identisk med før — kun mindre data leses.
  const { data: memberQuizRows } = await supabaseAdmin
    .from('attempts')
    .select('quiz_id')
    .in('user_id', memberUserIds)

  const playedQuizIds = [...new Set((memberQuizRows ?? []).map(r => r.quiz_id as string).filter(Boolean))]

  let quiz: { id: string; title: string; is_active: boolean } | null = null
  let attempts: unknown[] = []

  if (playedQuizIds.length > 0) {
    const { data: latest } = await supabaseAdmin
      .from('quizzes')
      .select('id, title, is_active, created_at')
      .in('id', playedQuizIds)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latest) {
      quiz = { id: latest.id, title: latest.title, is_active: latest.is_active }
      // Samme kolonner og samme populasjon (ingen is_team-filter) som før, kun
      // begrenset til siste quiz — så rankAttempts gir identisk resultat.
      const { data: latestAttempts } = await supabaseAdmin
        .from('attempts')
        .select('id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, user_id, completed_at, is_team, team_size')
        .eq('quiz_id', latest.id)
        .in('user_id', memberUserIds)
      attempts = latestAttempts ?? []
    }
  }

  const ranked = attempts.length > 0 ? rankAttempts(attempts as Parameters<typeof rankAttempts>[0]) : []

  return NextResponse.json({
    org: { name: org.name, plan: org.plan },
    quiz,
    attempts: ranked,
    userRole: membership.role,
    currentUserId: user.id,
  })
}
