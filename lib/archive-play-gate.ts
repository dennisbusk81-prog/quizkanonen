// ── Arkiv-gate på SPILL-PORTEN: hvem får starte et forsøk på en arkivquiz ───
//
// Bygget 27. august 2026 for start-attempt ([ARK-1] steg 1A). Ren beslutning
// uten I/O, samme deling som lib/archive-create-rules.ts. Ruten kaller den
// UBETINGET for hver quiz — betingelsen «gjelder kun arkivquizer» bor HER,
// som første linje, ikke som et hvis-ledd i ruten noen kan flytte senere.
// Flyttes eller fjernes kallet, feller lib/start-attempt-archive-gate-route.test.ts
// det; endres betingelsen, feller lib/archive-play-gate.test.ts den.
//
// ── RETNINGEN: «vet ikke» er 503, aldri en dom (Dennis, 27. august 2026) ────
// Samme retning som /api/arkiv og /api/historikk — og BEVISST MOTSATT av
// start-attempts eksisterende «vet ikke → ikke premium», som er dokumentert
// riktig for et VISNINGSKRAV (premium-kravet i attempt-tokenet: feil retning
// der koster en pyntedetalj, og alternativet var å nekte quiz-start på en
// lesefeil). Dette er porten til en betalt SKRIVEFLATE. En transient DB-feil
// skal ikke slippe en gratisbruker inn (lekkasje) og skal ikke vise oppsalg
// til en betalende kunde (usant). En ærlig 503 er riktig fordi arkivet IKKE
// er tidskritisk — ingen mister en uke av å prøve igjen om ti sekunder.
//
// MERK EKSPLISITT: retningen gjelder ARKIVQUIZER. Den skal IKKE endre
// oppførselen for fredagsquizen, der avveiningen er motsatt: en spiller midt
// i et tidsvindu skal ikke avvises av en glipp. Derfor er ikke-arkiv-grenen
// første linje og returnerer alltid `allowed` — uansett hva premium-oppslaget
// vet eller ikke vet.
//
// Premium-verdien kommer fra decidePremiumFromProfile på profilraden ruten
// uansett henter (suspensjonssperren) — samme grace-regler som getUserPremium,
// så org-medlemskap (premium_status=true skrives ved innmelding, org/join) og
// begge karensperiodene dekkes. Lesefeil på raden er `{ ok: false }`.
import type { Loaded } from '@/lib/fetch-result'

/** Samme ordlyd som premium-gaten i POST /api/arkiv. */
export const ARCHIVE_PLAY_PREMIUM_ERROR = 'Arkivet krever Premium.'
export const ARCHIVE_PLAY_UNKNOWN_ERROR =
  'Kunne ikke bekrefte tilgangen din akkurat nå. Prøv igjen om litt.'

export type ArchivePlayGateDecision =
  | { allowed: true }
  | { allowed: false; status: 403 | 503; error: string }

export function decideArchivePlayGate(
  quizType: string | null | undefined,
  premium: Loaded<boolean>
): ArchivePlayGateDecision {
  // Alt som ikke er arkiv passerer uendret — fredagsstien skal ikke kunne
  // påvirkes av denne gaten, heller ikke ved lesefeil.
  if (quizType !== 'archive') return { allowed: true }

  if (!premium.ok) {
    return { allowed: false, status: 503, error: ARCHIVE_PLAY_UNKNOWN_ERROR }
  }
  if (!premium.value) {
    return { allowed: false, status: 403, error: ARCHIVE_PLAY_PREMIUM_ERROR }
  }
  return { allowed: true }
}
