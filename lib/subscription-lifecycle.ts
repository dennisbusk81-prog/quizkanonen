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

// ── Org-grenen i customer.subscription.updated (29. juli 2026) ─────────────
//
// `subscription.deleted` har hatt en sub-id-vakt for orger siden 21. juni
// (`isCurrentOrgSub`, «FIX 2» i aa5582f). `updated` fikk aldri den samme —
// den matcher kun på `stripe_customer_id`. Konsekvensen er konkret:
//
//   org-checkout sin reaktiveringsgren kansellerer ALLE ikke-terminale
//   abonnement på kunden før den lager en ny checkout-sesjon. Hver
//   kansellering fyrer `updated (canceled)` + `deleted` for det gamle
//   abonnementet, og `checkout.session.completed` skriver deretter en NY
//   stripe_subscription_id. Kunden beholder samme kunde-id. Ankommer den
//   gamle `updated`-en for sent — en Stripe-retry, eller bare ute av
//   rekkefølge — låser den en org som nettopp har betalt, og siden 29. juli
//   sender den også e-post om det til hele bedriften.
//
// HVORFOR IKKE BARE KOPIERE isCurrentOrgSub: ren id-likhet ville innført en
// ny feilklasse. Opprettes et abonnement utenfor vår checkout-flyt — typisk
// manuelt i Stripe-dashbordet — er det ingenting som noensinne skriver den
// nye id-en til `organizations`. Hver eneste hendelse for kundens reelle,
// levende abonnement ville da blitt ignorert i det stille, for alltid.
//
// Derfor: vi ignorerer KUN når Stripe positivt bekrefter at det lagrede
// abonnementet fortsatt lever. Er det dødt, er hendelsens abonnement det
// reelle gjeldende, og vi adopterer id-en.

export type OrgSubEventVerdict =
  /** Behandle hendelsen som normalt. */
  | 'process'
  /** Hendelsen gjelder et forbigått abonnement — rør ingenting. */
  | 'ignore'
  /** Behandle, og skriv hendelsens abonnements-id til organizations. */
  | 'adopt'

export type OrgSubEventInput = {
  /** organizations.stripe_subscription_id på lesetidspunktet. */
  storedSubId: string | null
  /** Abonnementet hendelsen gjelder. null = kunne ikke utledes. */
  eventSubId: string | null
  /**
   * Kundens fortsatt levende abonnement hos Stripe. `null` = oppslaget ble
   * ikke gjort (id-ene var like, så det var unødvendig) eller feilet.
   */
  liveSubIds: string[] | null
}

/**
 * Trenger vi et Stripe-oppslag for å avgjøre denne hendelsen?
 *
 * Kun når begge id-ene finnes OG er ulike. Normaltilfellet — hendelsen
 * gjelder abonnementet vi allerede kjenner — koster dermed ingen ekstra
 * rundtur.
 */
export function needsLiveSubscriptionLookup(
  storedSubId: string | null,
  eventSubId: string | null,
): boolean {
  return !!storedSubId && !!eventSubId && storedSubId !== eventSubId
}

/**
 * Hva skal org-grenen gjøre med denne `customer.subscription.updated`?
 *
 * Fail-open ved usikkerhet, som resten av webhooken: mangler vi id-er eller
 * feiler Stripe-oppslaget, behandles hendelsen som før. Å ignorere en ekte
 * forfalt org er verre enn en sjelden overflødig skriving — og motsatt vei
 * er `ignore` avgrenset til det ene tilfellet vi har bevis for.
 *
 * Ren funksjon — testet uten Stripe og uten database.
 */
