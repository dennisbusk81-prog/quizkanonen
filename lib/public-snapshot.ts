import { getOrBuildSnapshot, type SnapshotEntry } from './ranking-snapshot'
import { getGloballyBlockedSet } from './globally-blocked-set'

// ── Det SYNLIGE feltet for en quiz — ÉN implementasjon, ikke én per flate ────
// Trukket ut av app/api/quiz/[id]/standings/route.ts 13. august 2026. Ruten
// hadde filteret og den posisjonelle re-ranken inline, og tre andre flater som
// viser navn på andre spillere under spilling (social-proof, rival,
// live-ranking) skal gates senere. Skrives den samme logikken inn i hver av dem
// for hånd, er det tre sjanser til å avvike fra originalen — og «en feil har
// søsken»-regelen sier at avviket da oppdages ett sted av gangen.
//
// Gaten er den samme som /api/leaderboard/[id] og prev-rank bruker
// (lib/globally-blocked-set.ts): brukere blokkert fra den åpne konkurransen —
// org med allow_global_league=false, eller eget opt-out.
//
// FAIL-STENGT, IKKE ÅPENT. getGloballyBlockedSet returnerer HELE den spurte
// lista hvis den ikke klarer avgjøre hvem som er blokkert (se endring 1 i
// toppkommentaren der). Konsekvensen her er at `publicSnapshot` da kun
// inneholder gjester: en tom eller nesten tom liste framfor en feilaktig
// komplett en. Den retningen skal bevares — ikke «forbedre» den til å falle
// tilbake på det ufiltrerte feltet ved feil.
//
// Gjester (user_id = null) berøres aldri av gaten.

export type PublicSnapshot = {
  // Hele det rangerte feltet, UFILTRERT — nøyaktig slik getOrBuildSnapshot ga
  // det. getOrBuildSnapshot selv skal forbli ufiltrert: /standings trenger det
  // ufiltrerte feltet for at en BLOKKERT kaller skal beholde sin egen
  // plassering («egne tall skjules aldri for en selv»).
  snapshot: SnapshotEntry[]
  // Det synlige feltet: blokkerte fjernet, gjenværende posisjonelt re-ranket.
  publicSnapshot: SnapshotEntry[]
  // Settet gaten svarte med — for kallere som må vite om KALLEREN selv er
  // blokkert, og derfor skal regnes mot det ufiltrerte feltet.
  blocked: Set<string>
}

/**
 * Filtrer en ALLEREDE HENTET snapshot ned til det synlige feltet.
 *
 * Skilt fra `getPublicSnapshot` fordi /standings henter snapshoten PARALLELT
 * med quiz-raden (den trenger `closes_at` til cache-headeren fra samme rad som
 * `season_points_awarded`). Går snapshot-hentingen inn i denne funksjonen, blir
 * de to rundturene serielle. Nye kallere som ikke har den bindingen bør bruke
 * `getPublicSnapshot` under.
 */
export async function filterSnapshotToPublic(
  quizId: string,
  snapshot: SnapshotEntry[],
  seasonPointsAwarded: boolean,
): Promise<PublicSnapshot> {
  // Blocked-settet er 30s-cachet per quiz-id i lib-en (modul-lokal Map, delt
  // med leaderboard-ruten innenfor samme serverless-instans), så trafikk-toppen
  // ved quiz-slutt koster ikke en medlemskaps-spørring per spiller.
  const attemptUserIds = [...new Set(
    snapshot.map(e => e.user_id).filter((id): id is string => !!id)
  )]
  const blocked = attemptUserIds.length > 0
    ? await getGloballyBlockedSet(quizId, attemptUserIds, seasonPointsAwarded)
    : new Set<string>()

  // Posisjonell re-rank er korrekt fordi snapshoten allerede ER den totalordnede
  // lista (rankQuizAttempts, uten delte plasseringer) og filter bevarer
  // rekkefølgen — gjenværende starter på 1 uten hull.
  const publicSnapshot: SnapshotEntry[] = blocked.size > 0
    ? snapshot
        .filter(e => e.user_id == null || !blocked.has(e.user_id))
        .map((e, i) => ({ ...e, rank: i + 1 }))
    : snapshot

  return { snapshot, publicSnapshot, blocked }
}

/**
 * Hent quizens rangerte felt og filtrer det ned til den synlige delen.
 *
 * Tynt lag oppå `getOrBuildSnapshot` — som selv forblir ufiltrert, med vilje.
 */
export async function getPublicSnapshot(
  quizId: string,
  opts: { seasonPointsAwarded: boolean; ensureAttemptId?: string | null },
): Promise<PublicSnapshot> {
  const snapshot = await getOrBuildSnapshot(quizId, { ensureAttemptId: opts.ensureAttemptId })
  return filterSnapshotToPublic(quizId, snapshot, opts.seasonPointsAwarded)
}
