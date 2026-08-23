// ── Rekalkulering av season_scores etter at attempts er rettet ───────────────
//
// REN funksjon, uten I/O. Ligger i egen fil fordi den da kan testes direkte med
// `node --test` uten å dra inn `supabase-admin` (som er `server-only` og krever
// env-variabler). I/O-siden ligger i lib/resync-season-scores.ts.
//
// ─────────────────────────────────────────────────────────────────────────────
// KRITISK PRINSIPP — LES DETTE FØR DU ENDRER NOE HER
//
// season_scores er et ØYEBLIKKSBILDE skrevet én gang av award-season-points da
// quizen stengte. Når en fasit rettes i ettertid endres attempts.correct_answers,
// og dermed plasseringene — men de lagrede radene står igjen med gamle tall.
//
// Man kan IKKE bare kjøre award-season-points sin processQuiz() på nytt:
//
//   1. (Endret 24. august 2026:) upserten er nå en MERGE — en gjenkjøring
//      OVERSKRIVER eksisterende rader. Det gjør punkt 2 under FARLIGERE, ikke
//      mildere: fram til nå var en feilaktig gjenkjøring en no-op; nå gjør den
//      faktisk skade. Beskyttelsen bor i UTVALGET — processQuiz kalles kun for
//      quizer med closes_at innenfor RESETTLE_SCAN_MS (rekjøringsvinduet i
//      publish-quiz, se lib/late-play-window.ts), der medlemskapsdrift ikke
//      rekker å oppstå.
//   2. Den utleder populasjonen (hvem som er med i en liga/org,
//      og hvem som er blokkert fra global) fra medlemskapstabellene slik de ser
//      ut I DAG. Medlemskap drifter — folk melder seg ut av ligaer og skrur på
//      global_league_opt_out. En gjenkjøring ville derfor slettet eller
//      forvrengt historiske plasseringer for alle som har endret medlemskap
//      siden quizen stengte. Det er retroaktiv omskriving av historikk, ikke en
//      retting.
//
// Derfor rekonstrueres populasjonen her fra de LAGREDE radene:
//
//   - LIGA/ORG: hvem som HAR en lagret rad for (quiz, scope) ER definisjonen av
//     hvem som var med da quizen stengte. Den gruppen rangeres på nytt med
//     dagens (rettede) attempts-tall.
//   - GLOBAL: rangeres over HELE attempt-populasjonen — nøyaktig som kilden, som
//     rangerer først og filtrerer blokkerte brukere bort ETTERPÅ. Rank-tallene er
//     dermed per konstruksjon uavhengige av hvem som er blokkert i dag.
//
// Ingen rad settes noensinne inn eller slettes, og closes_at røres aldri
// (periodetilhørighet må stå urørt). Kun rank/points på eksisterende rader.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getSeasonPoints,
  bestSeasonAttemptsByUser,
  rankSeasonAttempts,
  type SeasonAttempt,
} from '@/lib/season-points'

export type StoredSeasonRow = {
  id: string
  user_id: string
  scope_type: string
  scope_id: string | null
  points: number
  rank: number
}

export type SeasonResyncChange = {
  id: string
  user_id: string
  scope_type: string
  scope_id: string | null
  fromRank: number
  toRank: number
  fromPoints: number
  toPoints: number
}

export type SeasonResyncPlan = {
  /** Antall lagrede rader som ble vurdert. */
  checked: number
  /** Rader der rank og/eller points avviker fra ny beregning. */
  changes: SeasonResyncChange[]
  /**
   * Rader som peker på en bruker uten forsøk på quizen. Da finnes ingen
   * plassering å utlede, og raden lates bevisst i fred.
   */
  unresolvable: StoredSeasonRow[]
}

const scopeKey = (scopeType: string, scopeId: string | null) => `${scopeType}|${scopeId ?? ''}`

/**
 * Regner ut hvilke season_scores-rader som må oppdateres etter en fasitretting.
 *
 * @param storedRows Alle lagrede season_scores-rader for ÉN quiz, alle scope.
 * @param attempts   Alle attempts for samme quiz (is_team = false, user_id satt),
 *                   med allerede rettede correct_answers.
 */
export function planSeasonResync(
  storedRows: StoredSeasonRow[],
  attempts: SeasonAttempt[]
): SeasonResyncPlan {
  const bestByUser = bestSeasonAttemptsByUser(attempts)

  // GLOBAL — full populasjon, identisk med award-season-points sin rangering.
  const globalRank = new Map(rankSeasonAttempts(bestByUser).map(r => [r.userId, r.rank]))

  // LIGA/ORG — historisk populasjon rekonstruert fra de lagrede radene.
  const membersByScope = new Map<string, Set<string>>()
  for (const row of storedRows) {
    if (row.scope_type === 'global') continue
    const key = scopeKey(row.scope_type, row.scope_id)
    let members = membersByScope.get(key)
    if (!members) { members = new Set(); membersByScope.set(key, members) }
    members.add(row.user_id)
  }

  const rankByScope = new Map<string, Map<string, number>>()
  for (const [key, members] of membersByScope) {
    const subset = new Map<string, SeasonAttempt>()
    for (const userId of members) {
      const attempt = bestByUser.get(userId)
      if (attempt) subset.set(userId, attempt)
    }
    if (subset.size === 0) continue
    rankByScope.set(key, new Map(rankSeasonAttempts(subset).map(r => [r.userId, r.rank])))
  }

  const changes: SeasonResyncChange[] = []
  const unresolvable: StoredSeasonRow[] = []

  for (const row of storedRows) {
    const newRank = row.scope_type === 'global'
      ? globalRank.get(row.user_id)
      : rankByScope.get(scopeKey(row.scope_type, row.scope_id))?.get(row.user_id)

    if (newRank === undefined) {
      unresolvable.push(row)
      continue
    }

    const newPoints = getSeasonPoints(newRank)
    if (row.rank !== newRank || row.points !== newPoints) {
      changes.push({
        id: row.id,
        user_id: row.user_id,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        fromRank: row.rank,
        toRank: newRank,
        fromPoints: row.points,
        toPoints: newPoints,
      })
    }
  }

  return { checked: storedRows.length, changes, unresolvable }
}