export function decideOrgSubscriptionEvent(input: OrgSubEventInput): OrgSubEventVerdict {
  const { storedSubId, eventSubId, liveSubIds } = input

  // Ingen hendelses-id å sammenligne med, eller ingen lagret peker å
  // sammenligne mot: ingen stale-signal i det hele tatt.
  if (!eventSubId) return 'process'
  if (!storedSubId) return 'process'

  // Hendelsen gjelder abonnementet org-en peker på i dag.
  if (storedSubId === eventSubId) return 'process'

  // ── Id-ene er ulike ────────────────────────────────────────────────────
  // Oppslaget feilet eller ble ikke gjort → ingen ny informasjon, oppfør
  // deg som før vakten fantes.
  if (liveSubIds === null) return 'process'

  // Det lagrede abonnementet lever fortsatt. Da er DET gjeldende, og
  // hendelsen her gjelder et forbigått abonnement.
  if (liveSubIds.includes(storedSubId)) return 'ignore'

  // Det lagrede abonnementet er dødt eller borte. Hendelsens abonnement er
  // org-ens reelle gjeldende — behandle den, og rett opp pekeren.
  return 'adopt'
}

// ── Stripes egen trial-utløps-kansellering (11. august 2026) ───────────────
//
// Når `trial_settings.end_behavior.missing_payment_method: 'cancel'` lar en
// trial løpe ut, setter Stripe `cancellation_details.reason` til
// 'cancellation_requested' — SAMME verdi som når en bruker selv sier opp.
// Målt empirisk 11. august i både test-modus (fixture) og live-historikk
// (org-trialene som løp ut 22. juli). Reason alene kan derfor ikke skille
// «brukeren ba om det» fra «kortet manglet da trialen tok slutt».
//
// Auto-kanselleringen har derimot et presist fingeravtrykk i payloaden:
//   * canceled_at === trial_end — EKSAKT samme epoch-sekund; Stripe stempler
//     kanselleringen på trial-slutten selv når prosesseringen skjer minutter
//     senere (målt: prosessert ~90 s etter, stemplet nøyaktig på trial_end)
//   * cancel_at_period_end=false og cancel_at=null — brukeren hadde ikke
//     planlagt noen kansellering; en oppsigelse underveis i trialen setter
//     ett av disse, eller gir canceled_at < trial_end ved umiddelbar avslutning
export type TrialAutoCancelFacts = {
  /** subscription.canceled_at (epoch-sekunder) fra hendelses-payloaden. */
  canceledAt?: number | null
  /** subscription.trial_end (epoch-sekunder). */
  trialEnd?: number | null
  /** subscription.cancel_at_period_end. */
  cancelAtPeriodEnd?: boolean | null
  /** subscription.cancel_at (epoch-sekunder). */
  cancelAt?: number | null
}

/**
 * Er dette Stripes egen kansellering av en trial som løp ut — ikke noe noen
 * har bedt om? Mangler feltene (gamle kallere, ufullstendig payload) er svaret
 * `false`: da vet vi ingenting nytt, og kalleren beholder gammel oppførsel.
 */
export function isTrialAutoCancel(facts: TrialAutoCancelFacts): boolean {
  const { canceledAt, trialEnd, cancelAtPeriodEnd, cancelAt } = facts
  if (typeof canceledAt !== 'number' || typeof trialEnd !== 'number') return false
  if (canceledAt !== trialEnd) return false
  if (cancelAtPeriodEnd === true) return false
  if (typeof cancelAt === 'number') return false
  return true
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
} & TrialAutoCancelFacts

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
  //
  // MED ETT UNNTAK (11. august 2026): Stripe setter samme reason på sin egen
  // auto-kansellering når en kortløs trial løper ut under
  // `end_behavior.missing_payment_method: 'cancel'`. Det er ingen beslutning
  // brukeren har tatt, og «Premium-abonnementet ditt er avsluttet» er da både
  // misvisende og feil tone. Unntaket krever BÅDE auto-fingeravtrykket
  // (se isTrialAutoCancel) OG bekreftet kortløshet — feiler kortoppslaget
  // (null), sendes e-posten som før.
  if (cancellationReason === 'cancellation_requested') {
    if (hasPaymentMethod === false && isTrialAutoCancel(input)) return false
    return true
  }

  // Fail-safe: ukjent kortstatus behandles som «har kort».
  if (hasPaymentMethod !== false) return true

  // Ingen betalingsmetode + ikke selv-initiert = abonnementet løp ut.
  return false
}
