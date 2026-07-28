/**
 * Ren logikk for periode-topplistenes tabellformat (28. juli 2026,
 * periode-tabell-final-spec) — trukket ut av components/SeasonLeaderboard.tsx
 * for å være testbar uten React.
 */

export function formatQuizCount(quizCount: number): string {
  return `${quizCount} ${quizCount === 1 ? 'quiz' : 'quizer'}`
}

export type PlacementRowState = {
  isLastQuiz: boolean
  /** True hvis brukerens egen rad allerede er synlig i hovedlisten. */
  userVisible: boolean
  /** userEntry.rank fra API-et, eller null hvis ingen userEntry finnes. */
  userEntryRank: number | null
  isPremium: boolean
  scope: 'global' | 'league' | 'organization'
}

/**
 * Skal brukerens egen plassering vises som en tabellrad (med separator)
 * i periode-visningene? Mønster fra app/leaderboard/[id]/page.tsx.
 *
 * KUN periode-visninger (måned/kvartal/år/all-time) — Siste quiz sin
 * userEntry mangler fastestMs (API-et henter det ikke for den grenen), så
 * Tid-kolonnen der ikke kan fylles ut korrekt uten en API-endring. Det er
 * derfor `isLastQuiz` alltid gir `false` her, uansett de andre feltene —
 * ikke en forglemmelse, se components/SeasonLeaderboard.tsx sin
 * renderUserSection().
 *
 * Samme tre betingelser som «Premium (eller org) + utenfor topp 10, ikke
 * allerede synlig» fra det gamle userCardGold-kortet — kun DATA-grenen av
 * renderUserSection() sine fire grener konverteres, de tre CTA-grenene
 * (ikke innlogget / ikke Premium / ikke spilt) forblir kort, se
 * kartleggingen i periode-tabell-final-spec.
 */
export function shouldShowPeriodPlacementRow(state: PlacementRowState): boolean {
  if (state.isLastQuiz) return false
  if (state.userVisible) return false
  if (state.userEntryRank == null) return false
  if (state.userEntryRank <= 10) return false
  return state.isPremium || state.scope === 'organization'
}
