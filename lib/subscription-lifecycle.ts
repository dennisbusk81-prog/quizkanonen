/**
 * Ren beslutningslogikk for terminale Stripe-abonnementshendelser
 * (28. juli 2026). Trukket ut av app/api/stripe/webhook/route.ts etter samme
 * mønster som lib/premium-state.ts (ren) + lib/premium-state-io.ts (I/O):
 * beslutningene er testbare uten Stripe og uten database, ruten gjør kun
 * oppslagene og handler på svaret.
 *
 * Bakgrunn — to hull funnet i kartleggingen 28. juli:
 *
 *  1. `isCurrentPersonalSub` falt tilbake til `true` når
 *     `profiles.personal_stripe_subscription_id` var NULL. NULL er tvetydig:
 *     det betyr enten «har aldri hatt eget abonnement» ELLER «feltet ble
 *     nettopp nullet av en tidligere terminal hendelse». Konsekvens: en sen
 *     `subscription.deleted` for et GAMMELT abonnement kunne slippe gjennom
 *     og fortelle en kunde med ferskt, levende abonnement at Premium var
 *     avsluttet.
 *
 *  2. `subscription.deleted` sendte alltid «Premium-abonnementet ditt er
 *     avsluttet», også for en kortløs Founders-trial som bare løp ut.
 *     `invoice.payment_failed` skilte allerede disse to tilfellene riktig
 *     (kortløs → trialEndedNoCardEmail), men `deleted` gjorde det ikke.
 */

/**
 * Stripe-statuser som betyr at abonnementet fortsatt lever — altså at det
 * kan supersede et eldre abonnement. `past_due` og `unpaid` teller med:
 * begge er abonnement Stripe fortsatt driver innkreving på, og et av dem
 * skal absolutt ikke overkjøres av en sen `deleted` for et eldre abonnement.
 *
 * Samme prinsipp som `LIVE_STRIPE_STATUSES` i lib/premium-state.ts, men
 * bevisst bredere: der er spørsmålet «gir dette Premium-dekning?»
 * (`active`/`trialing`), her er det «finnes dette fortsatt?».
 */
export const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'] as const

export type StaleEventInput = {
  /** Verdien i profiles.personal_stripe_subscription_id på lesetidspunktet. */
  storedSubId: string | null
  /** Abonnementet hendelsen faktisk gjelder. null = kunne ikke utledes. */
  eventSubId: string | null
  /**
   * Abonnement-id-er for kunden som fortsatt lever hos Stripe.
   * `null` betyr at oppslaget ikke ble gjort eller feilet — da har vi ingen
   * ny informasjon, og fallbacken skal være den gamle (ikke-undertrykkende)
   * oppførselen.
   */
  liveSubIds: string[] | null
}

/**
 * Er denne terminale hendelsen for et FORELDET abonnement som ikke lenger
 * representerer brukerens gjeldende tilstand?
 *
 * `true` betyr «ignorer hendelsen» — ikke rør premium, ikke send e-post.
 *
 * Fail-safe i begge retninger, men aldri undertrykkende ved usikkerhet: får
 * vi ikke lest hendelsens subscription-id, eller feiler Stripe-oppslaget,
 * returnerer vi `false` og lar hendelsen behandles som før. Å tie om en ekte
 * kansellering er verre enn en sjelden overflødig e-post.
 */
export function isStaleSubscriptionEvent(input: StaleEventInput): boolean {
  const { storedSubId, eventSubId, liveSubIds } = input

  // Uten en id å sammenligne mot har vi ingen stale-signal i det hele tatt.
  if (!eventSubId) return false

  // Feltet er satt: det er den autoritative «gjeldende abonnement»-pekeren.
  // Uendret oppførsel fra før 28. juli.
  if (storedSubId) return storedSubId !== eventSubId

  // ── Feltet er NULL — det tvetydige tilfellet (hull 1) ────────────────────
  // Vi kan ikke vite av databasen alene om brukeren aldri har hatt et
  // abonnement, eller om feltet nettopp ble nullet av en tidligere hendelse.
  // Stripe vet det derimot: finnes det et ANNET levende abonnement på samme
  // kunde, er hendelsen her per definisjon for et forbigått abonnement.
  if (liveSubIds === null) return false
  return liveSubIds.some(id => id !== eventSubId)
}

export type CancellationEmailInput = {
  /** subscription.cancellation_details?.reason fra hendelsesobjektet. */
  cancellationReason: string | null | undefined
  /**
   * Har kunden NOEN betalingsmetode registrert hos Stripe?
   * `null` = oppslaget feilet (behandles som «har kort» — fail-safe mot å
   * undertrykke et varsel om en ekte kansellering).
   */
  hasPaymentMethod: boolean | null
}

/**
 * Skal «Premium-abonnementet ditt er avsluttet» sendes?
 *
 * Regelen: e-posten undertrykkes KUN når abonnementet løp ut av seg selv hos
 * en kunde som aldri har hatt en betalingsmetode. Det er nøyaktig profilen
 * til en kortløs Founders-trial — en bruker som aldri betalte en krone, og
 * som allerede har fått «Prøveperioden din er over» fra
 * `invoice.payment_failed` (samme kanselleringssekvens, se
 * trialEndedNoCardEmail-grenen i webhooken). For dem er «abonnementet ditt er
 * avsluttet» både faktisk misvisende og en dublett.
 *
 * Bevisst bredere enn kun `reason === 'payment_failed'`: også `null`/ukjent
 * grunn undertrykkes når kortet mangler, fordi Stripe ikke garanterer at
 * `cancellation_details.reason` alltid er satt. Det eneste som ALLTID
 * overstyrer er `cancellation_requested` — ba brukeren selv om å avslutte,
 * skal de få bekreftelsen, kort eller ikke.
 *
 * Har kunden kort (eller feiler oppslaget), sendes e-posten som før — en
 * kansellering etter avviste kortbelastninger er en ekte avslutning av et
 * abonnement brukeren faktisk hadde.
 */
export function shouldSendCancellationEmail(input: CancellationEmailInput): boolean {
  const { cancellationReason, hasPaymentMethod } = input

  // Brukeren ba selv om å avslutte — bekreftelsen skal alltid ut.
  if (cancellationReason === 'cancellation_requested') return true

  // Fail-safe: ukjent kortstatus behandles som «har kort».
  if (hasPaymentMethod !== false) return true

  // Ingen betalingsmetode + ikke selv-initiert = abonnementet løp ut.
  return false
}
