// ── Sperre mot duell-spam mot samme mottaker ────────────────────────────────
// Bakgrunn (kartlegging 28. juli 2026, FUNN 3.3):
//
// DELETE /api/rivalries/[id] setter status 'cancelled', og opprettelsessperren
// teller kun 'pending'/'active'. Løkken utfordre → kanseller → utfordre var
// derfor fri, og HVER runde sendte en ny e-post til mottakeren fra
// hei@quizkanonen.no. Eneste brems var rateLimit('rivalries-create:IP', 5,
// 60_000) — altså ~5 e-poster i minuttet mot ett offer, og den telleren er en
// modul-lokal Map som lever per serverless-instans, så reelt tak var høyere.
//
// Denne sperren er bevisst UAVHENGIG av IP-basert rate-limiting: den teller
// faktiske utfordringer mot ÉN bestemt mottaker, uansett hvor de kom fra.
// Rate-limiter-arkitekturen i seg selv er en egen, større sak og røres ikke her.
//
// Hvorfor et døgntak og ikke en ren cooldown etter kansellering: en cooldown
// straffer også den som kansellerer ved et uhell og vil sende på nytt med én
// gang. Et tak på 3 forsøk per døgn per mottaker slipper det tilfellet
// gjennom, men gjør spam-løkken verdiløs (3 e-poster i døgnet, ikke 300 i timen).
//
// Telles fra rivalries-radene selv — ingen ny tabell, ingen migrasjon.

export const SAME_RECIPIENT_WINDOW_MS = 24 * 60 * 60 * 1000
export const SAME_RECIPIENT_MAX = 3

/**
 * Har utfordreren brukt opp forsøkene sine mot denne ene mottakeren?
 *
 * `recentCreatedAt` er created_at for utfordringer DENNE brukeren har sendt til
 * DENNE mottakeren (uansett status — en kansellert utfordring har allerede
 * kostet mottakeren en e-post og skal telle med).
 */
export function hasExhaustedChallengesToRecipient(
  recentCreatedAt: string[],
  now: Date,
): boolean {
  const cutoff = now.getTime() - SAME_RECIPIENT_WINDOW_MS
  const withinWindow = recentCreatedAt.filter(iso => new Date(iso).getTime() > cutoff)
  return withinWindow.length >= SAME_RECIPIENT_MAX
}
