import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { getOptionCountsByQuestions } from '@/lib/attempt-answer-stats'
import { readStoredKey } from '@/lib/answer-key-correction'
import { selectEasiestAndHardest, type QuestionDifficulty } from '@/lib/question-difficulty'
import { getUserPremium } from '@/lib/premium-check'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export const dynamic = 'force-dynamic'

// Antall spørsmål vist på hver side (lettest/vanskeligst) til Premium-brukere.
const HIGHLIGHT_COUNT = 2

/**
 * Svarfordeling — fasit + prosent per svaralternativ.
 *
 * Krever innlogging OG Premium. Var tidligere helt åpen (kun krav om at
 * quizen var stengt) og returnerte fasiten for ALLE spørsmål til hvem som
 * helst, uten pålogging — fant under kartlegging 26. juli 2026 at dette lot
 * anonyme besøkende lese fasit og svarprosent for en hel quiz. Nå: kun
 * innloggede Premium-brukere, og kun de to letteste + to vanskeligste
 * spørsmålene (samme utvalgslogikk som admin sin «Ukens letteste/
 * vanskeligste», se lib/question-difficulty.ts) — ikke alle 15, for å holde
 * fasit-eksponeringen minimal selv for de som har tilgang.
 *
 * `Cache-Control` er fjernet (var `public, s-maxage=300` før): svaret er nå
 * avhengig av HVEM som spør (Premium-status), så en delt/CDN-cache ville
 * kunnet servere én brukers respons til en annen.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `answer-dist:${ip}`
  if (!rateLimit(rlKey, 30, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 30, windowMs: 60_000, quizId: (await params).id })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // «Vet ikke» skilles fra «ikke Premium»: en transient DB-feil skal ikke
  // presentere en betalende kunde for paywallen som om abonnementet var borte.
  // 503 er et forbigående svar klienten kan prøve på nytt; 403 er en dom.
  const premium = await getUserPremium(user.id)
  if (!premium.ok) {
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte tilgangen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }
  if (!premium.value) {
    return NextResponse.json({ error: 'Krever Premium', code: 'premium_required' }, { status: 403 })
  }

  const { id: quizId } = await params

  // Only available after quiz closes
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('closes_at, num_options, time_limit_seconds')
    .eq('id', quizId)
    .maybeSingle()

  if (!quiz) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  if (new Date(quiz.closes_at) > new Date()) {
    return NextResponse.json({ error: 'Quiz er ikke stengt ennå' }, { status: 403 })
  }

  const numOptions = quiz.num_options ?? 4

  // Fetch questions
  const { data: questions } = await supabaseAdmin
    .from('questions')
    .select('id, question_text, correct_answer, correct_answers, option_a, option_b, option_c, option_d, order_index')
    .eq('quiz_id', quizId)
    .order('order_index')

  if (!questions || questions.length === 0) {
    return NextResponse.json({ easiest: [], hardest: [] })
  }

  // Fetch answer counts per question per option
  const optionCounts = await getOptionCountsByQuestions(questions.map(q => q.id))

  const opts = ['A', 'B', 'C', 'D'].slice(0, numOptions)
  type CountMap = Record<string, number>
  const countsByQuestion = new Map<string, CountMap>()
  for (const q of questions) {
    const perQ = optionCounts.get(q.id)
    const counts = Object.fromEntries(opts.map(o => [o, perQ?.get(o) ?? 0]))
    countsByQuestion.set(q.id, counts)
  }

  // correct_pct per spørsmål — nødvendig for å velge letteste/vanskeligste.
  // Utledet direkte fra optionCounts + fasiten, ingen ekstra spørring:
  // total = sum av alle alternativer, correct = sum av alternativene som
  // ER fasiten (håndterer også multi-svar-spørsmål via readStoredKey).
  const difficultyStats: QuestionDifficulty[] = questions.map(q => {
    const counts = countsByQuestion.get(q.id) ?? {}
    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    const correctKeys = readStoredKey(q)
    const correct = correctKeys.reduce((s, k) => s + (counts[k] ?? 0), 0)
    return {
      question_id: q.id,
      order_index: q.order_index,
      question_text: q.question_text,
      total,
      correct,
      correct_pct: total > 0 ? Math.round((correct / total) * 100) : 0,
    }
  })

  const { easiest, hardest } = selectEasiestAndHardest(difficultyStats, HIGHLIGHT_COUNT)
  const questionById = new Map(questions.map(q => [q.id, q]))

  function toDistribution(stat: QuestionDifficulty) {
    const q = questionById.get(stat.question_id)!
    const counts = countsByQuestion.get(q.id) ?? {}
    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    const optionLabels: Record<string, string> = { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d }
    const distribution = opts.map(o => ({
      option: o,
      label: optionLabels[o] ?? '',
      count: counts[o] ?? 0,
      percent: total > 0 ? Math.round(((counts[o] ?? 0) / total) * 100) : 0,
    }))
    return {
      questionId: q.id,
      questionText: q.question_text,
      correctAnswers: readStoredKey(q),
      totalAnswers: total,
      correctPct: stat.correct_pct,
      distribution,
    }
  }

  return NextResponse.json({
    easiest: easiest.map(toDistribution),
    hardest: hardest.map(toDistribution),
  })
}
