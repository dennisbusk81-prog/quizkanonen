import { createHash } from 'crypto'

// ── Bremsing av gjetting mot verdikoder (/api/codes/redeem) ──────────────────
//
// BAKGRUNN
// En DELT kode er bevisst et minneverdig ord — «FREDAG2025» er ikke en
// hemmelighet, og skal ikke være det. Forsvaret for den typen kode er
// bruksgrensene (max_uses, valid_until, én innløsning per konto), ikke at
// teksten er vanskelig å gjette. Men uten en brems kan noen prøve seg fram i
// stort tempo og spise plassene på en kampanjekode før de riktige mottakerne
// rekker det.
//
// HVORFOR IKKE lib/rate-limit.ts ALENE
// Den er en Map i minnet, altså per serverless-instans. Vercel resirkulerer
// instanser hele tiden og kjører mange parallelt, så en angriper som sender
// raskt treffer stadig ferske tellere. Den duger som burst-brems foran, men
// ikke som den grensen vi faktisk lener oss på. Samme erkjennelse som i
// lib/invite-quota.ts: den autoritative tellingen ligger i admin_actions, som
// overlever kalde starter.
//
// HVA SOM TELLES — og hvorfor bare bom
// Vi teller kun forsøk der koden IKKE finnes. Det er nøyaktig signalet på
// gjetting, og det gjør at ingen ekte bruker noensinne bremses:
//   • En som skriver inn en gyldig kode blir aldri talt.
//   • Feilene som ikke er gjetting — utløpt kode, allerede innløst, dekket av
//     org — blir heller ikke talt. En bruker som prøver den samme
//     ikke-fungerende koden ti ganger skal se feilmeldingen sin, ikke en
//     utestengelse.
//   • Et kontor bak én NAT-IP der tjue kolleger løser inn den samme gyldige
//     koden gir null treff. Det er den viktigste falsk-positiv-fellen her.
// Innløsning krever dessuten innlogging, så hvert bom er knyttet til en konto.
//
// TO UAVHENGIGE DIMENSJONER, ÉN RAD
// Raden som skrives har både user_id og en IP-bøtte, så én insert dekker begge
// tellingene:
//   per bruker → filtrer på user_id   (IP-er roteres billig, konti ikke)
//   per IP     → filtrer på scope_id  (fanger mange konti fra samme maskin)

export const REDEEM_MISS_ACTION = 'code_redeem_miss'

/** Tellevindu for begge grensene. */
export const REDEEM_WINDOW_MS = 60 * 60 * 1000

// Grensene er satt mot faktisk bruk, ikke mot en følelse: en ekte innløsning
// skjer én gang, kanskje to hvis man skriver feil. Ti bom på en time er langt
// over det, og fortsatt lavt nok til at gjetting ikke kommer noen vei.
export const REDEEM_MISS_LIMIT_USER = 10

// IP-grensen er høyere fordi flere ekte brukere kan dele utgående IP
// (mobilnett/CGNAT, kontornett). Den skal fange én maskin som maler gjennom
// mange konti, ikke et delt nett.
export const REDEEM_MISS_LIMIT_IP = 30

/**
 * Stabil, ikke-reverserbar bøtte-id for en IP, formatert som UUID.
 *
 * admin_actions.scope_id er av typen uuid, så en rå IP kan ikke lagres der —
 * og bør heller ikke det. Hashen er kun en bøtte å telle i: den er
 * deterministisk (samme IP → samme bøtte) og bærer ingen adresse videre inn i
 * databasen.
 *
 * Nøkkelen gjør bøttene uforutsigbare for utenforstående. Mangler den, faller
 * vi tilbake til en ren hash i stedet for å kaste: dette er en teller, ikke en
 * autentiseringsgrense — bøtta skal virke selv om ingen hemmelighet er satt.
 */
export function ipScopeId(rawIp: string): string {
  // x-forwarded-for er «klient, proxy1, proxy2». Kun første hopp er klienten;
  // resten skifter med rutingen og ville gitt samme klient nye bøtter.
  const ip = (rawIp.split(',')[0] ?? '').trim().toLowerCase() || 'unknown'
  const key = process.env.QUIZ_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const hex = createHash('sha256').update(`${key}|redeem-ip|${ip}`).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export type RedeemThrottleInput = {
  /** Antall bom fra denne kontoen i vinduet. */
  userMisses: number
  /** Antall bom fra denne IP-bøtta i vinduet. */
  ipMisses: number
}

export type RedeemThrottleDecision =
  | { allowed: true }
  | { allowed: false; scope: 'user' | 'ip'; message: string }

/**
 * Ren beslutning: har denne kontoen eller denne IP-en bommet for mye?
 *
 * Bruker-grensen sjekkes først. Treffer begge, er det kontoens egen oppførsel
 * som er nærmest brukeren, og meldingen skal si det.
 */
export function decideRedeemThrottle({
  userMisses,
  ipMisses,
}: RedeemThrottleInput): RedeemThrottleDecision {
  if (userMisses >= REDEEM_MISS_LIMIT_USER) {
    return {
      allowed: false,
      scope: 'user',
      message: 'For mange mislykkede kodeforsøk. Vent en time og prøv igjen.',
    }
  }
  if (ipMisses >= REDEEM_MISS_LIMIT_IP) {
    return {
      allowed: false,
      scope: 'ip',
      message: 'For mange mislykkede kodeforsøk fra dette nettverket. Prøv igjen om en stund.',
    }
  }
  return { allowed: true }
}
