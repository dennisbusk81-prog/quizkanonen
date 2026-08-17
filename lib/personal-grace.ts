/**
 * Karensperiode for PERSONLIG (B2C) Premium ved ufrivillig betalingsfeil
 * (17. august 2026).
 *
 * PROBLEMET: når et kort avvises, flipper Stripe abonnementet til `past_due`.
 * Den statusen er ikke med i LIVE_STRIPE_STATUSES, så getStripeCoverage fant
 * ingen dekning og premium_status ble satt false i samme minutt som første
 * trekk feilet — mens betalingsfeil-e-posten vår samtidig sa at tilgangen
 * bestod og at brukeren bare måtte oppdatere kortet. Stripe purrer i 14 dager
 * etterpå, så brukeren satt uten tilgang i hele perioden der problemet fortsatt
 * kunne løse seg av seg selv.
 *
 * REGELEN er den samme som allerede står bak LOCK_GRACE_DAYS for bedrifter:
 * et utløpt eller avvist kort er ikke en beslutning noen har tatt. Sier
 * brukeren selv opp, er det en beslutning — og da gis ingen karensperiode.
 *
 * Ren logikk, ingen I/O — samme deling som lib/org-lock-grace.ts (ren) og
 * lib/premium-state.ts (ren) + lib/premium-state-io.ts (I/O).
 */

/**
 * Hvor lenge personlig Premium overlever en ufrivillig betalingsfeil.
 *
 * FJORTEN dager, ikke sju som for bedrifter, og det er ikke en avrunding:
 * karensperioden må ikke utløpe mens Stripe fortsatt prøver å trekke. Stripes
 * dunning-vindu er satt til 14 dager med smart retries, og hver purring sender
 * en ny e-post til kunden. Med sju dager ville brukeren mistet tilgangen på dag
 * 7 og deretter fått e-post på dag 9 om at betalingen forsøkes igjen — vi ville
 * altså sagt «vi prøver fortsatt» til noen vi allerede hadde stengt ute.
 * Endres dunning-vinduet i Stripe-dashbordet, skal dette tallet følge etter.
 */
export const PERSONAL_GRACE_DAYS = 14

/**
 * Statusene der Stripe fortsatt driver innkreving på et personlig abonnement.
 * Speiler DUNNING_STATUSES i lib/org-lock-grace.ts med vilje: det er samme
 * skille mellom «betalingen gikk ikke gjennom» og «noen har sagt opp», bare på
 * den andre kundetypen.
 */
export const PERSONAL_DUNNING_STATUSES: readonly string[] = ['past_due', 'unpaid']

const DAY_MS = 24 * 60 * 60 * 1000

export type PersonalGraceDecision =
  /** Ingen karensperiode nå. */
  | { grace: false; reason: 'not_dunning' | 'already_running' }
  /** Ufrivillig betalingsfeil — brukeren beholder Premium til `until`. */
  | { grace: true; reason: 'payment_failed'; until: string }

export type PersonalGraceInput = {
  /** `subscription.status` på hendelsens abonnement. */
  stripeStatus: string | null | undefined
  /**
   * `profiles.personal_grace_until` slik den står FØR denne hendelsen.
   * null/utløpt = ingen karensperiode løper.
   */
  existingGraceUntil: string | null | undefined
  now?: Date
}

/** Løper det en karensperiode akkurat nå? */
export function isPersonalGraceActive(
  until: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!until) return false
  // Ingen egen NaN-vakt: en ugyldig dato gir NaN, og NaN > n er alltid false,
  // så sammenligningen avviser den allerede. En `if (Number.isNaN(ts))` her
  // ville sett ut som et forsvar uten å være det — ingen mutasjon av den kan
  // felles av en test, fordi den ikke endrer noe utfall.
  return new Date(until).getTime() > now.getTime()
}

/**
 * Skal brukeren få karensperiode nå?
 *
 * KUN ufrivillig betalingsfeil gir karens. En kansellering — enten brukeren
 * selv trykket «avslutt» eller Stripe kansellerte etter endt dunning — kommer
 * med status `canceled`/`incomplete_expired` og treffer `not_dunning`. Det er
 * hele skillet mellom krav 1 (frivillig oppsigelse gir ingen karens) og krav 3
 * (tilgangen opphører faktisk når Stripe gir opp etter 14 dager).
 *
 * `already_running` finnes fordi ÉN betalingsfeil gir FLERE hendelser: Stripe
 * går past_due → unpaid, og hver purring kan oppdatere abonnementet på nytt.
 * Uten den vakten ville hver purring skjøvet sluttdatoen 14 nye dager fram, og
 * karensperioden ville aldri tatt slutt så lenge Stripe fortsatte å prøve.
 * Samme rolle som isLockTransition har for bedriftene.
 */
export function decidePersonalGrace(input: PersonalGraceInput): PersonalGraceDecision {
  const { stripeStatus, existingGraceUntil } = input
  const now = input.now ?? new Date()

  if (!stripeStatus || !PERSONAL_DUNNING_STATUSES.includes(stripeStatus)) {
    return { grace: false, reason: 'not_dunning' }
  }

  if (isPersonalGraceActive(existingGraceUntil, now)) {
    return { grace: false, reason: 'already_running' }
  }

  return {
    grace: true,
    reason: 'payment_failed',
    until: new Date(now.getTime() + PERSONAL_GRACE_DAYS * DAY_MS).toISOString(),
  }
}
