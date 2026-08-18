import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'
import { planSeasonResync, type SeasonResyncChange, type StoredSeasonRow } from '@/lib/season-resync-plan'
import type { SeasonAttempt } from '@/lib/season-points'

// I/O-siden av season_scores-rekalkuleringen. All logikk om HVEM som skal
// rangeres mot hvem ligger i lib/season-resync-plan.ts — les prinsippkommentaren
// øverst der før du endrer noe her.

export type SeasonResyncResult = {
  quizId: string
  /** Antall lagrede season_scores-rader for quizen som ble vurdert. */
  checked: number
  /** Antall rader som faktisk ble skrevet. */
  updated: number
  /** Rader som ikke kunne utledes (bruker uten forsøk) og derfor ble stående. */
  unresolvable: number
  changes: SeasonResyncChange[]
  error: string | null
}

// Skrivingen går i parallelle batcher mot eu-west-1. Sekvensielt ville en quiz
// med et par hundre avvikende rader kostet flere sekunder i ren rundtursventing.
const WRITE_BATCH_SIZE = 25

export async function resyncSeasonScoresForQuiz(quizId: string): Promise<SeasonResyncResult> {
  const empty: SeasonResyncResult = {
    quizId, checked: 0, updated: 0, unresolvable: 0, changes: [], error: null,
  }

  let storedRows: StoredSeasonRow[]
  let attempts: SeasonAttempt[]

  try {
    storedRows = await fetchAllRows<StoredSeasonRow>((from, to) =>
      supabaseAdmin
        .from('season_scores')
        .select('id, user_id, scope_type, scope_id, points, rank')
        .eq('quiz_id', quizId)
        .order('id', { ascending: true })
        .range(from, to)
    )

    // Ingen lagrede rader = sesongpoeng er ikke tildelt for denne quizen ennå
    // (den er ikke stengt, eller cronen har ikke kjørt). Da er det ingenting å
    // rette: award-season-points regner dem uansett fra de rettede tallene når
    // den kjører. Bevisst no-op — vi setter aldri inn rader herfra.
    if (storedRows.length === 0) return empty

    attempts = await fetchAllRows<SeasonAttempt>((from, to) =>
      supabaseAdmin
        .from('attempts')
        .select('user_id, correct_answers, total_time_ms, correct_streak')
        .eq('quiz_id', quizId)
        .eq('is_team', false)
        .not('user_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[resync-season-scores] lesing feilet for quiz ${quizId}:`, message)
    return { ...empty, error: message }
  }

  const plan = planSeasonResync(storedRows, attempts)

  if (plan.unresolvable.length > 0) {
    console.warn(
      `[resync-season-scores] quiz ${quizId}: ${plan.unresolvable.length} rad(er) uten utledbar plassering — ikke rørt`
    )
  }

  let updated = 0
  for (let i = 0; i < plan.changes.length; i += WRITE_BATCH_SIZE) {
    const batch = plan.changes.slice(i, i + WRITE_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(change =>
        supabaseAdmin
          .from('season_scores')
          .update({ rank: change.toRank, points: change.toPoints })
          .eq('id', change.id)
      )
    )
    const failed = results.find(r => r.error)
    if (failed?.error) {
      // Delvis skriving er trygg å stoppe på: rekalkuleringen er idempotent og
      // regner alltid fra dagens attempts-tall, så en ny kjøring fullfører resten.
      console.error(`[resync-season-scores] UPDATE feilet for quiz ${quizId}:`, failed.error.message)
      return {
        quizId,
        checked: plan.checked,
        updated,
        unresolvable: plan.unresolvable.length,
        changes: plan.changes,
        error: failed.error.message,
      }
    }
    updated += batch.length
  }

  console.log(
    `[resync-season-scores] quiz ${quizId}: ${plan.checked} rader vurdert, ${updated} oppdatert`
  )

  return {
    quizId,
    checked: plan.checked,
    updated,
    unresolvable: plan.unresolvable.length,
    changes: plan.changes,
    error: null,
  }
}
