/**
 * Prislinja på abonnementskortet i /profil.
 *
 * HVORFOR DEN ER AVLEDET, IKKE HARDKODET (30. august 2026)
 * Fram til nå sto «kr 49/mnd · Avslutt når du vil» hardkodet i
 * app/profil/page.tsx og ble vist til ENHVER med Premium og en Stripe-kunde.
 * Med årsprisen (kr 399/år, e18eac6) ble den setningen direkte usann for en
 * årsabonnent — feil beløp OG feil intervall, på kundens egen
 * abonnementsside.
 *
 * Kilden er abonnementet hos Stripe, lest via /api/stripe/subscription. Den
 * ruten henter allerede abonnementet for `has_subscription` (78817c4); pris og
 * intervall ligger i det SAMME svaret (`sub.items.data[0].price`), så dette
 * koster ingen ekstra rundtur til Stripe.
 *
 * UKJENT ER IKKE «MÅNEDLIG» — returnerer null.
 * Null betyr «vi vet ikke», og da vises ingen prislinje i det hele tatt. Det
 * dekker fire reelle tilfeller: ruten feilet, intervallet mangler i svaret,
 * beløpet mangler, eller brukeren har Premium fra en annen kilde enn et eget
 * abonnement (verdikode, org-medlemskap, founders-trial) og altså ingen
 * personlig pris å vise. Den siste gruppen fikk fram til nå «kr 49/mnd»
 * fortalt om et abonnement de ikke har.
 *
 * Samme prinsipp som lib/has-settled-plays.ts og middleware-cookie-guard:
 * ikke fått svar betyr UKJENT, aldri en gjetning servert som et faktum. En
 * manglende linje er en liten skade; en gal pris er en stor.
 */

export type PersonalPlanFacts = {
  /** Stripes `price.recurring.interval` — 'month' | 'year' (eller noe ukjent). */
  interval: string | null
  /** Stripes `price.unit_amount`, i øre. 4900 = kr 49. */
  amountOre: number | null
}

/** 4900 → «49», 39900 → «399», 4950 → «49,50». */
export function formatKroner(amountOre: number): string {
  const hele = Math.floor(amountOre / 100)
  const ore = amountOre % 100
  return ore === 0 ? String(hele) : `${hele},${String(ore).padStart(2, '0')}`
}

export function describePersonalPlan(facts: PersonalPlanFacts | null): string | null {
  if (!facts) return null
  const { interval, amountOre } = facts
  if (amountOre == null || !Number.isFinite(amountOre) || amountOre <= 0) return null

  const pris = `kr ${formatKroner(amountOre)}`

  // «Avslutt når du vil» står BEVISST kun på månedsplanen. På en årsplan er
  // det en halvsannhet: du kan avslutte, men det som er betalt for resten av
  // året kommer ikke tilbake. Nøyaktig den forskjellen er grunnen til at
  // org/join-refusjonssaken (8b) fortsatt står åpen — vi skal ikke lage nye
  // varianter av den påstanden mens den er uavklart.
  if (interval === 'month') return `${pris}/mnd · Avslutt når du vil`
  if (interval === 'year') return `${pris}/år · Fornyes automatisk`

  // Et ukjent intervall (Stripe støtter også 'day' og 'week') skal ikke
  // presses inn i en av de to formene.
  return null
}
