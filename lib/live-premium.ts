// ── Premium-gate for live-flatene under spilling (P-2, 23. august 2026) ──────
//
// Fire ruter sendte eksakt plassering — og nabonavn — til enhver kaller:
// /api/quiz/[id]/standings, /api/quiz/[id]/ranking-snapshot,
// /api/quiz/live-ranking og /api/quiz/rival. Ingen av dem gjorde noen
// auth-sjekk i det hele tatt. Bekreftet anonymt mot prod 23. august 2026:
// et rått curl mot live-ranking ga `userRank: 16` pluss navnet på spilleren
// over og under. Klienten gatet visningen; serveren sendte tallet uansett.
//
// ── HVORFOR KRAVET LIGGER I TOKENET, IKKE I ET OPPSLAG ───────────────────────
// Se lib/attempt-token.ts for hele regnestykket. Kort: `auth.getUser` +
// `getUserPremium` er to serielle rundturer, ranking-snapshot ble kalt 21,6
// ganger per spiller 21. august, og ett kallsted ligger `await`et rett etter
// at spilleren trykker på et svar. Premium leses derfor én gang ved
// start-attempt og signeres inn i attempt-tokenet; her verifiseres det med
// lokal HMAC, uten nettverk.
//
// Verifiseringen ligger INNE i denne funksjonen, ikke hos kallerne — samme
// «rens ved sinket»-mønster som liveRateLimitKey (lib/live-rate-limit.ts) og
// escapingen i lib/email-templates.ts. Da kan ingen framtidig rute komme til å
// stole på et UVERIFISERT premium-krav. Et påstått attemptId uten gyldig
// signatur er ikke premium, punktum.
//
// ── PARITET MED KLIENTEN (krav 5) ────────────────────────────────────────────
// Klienten gatet allerede — men på SIN egen `isPremium` fra ProfileProvider,
// ikke på noe serveren sa. Når serveren nå også gater, er det to uavhengige
// meninger om samme spørsmål, og de kan avvike i ett reelt tilfelle: kjøper
// noen Premium midt i en quiz, sier tokenet «gratis» til neste sidelast.
//
// Kontrakten som fjerner avviket: SVARET BÆRER HVA SERVEREN AVGJORDE.
// `rank`/`above`/`below` er `null` — ikke utelatt, ikke 0 — når kalleren ikke
// fikk eksakt plassering, og `low`/`high` sendes ALLTID. Klienten tegner det
// den fikk i stedet for det den trodde den ville få: mangler `rank`, vises
// spennet. Den samme fellen som [P-3] 21. august (tom liste ved siden av
// «Plass 49 av 49») kan da ikke oppstå — det finnes ikke en tilstand der
// klienten har et eksakt tall å vise og serveren mener den ikke skal ha det.
//
// Motsatt retning er ufarlig: tokenet sier premium mens klienten tror gratis
// (nedgradering midt i quiz). Da får klienten et eksakt tall den ikke bruker.
import 'server-only'
import { readAttemptToken } from './attempt-token'
import type { Placement } from './ranking-snapshot'

/**
 * Er kalleren Premium, ifølge det signerte kravet i attempt-tokenet?
 *
 * `attemptId` og `token` kommer rått fra forespørselen (query + x-attempt-token)
 * og er UVERIFISERT input. Signaturen regnes derfor på nytt mot den quizen og
 * det forsøket forespørselen faktisk gjelder — tokenet kan ikke flyttes.
 *
 * FALSE ER DET TRYGGE SVARET her, og det er også svaret ved manglende token
 * (anonymt kall, gammel fane under deploy). En kaller som ikke kan bevise noe,
 * får gratisvisningen.
 */
export function attemptIsPremium(opts: {
  quizId: string
  attemptId: string | null
  token: string | null
}): boolean {
  const { quizId, attemptId, token } = opts
  if (!attemptId || !token) return false
  return readAttemptToken(token, attemptId, quizId).premium
}

/** Plasseringen slik den forlater serveren — eksakt kun til Premium. */
export type GatedPlacement = {
  total: number
  low: number
  high: number
  /** Eksakt plassering. `null` for alle som ikke er Premium. */
  rank: number | null
  /** Naboen over. `null` for alle som ikke er Premium — dette er et NAVN. */
  above: { name: string; correct: number } | null
  /** Naboen under. Samme som over. */
  below: { name: string; correct: number } | null
}

/**
 * Form en beregnet plassering etter hva kalleren har krav på.
 *
 * ÉN implementasjon for alle tre plasseringsrutene med vilje. Skrives skillet
 * for hånd i hver rute, er det tre sjanser til å avvike — og «en feil har
 * søsken»-regelen sier at avviket da oppdages ett sted av gangen. Nøyaktig
 * samme begrunnelse som lib/public-snapshot.ts har for blokkert-gaten.
 *
 * NABONAVNENE er den viktigste halvdelen. Et tall er en plassering; et navn er
 * en personopplysning, og `above`/`below` navngir to konkrete spillere som
 * aldri har bedt om å bli vist til en fremmed. De faller derfor sammen med
 * `rank`, ikke i et eget senere steg.
 *
 * `low`/`high` sendes til ALLE. De er spennet gratisvisningen er bygget på
 * (rank ± 2, se computePlacement) og har alltid vært ment som gratis-tieren —
 * de er ikke en lekkasje som slapp gjennom.
 */
export function gatePlacement(placement: Placement, isPremium: boolean): GatedPlacement {
  return {
    total: placement.total,
    low: placement.low,
    high: placement.high,
    rank: isPremium ? placement.rank : null,
    above: isPremium ? placement.above : null,
    below: isPremium ? placement.below : null,
  }
}
