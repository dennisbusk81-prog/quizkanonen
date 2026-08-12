// ── Hva brukeren får se når aktiveringen ikke gikk gjennom ──────────────────
//
// BAKGRUNN (12. august 2026)
// /premium sendte rutens `error`-felt rett ut i UI-et, uansett status. For de
// fleste svarene er det riktig: `founders-activate` formulerer selv teksten
// for 409 («Du har allerede hatt en gratis prøveperiode …»), 503-ene («Prøv
// igjen om et par minutter») og 400 — alle skrevet for en bruker, og bedre enn
// noe vi kan gjette oss til her.
//
// 500 er unntaket. Der er teksten enten teknisk og engelsk («Founders price
// not configured» — vakten som fyrer når STRIPE_PRICE_FOUNDERS mangler) eller
// intetsigende («Noe gikk galt»). Under en lokal klikktest 12. august møtte
// den første av dem en bruker som klikket FIRE ganger, fordi meldingen verken
// var til å forstå eller sto der klikket skjedde.
//
// Regelen: rutens tekst brukes KUN for statuser der den er skrevet for
// mennesker. Alt annet — 500, ukjent status, nettverksfeil, svar i en form vi
// ikke kjenner igjen — får vår egen setning.
//
// Siste ledd i den setningen er ikke høflighet, det er informasjon: ruten er
// fail-CLOSED, og alle utganger før det atomiske claimet lar `has_used_trial`
// stå urørt. En bruker som nettopp trykket på sin ENE prøveperiode og fikk en
// feil, trenger å vite at den ikke er brukt opp.

export const GENERISK_AKTIVERINGSFEIL =
  'Vi fikk ikke startet prøveperioden akkurat nå. Prøv igjen om et par minutter — kontoen din er ikke berørt.'

/**
 * Statuser der `founders-activate` selv skriver en brukervendt norsk tekst.
 *
 *   400 — «Du har allerede Premium»
 *   409 — «Du har allerede hatt en gratis prøveperiode …» / aktiv prøveperiode
 *   429 — «For mange forespørsler»
 *   503 — de tre fail-closed-utgangene («Prøv igjen om et par minutter»)
 *
 * 401 står bevisst UTENFOR: «Ikke innlogget» er sant, men ikke handlingsrettet
 * i en flyt brukeren startet som innlogget. Den får den generiske teksten til
 * noen eventuelt bygger en egen re-innloggings-sti.
 */
export const RUTETEKST_STATUSER = [400, 409, 429, 503] as const

/**
 * Hvor høyt et avvist aktiveringsforsøk skal logges.
 *
 * 409 er ikke en feil. Det er sperren fra ce6ccb5 som gjør nøyaktig jobben
 * sin: kontoen har hatt sin ene prøveperiode, og ruten sier det pent fra. Det
 * er normal drift, og normal drift skal ikke se ut som en feil.
 *
 * Konsekvensene av feil nivå er to, og begge er reelle:
 *   • Next sitt dev-overlay teller `console.error` som «1 Issue». En helt
 *     vellykket klikktest av sperren endte med et rødt tall i hjørnet.
 *   • Sentry lager ingen hendelse av en console-linje — `captureConsole` er
 *     ikke aktivert i noen av de tre initene (se lib/rate-limit-log.ts). MEN
 *     standard-breadcrumbs plukker opp console-kall og arver nivået. En
 *     error-breadcrumb fra normal bruk følger da med på neste ekte hendelse
 *     og farger feilsøkingen av noe helt annet.
 *
 * Alt annet — 500, 503, 400, 429, ukjent status, nettverksfeil — beholder
 * `error`. De betyr at noe faktisk ikke virket.
 */
export function activationLogLevel(status: number): 'info' | 'error' {
  return status === 409 ? 'info' : 'error'
}

/**
 * @param status HTTP-status fra ruten. 0 (eller hva som helst ukjent) for
 *               nettverksfeil — kalleren trenger ikke skille.
 * @param error  `error`-feltet fra svaret, i den formen det faktisk kom.
 */
export function decideActivationNotice(input: { status: number; error?: unknown }): string {
  if (!(RUTETEKST_STATUSER as readonly number[]).includes(input.status)) {
    return GENERISK_AKTIVERINGSFEIL
  }
  // Riktig status, men feltet mangler eller er ikke en streng: da har vi ingen
  // tekst å vise. En tom melding ville gitt en tom boks — synlig ramme uten
  // innhold, som er verre enn ingen boks.
  if (typeof input.error !== 'string') return GENERISK_AKTIVERINGSFEIL
  const tekst = input.error.trim()
  if (tekst === '') return GENERISK_AKTIVERINGSFEIL
  return tekst
}
