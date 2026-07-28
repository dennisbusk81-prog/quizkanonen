/**
 * H2H Duell er gratis for alle innloggede, på alle rader unntatt egen.
 *
 * Trukket ut 28. juli 2026 fra app/leaderboard/[id]/page.tsx sin
 * attemptToRow — kartleggingen samme dag viste at komponentens Premium
 * søk-/paginerings-mapper (browseEntryToRow) aldri fikk denne logikken da
 * ResultsTable-formatet ble innført 26. juli, så "Utfordre" manglet helt
 * for rader utenfor topp 50. Trukket hit (i stedet for en lokal closure)
 * slik at BÅDE attemptToRow og browseEntryToRow bruker nøyaktig samme
 * beslutning, og slik at logikken er testbar uten React.
 *
 * `trailingLabel`-teksten («Sendt» / «Duell sendt!») er bevisst IKKE en del
 * av denne funksjonen — ResultsTable sitt `trailingLabel`-felt er
 * domene-agnostisk med hensikt (se components/ResultsTable.tsx), og de to
 * kalleres (leaderboard/[id] og SeasonLeaderboard) har alltid brukt litt
 * ulik ordlyd. Funksjonen returnerer kun `alreadySent` som kalleren
 * oversetter til sin egen tekst.
 */
export type DuelAffordanceState = {
  currentUserId: string | null
  /** Bruker-id-er involvert i en ikke-utløpt duell (aktiv eller ventende, begge sider). */
  duelInvolvedIds: Set<string>
  /** Bruker-id-er en UTGÅENDE forespørsel allerede er sendt til. */
  challengeSentIds: Set<string>
  /** Om brukeren allerede har en annen aktiv/ventende duell denne måneden. */
  activeDuelExists: boolean
  /** Bruker-id-en en forespørsel akkurat nå er underveis for (forhindrer dobbel-klikk). */
  challengeLoadingId: string | null
}

export type DuelAffordance = {
  clickable: boolean
  /** True når raden skal vise en "allerede sendt"-etikett i stedet for chevron. */
  alreadySent: boolean
}

export function computeDuelAffordance(
  userId: string | null,
  isSelf: boolean,
  state: DuelAffordanceState,
): DuelAffordance {
  if (isSelf || !state.currentUserId || !userId) {
    return { clickable: false, alreadySent: false }
  }
  const involved = state.duelInvolvedIds.has(userId)
  const sent = state.challengeSentIds.has(userId)
  if (involved && sent) {
    return { clickable: false, alreadySent: true }
  }
  if (!involved && !state.activeDuelExists) {
    // Klikkbar kun mens ingen forespørsel for NETTOPP denne mottakeren er
    // underveis — hindrer dobbel-innsending hvis raden rekker å bli
    // trykkbar igjen i vinduet mellom modal-lukk og at
    // challengeSentIds/duelInvolvedIds faktisk oppdateres.
    const isLoading = state.challengeLoadingId === userId
    return { clickable: !isLoading, alreadySent: false }
  }
  // involved uten sent, eller activeDuelExists: skjules stille — verken
  // chevron eller merkelapp.
  return { clickable: false, alreadySent: false }
}
