import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { DEFAULT_QUESTION_TIME_LIMIT_SECONDS } from '@/lib/quiz-time-limit'

type ImportQuestion = {
  question_text: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
  time_limit_seconds: number | null
  shuffle_options: boolean
  category: string | null
}

// ── DELVIS OPPRETTELSE ER FORBUDT — «aktiver sist» ──────────────────────────
// Fram til 27. august ble quiz-raden satt inn AKTIV, og en feilet
// spørsmålsinnsetting ryddet med en delete hvis FEIL BLE IGNORERT. Feilet
// begge — innsettingen og oppryddingen — sto det igjen en AKTIV quiz uten
// spørsmål, og den var spillbar: spillestiens anon-lesing krever kun
// is_active=true (samme grunn som i .claude/QK_TESTQUIZ_OPPSKRIFT.md).
//
// Formen er nå den samme som POST /api/arkiv (c418b64), som ble skrevet slik
// nettopp fordi DENNE ruten ikke var det:
//
//   insert quiz (INAKTIV) → insert spørsmål (ÉN batch) → aktiver SIST
//
// Feiler noe underveis, står raden igjen med is_active=false — usynlig og
// uspillbar. Oppryddingen er da en opprydding, ikke et forsvar; derfor logges
// en feilet opprydding i stedet for å ignoreres. Den er ikke lenger
// forskjellen mellom trygt og utrygt, bare mellom ryddig og rotete.
// Spørsmålsinnsettingen er ÉN batch-INSERT (én transaksjon), så «noen av
// radene» er ikke en mulig tilstand.
// Testdekket i lib/quiz-import-route.test.ts.
//
// MERK hva dette IKKE er: veiviseren (app/admin/quizzes/new/page.tsx) kaller
// ruten på tittel-blur og får en aktiv quiz med TOMME placeholder-spørsmål som
// står slik mens admin skriver. Det er uendret og bevisst. Vinduet som lukkes
// her er det ATOMISKE — det som oppstår når en skriving feiler, ikke det
// admin selv står i.

/** Verdien quizen ender på når importen er bekreftet. Skrives KUN i det siste
 *  steget; opprettelsen bruker alltid is_active=false. */
const ACTIVE_AFTER_IMPORT = true

// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { title, questions, opens_at, closes_at, quiz_type, is_test }: {
    title: string
    questions: ImportQuestion[]
    opens_at?: string
    closes_at?: string
    quiz_type?: string
    is_test?: boolean
  } = body

  if (!title || !questions?.length) {
    return NextResponse.json({ error: 'Mangler tittel eller spørsmål.' }, { status: 400 })
  }

  const now = new Date()
  const opens = opens_at ? new Date(opens_at) : new Date(now.getTime() + 60 * 60 * 1000)
  const closes = closes_at ? new Date(closes_at) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // ── Skriving 1: quiz-raden, INAKTIV (se «aktiver sist» i filhodet) ────────
  const { data: quiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .insert({
      title,
      description: '',
      opens_at: opens.toISOString(),
      closes_at: closes.toISOString(),
      time_limit_seconds: DEFAULT_QUESTION_TIME_LIMIT_SECONDS,
      num_options: 4,
      // INAKTIV til spørsmålene er bekreftet inne. Den ferdige verdien er
      // ACTIVE_AFTER_IMPORT, og den skrives i siste steg — ikke her.
      is_active: false,
      show_leaderboard: true,
      hide_leaderboard_until_closed: true,
      show_live_placement: true,
      show_answer_explanation: true,
      randomize_questions: false,
      allow_teams: true,
      requires_access_code: false,
      quiz_type: quiz_type ?? 'weekly',
      is_test: is_test ?? false,
    })
    .select()
    .single()

  if (quizError || !quiz) {
    return NextResponse.json(
      { error: quizError?.message ?? 'Kunne ikke opprette quiz.' },
      { status: 500 }
    )
  }

  const nowIso = now.toISOString()
  const rows = questions.map((q, i) => {
    let timeSec: number | null = null
    if (q.time_limit_seconds !== null) {
      timeSec = Math.min(60, Math.max(5, q.time_limit_seconds))
    }
    return {
      quiz_id: quiz.id,
      question_text: q.question_text,
      option_a: q.option_a,   // riktig svar er alltid option_a (kolonne B i Excel)
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_answer: 'A',    // kolonne B i Excel er alltid riktig
      time_limit_seconds: timeSec,
      shuffle_options: q.shuffle_options,
      category: q.category || null,
      order_index: i + 1,
      usage_count: 1,
      last_used_at: nowIso,
    }
  })

  // ── Skriving 2: spørsmålsradene (én atomisk batch) ────────────────────────
  const { error: qError } = await supabaseAdmin.from('questions').insert(rows)
  if (qError) {
    const { error: cleanupError } = await supabaseAdmin
      .from('quizzes')
      .delete()
      .eq('id', quiz.id)
    if (cleanupError) {
      // Ikke et hull: raden er fortsatt is_active=false og dermed hverken
      // synlig eller spillbar. Loggen finnes så resten kan ryddes manuelt.
      console.error(
        `[quiz-import] opprydding feilet — INAKTIV tom quiz ${quiz.id} står igjen:`,
        cleanupError.message
      )
    }
    return NextResponse.json({ error: qError.message }, { status: 500 })
  }

  // ── Skriving 3: aktiver — først nå blir quizen synlig/spillbar ────────────
  const { error: activateError } = await supabaseAdmin
    .from('quizzes')
    .update({ is_active: ACTIVE_AFTER_IMPORT })
    .eq('id', quiz.id)

  if (activateError) {
    console.error('[quiz-import] aktivering feilet:', activateError.message)
    // Rydd begge radsettene eksplisitt (antar ikke kaskade); feiler det, står
    // quizen komplett men inaktiv — usynlig, og trygg å rydde manuelt.
    const { error: cleanupQuestionsError } = await supabaseAdmin
      .from('questions')
      .delete()
      .eq('quiz_id', quiz.id)
    const { error: cleanupQuizError } = cleanupQuestionsError
      ? { error: cleanupQuestionsError }
      : await supabaseAdmin.from('quizzes').delete().eq('id', quiz.id)
    if (cleanupQuizError) {
      console.error(
        `[quiz-import] opprydding etter aktiveringsfeil — INAKTIV quiz ${quiz.id} står igjen:`,
        cleanupQuizError.message
      )
    }
    return NextResponse.json({ error: activateError.message }, { status: 500 })
  }

  return NextResponse.json({ quizId: quiz.id })
}
