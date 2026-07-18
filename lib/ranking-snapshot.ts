import { supabaseAdmin } from './supabase-admin'
import { rankQuizAttempts, type RankableAttempt } from './ranking'

// ── ÉN felles rangert liste for LIVE plassering, topp-3 og sluttresultat ─────
// Alle plasseringsflater (topp-3, "din plassering", live-ranking underveis)
// utledes NÅ av den samme snapshoten, bygget med den SAMME rangeringsfunksjonen
// (rankQuizAttempts — total ordning, id som siste tiebreak, ingen delte
// plasseringer) og den SAMME ferdig-definisjonen (submitted_at IS NOT NULL).
//
// Konsekvens: topp-3 og "din plassering" kan aldri lenger vise ulike tall på
// samme skjerm — de leser samme liste, i samme øyeblikk, via /standings-ruten.
//
// Merk: snapshoten er uavhengig av spørsmålsindeks (samme ferdig-pool uansett).
// Den caches derfor med ÉN rad per quiz — ikke lenger per (quiz_id,
// question_index). Den gamle nøkkelen delte trafikken på like mange nøkler som
// quizen har spørsmål, slik at hver nøkkel ble truffet sjeldnere enn TTL-en og
// cachen i praksis aldri traff. Samme rangering, samme output — kun færre
// rebuilds og dermed færre JSONB-skrivinger (Disk IO).

export type SnapshotEntry = {
  id: string
  user_id: string | null
  player_name: string
  rank: number
  correct_answers: number
  total_time_ms: number
  correct_streak: number
}

// FIX (Sak 1B): 10s TTL slik at live-plasseringen ikke henger etter.
export const CACHE_TTL_MS = 10_000

// Tabellen har UNIQUE(quiz_id, question_index) og question_index NOT NULL. Vi
// beholder skjemaet uendret og bruker én fast slot-verdi som lagringsplass, slik
// at det finnes nøyaktig én cache-rad per quiz. Ingen migrasjon nødvendig.
// (Gamle rader med question_index > 0 blir liggende, men leses aldri mer.)
const SNAPSHOT_SLOT = 0

type Opts = {
  // Når satt: hvis dette attempt-id-et IKKE finnes i den cachede snapshoten,
  // regnes cachen som utdatert og bygges på nytt. Brukes rett etter innsending
  // slik at spilleren selv garantert er med i lista topp-3 og "din plassering"
  // begge leser — uten å tvinge en rebuild på hver sidevisning (amortisering).
  ensureAttemptId?: string | null
}

