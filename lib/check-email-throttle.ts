// ── Bremsing av e-post-enumerering (/api/auth/check-email) ───────────────────
//
// BAKGRUNN
// Ruten svarer ærlig på om en e-postadresse har konto hos oss, og den gjør det
// UTEN innlogging — den må, siden hele poenget er å hjelpe noen som ennå ikke
// er logget inn. Det er et bevisst valg vi beholder, men det gjør ruten til et
// oppslagsverk: gitt nok kall kan hvem som helst kartlegge hvilke av 400
// Facebook-medlemmer som er registrert.
//
// HVORFOR IKKE lib/rate-limit.ts ALENE
// Samme grunn som i lib/redeem-throttle.ts og lib/invite-quota.ts: Map-en lever
// per serverless-instans, og Vercel kjører mange parallelt. Den duger som
// burst-brems, ikke som den grensen vi lener oss på. Den autoritative tellingen
// ligger i admin_actions, som overlever kalde starter.
//
// HVA SOM TELLES — og hvorfor det IKKE er bom her
// I lib/redeem-throttle.ts telles kun bom, fordi «koden finnes ikke» der er
// nøyaktig signalet på gjetting. Her har bom motsatt fortegn: «e-posten finnes
// ikke» er det NORMALE utfallet av en ekte pre-signup. Bom-telling ville
// straffet hver eneste nye bruker som registrerer seg, og samtidig sluppet
// gjennom enumereringen som treffer eksisterende kontoer. Signalet her er
// volum, uansett utfall:
//   • en ekte person slår opp 1–3 adresser (pre-signup, post-signup, og ved
//     mislykket passordinnlogging én lookup)
//   • en enumerator må ha hundrevis for at øvelsen skal ha noen verdi
//
// KUN IP-DIMENSJON
// Ruten er uinnlogget, så det finnes ingen konto å telle på. IP-bøtta er det
// eneste vi har, og grensen er satt deretter — se konstanten under.

export const CHECK_EMAIL_ACTION = 'auth_email_lookup'

/** Tellevindu. */
export const CHECK_EMAIL_WINDOW_MS = 60 * 60 * 1000

// Grensen er satt mot det verste LEGITIME tilfellet, ikke mot det typiske.
// Verstefallet er mange ekte brukere bak én utgående IP: et kontornett, eller
// norsk mobil-CGNAT der flere abonnenter deler adresse. To kall per
// registrering (pre-signup + post-signup) betyr at 100 dekker rundt 50
// registreringer fra samme IP innenfor samme time — langt over noe vi har sett.
//
// For en enumerator er det samme tallet en helt annen historie: å kartlegge en
// liste på noen tusen adresser krever like mange kall, og stopper på 100.
export const CHECK_EMAIL_LIMIT_IP = 100

export type CheckEmailThrottleDecision =
  | { allowed: true }
  | { allowed: false; message: string }

/**
 * Ren beslutning: har denne IP-bøtta slått opp for mange adresser i vinduet?
 */
export function decideCheckEmailThrottle(lookups: number): CheckEmailThrottleDecision {
  if (lookups >= CHECK_EMAIL_LIMIT_IP) {
    return {
      allowed: false,
      message: 'For mange forespørsler fra dette nettverket. Prøv igjen om en stund.',
    }
  }
  return { allowed: true }
}
