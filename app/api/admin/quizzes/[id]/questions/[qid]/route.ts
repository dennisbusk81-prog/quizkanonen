import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import {
  parseAnswerKey,
  readStoredKey,
  sameAnswerKey,
  decideAnswerKeyPatch,
} from '@/lib/answer-key-correction'

// Felt admin-sidene faktisk redigerer. Ruten skrev tidligere hele request-body
// rått til questions-raden (`.update(body)`), så en klient kunne sette en
// hvilken som helst kolonne. Alt utenfor lista ignoreres nå og rapporteres
// tilbake i `ignored`, slik at en glemt kolonne blir synlig i stedet for å
// forsvinne stille.
const EDITABLE_FIELDS = [
  'question_text',
  'option_a', 'option_b', 'option_c', 'option_d',
  'explanation',
  'time_limit_seconds',
  'shuffle_options',
  'category',
  'is_classic',
  'order_index',
] as const

// Fasit-kolonnene håndteres for seg, av decideAnswerKeyPatch.
const ANSWER_KEY_FIELDS = ['correct_answer', 'correct_answers']

/**
 * Hvor mange svar som finnes på spørsmålet, og hva fasiten er nå.
 *
 * Admin-sidene bruker dette til å vite OM en fasitendring må gå via
 * bekreftelses-panelet (og hvor mange spillere den påvirker) FØR de sender en
 * lagring som ellers ville blitt låst.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { qid } = await params

  const [{ data: question, error: qErr }, { count, error: cErr }] = await Promise.all([
    supabaseAdmin
      .from('questions')
      .select('id, correct_answer, correct_answers')
      .eq('id', qid)
      .maybeSingle(),
    supabaseAdmin
      .from('attempt_answers')
      .select('id', { count: 'exact', head: true })
      .eq('question_id', qid),
  ])

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })
  if (!question) return NextResponse.json({ error: 'Spørsmål ikke funnet' }, { status: 404 })
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  return NextResponse.json({
    answeredCount: count ?? 0,
    correctAnswers: readStoredKey(question),
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: quizId, qid } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field]
  }
  const ignored = Object.keys(body).filter(
    k => !(EDITABLE_FIELDS as readonly string[]).includes(k) && !ANSWER_KEY_FIELDS.includes(k)
  )
  if (ignored.length > 0) {
    console.warn('[questions PATCH] ukjente felt ignorert:', { qid, ignored })
  }

  // ── Fasit ──────────────────────────────────────────────────────────────────
  // Regraderingen som lå her er FJERNET. Den satte is_correct på
  // attempt_answers ut fra body.correct_answer alene, men oppdaterte hverken
  // attempts.correct_answers/correct_streak eller season_scores — og kollapset
  // multi-svar stille, siden den bare så på én bokstav. Se den fulle
  // beskrivelsen i lib/answer-key-correction.ts.
  //
  // Nå: uendret fasit slipper gjennom (det er den vanlige lagringen — begge
  // admin-sidene sender fasiten hver gang), fasit på et spørsmål ingen har
  // svart på skrives direkte, og en reell endring på et spilt spørsmål LÅSES
  // med 409 og henvises til /api/admin/correct-answer.
  //
  // Klientene sender begge kolonnene, der correct_answers er null når det bare
  // er ett riktig svar. Et ikke-tomt array er derfor autoritativt; ellers
  // gjelder enkelt-kolonnen. Er ingen av dem med (f.eks. en ren
  // order_index-flytting), er fasiten ikke en del av forespørselen.
  const requestedKey =
    Array.isArray(body.correct_answers) && body.correct_answers.length > 0
      ? body.correct_answers
      : 'correct_answer' in body
        ? body.correct_answer
        : undefined

  if (requestedKey !== undefined && requestedKey !== null) {
    const [{ data: question, error: qErr }, { data: quiz }] = await Promise.all([
      supabaseAdmin
        .from('questions')
        .select('id, correct_answer, correct_answers')
        .eq('id', qid)
        .maybeSingle(),
      supabaseAdmin
        .from('quizzes')
        .select('num_options')
        .eq('id', quizId)
        .maybeSingle(),
    ])

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })
    if (!question) return NextResponse.json({ error: 'Spørsmål ikke funnet' }, { status: 404 })

    const maxOptions = quiz?.num_options ?? 4

    // Tell svarrader KUN når fasiten faktisk er endret. Vanlig lagring (rettet
    // skrivefeil, ny forklaring) sender uendret fasit og skal ikke koste en
    // ekstra spørring.
    const pre = parseAnswerKey(requestedKey, maxOptions)
    const differs = pre.ok && !sameAnswerKey(pre.keys, readStoredKey(question))

    let answeredCount = 0
    if (differs) {
      const { count, error: cErr } = await supabaseAdmin
        .from('attempt_answers')
        .select('id', { count: 'exact', head: true })
        .eq('question_id', qid)
      if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
      answeredCount = count ?? 0
    }

    const decision = decideAnswerKeyPatch({
      requested: requestedKey,
      stored: question,
      answeredCount,
      maxOptions,
    })

    if (decision.action === 'invalid') {
      return NextResponse.json({ error: decision.error }, { status: 400 })
    }

    if (decision.action === 'locked') {
      // Ingenting skrives — heller ikke de andre feltene. Klienten fanger 409,
      // åpner bekreftelses-panelet på stedet og lagrer teksten på nytt med
      // uendret fasit, slik at admin ikke mister arbeid og ikke må navigere
      // noe sted. I praksis skal denne aldri treffes fra UI-et, som henter
      // answeredCount på forhånd — den er backstop for enhver annen kaller.
      return NextResponse.json({
        error: `Fasiten kan ikke endres her: ${decision.answeredCount} besvarelse(r) er allerede registrert på dette spørsmålet. Bruk «Rett svar» — da oppdateres poeng, streak og sesongpoeng samtidig.`,
        code: 'answer_key_locked',
        answeredCount: decision.answeredCount,
        currentAnswers: decision.currentKey,
        requestedAnswers: decision.requestedKey,
      }, { status: 409 })
    }

    if (decision.action === 'write') {
      Object.assign(update, decision.columns)
    }
    // 'unchanged' → fasit-kolonnene utelates bevisst fra update.
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, updated: [], ignored })
  }

  const { error } = await supabaseAdmin.from('questions').update(update).eq('id', qid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, updated: Object.keys(update), ignored })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { qid } = await params
  const { error } = await supabaseAdmin.from('questions').delete().eq('id', qid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
