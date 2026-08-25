import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { fetchAllRows, fetchAllRowsChunked } from '@/lib/paginate'

type ClassicRow = { id: string; quiz_id: string; [key: string]: unknown }

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Samme to tak som spørsmålsbanken i /api/admin/questions — kun filteret
  // skiller rutene. Klassikerne er en DELMENGDE av banken, så en import på
  // flere tusen spørsmål kan dra denne forbi 1000-radstaket den også.
  //
  // .order('id') er en tiebreaker: visningsrekkefølgen er fortsatt
  // question_text ASC, men den kolonnen er ikke unik (samme spørsmål gjenbrukes
  // som egne rader — se classics/copy), så uten tiebreaker er sidedelingen
  // ustabil og en side kan gjenta eller hoppe over rader.
  let data: ClassicRow[]
  try {
    data = await fetchAllRows<ClassicRow>((from, to) =>
      supabaseAdmin
        .from('questions')
        .select('id, question_text, option_a, option_b, option_c, option_d, correct_answer, correct_answers, explanation, category, quiz_id')
        .eq('is_classic', true)
        .order('question_text', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Kunne ikke hente klassikere' }, { status: 500 })
  }

  // Resolve quiz titles — chunket forbi URL-taket på ~390 id-er. Feiler
  // oppslaget, står titlene som null slik de gjorde før (feilen ble ignorert
  // her fra før); klassikerne skal vises uansett.
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
    console.error('[admin/classics] quiz-tittel-oppslag feilet:', e instanceof Error ? e.message : e)
  }

  const quizTitleMap = Object.fromEntries(quizData.map(q => [q.id, q.title]))

  const questions = data.map(q => ({
    ...q,
    quiz_title: quizTitleMap[q.quiz_id] ?? null,
  }))

  return NextResponse.json({ questions })
}
