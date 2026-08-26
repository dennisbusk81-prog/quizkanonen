// ── «Skjult til quizen stenger» — ÉN beslutning for klient OG server ─────────
//
// Fram til 26. august 2026 (NONNULL-sveipet, B1/B5 i
// .claude/QK_SVEIP_NONNULL_QUIZDATOER_26AUG.md) fantes denne beslutningen i to
// håndskrevne kopier som kunne bli uenige om samme quiz:
//
//   server (app/api/leaderboard/[id]/route.ts):
//       hide_leaderboard_until_closed && !isQuizClosed(closes_at) && !unntak
//   klient (app/leaderboard/[id]/page.tsx):
//       hide_leaderboard_until_closed && (opens_at <= now && closes_at >= now)
//       && !unntak                        — uguardet new Date, NULL = epoch
//
// Med NULL i closes_at konkluderte serveren «åpen → skjul radene» mens
// klienten konkluderte «stengt → ikke skjult» — resultatet var en tom liste
// uten forklaring. Samme klasse som admin-sesjonsregelen i CLAUDE.md: når
// klient og server tolker samme verdi, må de tolke den IDENTISK. Derfor bor
// tolkningen nå i ÉN funksjon som begge kaller.
//
// NULL-standpunktet (B5, Dennis-beslutning 26. august): closes_at NULL betyr
// «quizen stenger aldri». «Skjult til stengt» ville da vært skjult FOR ALLTID
// — det skal flagget ikke kunne bety. Arkivkopier skal ikke arve flagget
// (håndheves i kopieringsruten når den bygges); lesestedet her sørger for at
// en NULL-quiz uansett aldri låses ute permanent.
//
// Merk at klientens gamle opens_at-ledd er BEVISST utelatt: serveren har aldri
// sett på opens_at her, og en flagget quiz som ikke har åpnet ennå fikk derfor
// radene tømt server-side mens klienten viste tom liste uten melding — samme
// paritetsbrudd, bare i for-tidlig-enden. Nå viser klienten
// «kommer når quizen stenger»-meldingen i det tilfellet også.

import { isQuizClosed } from './standings-cache'

export type HiddenUntilClosedInput = {
  /** quizzes.hide_leaderboard_until_closed */
  hideUntilClosed: boolean
  /** quizzes.closes_at — NULL = stenger aldri */
  closesAt: string | null
  /** Premium-og-har-spilt-unntaket: egen rad løfter skjulingen for den som spør */
  premiumViewerHasOwnRow: boolean
  /** Millisekunder siden epoch — injisert for testbarhet */
  now: number
}

export function decideHiddenUntilClosed(input: HiddenUntilClosedInput): boolean {
  if (!input.hideUntilClosed) return false
  // NULL = stenger aldri: «til quizen stenger» kan aldri inntreffe, og skjult
  // for alltid er ikke et utfall flagget skal kunne gi. Vis stillingen.
  if (input.closesAt === null) return false
  if (isQuizClosed(input.closesAt, input.now)) return false
  return !input.premiumViewerHasOwnRow
}
