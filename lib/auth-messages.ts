// Brukervendte feilmeldinger for e-postbasert innlogging.
//
// Rene funksjoner, ingen imports — trygg å bruke fra klientkomponenter
// (i motsetning til lib/auth-post-login.ts, som drar inn service-role-klienten).
// Delt mellom /login og /profil så de to stedene ikke sier forskjellige ting om
// nøyaktig samme feil.

// Feilmelding når en e-postlenke IKKE lot seg sende.
//
// Tidligere ble enhver feil her vist som «Sjekk at e-postadressen er riktig».
// Den vanligste feilen i praksis er Supabase sin rate-limit på utsending — og da
// er e-postadressen helt korrekt. Brukeren ble sendt for å lete etter en skrivefeil
// som ikke fantes, i stedet for å bli bedt om å vente et minutt.
export function sendLinkErrorMessage(err: { message?: string; status?: number }): string {
  const msg = (err.message ?? '').toLowerCase()
  const rateLimited =
    err.status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('for security purposes') ||
    msg.includes('only request this after')
  if (rateLimited) {
    return 'Du ba nettopp om en lenke. Vent et minutt før du prøver igjen — sjekk innboksen og søppelposten i mellomtiden.'
  }
  return 'Kunne ikke sende lenken akkurat nå. Prøv igjen om litt.'
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
