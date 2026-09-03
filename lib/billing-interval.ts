// ── Faktureringsintervall for det personlige Premium-abonnementet ───────────
//
// HVORFOR (3. september 2026)
// Kjøpsbekreftelsen og fornyelsesbekreftelsen sa «fornyes automatisk hver
// måned» / «fornyet for en ny måned» til ALLE, uansett hva kunden kjøpte.
// Årsprisen (kr 399/år) har vært live siden 30. august (e18eac6); b1130d4
// rettet prisene i malene, ikke intervallsetningene. En årsabonnent fikk
// dermed skriftlig at hun har et månedsabonnement.
//
// TO VERDIER, INGEN GENERELL MEKANISME. Det finnes to priser, og malene
// trenger bare vite hvilken av dem kunden har. `null` betyr UKJENT — og
// ukjent er ikke «månedlig» (samme regel som lib/personal-plan-label.ts):
// malene skriver da en setning som er sann for begge, aldri en gjetning.
//
// HVOR INTERVALLET BOR, per hendelse webhooken behandler:
//
//  • invoice.payment_succeeded (fornyelse): fakturaen webhooken ALT har i
//    hendelsen bærer linjene (`lines.data`), og hver linje har både pris-id-en
//    (`pricing.price_details.price`) og perioden den dekker (`period`).
//    Pris-id-en sammenlignes med de to env-variablene checkout-ruta bruker;
//    treffer ingen (prisen er byttet i Stripe, env mangler), faller vi til
//    periodelengden. Ingen ekstra Stripe-kall.
//
//  • checkout.session.completed (kjøp): sesjonsobjektet i hendelsen har IKKE
//    linjene (`line_items` er kun med når man ekspanderer) og ikke prisen.
//    Alternativene var et `subscriptions.retrieve` per kjøp, eller å la
//    checkout-ruta — som VET hvilken pris den ba om — legge intervallet i
//    `metadata`, samme kanal som `userId` allerede går i. Metadata er valgt:
//    null rundturer, deterministisk, og samme kilde som kjøpet selv. Sesjoner
//    opprettet før denne utrullingen mangler feltet i opptil 24 timer (Stripes
//    sesjonslevetid) og får da den nøytrale setningen.

export type BillingInterval = 'month' | 'year'

/** Symbolene /premium sender til checkout-ruta (PRICE_ENV_BY_SYMBOL). */
export function intervalForPriceSymbol(symbol: string): BillingInterval | null {
  if (symbol === 'STRIPE_PRICE_PREMIUM_MONTHLY') return 'month'
  if (symbol === 'STRIPE_PRICE_PREMIUM_YEARLY') return 'year'
  return null
}

/** Leser intervallet checkout-ruta la i sesjonens metadata. Alt annet → null. */
export function intervalFromCheckoutMetadata(
  metadata: Record<string, string> | null | undefined,
): BillingInterval | null {
  const v = metadata?.interval
  return v === 'month' || v === 'year' ? v : null
}

export type PriceEnv = {
  STRIPE_PRICE_PREMIUM_MONTHLY?: string
  STRIPE_PRICE_PREMIUM_YEARLY?: string
}

/** Formen webhooken faktisk leser ut av `invoice.lines.data[0]`. */
export type InvoiceLineFacts = {
  /** `pricing.price_details.price` — pris-id som streng, eller null. */
  priceId: string | null
  /** `period.start` / `period.end`, Unix-sekunder. */
  periodStart: number | null
  periodEnd: number | null
}

const DAY_S = 24 * 60 * 60

/**
 * Pris-id først (eksakt), periodelengde som reserve. Grensene er romslige
 * med vilje: en måned er 28–31 dager, et år 365–366, og Stripe kan runde
 * periodegrensene til sekundet. Alt utenfor de to båndene er ukjent.
 */
export function intervalFromInvoiceLine(
  line: InvoiceLineFacts | null,
  env: PriceEnv,
): BillingInterval | null {
  if (!line) return null

  if (line.priceId) {
    if (env.STRIPE_PRICE_PREMIUM_YEARLY && line.priceId === env.STRIPE_PRICE_PREMIUM_YEARLY) return 'year'
    if (env.STRIPE_PRICE_PREMIUM_MONTHLY && line.priceId === env.STRIPE_PRICE_PREMIUM_MONTHLY) return 'month'
  }

  if (line.periodStart != null && line.periodEnd != null) {
    const days = (line.periodEnd - line.periodStart) / DAY_S
    if (days >= 27 && days <= 32) return 'month'
    if (days >= 360 && days <= 371) return 'year'
  }

  return null
}

/** Plukker feltene over ut av en rå Stripe-fakturalinje (hendelsens payload). */
export function invoiceLineFacts(line: unknown): InvoiceLineFacts | null {
  if (!line || typeof line !== 'object') return null
  const l = line as {
    pricing?: { price_details?: { price?: unknown } } | null
    period?: { start?: unknown; end?: unknown } | null
  }
  const rawPrice = l.pricing?.price_details?.price
  const priceId = typeof rawPrice === 'string'
    ? rawPrice
    : (rawPrice && typeof rawPrice === 'object' && typeof (rawPrice as { id?: unknown }).id === 'string')
      ? (rawPrice as { id: string }).id
      : null
  const start = l.period?.start
  const end = l.period?.end
  return {
    priceId,
    periodStart: typeof start === 'number' ? start : null,
    periodEnd: typeof end === 'number' ? end : null,
  }
}
