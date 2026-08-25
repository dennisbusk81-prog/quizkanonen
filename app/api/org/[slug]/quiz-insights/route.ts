import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getQuestionStatsByAttempts } from '@/lib/attempt-answer-stats'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'

type Params = { params: Promise<{ slug: string }> }

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest, { params }: Params) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // orgId er UUID her, ikke en slug — kun param-namn er endret for Next.js routing-konsistens
  const { slug: orgId } = await params

  // Verify admin
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen admin-tilgang' }, { status: 403 })
  }

  // Låst org: spørsmålsanalysen er en del av det betalte bedriftspanelet.
  const lock = await requireUnlockedOrg({ id: orgId })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  // Get org member IDs
  const { data: orgMembers } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)

  const memberIds = ((orgMembers ?? []) as { user_id: string }[]).map(m => m.user_id)
  if (memberIds.length === 0) {
    return NextResponse.json({ error: 'Ingen medlemmer' }, { status: 404 })
  }

  // Most recent closed quiz that actually has attempt_answers.
  // Embedden er kun et eksistensfilter — limit(1) på begge nivåene gjør den
  // til et rent EXISTS-oppslag i stedet for en json_agg over hele undertreet
  // (samme mønster som toppliste-ruten og quiz-scores i samme mappe).
  // is_active filtreres BEVISST IKKE — «Skjul» i admin skal ikke fjerne
  // resultater folk allerede har spilt (samme presedens som
  // award-season-points).
  //
  // `.eq('is_test', false)` er ERSTATTET av onlyRealQuizzes, ikke supplert. Det
  // gamle filteret dekket halve gulvet og hadde to hull: det matcher ikke
  // `is_test IS NULL` (kolonnen er nullable), og det sier ingenting om
  // `quiz_type`. Et arkivforsøk (`quiz_type='archive'`, `is_test=false`) ville
  // altså stengt ferskest, vunnet `order('closes_at', desc)` og fylt
  // bedriftspanelets innsikt med arkivdata — stille, siden svaret ser helt
  // normalt ut. Se lib/real-quiz-population.ts.
  //
  // Spørringen står i en LOKAL VARIABEL: inlinet som argument til
  // onlyRealQuizzes() ga `next build` TS2589 «Type instantiation is
  // excessively deep». Ikke inline den tilbake.
  const closedQuizQuery = supabaseAdmin
    .from('quizzes')
    .select('id, title, attempts!inner(id, attempt_answers!inner(id))')
    .lt('closes_at', new Date().toISOString())
    .not('closes_at', 'is', null)
    .order('closes_at', { ascending: false })
    .limit(1, { referencedTable: 'attempts' })
    .limit(1, { referencedTable: 'attempts.attempt_answers' })
    .limit(1)

  // Helperen MÅ stå før `.maybeSingle()`.
  const { data: closedQuiz } = await onlyRealQuizzes(closedQuizQuery).maybeSingle()

  if (!closedQuiz) {
    return NextResponse.json({ error: 'Ingen stengt quiz' }, { status: 404 })
  }

  const cq = closedQuiz as { id: string; title: string }

  // Attempt IDs for org members on this quiz (is_team = false)
  const { data: quizAttempts } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('quiz_id', cq.id)
    .in('user_id', memberIds)
    .eq('is_team', false)

  const attemptIds = ((quizAttempts ?? []) as { id: string }[]).map(a => a.id)
  if (attemptIds.length < 2) {
    return NextResponse.json({ error: 'For lite data' }, { status: 404 })
  }

  // Aggregated stats for those attempts
  const statsMap = await getQuestionStatsByAttempts(attemptIds)

  if (statsMap.size === 0) {
    return NextResponse.json({ error: 'Ingen svar' }, { status: 404 })
  }

  // Filter questions with >= 2 answers, sort by correctPct desc
  const qualified = [...statsMap.entries()]
    .filter(([, s]) => s.total >= 2)
    .map(([qId, s]) => ({ questionId: qId, correctPct: Math.round((s.correct / s.total) * 100) }))
    .sort((a, b) => b.correctPct - a.correctPct)

  if (qualified.length < 2) {
    return NextResponse.json({ error: 'For lite data' }, { status: 404 })
  }

  // Fetch question texts
  const { data: questions } = await supabaseAdmin
    .from('questions')
    .select('id, question_text')
    .in('id', qualified.map(q => q.questionId))

  const textMap = new Map(
    ((questions ?? []) as { id: string; question_text: string }[]).map(q => [q.id, q.question_text])
  )

  const withText = qualified
    .map(q => ({ questionText: textMap.get(q.questionId) ?? '', correctPct: q.correctPct }))
    .filter(q => q.questionText)

  if (withText.length < 2) {
    return NextResponse.json({ error: 'Mangler spørsmålstekster' }, { status: 404 })
  }

  // Easiest = highest correctPct; Hardest = lowest 3
  const easiest = withText[0]
  const hardest = withText.slice(-Math.min(3, withText.length)).reverse()

  return NextResponse.json({
    quizTitle: cq.title,
    easiest: { questionText: easiest.questionText, correctPct: easiest.correctPct },
    hardest: hardest.map(q => ({ questionText: q.questionText, correctPct: q.correctPct })),
  })
}
