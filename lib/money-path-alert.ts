import * as Sentry from '@sentry/nextjs'

// ── Varsling når en PENGE-operasjon feiler stille ────────────────────────────
//
// BAKGRUNN (12. august 2026)
// `/api/codes/redeem` pauser abonnementet til en betalende kunde som løser inn
// en verdikode, slik at de ikke trekkes for en periode de samtidig får gratis.
// Feilet `stripe.subscriptions.update`, ble koden likevel gitt — riktig
// prioritering — og det eneste sporet var en `console.error` med teksten
// «KRITISK: kunden risikerer å bli belastet». Kunden betaler kr 49 for en måned
// de fikk i gave, og INGEN oppdager det: Sentry-oppsettet har ingen
// captureConsole-integrasjon, så en `console.error` når aldri fram.
//
// Feilen har søsken. Det finnes flere steder der en operasjon som flytter penger
// feiler, ruten bevisst fortsetter med et suksess-svar, og loggen er eneste spor.
//
// HVA SOM KVALIFISERER (alle tre kravene samtidig)
//   1. Operasjonen flytter eller STOPPER penger — en Stripe-mutasjon, eller den
//      DB-skrivingen som er eneste kobling til en Stripe-tilstand.
//   2. Kontrollflyten fortsetter bevisst. Brukeren får ikke vite noe, og vil
//      derfor aldri melde fra.
//   3. Ingen retry, ingen webhook og ingen annen mekanisme vil oppdage det.
//
// Krav 2 er det som skiller klassen fra vanlige feil: en feil brukeren SER blir
// meldt inn av brukeren. En feil som gir 200 blir aldri meldt inn av noen.
//
// HVORFOR EN SINK OG IKKE `Sentry.captureMessage` PÅ HVERT STED
// Samme begrunnelse som rapporteringen i lib/email.ts, escapingen i
// lib/email-templates.ts og skrubbingen i lib/sentry-scrub.ts: nyttelastens
// form, taggen, nivået og aldri-kast-garantien nedenfor skal eies ett sted.
// Et sjuende kallsted arver dem gratis i stedet for å måtte huske dem.
//
// `console.error` hos kallerne er BEHOLDT. Den er fortsatt det raskeste sporet i
// en lokal `npm run dev`, og teksten der er ofte rikere enn det vi vil sende ut
// av huset. Det eneste nye er at feilen blir synlig i prod.

export type MoneyPathFailure = {
  /**
   * Stabil identifikator for operasjonen, på formen `<rute>:<handling>`.
   *
   * Denne er meldingsteksten Sentry grupperer på, og derfor skal den IKKE
   * inneholde id-er eller annet som varierer per hendelse — da ville hver
   * forekomst blitt en ny sak i stedet for en teller på den samme.
   */
  operation: string
  /**
   * Hva som skjer med pengene hvis ingen griper inn. Skrevet for den som blir
   * vekket av varselet, ikke for utvikleren som skrev linja: «kunden trekkes for
   * en periode de fikk gratis» er brukbart, «pause feilet» er det ikke.
   */
  consequence: string
  /** Den underliggende feilen, hvis det finnes en. */
  err?: unknown
  /**
   * Ikke-personlige identifikatorer som gjør saken mulig å rette opp manuelt —
   * typisk `subscriptionId`, `orgId`, `userId`, `sessionId`.
   *
   * Send ALDRI e-postadresser eller navn hit. `scrubEvent` ville riktignok
   * fjernet en e-postadresse (den skrubber også `extra`), men en personopplysning
   * som aldri forlater prosessen kan ikke lekke gjennom en framtidig endring i
   * skrubbingen. Samme holdning som mottakeradressen i lib/email.ts.
   */
  context?: Record<string, string | number | null | undefined>
}

/**
 * Rapporter en stille feil på en pengesti.
 *
 * KASTER ALDRI. Kallstedene har allerede bestemt seg for å fortsette — en
 * innløsning som gikk gjennom skal ikke kunne rulle tilbake fordi Sentry er
 * nede. Samme holdning som fail-open i lib/rate-limit-shared.ts, og grunnen til
 * at hele kroppen ligger i try/catch.
 *
 * `captureMessage` og ikke `captureException`, selv når vi har en feil:
 * grupperingen skal følge OPERASJONEN, ikke feilteksten. Vi vil ha én sak per
 * pengesti med en teller, ikke én sak per Stripe-feilvariant. Feilen følger med
 * i `extra` — det er der den er nyttig.
 */
export function reportMoneyPathFailure(failure: MoneyPathFailure): void {
  try {
    Sentry.captureMessage(`money-path: ${failure.operation}`, {
      level: 'error',
      tags: { area: 'money-path', operation: failure.operation },
      extra: {
        consequence: failure.consequence,
        ...describeError(failure.err),
        ...failure.context,
      },
    })
  } catch {
    // Sentry selv feilet. Det er ingenting fornuftig å gjøre her: vi kan ikke
    // rapportere at rapporteringen feilet, og kallstedet skal fortsette uansett.
  }
}

/**
 * Feilen flatet ut til noe som overlever serialisering til Sentry.
 *
 * Håndterer BEGGE formene kallstedene faktisk sender: en ekte `Error` fra
 * Stripe-klienten, og et rått PostgrestError-objekt (`{ message, code }`) fra
 * Supabase — det er ikke en Error-instans, og `String(...)` på det gir
 * «[object Object]», altså et varsel uten innhold.
 */
function describeError(err: unknown): Record<string, string> {
  if (err === undefined || err === null) return {}

  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message }
  }

  if (typeof err === 'object') {
    const obj = err as { message?: unknown; code?: unknown; name?: unknown }
    if (typeof obj.message === 'string') {
      return {
        errorMessage: obj.message,
        ...(typeof obj.code === 'string' ? { errorCode: obj.code } : {}),
        ...(typeof obj.name === 'string' ? { errorName: obj.name } : {}),
      }
    }
  }

  return { errorMessage: String(err) }
}
