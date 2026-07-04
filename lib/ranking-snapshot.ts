import { supabaseAdmin } from './supabase-admin'
import { rankAttempts } from './ranking'
import type { Attempt } from './supabase'

// ── Delt rangerings-snapshot for LIVE plassering underveis ────────────────────
// Både ikke-premium-spennet (/api/quiz/[id]/ranking-snapshot) og premium-eksakt
// (/api/quiz/live-ranking) leser NÅ den samme kortlevde snapshoten og bruker den
// samme placeringsberegningen. Da blir de to flatene internt konsistente per
// definisjon: samme ferdig-pool, samme rang, samme naboer.
//
// Merk: snapshoten er uavhengig av spørsmålsindeks (samme «ferdige forsøk»-
// spørring uansett), men caches per (quiz_id, question_index) slik at ulike
// steg i quizen kan dele/gjenbruke cachen.

export type SnapshotEntry = {
  player_name: string
  rank: number
  correct_answers: number
  total_time_ms: number
  correct_streak: number
}

// FIX (Sak 1B): senket fra 60s til 10s slik at live-plasseringen ikke henger
// etter på et halvt minutt gamle tall når mange leverer samtidig.
export const CACHE_TTL_MS = 10_000

// Hent snapshot fra cache, eller bygg og lagre en ny hvis den mangler/er utdatert.
// Gjester (user_id = null) INKLUDERES — samme populasjon som topp-3/leaderboard
// (fasit i lib/ranking.ts), slik at live-plasseringen matcher sluttresultatet.
export async function getOrBuildSnapshot(
  quizId: string,
  questionIndex: number,
): Promise<SnapshotEntry[]> {
  const { data: cached } = await supabaseAdmin
    .from('ranking_snapshots')
    .select('snapshot, created_at')
    .eq('quiz_id', quizId)
    .eq('question_index', questionIndex)
    .maybeSingle()

  const isStale =
    !cached ||
    Date.now() - new Date(cached.created_at as string).getTime() > CACHE_TTL_MS

  if (!isStale && cached) {
    return cached.snapshot as SnapshotEntry[]
  }

  // Hent alle fullførte solo-forsøk (total_time_ms > 0 = quiz avsluttet).
  const { data: attempts, error: attErr } = await supabaseAdmin
    .from('attempts')
    .select(
      'id, quiz_id, player_name, is_team, team_size, correct_answers, ' +
      'total_questions, total_time_ms, correct_streak, user_id, completed_at',
    )
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .gt('total_time_ms', 0)

  if (attErr) throw attErr

  // Dedupliser: behold kun beste forsøk per spiller (user_id, ellers player_name
  // for gjester) — unngår at samme bruker vises flere ganger ved flere forsøk.
  const allRows = (attempts ?? []) as unknown as Attempt[]
  const bestByPlayer = new Map<string, Attempt>()
  for (const a of allRows) {
    const key = a.user_id ?? `name:${a.player_name}`
    const existing = bestByPlayer.get(key)
    if (
      !existing ||
      a.correct_answers > existing.correct_answers ||
      (a.correct_answers === existing.correct_answers && a.total_time_ms < existing.total_time_ms) ||
      (a.correct_answers === existing.correct_answers && a.total_time_ms === existing.total_time_ms && (a.correct_streak ?? 0) > (existing.correct_streak ?? 0))
    ) {
      bestByPlayer.set(key, a)
    }
  }

  // Ranger med eksakt samme logikk som lib/ranking.ts.
  const ranked = rankAttempts([...bestByPlayer.values()])
  const snapshot: SnapshotEntry[] = ranked.map(a => ({
    player_name:     a.player_name,
    rank:            a.rank,
    correct_answers: a.correct_answers,
    total_time_ms:   a.total_time_ms,
    correct_streak:  a.correct_streak ?? 0,
  }))

  await supabaseAdmin
    .from('ranking_snapshots')
    .upsert(
      {
        quiz_id:        quizId,
        question_index: questionIndex,
        snapshot,
        created_at:     new Date().toISOString(),
      },
      { onConflict: 'quiz_id,question_index' },
    )

  return snapshot
}

export type Placement = {
  rank: number
  total: number
  low: number
  high: number
  above: { name: string; correct: number } | null
  below: { name: string; correct: number } | null
}

// Beregn den nåværende spillerens plassering mot en snapshot av ferdige spillere.
//
// Del A (Sak 1) — garantér at rang <= total ALLTID (aldri «20 av 19»):
//   playerInPool = false  → spilleren er beviselig IKKE i den ferdige poolen
//                            (uferdig forsøk, total_time_ms = 0). Da er total =
//                            ferdige + 1, slik at også en sisteplass (rang =
//                            ferdige + 1) holder rang <= total. Brukes av
//                            live-ranking underveis.
//   playerInPool = true   → spilleren KAN allerede ligge i snapshoten (fersk
//                            snapshot rett etter innsending på resultatskjermen).
//                            total = max(ferdige, rang) unngår både dobbelttelling
//                            (rang <= ferdige → total = ferdige) og umulige tall
//                            (rang = ferdige + 1 ved utdatert cache → total følger
//                            med opp). Brukes av ranking-snapshot-ruten.
export function computePlacement(
  snapshot: SnapshotEntry[],
  correct: number,
  time: number,
  opts: { playerInPool: boolean },
): Placement {
  const finished = snapshot.length

  // Snapshoten er sortert (flest riktige → raskest tid → lengst streak).
  const strictlyBetter = snapshot.filter(e =>
    e.correct_answers > correct ||
    (e.correct_answers === correct && time > 0 && e.total_time_ms < time),
  )
  const strictlyWorse = snapshot.filter(e =>
    e.correct_answers < correct ||
    (e.correct_answers === correct && time > 0 && e.total_time_ms > time),
  )

  const rank = strictlyBetter.length + 1

  const total = opts.playerInPool
    ? Math.max(finished, rank)
    : finished + 1

  const low  = Math.max(1, rank - 2)
  const high = Math.min(total, rank + 2)

  // Nærmeste nabo over = den svakeste av dem som er bedre enn deg (sist i lista).
  const aboveEntry = strictlyBetter.length > 0 ? strictlyBetter[strictlyBetter.length - 1] : null
  // Nærmeste nabo under = den sterkeste av dem som er dårligere (først i lista).
  const belowEntry = strictlyWorse.length > 0 ? strictlyWorse[0] : null

  return {
    rank,
    total,
    low,
    high,
    above: aboveEntry ? { name: aboveEntry.player_name, correct: aboveEntry.correct_answers } : null,
    below: belowEntry ? { name: belowEntry.player_name, correct: belowEntry.correct_answers } : null,
  }
}
