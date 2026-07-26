/**
 * Hvem som skal skjules fra den GLOBALE «Siste quiz»-fanen på toppliste.
 *
 * Ren logikk, uten I/O — kalleren gjør oppslagene. Se
 * app/api/toppliste/route.ts (getGloballyBlockedSet).
 *
 * PRINSIPPET: historikken står som den var. En endring i
 * global_league_opt_out (eller org-ens allow_global_league) skal kun gjelde
 * fremover — den skal aldri endre hvordan en quiz som allerede er spilt og
 * gjort opp vises. Det er slik periodevisningene (måned/kvartal/år/all-time)
 * oppfører seg: de leser season_scores, og filtrerer aldri de historiske
 * radene på dagens status.
 */

/**
 * Utleder blokkerte brukere for en FERDIG BEHANDLET quiz
 * (season_points_awarded = true).
 *
 * award-season-points skriver kun en global season_scores-rad for brukere som
 * IKKE var blokkert da quizen ble gjort opp. Fraværet av en rad er derfor selve
 * det persisterte vedtaket: «denne brukeren skulle ikke være med globalt».
 *
 * Begge sidene starter fra samme attempts-populasjon (is_team = false,
 * user_id ikke null). award filtrerer IKKE på submitted_at, så en spiller som
 * startet uten å levere får også en rad — et ulevert forsøk kan altså ikke gi
 * et falskt «blokkert» her.
 */
export function deriveBlockedFromScores(
  attemptUserIds: readonly string[],
  scoredUserIds: readonly string[]
): Set<string> {
  const scored = new Set(scoredUserIds)
  const blocked = new Set<string>()
  for (const uid of attemptUserIds) {
    if (!scored.has(uid)) blocked.add(uid)
  }
  return blocked
}

export type OrgMembership = {
  user_id: string
  organization_id: string
  global_league_opt_out: boolean | null
}

/**
 * Blokkerte brukere ut fra NÅVÆRENDE medlemskapsstatus.
 *
 * Brukes kun når quizen ennå ikke er gjort opp (fortsatt åpen, eller cronen
 * har ikke rukket den). Da finnes ingen historisk fasit å lese, og dagens
 * status er per definisjon også datidens — ingen tilbakevirkende kraft er
 * mulig i det vinduet.
 */
export function deriveBlockedFromLiveStatus(
  memberships: readonly OrgMembership[],
  restrictedOrgIds: ReadonlySet<string>
): Set<string> {
  const blocked = new Set<string>()
  for (const m of memberships) {
    if (restrictedOrgIds.has(m.organization_id) || m.global_league_opt_out === true) {
      blocked.add(m.user_id)
    }
  }
  return blocked
}
