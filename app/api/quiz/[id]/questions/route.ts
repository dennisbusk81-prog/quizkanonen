import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Spørsmål ett om gangen — skjuler fasiten fra klienten ────────────────────
// Tidligere gjorde klienten select('*') på questions og fikk HELE fasiten i
// nettverksfanen før spilleren svarte. Nå leveres ett spørsmål av gangen via
// denne ruten (supabaseAdmin), der hvert spørsmål kun bærer SIN egen fasit.
// Klienten kan dermed aldri pre-laste svarene på fremtidige spørsmål.
//
// correct_answer/correct_answers sendes fortsatt med — men kun for spørsmålet
// spilleren er på akkurat nå (umiddelbar tap→animasjon-feedback beholdes). Den
// autoritative scoringen skjer uansett server-side i submit/route.ts.
//
// YTELSE: Tidligere hentet ruten ALLE spørsmål (med full fasit) og shufflet dem
// på HVERT kall — N fulle tabellhentinger per spillerunde. Nå lagres den
// shufflede rekkefølgen (array av question_id) på attempt-raden ved første
// kall, og påfølgende kall henter kun det ene spørsmålet direkte by id.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const QUESTION_COLUMNS =
  'id, question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, time_limit_seconds, shuffle_options, category, order_index'

// Deterministisk PRNG slik at randomisert rekkefølge er stabil per attempt
// (samme rekkefølge på tvers av kall og ved resume), men unik per spiller.
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle<T>(arr: T[], seedStr: string): T[] {
  const seedFn = xmur3(seedStr)
  const rand = mulberry32(seedFn())
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!UUID_RE.test(quizId)) {
    return NextResponse.json({ error: 'Ugyldig quiz-id' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const index = parseInt(searchParams.get('index') ?? '0', 10)
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: 'Ugyldig index' }, { status: 400 })
  }
  const attemptId = searchParams.get('attemptId') ?? ''
  const hasAttempt = UUID_RE.test(attemptId)

  // ── Quiz + attempt parallelt ──────────────────────────────────────────────────
  // Quizen må finnes/være åpen; attempt-raden bærer den lagrede rekkefølgen.
  // Begge er uavhengige oppslag → Promise.all (tidligere sekvensielt).
  const [quizRes, attemptRes] = await Promise.all([
    supabaseAdmin
      .from('quizzes')
      .select('id, opens_at, closes_at, randomize_questions, quiz_type')
      .eq('id', quizId)
      .maybeSingle(),
    hasAttempt
      ? supabaseAdmin
          .from('attempts')
          .select('id, quiz_id, question_order')
          .eq('id', attemptId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const quiz = quizRes.data
  if (!quiz) {
    return NextResponse.json({ error: 'Quizen finnes ikke' }, { status: 404 })
  }
  const now = Date.now()
  const opensAt = quiz.opens_at ? new Date(quiz.opens_at).getTime() : null
  const closesAt = quiz.closes_at ? new Date(quiz.closes_at).getTime() : null
  if ((opensAt !== null && now < opensAt) || (closesAt !== null && now > closesAt)) {
    return NextResponse.json({ error: 'Quizen er ikke åpen' }, { status: 403 })
  }

  // Attempt må tilhøre denne quizen for å brukes som rekkefølge-kilde.
  const attempt = (attemptRes.data && (attemptRes.data as { quiz_id?: string }).quiz_id === quizId)
    ? (attemptRes.data as { id: string; quiz_id: string; question_order: unknown })
    : null

  const shouldRandomize = quiz.randomize_questions === true && (quiz as { quiz_type?: string }).quiz_type !== 'weekly' && attempt !== null

  // ── Randomisert: bruk (eller bygg) lagret rekkefølge på attempt-raden ─────────
  if (shouldRandomize && attempt) {
    let order: string[] | null = Array.isArray(attempt.question_order)
      ? (attempt.question_order as string[])
      : null

    if (!order) {
      // Første kall for denne attempten — bygg rekkefølgen fra KUN id-kolonnen
      // (lett henting, ingen fasit), shuffle deterministisk, og lagre den.
      const { data: idRows } = await supabaseAdmin
        .from('questions')
        .select('id')
        .eq('quiz_id', quizId)
        .order('order_index', { ascending: true })

      const ids = ((idRows ?? []) as { id: string }[]).map(r => r.id)
      order = seededShuffle(ids, attemptId)

      // Lagre atomisk: kun hvis fortsatt null. Hindrer at to samtidige kall
      // (f.eks. index 0 og 1) skriver ulik rekkefølge — taperen leser vinnerens.
      const { data: claimed } = await supabaseAdmin
        .from('attempts')
        .update({ question_order: order })
        .eq('id', attemptId)
        .is('question_order', null)
        .select('question_order')
        .maybeSingle()

      if (!claimed) {
        const { data: fresh } = await supabaseAdmin
          .from('attempts')
          .select('question_order')
          .eq('id', attemptId)
          .maybeSingle()
        if (fresh && Array.isArray(fresh.question_order)) {
          order = fresh.question_order as string[]
        }
      }
    }

    const total = order.length
    if (index >= total) {
      return NextResponse.json({ error: 'Index utenfor rekkevidde', total }, { status: 404 })
    }

    const questionId = order[index]
    const { data: question, error } = await supabaseAdmin
      .from('questions')
      .select(QUESTION_COLUMNS)
      .eq('id', questionId)
      .eq('quiz_id', quizId)
      .maybeSingle()

    if (error) {
      console.error('[quiz/questions] feil:', { quizId, error: error.message })
      return NextResponse.json({ error: 'Kunne ikke hente spørsmål' }, { status: 500 })
    }
    if (!question) {
      return NextResponse.json({ error: 'Index utenfor rekkevidde', total }, { status: 404 })
    }

    return NextResponse.json({ question, total })
  }

  // ── Ikke-randomisert: deterministisk på order_index ───────────────────────────
  // Hent KUN spørsmålet på posisjon `index` via range(), og total via count i
  // samme spørring. Aldri hele settet.
  const { data: rows, count, error } = await supabaseAdmin
    .from('questions')
    .select(QUESTION_COLUMNS, { count: 'exact' })
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true })
    .range(index, index)

  if (error) {
    console.error('[quiz/questions] feil:', { quizId, error: error.message })
    return NextResponse.json({ error: 'Kunne ikke hente spørsmål' }, { status: 500 })
  }

  const total = count ?? 0
  const question = (rows ?? [])[0]
  if (!question) {
    return NextResponse.json({ error: 'Index utenfor rekkevidde', total }, { status: 404 })
  }

  return NextResponse.json({ question, total })
}
