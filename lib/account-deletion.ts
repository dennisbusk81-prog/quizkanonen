// ── Ren beslutningslogikk for kontosletting ─────────────────────────────────
// Bakgrunn (liga-kartleggingen 28. juli 2026, FUNN 3.2): tre fremmednøkler
// peker på profiles.id uten at app/api/profile/delete rydder i dem, og de har
// ulik ON DELETE-regel. Regelen ble bekreftet med en direkte spørring mot
// information_schema i prod:
//
//   leagues.owner_id                 → CASCADE
//     Sletter liga-eieren kontoen sin, forsvinner HELE ligaen stille for alle
//     de andre medlemmene. Ingen advarsel, ingen mulighet til å overta først.
//
//   organizations.created_by         → NO ACTION
//   organization_invites.created_by  → NO ACTION
//     Databasen nekter å slette profilrader noe fortsatt peker på, så
//     deleteUser feiler. En org-oppretter kan i praksis ALDRI slette kontoen
//     sin — et reelt brudd på retten til sletting (GDPR art. 17).
//
//   push_subscriptions.user_id       → CASCADE (uproblematisk, se rapport)
//
// Denne filen avgjør HVA som skal skje. Selve I/O-en ligger i ruten, etter
// samme mønster som lib/premium-state.ts (ren) + lib/premium-state-io.ts (I/O).

export type LeagueMemberRef = {
  user_id: string
  /** Kan være null på gamle rader; håndteres eksplisitt i sorteringen. */
  joined_at: string | null
}

export type LeagueOwnershipPlan =
  | { leagueId: string; action: 'transfer'; newOwnerId: string }
  | { leagueId: string; action: 'delete' }

/**
 * Hvem arver ligaen når eieren sletter kontoen sin?
 *
 * VALGT REGEL: medlemmet som har vært lengst i ligaen (laveste `joined_at`).
 *
 * Begrunnelse: det er den mest forutsigbare regelen som ikke krever noe nytt
 * av brukeren. Alternativene var «tilfeldig» (uforklarlig for den som plutselig
 * blir eier) og «den med flest poeng» (gjør eierskap til en premie, og ville
 * flyttet seg fra måned til måned). Ansiennitet er stabil, lett å forklare i
 * ettertid, og treffer normalt den som var med fra starten.
 *
 * `joined_at = null` sorteres SIST: en rad uten tidspunkt kan ikke dokumentere
 * ansiennitet, og skal ikke slå en rad som kan det. Uavgjort brytes på
 * `user_id` slik at resultatet er determinstisk — to kjøringer på samme data
 * skal aldri gi ulik eier.
 *
 * Returnerer null når det ikke finnes noen andre medlemmer.
 */
export function pickSuccessor(
  members: LeagueMemberRef[],
  departingUserId: string,
): string | null {
  const candidates = members.filter(m => m.user_id !== departingUserId)
  if (candidates.length === 0) return null

  const sorted = [...candidates].sort((a, b) => {
    const aTime = a.joined_at ? new Date(a.joined_at).getTime() : Number.POSITIVE_INFINITY
    const bTime = b.joined_at ? new Date(b.joined_at).getTime() : Number.POSITIVE_INFINITY
    if (aTime !== bTime) return aTime - bTime
    return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0
  })

  return sorted[0].user_id
}

/**
 * Hva skjer med én liga brukeren eier?
 *
 * Finnes det andre medlemmer, overføres eierskapet — ligaen skal overleve.
 * Er brukeren eneste medlem, slettes ligaen som en del av den ordinære
 * opprydningen; da rammes ingen andre.
 */
export function planLeagueOwnership(
  leagueId: string,
  members: LeagueMemberRef[],
  departingUserId: string,
): LeagueOwnershipPlan {
  const successor = pickSuccessor(members, departingUserId)
  return successor
    ? { leagueId, action: 'transfer', newOwnerId: successor }
    : { leagueId, action: 'delete' }
}
