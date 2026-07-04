import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrBuildSnapshot } from '@/lib/ranking-snapshot'

// ── Admin resultatoversikt ────────────────────────────────────────────────────
// Samler alt Dennis trenger etter en fredagsquiz på ÉN plass: full rangert liste,
// spilleren i midten (sosialt bevis), og spørsmålsstatistikk.
//
// ARKITEKTUR: Rangeringen kommer fra getOrBuildSnapshot (lib/ranking-snapshot) —
// nøyaktig samme kilde som /api/quiz/[id]/standings. Ingen frittstående
// SELECT+sortering her (i motsetning til quiz-results-text/analytics, som hver
// har sin egen sortering). Da kan denne siden aldri vise en annen rekkefølge enn
// resultatskjermen spillerne selv ser.

type PlayerRow = {
  rank: number
  attemptId: string
  user_id: string | null
  name: string
  nickname: string | null
  correct_answers: number
  total_time_ms: number
}

type QuestionStat = {
  question_id: string
  order_index: number
  question_text: string
  total: number
  correct: number
  correct_pct: number
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: quizId } = await params

  const { data: quiz, error: quizErr } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, closes_at, is_active')
    .eq('id', quizId)
    .maybeSingle()

  if (quizErr) return NextResponse.json({ error: quizErr.message }, { status: 500 })
  if (!quiz) return NextResponse.json({ error: 'Quiz ikke funnet' }, { status: 404 })

  const now = Date.now()
  const opensAt = quiz.opens_at ? new Date(quiz.opens_at).getTime() : null
  const closesAt = quiz.closes_at ? new Date(quiz.closes_at).getTime() : null
  const isOpen = quiz.is_active === true
    && (opensAt === null || now >= opensAt)
    && (closesAt === null || now <= closesAt)

  // ── Rangert liste fra den delte snapshot-kilden ─────────────────────────────
  let snapshot
  try {
    snapshot = await getOrBuildSnapshot(quizId, 0)
  } catch (err) {
    console.error('[admin/results] snapshot feilet:', err)
    return NextResponse.json({ error: 'Kunne ikke bygge resultatliste' }, { status: 500 })
  }

  const total = snapshot.length

  // Slå opp ferske display_name + nickname for de innloggede spillerne, slik at
  // admin ser hvem som er hvem (snapshoten bærer player_name fra spilletidspunktet).
  const userIds = [...new Set(snapshot.map(e => e.user_id).filter((u): u is string => !!u))]
  const nameByUser = new Map<string, string>()
  const nickByUser = new Map<string, string | null>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, nickname')
      .in('id', userIds)
    for (const p of (profiles ?? []) as { id: string; display_name: string | null; nickname: string | null }[]) {
      if (p.display_name) nameByUser.set(p.id, p.display_name)
      nickByUser.set(p.id, p.nickname ?? null)
    }
  }

  const players: PlayerRow[] = snapshot.map(e => ({
    rank: e.rank,
    attemptId: e.id,
    user_id: e.user_id,
    name: (e.user_id && nameByUser.get(e.user_id)) || e.player_name || '?',
    nickname: e.user_id ? (nickByUser.get(e.user_id) ?? null) : null,
    correct_answers: e.correct_answers,
    total_time_ms: e.total_time_ms,
  }))

  // ── Spilleren i midten (median-plassering) + naboene ────────────────────────
  // Samme definisjon som «midt på treet» i quiz-results-text: floor(total/2).
  // Naboene hentes med rene indekser i DEN SAMME rangerte lista (players) — ingen
  // ny beregning. `?? null` gjør at kantcaser (median helt i topp/bunn) aldri gir
  // tomme rader eller krasj; UI viser kun de som faktisk finnes.
  const midIdx = Math.floor(total / 2)
  const median = total >= 3 ? (players[midIdx] ?? null) : null
  const medianAbove = median ? (players[midIdx - 1] ?? null) : null
  const medianBelow = median ? (players[midIdx + 1] ?? null) : null

  // ── Spørsmålsstatistikk (andel riktige per spørsmål) ────────────────────────
  // Aggregert over attempt_answers for NØYAKTIG de forsøkene som er med i den
  // rangerte lista (ett per spiller — samme populasjon som rangeringen), så
  // tallene henger sammen med lista over.
  const { data: questions } = await supabaseAdmin
    .from('questions')
    .select('id, question_text, order_index')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true })

  const questionStats: QuestionStat[] = []
  let easiest: QuestionStat | null = null
  let hardest: QuestionStat | null = null

  const attemptIds = snapshot.map(e => e.id)
  if (attemptIds.length > 0 && questions && questions.length > 0) {
    const { data: answers } = await supabaseAdmin
      .from('attempt_answers')
      .select('question_id, is_correct')
      .in('attempt_id', attemptIds)

    const agg = new Map<string, { total: number; correct: number }>()
    for (const a of (answers ?? []) as { question_id: string; is_correct: boolean }[]) {
      const s = agg.get(a.question_id) ?? { total: 0, correct: 0 }
      s.total++
      if (a.is_correct) s.correct++
      agg.set(a.question_id, s)
    }

    for (const q of questions as { id: string; question_text: string; order_index: number }[]) {
      const s = agg.get(q.id) ?? { total: 0, correct: 0 }
      questionStats.push({
        question_id: q.id,
        order_index: q.order_index,
        question_text: q.question_text,
        total: s.total,
        correct: s.correct,
        correct_pct: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
      })
    }

    // Letteste/vanskeligste — kun blant spørsmål med nok svar (>= 2), samme
    // terskel som «ukens fakta»-logikken (quiz-insights).
    const qualified = questionStats.filter(s => s.total >= 2)
    if (qualified.length >= 1) {
      const sorted = [...qualified].sort((a, b) => b.correct_pct - a.correct_pct)
      easiest = sorted[0]
      if (sorted.length >= 2) hardest = sorted[sorted.length - 1]
    }
  }

  return NextResponse.json({
    quiz: { id: quiz.id, title: quiz.title, opens_at: quiz.opens_at, closes_at: quiz.closes_at },
    isOpen,
    total,
    players,
    median,
    medianAbove,
    medianBelow,
    questionStats,
    easiest,
    hardest,
  })
}
