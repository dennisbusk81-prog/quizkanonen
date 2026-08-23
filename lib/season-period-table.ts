/**
 * Ren logikk for topplistenes tabellformat (28. juli 2026, periode-tabell-
 * final-spec) — trukket ut av components/SeasonLeaderboard.tsx for å være
 * testbar uten React.
 */

import { isClosedRoom } from './leaderboard-scope'

export function formatQuizCount(quizCount: number): string {
  return `${quizCount} ${quizCount === 1 ? 'quiz' : 'quizer'}`
}

export type PlacementRowState = {
  /** True hvis brukerens egen rad allerede er synlig i hovedlisten. */
  userVisible: boolean
  /** userEntry.rank fra API-et, eller null hvis ingen userEntry finnes. */
  userEntryRank: number | null
  isPremium: boolean
  scope: 'global' | 'league' | 'organization'
  /**
   * True når API-et sier at kalleren er blokkert fra den åpne topplisten
   * (userBlockedFromGlobal, 5. august 2026). Da finnes userEntry kun som
   * bærer av «egne tall» — ranken er mot det UFILTRERTE feltet og skal ikke
   * tegnes som en rad i den offentlige listen. renderUserSection viser i
   * stedet en sann tekst.
   */
  userBlockedFromGlobal: boolean
}

/**
 * Skal brukerens egen plassering vises som en tabellrad (med separator) i
 * ALLE faner — Siste quiz og periode-visningene (måned/kvartal/år/
 * all-time)? Mønster fra app/leaderboard/[id]/page.tsx.
 *
 * Fram til 28. juli 2026 ga denne alltid `false` for Siste quiz, fordi
 * userEntry fra API-et manglet fastestMs (Tid-kolonnen kunne derfor ikke
 * fylles ut korrekt). `/api/toppliste` sin last_quiz-gren setter nå
 * fastestMs fra samme withRanks-rad som resten av entries-listen bruker —
 * ingen gjenværende grunn til å skille periode fra Siste quiz her.
 *
 * Samme tre betingelser som «Premium (eller org) + utenfor topp 10, ikke
 * allerede synlig» fra det gamle userCardGold-kortet — kun DATA-grenen av
 * renderUserSection() sine fire grener konverteres, de tre CTA-grenene
 * (ikke innlogget / ikke Premium / ikke spilt) forblir kort, se
 * kartleggingen i periode-tabell-final-spec.
 */
export function shouldShowPlacementRow(state: PlacementRowState): boolean {
  if (state.userBlockedFromGlobal) return false
  if (state.userVisible) return false
  if (state.userEntryRank == null) return false
  if (state.userEntryRank <= 10) return false
  // Lukket rom (liga ELLER org) — se lib/leaderboard-scope.ts. Sto som
  // `scope === 'organization'` fram til 23. august 2026, slik at et gratis
  // ligamedlem utenfor topp 10 mistet plasseringsraden og i stedet fikk
  // paywall-kortet i renderUserSection — inne i et rom der alle andres
  // eksakte plassering allerede var synlig.
  return state.isPremium || isClosedRoom(state.scope)
}

export type PlacementRowSource = {
  rank: number
  displayName: string
  nickname?: string | null
  points: number
  quizCount: number
  /** Kun til stede for Siste quiz (se app/api/toppliste/route.ts sin last_quiz-gren). */
  fastestMs?: number | null
}

/**
 * Bygger «Din plassering»-raden fra userEntry. Eneste stedet Siste quiz og
 * periode-visninger faktisk skiller seg fra hverandre etter 28. juli-fiksen:
 * Siste quiz viser ekte tid (Tid-kolonnen er synlig der, se
 * ResultsTable sin `showTimeColumn`), periode-visninger viser quizCount som
 * undertekst i stedet (ingen tid-begrep, kolonnen er skjult der).
 */
export function buildPlacementRow(ue: PlacementRowSource, isLastQuiz: boolean) {
  const nick = ue.nickname?.trim()
  const hasNick = !!nick
  return {
    key: 'user-placement',
    rank: ue.rank,
    name: hasNick ? nick! : ue.displayName,
    secondary: hasNick ? ue.displayName : null,
    correctAnswers: ue.points,
    totalTimeMs: isLastQuiz ? (ue.fastestMs ?? 0) : 0,
    metricSubLabel: isLastQuiz ? null : formatQuizCount(ue.quizCount),
    highlight: true as const,
    separatorLabel: '— Din plassering —',
  }
}
