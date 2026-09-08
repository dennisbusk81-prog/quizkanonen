// ── Arkiv-gate på SPILL-PORTEN: hvem får starte et forsøk på en arkivquiz ───
//
// Bygget 27. august 2026 for start-attempt ([ARK-1] steg 1A). Ren beslutning
// uten I/O, samme deling som lib/archive-create-rules.ts. Ruten kaller den
// UBETINGET for hver quiz — betingelsen «gjelder kun arkivquizer» bor HER,
// som første linje, ikke som et hvis-ledd i ruten noen kan flytte senere.
// Flyttes eller fjernes kallet, feller lib/start-attempt-archive-gate-route.test.ts
// det; endres betingelsen, feller lib/archive-play-gate.test.ts den.
//
// Gaten deles med GET /api/arkiv/[id]/plassering — med vilje, og det er ikke
// bare gjenbruk: plasseringen vises via en ANNEN kodesti enn spillingen, og
// lærer bare den ene en ny regel, ser samme spiller to ulike sannheter
// minutter fra hverandre (QK_3, 4. august 2026). Én regel, ett sted.
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
//
// ── EIEREN AV EN GENERERT QUIZ SLIPPER INN (8. september 2026) ──────────────
// a025d46 ga gratisbrukere to «kanonkuler» i måneden (POST /api/tilfeldig-quiz),
// og en generert quiz er `quiz_type='archive'` med `source_quiz_id NULL`.
// Fram til nå avviste gaten ALLE arkivquizer for ikke-premium, så en
// gratisbruker kunne generere en quiz hun ikke fikk starte.
//
// Regelen er nå: premium ELLER eier. Eierskapet er en rad i ledgeren
// `quiz_generations` med hennes `user_id` og denne `quiz_id` — IKKE
// `source_quiz_id IS NULL`, for NULL-kilde er ikke unikt for genererte quizer:
// POST /api/arkiv skriver også NULL ved delvis reprise eller testforelder
// (lib/archive-source-quiz.ts, krav 1–3). En ekte arkivkopi krever fortsatt
// Premium, og som belte-og-bukser teller eierskapet KUN når `sourceQuizId`
// er null: en quiz med NOT NULL kilde er en reprise av en fredagsquiz, og
// ingen ledger-rad skal kunne åpne den (en slik rad kan ikke oppstå via
// koden, men porten skal ikke hvile på det).
//
// ELLER-et er TREVERDIG, samme retning som over: én bekreftet sann side gir
// inn (premium bekreftet, eller eier bekreftet). Er ingen side bekreftet sann
// og én av dem ukjent, er svaret 503 — ikke 403 (usant avslag til en eier
// eller en betalende kunde) og ikke inn (lekkasje). Begge bekreftet falske
// er 403 med oppsalgsordlyden.
//
// `needsGeneratedOwnershipLookup` er rutens spørsmål «må jeg spørre
// ledgeren?». Det bor HER, ikke som et hvis-ledd i ruten: bekreftet premium
// trenger ikke oppslaget (premium vinner uansett), ikke-arkiv skal ALDRI røre
// `quiz_generations` (fredagsstien), og NOT NULL kilde kan ikke bli eid.
// Hopper ruten over oppslaget og sender `null`, faller gaten til
// premium-alene — en eier får da 403 (dagens feil), aldri en lekkasje.
import type { Loaded } from '@/lib/fetch-result'

/** Samme ordlyd som premium-gaten i POST /api/arkiv. */
export const ARCHIVE_PLAY_PREMIUM_ERROR = 'Quizarkivet krever Premium.'
export const ARCHIVE_PLAY_UNKNOWN_ERROR =
  'Kunne ikke bekrefte tilgangen din akkurat nå. Prøv igjen om litt.'

export type ArchivePlayGateDecision =
  | { allowed: true }
  | { allowed: false; status: 403 | 503; error: string }

/**
 * Eierskapsfakta for en arkivquiz. `null` hos kalleren betyr «ikke slått
 * opp» — gaten faller da til premium-alene.
 *   sourceQuizId  quizzes.source_quiz_id — NOT NULL = reprise av en fredagsquiz
 *   owner         finnes en quiz_generations-rad (quiz_id, user_id)? Loaded:
 *                 lesefeil er «vet ikke», ikke «nei».
 */
export type GeneratedQuizOwnership = {
  sourceQuizId: string | null
  owner: Loaded<boolean>
}

/**
 * Må ruten slå opp eierskap i `quiz_generations` for denne quizen?
 * Kun for arkivquizer der premium ikke allerede er bekreftet sann, og kun
 * når kilden er NULL — alt annet er avgjort uten oppslaget.
 */
export function needsGeneratedOwnershipLookup(
  quizType: string | null | undefined,
  premium: Loaded<boolean>,
  sourceQuizId: string | null | undefined
): boolean {
  if (quizType !== 'archive') return false
  if (premium.ok && premium.value) return false
  return sourceQuizId === null || sourceQuizId === undefined
}

export function decideArchivePlayGate(
  quizType: string | null | undefined,
  premium: Loaded<boolean>,
  generated: GeneratedQuizOwnership | null
): ArchivePlayGateDecision {
  // Alt som ikke er arkiv passerer uendret — fredagsstien skal ikke kunne
  // påvirkes av denne gaten, heller ikke ved lesefeil.
  if (quizType !== 'archive') return { allowed: true }

  // Premium bekreftet → inn, uansett eierskap.
  if (premium.ok && premium.value) return { allowed: true }

  // Eierskap teller kun for en quiz UTEN kilde (generert). En reprise av en
  // fredagsquiz kan ikke bli eid — se filhodet.
  const ownershipApplies = generated !== null && generated.sourceQuizId === null
  if (ownershipApplies && generated.owner.ok && generated.owner.value) {
    return { allowed: true }
  }

  // Ingen side bekreftet sann. Er én av dem ukjent, er svaret «vet ikke».
  const ownerUnknown = ownershipApplies && !generated.owner.ok
  if (!premium.ok || ownerUnknown) {
    return { allowed: false, status: 503, error: ARCHIVE_PLAY_UNKNOWN_ERROR }
  }
  return { allowed: false, status: 403, error: ARCHIVE_PLAY_PREMIUM_ERROR }
}
