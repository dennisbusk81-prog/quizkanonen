/**
 * Hvordan en «Prøv igjen» skal se ut mens den faktisk prøver.
 *
 * Bakgrunn (19. august 2026): `refreshMyOrgs()` i ProfileProvider nullstilte
 * `myOrgsError` FØR det nye kallet ble sendt. Feiltilstanden var altså borte i
 * samme øyeblikk brukeren trykket. På /org/[slug] betydde det at feilskjermen
 * ble byttet med lasteskjermen — bevisst den gangen. På de to inline-lenkene
 * (resultatskjermen i app/quiz/[id] og /leaderboard/[id]) betydde det noe helt
 * annet: `shouldOfferPlacementRetry` gates på nettopp `myOrgsError`, så HELE
 * avsnittet — forklaringen og lenken — forsvant i klikkøyeblikket og kom
 * tilbake først hvis kallet feilet på nytt. Utenfra: man trykker, teksten
 * forsvinner, ingenting skjer, teksten er tilbake. Det er ikke til å skille fra
 * en knapp som ikke virker.
 *
 * Regelen som følger av det: en feiltilstand skal bestå til det NYE forsøket
 * har svart. Fram til da er svaret «prøver», ikke «ingen feil». Samme skille
 * som `Loaded<T>` gjør mellom «feilet» og «tomt» — her mellom «prøver» og
 * «ferdig».
 *
 * Ren logikk, ingen React. Delt av alle tre kallstedene så de ikke kan drive
 * fra hverandre igjen.
 */

export type RetryState =
  /** Ingenting å tilby — det finnes ingen feil å rette. */
  | 'hidden'
  /** Feilet, står stille, venter på at brukeren trykker. */
  | 'idle'
  /** Brukeren har trykket, kallet er underveis. */
  | 'pending'

/**
 * `refreshing` VINNER over `failed`. Det er hele poenget: mellom trykket og
 * svaret er ingen av de to andre tilstandene sanne, og uten et eget navn ble
 * det vinduet tegnet som «hidden».
 */
export function describeRetry(input: { failed: boolean; refreshing: boolean }): RetryState {
  if (input.refreshing) return 'pending'
  return input.failed ? 'idle' : 'hidden'
}
