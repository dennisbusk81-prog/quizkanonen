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

  // Get latest quiz with attempts from members — én enkelt spørring via
  // embedded join (erstatter tidligere N+1-løkke over quizer). Henter alle
  // medlems-attempts med tilhørende quiz; nyeste quiz (etter created_at)
  // velges i JS fordi PostgREST ikke kan sortere topp-nivå på en embedded
  // kolonne. Det embeddede quiz-feltet strippes så attempt-formen forblir
  // identisk med før (rankAttempts spreder hele objektet).
  type EmbeddedQuiz = { id: string; title: string; is_active: boolean; created_at: string }
  const { data: memberAttempts } = await supabaseAdmin
    .from('attempts')
    .select('id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, user_id, completed_at, is_team, team_size, quiz:quizzes!inner(id, title, is_active, created_at)')
    .in('user_id', memberUserIds)

  let quiz: { id: string; title: string; is_active: boolean } | null = null
  let attempts: unknown[] = []

  // attempts → quizzes er many-to-one, så PostgREST returnerer quiz som ett
  // objekt på runtime selv om supabase-js typer det som array. Cast via unknown.
  const rows = (memberAttempts ?? []) as unknown as Array<Record<string, unknown> & { quiz: EmbeddedQuiz }>
  if (rows.length > 0) {
    let latest: EmbeddedQuiz | null = null
    for (const row of rows) {
      if (!latest || row.quiz.created_at > latest.created_at) latest = row.quiz
    }
    if (latest) {
      quiz = { id: latest.id, title: latest.title, is_active: latest.is_active }
      const latestId = latest.id
      attempts = rows
        .filter(row => row.quiz.id === latestId)
        .map(row => {
          const rest = { ...row }
          delete (rest as { quiz?: unknown }).quiz
          return rest
        })
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
