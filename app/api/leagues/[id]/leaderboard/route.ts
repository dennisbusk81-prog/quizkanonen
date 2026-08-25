import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { fetchAllRowsChunked } from '@/lib/paginate'
import { onlyRealQuizAttempts, REAL_QUIZ_ATTEMPT_EMBED } from '@/lib/real-quiz-population'

type Params = { params: Promise<{ id: string }> }

// GET /api/leagues/[id]/leaderboard
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `league-leaderboard:${ip}`
  if (!rateLimit(rlKey, 30, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 30, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id } = await params

  // Hent liga
  const { data: league } = await supabaseAdmin
    .from('leagues')
    .select('id, name, reset_at')
    .eq('id', id)
    .maybeSingle()

  if (!league) return NextResponse.json({ error: 'Fant ikke ligaen.' }, { status: 404 })

  // Sjekk at brukeren er medlem
  const { data: membership } = await supabaseAdmin
    .from('league_members')
    .select('user_id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Du er ikke medlem av denne ligaen.' }, { status: 403 })
  }

  // Hent alle medlemmer
  const { data: members, error: membersError } = await supabaseAdmin
    .from('league_members')
    .select('user_id')
    .eq('league_id', id)

  if (membersError || !members) {
    return NextResponse.json({ error: 'Kunne ikke hente medlemmer.' }, { status: 500 })
  }

  const memberIds = members.map((m) => m.user_id)

  // Hent display_names — samme medlemsliste som attempts-oppslaget under, og
  // dermed samme URL-tak på .in() (~390 id-er). Én rad per medlem, så det er
  // listelengden — ikke radtallet — som biter her. Feil ble ignorert før
  // (alle ble «Ukjent»); .catch beholder den degraderingen.
  const profiles = await fetchAllRowsChunked<{ id: string; display_name: string | null }>(
    memberIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from('profiles')
        .select('id, display_name')
        .in('id', chunk)
        .order('id')
        .range(from, to)
  ).catch((): { id: string; display_name: string | null }[] => [])

  const profileMap = new Map(profiles.map((p) => [p.id, p.display_name ?? 'Ukjent']))

  // Hent attempts for alle medlemmer (respekter reset_at) — paginert via
  // fetchAllRowsChunked: .in()-listen over medlemmer treffer URL-taket ved
  // ~390 id-er, og radene ville ellers kuttes stille ved 1000 (PostgREST
  // db-max-rows; det gamle .limit(5000) gjorde ingenting). Nedstrøms er
  // rekkefølgeuavhengig — «siste quiz» finnes via maks completed_at i løkken
  // under, ikke via radrekkefølgen — så .order('id') er kun der for at
  // pagineringsvinduene skal være stabile radsett.
  type MemberAttempt = {
    id: string
    quiz_id: string
    user_id: string
    correct_answers: number
    total_questions: number
    total_time_ms: number
    completed_at: string
  }
  let allAttempts: MemberAttempt[]
  try {
    allAttempts = await fetchAllRowsChunked<MemberAttempt>(memberIds, (chunk, from, to) => {
      // Populasjonen: kun forsøk på EKTE quizer. Uten dette blir en testquiz
      // «siste quiz» i ligaen — den er stengt og fersk, og vinner dermed maks
      // completed_at i løkken under — den teller i all-time-snittet, og den blir
      // en egen quiz-id i beste_plassering-løkken. Se lib/real-quiz-population.ts.
      let q = supabaseAdmin
        .from('attempts')
        .select(`id, quiz_id, user_id, correct_answers, total_questions, total_time_ms, completed_at, ${REAL_QUIZ_ATTEMPT_EMBED}`)
        .in('user_id', chunk)
        .eq('is_team', false)
      q = onlyRealQuizAttempts(q)
      if (league.reset_at) {
        q = q.gte('completed_at', league.reset_at)
      }
      return q.order('id').range(from, to)
    })
  } catch {
    // Samme 500 som attemptsError ga før — en feil skal ikke se ut som en
    // tom liga. Aldri et DELVIS felt: feiler en senere side, forkastes alt.
    return NextResponse.json({ error: 'Kunne ikke hente resultater.' }, { status: 500 })
  }

  // ── Siste quiz ────────────────────────────────────────────────────────────────
  // Finn quizen med nyeste completed_at blant alle forsøk
  let latestQuizId: string | null = null
  let latestDate = ''
  for (const a of allAttempts) {
    if (a.completed_at > latestDate) {
      latestDate = a.completed_at
      latestQuizId = a.quiz_id
    }
  }

  let sisteQuiz: {
    quiz_id: string
    quiz_title: string | null
    results: {
      rank: number
      user_id: string
      display_name: string
      correct_answers: number
      total_questions: number
      total_time_ms: number
    }[]
  } | null = null

  if (latestQuizId) {
    const quizAttempts = allAttempts.filter((a) => a.quiz_id === latestQuizId)

    const sorted = [...quizAttempts].sort((a, b) => {
      if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
      return a.total_time_ms - b.total_time_ms
    })

    // Hent quiz-tittel
    const { data: quizRow } = await supabaseAdmin
      .from('quizzes')
      .select('title')
      .eq('id', latestQuizId)
      .maybeSingle()

    sisteQuiz = {
      quiz_id: latestQuizId,
      quiz_title: quizRow?.title ?? null,
      results: sorted.map((a, i) => ({
        rank: i + 1,
        user_id: a.user_id,
        display_name: profileMap.get(a.user_id) ?? 'Ukjent',
        correct_answers: a.correct_answers,
        total_questions: a.total_questions,
        total_time_ms: a.total_time_ms,
      })),
    }
  }

  // ── All time ──────────────────────────────────────────────────────────────────
  type UserAgg = {
    correct: number
    total: number
    quizIds: Set<string>
  }

  const userAgg = new Map<string, UserAgg>()
  for (const uid of memberIds) {
    userAgg.set(uid, { correct: 0, total: 0, quizIds: new Set() })
  }

  for (const a of allAttempts) {
    const agg = userAgg.get(a.user_id)
    if (!agg) continue
    agg.correct += a.correct_answers
    agg.total += a.total_questions
    agg.quizIds.add(a.quiz_id)
  }

  // Beregn beste plassering i ligaen: for hver quiz, ranger medlemmene, finn minste rang per bruker
  const quizIds = [...new Set(allAttempts.map((a) => a.quiz_id))]
  const memberBestRank = new Map<string, number>()

  for (const qid of quizIds) {
    const qAttempts = allAttempts.filter((a) => a.quiz_id === qid)
    const sorted = [...qAttempts].sort((a, b) => {
      if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
      return a.total_time_ms - b.total_time_ms
    })
    sorted.forEach((a, i) => {
      const rank = i + 1
      const prev = memberBestRank.get(a.user_id)
      if (prev === undefined || rank < prev) memberBestRank.set(a.user_id, rank)
    })
  }

  const allTime = memberIds
    .map((uid) => {
      const agg = userAgg.get(uid)!
      return {
        user_id: uid,
        display_name: profileMap.get(uid) ?? 'Ukjent',
        quiz_count: agg.quizIds.size,
        total_correct: agg.correct,
        total_questions: agg.total,
        avg_score_pct: agg.total > 0 ? Math.round((agg.correct / agg.total) * 100) : 0,
        beste_plassering: memberBestRank.get(uid) ?? null,
      }
    })
    .sort((a, b) => {
      if (b.avg_score_pct !== a.avg_score_pct) return b.avg_score_pct - a.avg_score_pct
      if (b.quiz_count !== a.quiz_count) return b.quiz_count - a.quiz_count
      return b.total_correct - a.total_correct
    })
    .map((u, i) => ({ ...u, rank: u.quiz_count > 0 ? i + 1 : null }))

  return NextResponse.json({ siste_quiz: sisteQuiz, all_time: allTime })
}
