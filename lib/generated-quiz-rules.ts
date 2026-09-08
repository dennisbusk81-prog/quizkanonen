// ── Generert quiz («kanonkuler»): de RENE reglene for hvem som får generere ──
//
// Bygget 8. september 2026 sammen med POST /api/tilfeldig-quiz. Ingen I/O —
// planen og månedstellingen kommer inn som Loaded<T>, og beslutningen tas
// her. Samme deling som lib/archive-create-rules.ts (som eier reglene for
// /api/arkiv) og lib/archive-play-gate.ts.
//
// ── KVOTEN ER PENGELOGIKK ───────────────────────────────────────────────────
// Kvoten (Dennis, september 2026):
//   gratis    2 per kalendermåned, KUN blandet quiz (ingen kategorivalg)
//   premium  30 per kalendermåned, kan velge kategori
//   ubrukte kuler overføres IKKE til neste måned
//
// Kalendermåned = norsk måned (lib/oslo-time.ts osloMonthStartUtcIso), og
// forbruket er count(*) i quiz_generations-ledgeren siden månedsstart — aldri
// en teller som må nullstilles (migrasjon 20260908000000).
//
// ── «VET IKKE» ER 503, ALDRI EN DOM ─────────────────────────────────────────
// Klarer ruten ikke å avgjøre planen (transient DB-feil), skal den svare
// 503 «prøv igjen» — ikke slippe brukeren inn som premium (lekkasje av
// kategorivalg og 30 kuler) og ikke behandle henne som gratis (usant avslag
// til en betalende kunde). Samme avveining som arkivets spill-port
// (lib/archive-play-gate.ts, 27. august 2026): generering er ikke
// tidskritisk, og en ærlig 503 koster ti sekunder. Samme retning for
// tellingen: vet vi ikke om dette er kule nr. 2 eller nr. 200, er svaret
// «vet ikke», ikke «slipp gjennom».
//
// Rekkefølgen i beslutningen er rutens rekkefølge (bestillingen): plan →
// telling → kvote → kategorisperre. Kategorisperren står SIST med vilje: en
// gratisbruker som har brukt opp kulene sine skal få «tomt for kuler», ikke
// «kategori krever Premium» — det første er sant uansett hva hun velger.
import type { Loaded } from '@/lib/fetch-result'
import { QUIZ_CATEGORIES } from '@/lib/quiz-categories'

export type GenerationPlan = 'free' | 'premium'

/** Kuler per kalendermåned. Endres tallene, endres de HER — ruten gjentar dem ikke. */
export const GENERATION_QUOTA: Readonly<Record<GenerationPlan, number>> = {
  free: 2,
  premium: 30,
}

/**
 * Antall spørsmål i en generert quiz. Fredagsquizen er ~15–20; arkivruten
 * dimensjonerte «en generert quiz ~15». Ikke bestemt av Dennis ennå — én
 * konstant, så tallet kan endres ett sted når det blir det.
 */
export const GENERATED_QUIZ_QUESTION_COUNT = 15

/** Tittelen på genererte quizer. «Tilfeldig quiz» inntil videre (bestillingen). */
export const GENERATED_QUIZ_TITLE = 'Tilfeldig quiz'

/**
 * Kategorier som IKKE tilbys i velgeren på forsiden (8. september 2026).
 * Teknologi har 82 spørsmål og Diverse 50 i banken; med 15 per quiz gir 82
 * færre enn seks quizer før gjentak. De ligger fortsatt i puljen for
 * BLANDEDE quizer — dette er visning, ikke en rett: ruten godtar fortsatt
 * alle fjorten (lib/quiz-categories.ts), fordi grunnen er kvalitet, ikke
 * tilgang.
 *
 * Velgeren er en FILTRERING av QUIZ_CATEGORIES (generatorCategoryOptions
 * under), ikke en egen liste — så en femtende kategori dukker opp i velgeren
 * uten at noen må huske to steder.
 */
export const GENERATOR_HIDDEN_CATEGORIES: readonly string[] = ['Teknologi', 'Diverse']

/** Kategoriene velgeren tilbyr, i QUIZ_CATEGORIES sin rekkefølge. Tolv per 8. september 2026. */
export function generatorCategoryOptions(): readonly string[] {
  return QUIZ_CATEGORIES.filter((c) => !GENERATOR_HIDDEN_CATEGORIES.includes(c))
}

export const GENERATION_UNKNOWN_ERROR =
  'Kunne ikke bekrefte tilgangen din akkurat nå. Prøv igjen om litt.'
export const GENERATION_QUOTA_ERROR =
  'Du har brukt opp kanonkulene dine for denne måneden.'
export const GENERATION_CATEGORY_PREMIUM_ERROR =
  'Kategorivalg krever Premium. Gratis gir en blandet quiz.'

export type GenerationDecision =
  | { allowed: true; plan: GenerationPlan; remainingAfter: number }
  | {
      allowed: false
      status: 403 | 429 | 503
      reason: 'plan-ukjent' | 'telling-ukjent' | 'kvote-brukt' | 'kategori-krever-premium'
      error: string
    }

export function planFromPremium(isPremium: boolean): GenerationPlan {
  return isPremium ? 'premium' : 'free'
}

/**
 * Får denne brukeren generere en quiz nå, med dette kategorivalget?
 *
 * `category` er antatt ALLEREDE validert mot lib/quiz-categories.ts av
 * kalleren (ukjent kategori er 400 — inngangshygiene, ikke en rettighet).
 * null = blandet.
 */
export function decideGeneration(input: {
  premium: Loaded<boolean>
  generatedThisMonth: Loaded<number>
  category: string | null
}): GenerationDecision {
  // 1. Planen. «Vet ikke» stopper alt — se filhodet.
  if (!input.premium.ok) {
    return { allowed: false, status: 503, reason: 'plan-ukjent', error: GENERATION_UNKNOWN_ERROR }
  }
  const plan = planFromPremium(input.premium.value)

  // 2. Tellingen. Samme retning.
  if (!input.generatedThisMonth.ok) {
    return { allowed: false, status: 503, reason: 'telling-ukjent', error: GENERATION_UNKNOWN_ERROR }
  }

  // 3. Kvoten. `>=`, ikke `>`: kule nr. 3 for gratis (2 brukt) avvises.
  const used = input.generatedThisMonth.value
  const quota = GENERATION_QUOTA[plan]
  if (used >= quota) {
    return { allowed: false, status: 429, reason: 'kvote-brukt', error: GENERATION_QUOTA_ERROR }
  }

  // 4. Kategorisperren for gratis. Kun blandet quiz uten Premium.
  if (input.category !== null && plan === 'free') {
    return {
      allowed: false,
      status: 403,
      reason: 'kategori-krever-premium',
      error: GENERATION_CATEGORY_PREMIUM_ERROR,
    }
  }

  return { allowed: true, plan, remainingAfter: quota - used - 1 }
}
