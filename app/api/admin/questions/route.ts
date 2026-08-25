import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { fetchAllRows, fetchAllRowsChunked } from '@/lib/paginate'

const QUESTION_COLUMNS =
  'id, question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, category, quiz_id, is_classic, usage_count, last_used_at, created_at'

type QuestionRow = {
  id: string
  question_text: string
  quiz_id: string
  [key: string]: unknown
}

// Hele spørsmålsbanken — ALLE spørsmål noensinne lagret i en quiz, ikke kun
// dem merket is_classic (det er /api/admin/classics, som filtrerer på det
// flagget og forblir urørt/ubrukt av denne siden). Filtrering på "kun
// klassikere" gjøres client-side i /admin/sporsmal ved å lese is_classic her.
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Hele banken, paginert. 195 rader i dag, men flere tusen etter planlagt
  // import — og PostgREST kutter stille ved 1000 uten feilmelding, så banken
  // ville vist 1000 av 5000 uten at noe sa fra.
  //
  // .order('id') er en TIEBREAKER, ikke en ny sortering: visningsrekkefølgen er
  // fortsatt created_at DESC. Uten den er sidedelingen ustabil når flere rader
  // deler tidsstempel — og nettopp en bulk-import gir tusenvis av rader med
  // identisk created_at, altså akkurat det tilfellet som kommer.
  let data: QuestionRow[]
  try {
    data = await fetchAllRows<QuestionRow>((from, to) =>
      supabaseAdmin
        .from('questions')
        .select(QUESTION_COLUMNS)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Kunne ikke hente spørsmål' }, { status: 500 })
  }

  // Quiz-titler: én id per quiz som har spørsmål i banken. Hele listen havner i
  // URL-ens query-streng, og den målte grensen ligger rundt 390 id-er — nådd
  // ved 390 quizer, altså FØR radtaket over rekker å bli det bindende taket.
  //
  // Feiler oppslaget, faller visningen tilbake på quiz_title = null slik den
  // gjorde før (feilen ble ignorert her fra før) — spørsmålene skal vises
  // uansett. Nå logges den i det minste.
  const quizIds = [...new Set(data.map(q => q.quiz_id))].filter(Boolean)
  let quizData: { id: string; title: string }[] = []
  try {
    quizData = await fetchAllRowsChunked<{ id: string; title: string }>(quizIds, (chunk, from, to) =>
      supabaseAdmin
        .from('quizzes')
        .select('id, title')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (e) {
    console.error('[admin/questions] quiz-tittel-oppslag feilet:', e instanceof Error ? e.message : e)
  }

  const quizTitleMap = Object.fromEntries(quizData.map(q => [q.id, q.title]))

  // Treffprosent telles på tvers av ALLE forekomster av samme spørsmålstekst
  // — hver gjenbruk via spørsmålsbanken lager en ny rad (ny id) uten
  // slektskap til kilden (se app/api/admin/classics/copy/route.ts), så én
  // enkelt question_id ville gitt et kunstig lavt/upresist tallgrunnlag for
  // spørsmål som er brukt flere ganger. question_text er eneste tilgjengelige
  // kobling mellom "samme" spørsmål på tvers av rader.
  let answerStats: { question_id: string; is_correct: boolean }[] = []
  try {
    answerStats = await fetchAllRows((from, to) =>
      supabaseAdmin
        .from('attempt_answers')
        .select('question_id, is_correct')
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Kunne ikke hente svarstatistikk' }, { status: 500 })
  }

  const idToText = new Map(data.map(q => [q.id, q.question_text]))
  const textStats = new Map<string, { correct: number; total: number }>()
  for (const a of answerStats) {
    const text = idToText.get(a.question_id)
    if (!text) continue
    const s = textStats.get(text) ?? { correct: 0, total: 0 }
    s.total += 1
    if (a.is_correct) s.correct += 1
    textStats.set(text, s)
  }

  const questions = data.map(q => {
    const s = textStats.get(q.question_text)
    return {
      ...q,
      quiz_title: quizTitleMap[q.quiz_id] ?? null,
      hit_rate: s && s.total > 0 ? Math.round((s.correct / s.total) * 100) : null,
      answer_count: s?.total ?? 0,
    }
  })

  return NextResponse.json({ questions })
}
