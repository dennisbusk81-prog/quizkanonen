// Brukervendte feilmeldinger for e-postbasert innlogging.
//
// Rene funksjoner, ingen imports — trygg å bruke fra klientkomponenter
// (i motsetning til lib/auth-post-login.ts, som drar inn service-role-klienten).
// Delt mellom /login og /profil så de to stedene ikke sier forskjellige ting om
// nøyaktig samme feil.

/**
 * Den delen av Supabase sin AuthError vi faktisk leser. Egen type framfor et
 * import fra @supabase/auth-js, slik at modulen forblir importfri og kan kalles
 * med et hvilket som helst feilobjekt i test.
 */
export type AuthErrorLike = { message?: string; status?: number; code?: string }

// GoTrue sine egne koder for «du har brukt opp kvoten». Hentet fra ErrorCode-
// unionen i @supabase/auth-js/dist/module/lib/error-codes.d.ts.
const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
])

/**
 * Er dette en «for mange forsøk»-feil?
 *
 * TRE signaler, med vilje, fordi GoTrue ikke er konsistent på tvers av
 * endepunkter og versjoner:
 *   • `status === 429` — det ryddige tilfellet.
 *   • `code` — finnes på HTTP-baserte feil, men er `undefined` på feil som
 *     oppstår FØR et svar er mottatt (se doc-kommentaren på AuthError.code).
 *   • meldingsteksten — 60-sekunders-sperren («For security purposes, you can
 *     only request this after N seconds») har historisk kommet med status 400
 *     og uten kode. Tekstmatchen er derfor ikke belte-og-bukseseler, den er det
 *     ENESTE som fanger det tilfellet.
 */
export function isRateLimitedAuthError(err: AuthErrorLike): boolean {
  const msg = (err.message ?? '').toLowerCase()
  return (
    err.status === 429 ||
    RATE_LIMIT_CODES.has(err.code ?? '') ||
    msg.includes('rate limit') ||
    msg.includes('for security purposes') ||
    msg.includes('only request this after')
  )
}

/**
 * Er kontoen registrert, men e-posten aldri bekreftet?
 *
 * Fram til 3. september 2026 var dette en ren tekstmatch på 'not confirmed' i
 * AuthForm. Den avgjør om brukeren i det hele tatt får se «send lenken på
 * nytt»-knappen, så en bom her betyr at kontoen forblir uten vei ut — akkurat
 * den tilstanden knappen finnes for. Koden sjekkes derfor i tillegg, ikke i
 * stedet.
 */
export function isEmailNotConfirmedError(err: AuthErrorLike): boolean {
  return (
    err.code === 'email_not_confirmed' ||
    (err.message ?? '').toLowerCase().includes('not confirmed')
  )
}

/**
 * Én streng for «vent litt», delt av alle e-postutsendingene. Eksportert fordi
 * signup-grenen gjenbruker den gjennom sendLinkErrorMessage — teksten skal
 * finnes ett sted, ikke i to varianter som kan drive fra hverandre.
 */
export const RATE_LIMIT_WAIT_TEXT =
  'Du ba nettopp om en lenke. Vent et minutt før du prøver igjen — sjekk innboksen og søppelposten i mellomtiden.'

// Feilmelding når en e-postlenke IKKE lot seg sende.
//
// Tidligere ble enhver feil her vist som «Sjekk at e-postadressen er riktig».
// Den vanligste feilen i praksis er Supabase sin rate-limit på utsending — og da
// er e-postadressen helt korrekt. Brukeren ble sendt for å lete etter en skrivefeil
// som ikke fantes, i stedet for å bli bedt om å vente et minutt.
export function sendLinkErrorMessage(err: AuthErrorLike): string {
  if (isRateLimitedAuthError(err)) {
    return RATE_LIMIT_WAIT_TEXT
  }
  return 'Kunne ikke sende lenken akkurat nå. Prøv igjen om litt.'
}

/**
 * Passordinnlogging avvist av Supabase sin sign-in-grense (100 per 5 min per IP).
 *
 * Peker BEVISST ikke mot «Glemt passord?». Den knappen sender en e-post fra
 * nøyaktig den kvoten som allerede er under press, så rådet ville forsterket
 * problemet det gir råd om. Teksten påstår heller ikke at passordet var riktig:
 * ved 429 kom vi aldri så langt som til å sjekke det.
 */
export const LOGIN_RATE_LIMIT_TEXT =
  'For mange innloggingsforsøk fra dette nettverket. Vent et minutt og prøv igjen.'

