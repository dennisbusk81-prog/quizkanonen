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
  /**
   * Har-spilt-unntaket: en egen, INNSENDT rad løfter skjulingen for den som
   * spør. Het `premiumViewerHasOwnRow` fram til 29. august 2026, da
   * Premium-leddet falt bort på kallstedene — navnet ville da påstått et
   * vilkår funksjonen ikke lenger kjenner.
   *
   * Funksjonen spør IKKE hvem kalleren er. Den tar imot ferdig utledet «har
   * egen rad», og HVEM som får utlede den til true bor hos kallstedet. Det er
   * nettopp derfor server og klient kan mate den fra hver sin kilde
   * (`mine` / `userAttempt`) og likevel svare identisk om samme quiz.
   */
  viewerHasOwnRow: boolean
  /** Millisekunder siden epoch — injisert for testbarhet */
  now: number
}

export function decideHiddenUntilClosed(input: HiddenUntilClosedInput): boolean {
  if (!input.hideUntilClosed) return false
  // NULL = stenger aldri: «til quizen stenger» kan aldri inntreffe, og skjult
  // for alltid er ikke et utfall flagget skal kunne gi. Vis stillingen.
  if (input.closesAt === null) return false
  if (isQuizClosed(input.closesAt, input.now)) return false
  return !input.viewerHasOwnRow
}

// ── Hva skal en SKJULT stilling vise? (28. august 2026) ──────────────────────
// decideHiddenUntilClosed svarer på OM radene holdes tilbake. Denne svarer på
// hva brukeren da får se i stedet — og finnes fordi de to spørsmålene ble
// besvart i samme inline-betingelse, med ett utfall for lite.
//
// Feilen: `(!authLoading && !hasPlayed) ? <låseskjerm> : null`. Betingelsen var
// skrevet for authLoading (ikke vis låseskjerm mens vi ennå ikke vet om
// brukeren er Premium), men `hasPlayed` ble foldet inn i samme ledd. En
// innlogget GRATISBRUKER SOM HAR SPILT falt dermed i null-grenen: ingen liste,
// ingen låseskjerm, ingen forklaring — tom luft der stillingen skulle stått.
// Med hide_leaderboard_until_closed på (dagens fredagsquiz) er det flertallet
// av spillerne, i hele vinduet quizen er åpen.
//
// De tre utfallene er tre ULIKE ting å si, ikke to og et hull:
//   'nothing' — vi vet ennå ikke hvem som spør. Å gjette gir enten en
//               låseskjerm til en Premium-bruker eller motsatt; ingen tekst er
//               riktigere enn feil tekst i et vindu som varer i millisekunder.
//   'locked'  — har ikke spilt. «Kun synlig for de som har spilt» er sant, og
//               handlingen er å spille.
//   'waiting' — HAR spilt. Samme setning ville vært usann her: hun oppfylte
//               nettopp vilkåret den stiller. Hun venter, hun er ikke stengt
//               ute — og det er derfor et eget utfall og ikke en variant.
//
// Som ren funksjon kan gaten mutasjonstestes; den inline-betingelsen den
// erstatter kunne ikke. Samme begrunnelse som shouldShowFreePlacementCard i
// lib/placement-visibility.ts, som ble flyttet ut av JSX-en på nøyaktig samme
// side, av nøyaktig samme grunn.
export type HiddenLeaderboardView = 'nothing' | 'locked' | 'waiting'

export function decideHiddenLeaderboardView(input: {
  /** Auth/profil er ikke avklart ennå — vi vet ikke hvem som spør. */
  authLoading: boolean
  /** Har brukeren et resultat på denne quizen? */
  hasPlayed: boolean
}): HiddenLeaderboardView {
  if (input.authLoading) return 'nothing'
  return input.hasPlayed ? 'waiting' : 'locked'
}

/**
 * Stengetid som norsk klokkeslett, eller `null` når quizen ikke stenger.
 *
 * Finnes for at kallstedene ikke skal skrive `new Date(quiz.closes_at)` selv —
 * NONNULL-regelen øverst i app/leaderboard/[id]/page.tsx og strukturvakten i
 * lib/nonnull-quiz-date-sites.test.ts. Regelen er bevisst FORM-basert, ikke
 * resonnement-basert: `new Date(null)` er epoch, og «kl. 01:00» skrevet med
 * full selvtillit er verre enn ingen tid. Da skal ingen kaller måtte utlede på
 * nytt at akkurat deres sted er trygt.
 *
 * Eksplisitt Europe/Oslo: uten tidssone leser toLocaleTimeString besøkerens
 * EGEN nettleserklokke, som er feil for enhver spiller utenfor Norge.
 */
export function osloClosingTime(closesAt: string | null): string | null {
  if (closesAt === null) return null
  const d = new Date(closesAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
}
