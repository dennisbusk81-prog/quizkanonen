import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankAttempts } from '@/lib/ranking'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  const { data: members } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)

  const memberUserIds = (members ?? []).map(m => m.user_id).filter(Boolean)
  if (memberUserIds.length === 0) return NextResponse.json({ placement: null })

  const { data: quizzes } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, created_at')
    .order('created_at', { ascending: false })
    .limit(10)

  for (const q of (quizzes ?? [])) {
    const { data: qAttempts } = await supabaseAdmin
      .from('attempts')
      .select('id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, user_id, completed_at, is_team, team_size')
      .eq('quiz_id', q.id)
      .in('user_id', memberUserIds)

    if (!qAttempts || qAttempts.length === 0) continue

    const ranked = rankAttempts(qAttempts as Parameters<typeof rankAttempts>[0])
    const mine = ranked.filter(a => (a as unknown as { user_id: string }).user_id === user.id)
    const myBest = mine.length > 0 ? mine.reduce((best, a) => a.rank < best.rank ? a : best) : null

    // rank: number → brukeren spilte og fikk denne plasseringen
    // rank: null   → quiz har aktivitet fra andre, men brukeren spilte ikke
    return NextResponse.json({
      placement: {
        rank: myBest ? myBest.rank : null,
        total: ranked.length,
        quizTitle: q.title as string,
      },
    })
  }

  return NextResponse.json({ placement: null })
}