/**
 * /api/auth/check-email svarte 429, så diagnosen ble aldri fullført.
 *
 * Ruten har to 429-lag (burst-brems 10/60 s i minnet, og den autoritative
 * tellingen 100/time per IP i admin_actions). Klienten ser ingen forskjell på
 * dem, og trenger ikke det.
 *
 * Teksten er ærlig om BEGGE halvdelene: passordet ble avvist av GoTrue, OG vi
 * fikk ikke slått opp hvorfor. Uten den andre halvdelen ville en bruker bak et
 * kontornett i en lanseringsspiss fått «Feil e-post eller passord.» som eneste
 * forklaring på noe som kan være en helt annen feil.
 */
export const LOOKUP_RATE_LIMIT_TEXT =
  'Passordet ble ikke godtatt, og vi kunne ikke sjekke kontoen din akkurat nå — for mange forespørsler fra dette nettverket. Vent et minutt og prøv igjen.'

/**
 * Delt av pre-signup-sperren og av signup-svaret fra GoTrue. Begge betyr det
 * samme for brukeren; den ene er en sjekk vi gjør før, den andre et race vi
 * ikke rakk å fange.
 */
export const ALREADY_REGISTERED_TEXT =
  'Denne e-posten er allerede registrert. Logg inn med passordet ditt eller Google under.'

// 8 er VÅR policy, håndhevet i AuthForm og profil-siden.
// Supabase' egen minimumsgrense er 6 (målt 03.09.2026,
// Authentication -> Sign In / Providers -> Email). Vår er
// bevisst strengere. Teksten skal følge VÅRT tall, siden det
// er grensen brukeren faktisk møter i skjemaet.
// Senkes klienten til 6, må dette tallet følge etter.
export const WEAK_PASSWORD_TEXT =
  'Passordet er for svakt. Velg et passord på minst 8 tegn.'

export type SignupFailure =
  | { kind: 'rate-limited'; text: string }
  | { kind: 'weak-password'; text: string }
  | { kind: 'already-registered'; text: string }
  | { kind: 'unknown'; text: string }

/**
 * Hvorfor feilet signup?
 *
 * Fram til 3. september 2026 hadde grenen ÉN tekst — «Kunne ikke opprette
 * konto. Prøv igjen.» — for kvotefeil, 60-sekunders-cooldown, for svakt passord
 * og Supabase nede. Rådet «prøv igjen» er direkte feil i tre av de fire:
 * kvotefeil og cooldown krever at man VENTER, og et for svakt passord blir ikke
 * bedre av å sendes på nytt.
 *
 * Merk hvorfor dette ikke bare er `sendLinkErrorMessage(err)`: den ville gjort
 * «passordet er for svakt» om til «Kunne ikke sende lenken akkurat nå», altså
 * byttet en unyttig tekst mot en direkte villedende. Rate-limit-tilfellet
 * DELEGERES dit, slik at vente-teksten finnes ett sted.
 */
export function classifySignupFailure(err: AuthErrorLike): SignupFailure {
  if (isRateLimitedAuthError(err)) {
    return { kind: 'rate-limited', text: sendLinkErrorMessage(err) }
  }

  const msg = (err.message ?? '').toLowerCase()

  if (
    err.code === 'weak_password' ||
    msg.includes('password should be') ||
    msg.includes('weak password')
  ) {
    return { kind: 'weak-password', text: WEAK_PASSWORD_TEXT }
  }

  // Racet pre-signup-sperren i AuthForm ikke kan fange: to faner, eller to
  // personer på samme adresse i samme sekund.
  if (
    err.code === 'user_already_exists' ||
    err.code === 'email_exists' ||
    msg.includes('already registered') ||
    msg.includes('already been registered') ||
    msg.includes('user already exists')
  ) {
    return { kind: 'already-registered', text: ALREADY_REGISTERED_TEXT }
  }

  return {
    kind: 'unknown',
    text: 'Kunne ikke opprette konto akkurat nå. Prøv igjen om litt.',
  }
}

// Forklaring på hvorfor brukeren ble sendt tilbake til /login fra en e-postlenke.
// /auth/callback og /api/auth/bekreft redirecter dit med ?error=, men INGEN leste
// parameteren før 20. juli — brukeren landet på en helt vanlig innloggingsside
// uten noen antydning om hva som gikk galt, og prøvde derfor naturlig nok å be om
// en ny lenke med én gang (som så traff rate-limiten og ga en melding om at
// e-postadressen var feil).
export function linkErrorMessage(code: string): string {
  switch (code) {
    case 'auth_failed':
      return 'Lenken kunne ikke brukes. Den er som regel enten utløpt, allerede brukt, eller åpnet i en annen nettleser enn den du ba om den fra. Be om en ny lenke under.'
    case 'link_invalid':
      return 'Lenken er utløpt eller allerede brukt. Be om en ny lenke under, så sender vi en fersk.'
    case 'rate_limit':
      return 'For mange forsøk på kort tid. Vent et minutt og prøv igjen.'
    default:
      return 'Noe gikk galt med lenken. Be om en ny under.'
  }
}
