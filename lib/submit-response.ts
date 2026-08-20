// Én invariant: et svar som BEKREFTER at forsøket er lagret skal aldri kunne
// vises for spilleren som om innsendingen mislyktes.
//
// Bakgrunn (5. august 2026): timeout-vakten i `finishQuiz` gir spilleren en
// «Prøv igjen»-knapp når submit ikke svarer innen 9 sekunder. Men submit er
// IKKE idempotent: rakk det første kallet fram til serveren likevel — bare for
// sent til at klienten fikk se svaret — treffer det nye kallet dobbel-scoring-
// vernet i app/api/quiz/[id]/submit/route.ts og får
// `403 { error: 'Forsøket er allerede levert' }`.
//
// Det svaret ser ut som en feil og betyr det stikk motsatte. Uten dette skillet
// hoppet klienten over resten av try-blokken: resultatskjermen mistet topp-3 og
// plasseringskortet, og spilleren fikk «Vi fikk ikke bekreftet om resultatet ble
// lagret» om et resultat som lå trygt i basen.
//
// Klassifiseringen ligger her, som ren funksjon, av samme grunn som
// `lib/answer-key-correction.ts` og `lib/invite-quota.ts`: beslutningen er verdt
// å teste for seg, uavhengig av komponenten den kalles fra.

// ⚠ DELT KONTRAKT MELLOM SERVER OG KLIENT — ikke bare en feiltekst.
//
// app/api/quiz/[id]/submit/route.ts svarer med denne teksten i dobbel-scoring-
// vernet (403) og i race-grenen (409). Klienten LESER og TOLKER den:
// `classifySubmitResponse` under bruker den til å skille «forsøket ditt ligger
// allerede trygt lagret» fra en ekte feil, etter at en timeout har fått
// spilleren til å trykke «Prøv igjen».
//
// Statuskoden alene holder IKKE: submit-ruten har fem ulike 403-er (ugyldig
// token, forsøk i feil quiz, ingen tilgang, manglende autentisering, for rask
// innsending), og fire av dem er ekte feil. Meldingen er det eneste som skiller
// dem i dagens respons.
//
// Derfor: endres teksten, må den endres HER — begge sider leser samme konstant.
// Skriver du den ordrett i ruten igjen, er koblingen brutt i stillhet, og
// spilleren får «vi fikk ikke bekreftet» om et resultat som ER lagret.
// lib/submit-response.test.ts feller en slik ordrett kopi.
export const ALREADY_SUBMITTED_ERROR = 'Forsøket er allerede levert'

export type SubmitClassification =
  // Serveren scoret forsøket nå og sendte tallene tilbake.
  | { kind: 'scored' }
  // Forsøket var allerede lagret fra før — vårt eget første kall rakk fram.
  // Bekreftelse på suksess, ikke en feil.
  | { kind: 'already-stored' }
  // 503 «prøv igjen om et øyeblikk» — transient serverfeil, skal til
  // timeout-veiens retry-skjerm, ikke feilveien.
  | { kind: 'retryable' }
  // Alt annet: ekte feil, skal gå feilveien.
  | { kind: 'error' }

export type SubmitResponseFacts = {
  status: number
  ok: boolean
  // `error`-feltet fra JSON-kroppen, hvis den lot seg lese.
  errorMessage?: string | null
  // Har vi allerede timet ut på dette forsøket? Avgjørende: dette er det som
  // gjør «allerede levert» til en forventet bekreftelse i stedet for et
  // mistenkelig svar.
  hasTimedOutOnce: boolean
}

export function classifySubmitResponse(facts: SubmitResponseFacts): SubmitClassification {
  if (facts.ok) return { kind: 'scored' }

  // Submit-rutens fem 503-er betyr alle «transient, prøv igjen» — uavhengig av
  // hasTimedOutOnce, for de gjelder også et første forsøk. Kun 503: 429 er
  // bevisst fortsatt en feil.
  if (facts.status === 503) return { kind: 'retryable' }

  // Den milde tolkningen gjelder KUN etter en timeout vi selv har sett.
  // På et første, ordinært forsøk betyr «allerede levert» noe helt annet — et
  // replay eller et forsøk som er levert fra en annen flate — og skal fortsatt
  // behandles som feil. Uten denne betingelsen ville enhver 403 med den
  // meldingen blitt stille godtatt som suksess.
  if (!facts.hasTimedOutOnce) return { kind: 'error' }

  // Kun 403. Rutens 409 med samme tekst betyr at attempts-raden ikke fantes da
  // den ble lest tilbake — der er noe faktisk galt, og det skal ikke skjules.
  if (facts.status === 403 && facts.errorMessage === ALREADY_SUBMITTED_ERROR) {
    return { kind: 'already-stored' }
  }

  return { kind: 'error' }
}
