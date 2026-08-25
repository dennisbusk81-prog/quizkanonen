import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrBuildSnapshot } from '@/lib/ranking-snapshot'
import { getQuestionStatsByAttempts } from '@/lib/attempt-answer-stats'
import { selectEasiestAndHardest } from '@/lib/question-difficulty'
import { fetchAllRowsChunked } from '@/lib/paginate'

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

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

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
    snapshot = await getOrBuildSnapshot(quizId)
  } catch (err) {
    console.error('[admin/results] snapshot feilet:', err)
    return NextResponse.json({ error: 'Kunne ikke bygge resultatliste' }, { status: 500 })
  }

  const total = snapshot.length

  // Slå opp ferske display_name + nickname for de innloggede spillerne, slik at
  // admin ser hvem som er hvem (snapshoten bærer player_name fra spilletidspunktet).
  // CHUNKET, ikke fordi grensen er nær, men fordi bruddet er STILLE.
  // Hele id-lista havner i URL-ens query-streng, og den målte grensen ligger
  // rundt 390 id-er (se lib/paginate.ts). Høyeste målte deltakertall på én quiz
  // er 67, så det er lang vei dit — men feiler oppslaget, faller HVER spiller
  // tilbake på player_name fra spilletidspunktet, og det er en verdi som ser
  // helt riktig ut. Admin ville ikke kunne skille et brudd fra normal drift.
  //
  // Derfor LOGGES feilen nå, i stedet for å bli forkastet med en forkastet destrukturering.
  // Den skal derimot ikke bli en 500: resultatlista er hele poenget med sida,
  // og gamle navn er uendelig mye bedre enn ingen liste. Samme avveining som i
  // /api/admin/questions — degrader visningen, men etterlat et spor.
  const userIds = [...new Set(snapshot.map(e => e.user_id).filter((u): u is string => !!u))]
  const nameByUser = new Map<string, string>()
  const nickByUser = new Map<string, string | null>()
  if (userIds.length > 0) {
    let profiles: { id: string; display_name: string | null; nickname: string | null }[] = []
    try {
      profiles = await fetchAllRowsChunked<{ id: string; display_name: string | null; nickname: string | null }>(
        userIds,
        (chunk, from, to) =>
          supabaseAdmin
            .from('profiles')
            .select('id, display_name, nickname')
            .in('id', chunk)
            .order('id', { ascending: true })
            .range(from, to)
      )
    } catch (e) {
      console.error('[admin/results] profil-oppslag feilet — viser navn fra spilletidspunktet:', e instanceof Error ? e.message : e)
    }
    for (const p of profiles) {
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
    const agg = await getQuestionStatsByAttempts(attemptIds)

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

    // Letteste/vanskeligste — delt logikk med leaderboard/[id] sin Premium-
    // svarfordeling (lib/question-difficulty.ts). count=1 her er bit-for-bit
    // identisk med den forrige inline-versjonen (verifisert i
    // lib/question-difficulty.test.ts) — samme terskel (≥2 svar) som «ukens
    // fakta»-logikken (quiz-insights).
    const picked = selectEasiestAndHardest(questionStats, 1)
    easiest = picked.easiest[0] ?? null
    hardest = picked.hardest[0] ?? null
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
