import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows, fetchAllRowsChunked } from '@/lib/paginate'
import { onlyRealQuizAttempts, REAL_QUIZ_ATTEMPT_EMBED } from '@/lib/real-quiz-population'

// ── Aggregert svarstatistikk for attempt_answers ────────────────────────────
// attempt_answers kan lett passere PostgREST sin stille 1000-rads-grense for
// EN ENKELT quiz (bekreftet mot prod 26. juli 2026: den mest spilte quizen
// har 1437 rader på 75 forsøk). Disse funksjonene forsøker først den raske
// SQL-RPC-stien (GROUP BY i databasen — se
// supabase/migrations/20260727000000_attempt_answer_stats_rpc.sql), og
// faller automatisk tilbake til en paginert, KORREKT JS-aggregering hvis
// RPC-en ikke er opprettet ennå. Begge stier gir identisk resultat — kun
// hastighet og datamengde over nettet skiller dem. Samme
// trygt-å-deploye-før-migrasjon-mønster som season_leaderboard_rpc.

export type QuestionStat = { total: number; correct: number }

// Per-spørsmål total/riktig-telling for et gitt sett av attempt-id-er.
export async function getQuestionStatsByAttempts(
  attemptIds: string[]
): Promise<Map<string, QuestionStat>> {
  const stats = new Map<string, QuestionStat>()
  if (attemptIds.length === 0) return stats

  const { data, error } = await supabaseAdmin.rpc('attempt_answer_stats_by_attempts', {
    p_attempt_ids: attemptIds,
  })

  if (!error) {
    for (const row of (data ?? []) as { question_id: string; total: number; correct: number }[]) {
      stats.set(row.question_id, { total: Number(row.total), correct: Number(row.correct) })
    }
    return stats
  }

  console.warn('[attempt-answer-stats] RPC attempt_answer_stats_by_attempts utilgjengelig, bruker paginert JS-fallback:', error.message)

  // CHUNKET, ikke bare paginert: attemptIds er ett element per forsøk, og hele
  // listen legges i URL-ens query-streng. Over ~390 id-er svarer PostgREST «Bad
  // Request» (målt 26. juli, se lib/paginate.ts), fetchAllRows kaster, og
  // fallbacken velter i stedet for å svare. Fire av de fem kallerne kan passere
  // 390 på en stor quiz — admin/results, quiz-results-text, org quiz-insights og
  // forsidens «Ukens fakta». RPC-stien over er upåvirket: p_attempt_ids går i
  // POST-body, ikke i URL-en. Radtaket på 1000 gjelder fortsatt INNAD i hver
  // bit; helperen dekker begge takene, og .order('id') er påkrevd fordi .range()
  // uten sortering taper rader (målt 18. august: 35 av 1035).
  const rows = await fetchAllRowsChunked<{ question_id: string; is_correct: boolean }>(
    attemptIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from('attempt_answers')
        .select('question_id, is_correct')
        .in('attempt_id', chunk)
        .order('id', { ascending: true })
        .range(from, to)
  )
  for (const a of rows) {
    const s = stats.get(a.question_id) ?? { total: 0, correct: 0 }
    s.total++
    if (a.is_correct) s.correct++
    stats.set(a.question_id, s)
  }
  return stats
}

// Per-spørsmål antall svar PER alternativ (A/B/C/D), for et gitt sett av
// question-id-er.
export async function getOptionCountsByQuestions(
  questionIds: string[]
): Promise<Map<string, Map<string, number>>> {
  const counts = new Map<string, Map<string, number>>()
  if (questionIds.length === 0) return counts

  const { data, error } = await supabaseAdmin.rpc('attempt_answer_option_counts', {
    p_question_ids: questionIds,
  })

  if (!error) {
    for (const row of (data ?? []) as { question_id: string; selected_answer: string; cnt: number }[]) {
      const perQ = counts.get(row.question_id) ?? new Map<string, number>()
      perQ.set(row.selected_answer, Number(row.cnt))
      counts.set(row.question_id, perQ)
    }
    return counts
  }

  console.warn('[attempt-answer-stats] RPC attempt_answer_option_counts utilgjengelig, bruker paginert JS-fallback:', error.message)

  const rows = await fetchAllRows<{ question_id: string; selected_answer: string | null }>((from, to) =>
    supabaseAdmin
      .from('attempt_answers')
      .select('question_id, selected_answer')
      .in('question_id', questionIds)
      .order('id', { ascending: true })
      .range(from, to)
  )
  for (const a of rows) {
    if (!a.selected_answer) continue
    const perQ = counts.get(a.question_id) ?? new Map<string, number>()
    perQ.set(a.selected_answer, (perQ.get(a.selected_answer) ?? 0) + 1)
    counts.set(a.question_id, perQ)
  }
  return counts
}

// Antall distinkte spillere (user_id) med minst ett individuelt, innlogget
// forsøk PÅ EN EKTE QUIZ siden et gitt tidspunkt. Populasjonsgulvet
// (lib/real-quiz-population.ts) håndheves i BEGGE stier: RPC-en fikk joinen
// mot quizzes i migrasjon 20260825000000, og fallbacken under speiler den —
// ellers ville de to stiene telt ulike populasjoner og et RPC-bortfall
// endret forsidetallet stille.
export async function countActivePlayersSince(sinceIso: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('count_active_players_since', {
    p_since: sinceIso,
  })

  if (!error) return Number(data ?? 0)

  console.warn('[attempt-answer-stats] RPC count_active_players_since utilgjengelig, bruker paginert JS-fallback:', error.message)

  const rows = await fetchAllRows<{ user_id: string }>((from, to) => {
    // Lokal variabel, ikke inline: den lengste byggerkjeden ga TS2589 under
    // `next build` da helperen ble kjedet direkte (se real-quiz-population.ts,
    // «TO MEKANISKE KRAV»).
    const base = supabaseAdmin
      .from('attempts')
      .select(`user_id, ${REAL_QUIZ_ATTEMPT_EMBED}`)
      .eq('is_team', false)
      .not('user_id', 'is', null)
      .gte('completed_at', sinceIso)
    return onlyRealQuizAttempts(base)
      .order('id', { ascending: true })
      .range(from, to)
  })
  return new Set(rows.map(r => r.user_id)).size
}
