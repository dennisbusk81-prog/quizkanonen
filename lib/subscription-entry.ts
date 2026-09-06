// ── Inngangen til «Abonnement» — ÉN beslutning for meny og profilside ────────
//
// REN logikk, ingen I/O. Importeres av lib/nav-model.ts (kontomenyens
// «Abonnement»-rad) og app/profil/page.tsx (abonnementskortet).
//
// ── HVILKEN FEIL DENNE FILA FINNES FOR (6. september 2026) ─────────────────
// Profilsiden og kontomenyen hadde hver sin kopi av samme gate, og de to
// driftet: profilsiden fikk 30. august en egen gren for en UTLØPT KORTLØS
// TRIAL (founders-activate lager Stripe-kunden uten kort, og has_used_trial
// er merket) fordi Stripe-portalen er en blindvei for den brukeren — der er
// ingen abonnement og ingen betalingshistorikk å vise. Menyen beholdt den
// gamle gaten «har Stripe-kunde → portal», og sendte nøyaktig de samme
// brukerne inn i blindveien. Nå leser begge flatene DENNE funksjonen.
//
// Fire tilstander, i den rekkefølgen de må prøves:
//
//   'none'           ingen Stripe-kunde, ikke Premium → det finnes ingenting
//                    å administrere; veien videre er /premium (salgsflaten).
//   'free-premium'   Premium uten Stripe-kunde (verdikode, org-medlemskap) →
//                    ingen portal å åpne; profilsiden forklarer tilstanden.
//   'trial-expired'  Stripe-kunde, IKKE Premium, har brukt prøveperioden →
//                    kortløs trial som tok slutt etter planen. Portalen er
//                    tom for denne brukeren; veien videre er /premium.
//   'portal'         Stripe-kunde med noe å administrere: løpende abonnement,
//                    pågående trial, eller et avvist kort som skal oppdateres
//                    (isPremium er da av, has_used_trial kan være hva som
//                    helst — det er KORTET som er saken, ikke prøveperioden).
//
// «Stripe-kunde + ikke Premium + ikke brukt trial» er portal med vilje: det
// er brukeren med avvist kort som betalingsfeil-e-posten sender til
// profilsiden for å oppdatere kortet. Gates det på isPremium alene, forsvinner
// knappen for nøyaktig den brukeren som trenger den (samme feil som ble
// rettet på profilsiden i august).
export type SubscriptionEntry = 'none' | 'free-premium' | 'trial-expired' | 'portal'

export interface SubscriptionEntryInput {
  isPremium: boolean
  hasStripeCustomer: boolean
  hasUsedTrial: boolean
}

export function decideSubscriptionEntry({ isPremium, hasStripeCustomer, hasUsedTrial }: SubscriptionEntryInput): SubscriptionEntry {
  if (!hasStripeCustomer) return isPremium ? 'free-premium' : 'none'
  if (!isPremium && hasUsedTrial) return 'trial-expired'
  return 'portal'
}

/**
 * Hvor kontomenyens «Abonnement»-rad peker. `null` betyr «åpne
 * Stripe-portalen» (en knapp med POST, ikke en lenke).
 *
 * Premium uten Stripe peker på profilsidens abonnementskort, ikke på
 * /premium: /premium selger noe brukeren allerede har, kortet forklarer
 * hvor Premium kommer fra og hva som skjer når det utløper.
 */
export function subscriptionMenuHref(entry: SubscriptionEntry): string | null {
  switch (entry) {
    case 'none':
    case 'trial-expired':
      return '/premium'
    case 'free-premium':
      return '/profil#abonnement'
    case 'portal':
      return null
  }
}
