// ── Prøveperiode-tilbudet: ÉN kilde til betingelsen ─────────────────────────
//
// Tre flater tilbyr den gratis prøveperioden (forsidens Premium-CTA-er,
// /premium og upsell-kortet på resultatskjermen). Alle tre stiller nøyaktig
// samme to spørsmål: «skal denne brukeren se tilbudet?» og «hvor mange dager
// skal teksten love?». Svarene bor her, ikke i tre kopier ute i JSX-en.
//
// VIKTIG — dette er VISNING, ikke en gate. Selve rettighetssjekken ligger i
// POST /api/stripe/founders-activate (lesevakt på has_used_trial + et atomisk
// claim som er race-sikkert). En bruker som ser knappen uten å være kvalifisert
// får et rolig 409 fra ruten; det er den forventede utgangen, ikke en feil.
// Derfor er `eligible` bevisst tre-tilstands: `null` betyr UKJENT (utlogget,
// eller et oppslag som ikke landet), og ukjent skal vise tilbudet og la
// serveren avgjøre. Å skjule det ville gitt falsk visshet i motsatt retning —
// en kvalifisert bruker som aldri får se at tilbudet finnes.
//
// Dagtallet er en INNSTILLING (site_settings.founders_new_trial_days), ikke en
// konstant. Det finnes med vilje ingen fallback til 14, av nøyaktig samme grunn
// som founders-activate ikke har en: en hardkodet verdi ville truffet hver gang
// nøkkelen manglet eller ble endret, og flaten ville lovet en lengde ingen har
// bestemt. Mangler tallet, faller flaten tilbake til sin vanlige Premium-tekst
// uten dagtall.

/** Rå verdi fra site_settings → et brukbart dagtall, eller null. */
export function parseTrialDays(raw: unknown): number | null {
  // Kun tall og tallstrenger. `Number(true)` er 1 og `Number([])` er 0 —
  // begge ville sluppet gjennom en naken Number()-konvertering.
  if (typeof raw !== 'number' && typeof raw !== 'string') return null
  if (typeof raw === 'string' && raw.trim() === '') return null
  const days = Number(raw)
  // Samme krav som founders-activate stiller før den oppretter abonnementet:
  // positivt heltall. Er de to uenige, lover teksten noe ruten ikke leverer.
  if (!Number.isInteger(days) || days <= 0) return null
  return days
}

/**
 * Er kontoen kvalifisert for den gratis prøveperioden?
 *
 * Speiler de to vaktene i founders-activate som kan avgjøres fra profilraden:
 * det varige merket `has_used_trial`, og at claimet krever at brukeren ikke
 * allerede har Premium. Rutens tredje vakt (levende abonnement hos Stripe)
 * kan ikke leses her, og trenger det ikke: den biter kun for kontoer som
 * uansett har dekning.
 */
export function isTrialEligible(input: { isPremium: boolean; hasUsedTrial: boolean }): boolean {
  if (input.isPremium) return false
  if (input.hasUsedTrial) return false
  return true
}

/** Vis tilbudet, og med hvilket dagtall. `days` finnes aldri uten `show`. */
export type TrialOffer =
  | { show: true; days: number }
  | { show: false; days: null }

const NO_OFFER: TrialOffer = { show: false, days: null }

/**
 * Beslutningen hver flate spør om.
 *
 * @param trialDays rå verdi fra site_settings (eller allerede parset tall)
 * @param eligible  true = kvalifisert, false = ikke kvalifisert,
 *                  null = UKJENT (utlogget / oppslaget landet ikke)
 */
export function decideTrialOffer(input: { trialDays: unknown; eligible: boolean | null }): TrialOffer {
  const days = parseTrialDays(input.trialDays)
  // Uten et bestemt dagtall har vi ingen ærlig tekst å vise. Flaten beholder
  // dagens Premium-tekst framfor å love «gratis i null dager».
  if (days === null) return NO_OFFER
  // `false` skjuler. `null` gjør det IKKE — se toppkommentaren.
  if (input.eligible === false) return NO_OFFER
  return { show: true, days }
}
