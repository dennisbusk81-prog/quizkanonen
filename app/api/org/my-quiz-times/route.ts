import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Returns org-specific quiz open/close times for the authenticated user,
// combined with the quiz's date so the client can compare against now().
export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`my-quiz-times:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })

  const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken)
  if (!user) return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })

  const quizId = request.nextUrl.searchParams.get('quizId')
  if (!quizId) return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })

  // Get the quiz's closes_at date to use as base date for combining with org times
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('closes_at')
    .eq('id', quizId)
    .maybeSingle()

  if (!quiz) return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })

  // Find user's org membership
  const { data: memberships } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })
  }

  const orgId = memberships[0].organization_id

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, org_quiz_opens_at, org_quiz_closes_at')
    .eq('id', orgId)
    .maybeSingle()

  if (!org || (!org.org_quiz_opens_at && !org.org_quiz_closes_at)) {
    return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })
  }

  // Combine the quiz date (from closes_at) with the org times
  // We extract the date portion in UTC from quiz.closes_at
  const quizDate = quiz.closes_at.slice(0, 10) // YYYY-MM-DD

  const orgOpensAt = org.org_quiz_opens_at
    ? `${quizDate}T${org.org_quiz_opens_at}:00.000Z`
    : null

  const orgClosesAt = org.org_quiz_closes_at
    ? `${quizDate}T${org.org_quiz_closes_at}:00.000Z`
    : null

  return NextResponse.json({
    orgOpensAt,
    orgClosesAt,
    orgName: org.name,
  })
}
