/**
 * Hvor lenge en admin-tilbakemelding blir stående.
 *
 * Bakgrunn (19. august 2026): alle fire admin-sidene med et `showFeedback`
 * skjulte meldingen etter 3–3,5 sekunder UANSETT type. For en kvittering
 * («Kode opprettet») er det riktig — handlingen lyktes, og beskjeden har gjort
 * jobben sin. For en FEIL er det feil form: den som nettopp mistet en lagring
 * har ofte ikke lest ferdig, og etterpå finnes det ingen spor av at noe gikk
 * galt. Verre på `fetchCodes`-stien, der feilmeldingen var det ENESTE som
 * skilte «hentingen feilet» fra tabellens «Ingen koder ennå. Lag din første!»
 * — etter tre sekunder sto det bare en påstand om at basen var tom.
 *
 * Samme skille som resten av kodebasen gjør mellom «feilet» og «tomt»
 * (lib/fetch-result.ts): et feilsvar er «vet ikke», og «vet ikke» skal ikke
 * kunne råtne til «alt er i orden» av seg selv.
 *
 * Ren logikk, ingen React — testdekket i lib/admin-feedback.test.ts.
 */

export type AdminFeedbackType = 'success' | 'error'

/** Kvitteringer forsvinner av seg selv. Uendret oppførsel for suksess. */
export const ADMIN_FEEDBACK_SUCCESS_MS = 3500

/**
 * Millisekunder til meldingen skal skjules automatisk, eller `null` for «bli
 * stående til noe erstatter den eller brukeren lukker den».
 *
 * Returnerer bevisst `null` — ikke `Infinity` eller et veldig stort tall — så
 * kalleren må ta stilling til at det IKKE skal settes en timer i det hele tatt.
 * En timer på ti minutter ville vært samme feil, bare tregere.
 */
export function autoDismissMs(type: AdminFeedbackType): number | null {
  return type === 'error' ? null : ADMIN_FEEDBACK_SUCCESS_MS
}
