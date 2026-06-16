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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  // ── Quizen må finnes og være åpen ─────────────────────────────────────────────
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('id, opens_at, closes_at, randomize_questions')
    .eq('id', quizId)
    .maybeSingle()

  if (!quiz) {
    return NextResponse.json({ error: 'Quizen finnes ikke' }, { status: 404 })
  }
  const now = Date.now()
  const opensAt = quiz.opens_at ? new Date(quiz.opens_at).getTime() : null
  const closesAt = quiz.closes_at ? new Date(quiz.closes_at).getTime() : null
  if ((opensAt !== null && now < opensAt) || (closesAt !== null && now > closesAt)) {
    return NextResponse.json({ error: 'Quizen er ikke åpen' }, { status: 403 })
  }

  // ── Hent spørsmål (med fasit) server-side ─────────────────────────────────────
  const { data: rows, error } = await supabaseAdmin
    .from('questions')
    .select('id, question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, time_limit_seconds, shuffle_options, category, order_index')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true })

  if (error) {
    console.error('[quiz/questions] feil:', { quizId, error: error.message })
    return NextResponse.json({ error: 'Kunne ikke hente spørsmål' }, { status: 500 })
  }

  const ordered = quiz.randomize_questions && UUID_RE.test(attemptId)
    ? seededShuffle(rows ?? [], attemptId)
    : (rows ?? [])

  const total = ordered.length
  if (index >= total) {
    return NextResponse.json({ error: 'Index utenfor rekkevidde', total }, { status: 404 })
  }

  // Returnerer KUN spørsmålet på posisjon `index` — aldri fremtidige spørsmål.
  return NextResponse.json({ question: ordered[index], total })
}
