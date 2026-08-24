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
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

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

// ── Sletting: alt i ÉN transaksjon (delete_question_and_renumber) ───────────
//
// Fram til 24. august 2026 var dette to kall (tell, så slett) med et
// dokumentert ÆRLIG HULL: to samtidige slettinger på en quiz med to spørsmål
// kunne begge se count=2 og tømme den. Renummereringen av gjenværende rader
// lå dessuten hos KLIENTENE — byggeren gjorde N kall, spørsmålsoversikten
// ingen (hull som [1..14,16] på Fredagsquiz 07.08.2026 er sporet dit).
// RPC-en gjør minst-ett-spørsmål-sperren, slettingen og renummereringen til
// 1..N i samme transaksjon — se
// supabase/migrations/20260824000000_delete_question_and_renumber.sql.
//
// FEILRETNING er fortsatt fail-CLOSED, nå med transaksjonsgaranti: feiler
// noe som helst, er ingenting slettet og ingenting renummerert. Motsatt av
// innholdsvakten i lib/opened-quiz-lookup.ts, og med vilje: her er den dyre
// utgangen en tømt quiz, der er den en uteblitt varsling.
//
// question_played (nytt): et spørsmål med registrerte besvarelser kan ikke
// slettes — resultater er urørlige (regel fra Dennis 24. august 2026), og en
// senere fasitretting ville ellers rekalkulert poeng fra et amputert radsett.
// Feil fasit på en spilt quiz rettes med /api/admin/correct-answer.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: quizId, qid } = await params

  const { data, error } = await supabaseAdmin.rpc('delete_question_and_renumber', {
    p_quiz_id: quizId,
    p_question_id: qid,
  })

  if (error) {
    // RPC-en signaliserer forretningsutfallene med et fast prefiks i
    // meldingen (P0001 har ingen egen feltkanal gjennom PostgREST).
    if (error.message.includes('last_question')) {
      return NextResponse.json({
        error: 'Kan ikke slette det eneste spørsmålet. En quiz må ha minst ett spørsmål — ' +
          'ellers blir den publisert og varslet om uten innhold.',
        code: 'last_question',
      }, { status: 409 })
    }
    if (error.message.includes('question_played')) {
      return NextResponse.json({
        error: 'Spørsmålet har registrerte besvarelser og kan ikke slettes — resultatene på en ' +
          'spilt quiz er urørlige. Er fasiten feil, bruk «Rett svar»; da oppdateres poeng, ' +
          'streak og sesongpoeng samtidig.',
        code: 'question_played',
      }, { status: 409 })
    }
    if (error.message.includes('question_not_found')) {
      return NextResponse.json({ error: 'Spørsmål ikke funnet' }, { status: 404 })
    }
    console.error('[questions DELETE] delete_question_and_renumber feilet:', {
      quizId, qid, code: error.code, message: error.message,
    })
    return NextResponse.json(
      { error: 'Kunne ikke slette spørsmålet. Ingenting er slettet — prøv igjen.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, questions: data ?? [] })
}