export async function getOrBuildSnapshot(
  quizId: string,
  opts: Opts = {},
): Promise<SnapshotEntry[]> {
  const { data: cached } = await supabaseAdmin
    .from('ranking_snapshots')
    .select('snapshot, created_at')
    .eq('quiz_id', quizId)
    .eq('question_index', SNAPSHOT_SLOT)
    .maybeSingle()

  const cachedSnap = cached?.snapshot as SnapshotEntry[] | undefined
  const fresh = !!cached && Date.now() - new Date(cached.created_at as string).getTime() <= CACHE_TTL_MS
  const missingEnsured =
    !!opts.ensureAttemptId && !!cachedSnap && !cachedSnap.some(e => e.id === opts.ensureAttemptId)

  if (fresh && cachedSnap && !missingEnsured) {
    return cachedSnap
  }

  // Rebuild utløst KUN av ensureAttemptId (cachen var ellers fersk): spilleren
  // har nettopp levert og er ikke med i den cachede lista ennå. Vi beregner en
  // fersk snapshot og returnerer den, men skriver den IKKE tilbake til DB.
  //
  // Uten dette ville hver eneste innsending i sluttminuttene tvinge en full
  // JSONB-UPDATE — nøyaktig når trafikktoppen treffer ved quiz-stenging.
  // Cachen oppdateres i stedet av neste ordinære (TTL-utløste) rebuild.
  const skipWrite = fresh && !!cachedSnap && missingEnsured

  // Hent alle LEVERTE solo-forsøk. ÉN ferdig-definisjon: submitted_at IS NOT NULL
  // (den kanoniske innsendingsmarkøren fra submit/route.ts). Erstatter det
  // tidligere total_time_ms>0-proxyet, så populasjonen er identisk med topp-3.
  const { data: attempts, error } = await supabaseAdmin
    .from('attempts')
    .select('id, user_id, player_name, correct_answers, total_time_ms, correct_streak, submitted_at')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('submitted_at', 'is', null)

  if (error) throw error

  // Rangér med fasiten (rankQuizAttempts): filtrerer (submitted), dedup'er
  // (beste per spiller; user_id, ellers name:<player_name> for gjester) og gir
  // total ordning uten delte plasseringer. Gjester inkluderes — samme
  // populasjon som topp-3/leaderboard.
  const ranked = rankQuizAttempts((attempts ?? []) as unknown as RankableAttempt[], {
    includeGuests: true,
    requireSubmitted: true,
  })

  const snapshot: SnapshotEntry[] = ranked.map(a => ({
    id:              a.id,
    user_id:         a.user_id,
    player_name:     a.player_name,
    rank:            a.rank,
    correct_answers: a.correct_answers,
    total_time_ms:   a.total_time_ms,
    correct_streak:  a.correct_streak ?? 0,
  }))

  if (!skipWrite) {
    await supabaseAdmin
      .from('ranking_snapshots')
      .upsert(
        {
          quiz_id:        quizId,
          question_index: SNAPSHOT_SLOT,
          snapshot,
          created_at:     new Date().toISOString(),
        },
        { onConflict: 'quiz_id,question_index' },
      )
  }

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

type PlaceOpts = {
  // Spillerens eget attempt-id. Hvis det finnes i snapshoten (spilleren har
  // levert), brukes spillerens EGEN rank fra den delte rangerte lista — da er
  // "din plassering" per definisjon lik topp-3 (samme liste, samme rank).
  attemptId?: string | null
  correct: number
  time: number
  // Del A — garantér rang <= total:
  //   false → spilleren er beviselig IKKE i den ferdige poolen (uferdig forsøk
  //           under spill) → total = ferdige + 1 (også en sisteplass holder).
  //   true  → spilleren KAN være i poolen (resultatskjerm) → total =
  //           max(ferdige, rang) unngår både dobbelttelling og umulige tall.
  playerInPool: boolean
}

export function computePlacement(snapshot: SnapshotEntry[], opts: PlaceOpts): Placement {
  const finished = snapshot.length

  // ── Definitiv plassering: spilleren finnes i den delte rangerte lista ──────
  const self = opts.attemptId ? snapshot.find(e => e.id === opts.attemptId) : undefined
  if (self) {
    const rank = self.rank
    const total = finished // spilleren er allerede talt med i lista
    const above = snapshot.find(e => e.rank === rank - 1) ?? null
    const below = snapshot.find(e => e.rank === rank + 1) ?? null
    return {
      rank,
      total,
      low: Math.max(1, rank - 2),
      high: Math.min(total, rank + 2),
      above: above ? { name: above.player_name, correct: above.correct_answers } : null,
      below: below ? { name: below.player_name, correct: below.correct_answers } : null,
    }
  }

  // ── Estimat: spilleren er ikke i lista (under spill / gjest uten match) ─────
  // Plasser via de samme primærnøklene som rankQuizAttempts (flest riktige,
  // deretter raskest tid). Ingen egen andre-rangeringsfunksjon — dette bare
  // finner hvor den delvise spilleren ville falt inn i den ferdige lista.
  const strictlyBetter = snapshot.filter(e =>
    e.correct_answers > opts.correct ||
    (e.correct_answers === opts.correct && opts.time > 0 && e.total_time_ms < opts.time),
  )
  const strictlyWorse = snapshot.filter(e =>
    e.correct_answers < opts.correct ||
    (e.correct_answers === opts.correct && opts.time > 0 && e.total_time_ms > opts.time),
  )

  const rank = strictlyBetter.length + 1
  const total = opts.playerInPool ? Math.max(finished, rank) : finished + 1

  const aboveEntry = strictlyBetter.length > 0 ? strictlyBetter[strictlyBetter.length - 1] : null
  const belowEntry = strictlyWorse.length > 0 ? strictlyWorse[0] : null

  return {
    rank,
    total,
    low: Math.max(1, rank - 2),
    high: Math.min(total, rank + 2),
    above: aboveEntry ? { name: aboveEntry.player_name, correct: aboveEntry.correct_answers } : null,
    below: belowEntry ? { name: belowEntry.player_name, correct: belowEntry.correct_answers } : null,
  }
}
