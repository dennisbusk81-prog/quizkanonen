import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRowsChunked } from '@/lib/paginate'

// Antall deltakere per quiz — samme tellelogikk som /toppliste og forsiden:
// distinkte innloggede spillere (is_team=false, user_id ikke null), minus
// globalt ekskluderte. Trukket ut av app/quizer/page.tsx 18. august 2026 slik
// at pagineringen kan testes (test-globben tar kun lib/**/*.test.ts, og en
// .tsx-server-komponent kan ikke importeres av node --test).
//
// Attempts-lesingen går via fetchAllRowsChunked, som dekker BEGGE takene:
// .in()-listen over quiz-id-er sprenger URL-grensen ved ~390 id-er, og radene
// (én per forsøk — 557 totalt i dag, målt 18. august 2026) kuttes ellers
// stille ved 1000 (PostgREST db-max-rows). Distinkt-tellingen er idempotent
// og rekkefølgeuavhengig, så pagineringen endrer ikke resultatet — .order('id')
// er kun der for at pagineringsvinduene skal være stabile radsett.
export async function fetchParticipantCounts(quizIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (quizIds.length === 0) return counts

  try {
    const [attemptRows, excludedResult] = await Promise.all([
      fetchAllRowsChunked<{ quiz_id: string; user_id: string }>(quizIds, (chunk, from, to) =>
        supabaseAdmin
          .from('attempts')
          .select('quiz_id, user_id')
          .in('quiz_id', chunk)
          .eq('is_team', false)
          .not('user_id', 'is', null)
          .order('id')
          .range(from, to)
      ),
      supabaseAdmin
        .from('excluded_members')
        .select('user_id')
        .eq('scope_type', 'global')
        .is('scope_id', null),
    ])

    const excludedSet = new Set(
      ((excludedResult.data ?? []) as { user_id: string }[]).map(e => e.user_id)
    )
    const perQuiz = new Map<string, Set<string>>()
    for (const r of attemptRows) {
      if (excludedSet.has(r.user_id)) continue
      if (!perQuiz.has(r.quiz_id)) perQuiz.set(r.quiz_id, new Set())
      perQuiz.get(r.quiz_id)!.add(r.user_id)
    }
    for (const [qid, set] of perQuiz) counts.set(qid, set.size)
  } catch (err) {
    // Samme degradering som før uttrekket (spørrefeil ble ignorert): kortene
    // vises uten deltakertall i stedet for at hele /quizer velter — men nå
    // med loggspor. Aldri et DELVIS tall: feiler en senere side/bit, kastes
    // alt og map-en forblir tom.
    console.error('[quizer] deltakertelling feilet:', err)
    counts.clear()
  }
  return counts
}
