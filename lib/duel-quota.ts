// ── Totalt døgntak på utgående utfordringer per AVSENDER ────────────────────
//
// BAKGRUNN (kartlegging 1. august 2026)
// lib/duel-cooldown.ts stopper spam mot ÉN mottaker: maks 3 utfordringer per
// døgn til samme person, talt uansett status, så løkken utfordre → kanseller →
// utfordre er verdiløs mot ett offer. Men den sperren er per (avsender,
// mottaker) — den sier ingenting om hvor mange FORSKJELLIGE mottakere én konto
// kan gå gjennom. Med ~400 medlemmer var det reelle taket per konto derfor
// 3 × antall medlemmer ≈ 1200 e-poster i døgnet fra hei@quizkanonen.no.
//
// Denne grensen er et TILLEGG, ikke en erstatning. De to måler ulike ting:
//   per mottaker (duel-cooldown) → «hvor mye tåler ÉN person å bli tutet på»
//   per avsender (denne)         → «hvor mye kan ÉN konto sende totalt»
// Begge må passere. Fjernes én av dem, åpner den andre halvparten seg igjen.
//
// HVORFOR IKKE lib/rate-limit.ts
// Den er en Map i minnet, altså per serverless-instans. Vercel resirkulerer
// instanser og kjører mange parallelt, så en angriper som fordeler
// forespørslene treffer stadig ferske tellere. Samme erkjennelse som i
// lib/invite-quota.ts og lib/redeem-throttle.ts: den autoritative tellingen
// ligger i admin_actions, som overlever kalde starter. IP-bremsen i ruten
// (5/min) beholdes som billig førstelag foran DB-arbeidet.
//
// HVORFOR IKKE TELLE FRA rivalries-TABELLEN
// Rader kan forsvinne der uten at utfordringen var «gratis» — race-vakten i
// ruten sletter sin egen rad ved konflikt, og kontosletting river rader med
// seg. En egen bokføringsrad i admin_actions teller nøyaktig det vi vil
// begrense: en utfordring som faktisk gikk ut.
//
// HVORFOR INGEN IP-DIMENSJON HER
// lib/redeem-throttle.ts har en, fordi kodegjetting er billig å spre over
// mange konti. Dueller er ikke det: en utfordring krever en ekte konto, en
// ekte mottaker-id, og hver konto er allerede hardt begrenset både per
// mottaker og totalt. Til gjengjeld ville en IP-bøtte truffet det mest
// normale bruksmønsteret vi har — kolleger på samme kontornett som utfordrer
// hverandre. Kostnaden er høyere enn gevinsten.

export const DUEL_SENT_ACTION = 'duel_challenge_sent'

/** Tellevindu: rullerende døgn, ikke kalenderdøgn (ingen midnatts-nullstilling å vente på). */
export const DUEL_SENDER_WINDOW_MS = 24 * 60 * 60 * 1000

// Satt mot faktisk bruk, ikke mot en følelse. Ruten tillater kun ÉN åpen duell
// av gangen per bruker, så 10 utfordringer i døgnet forutsetter at man har
// kansellert ni ganger. Ingen ekte spiller gjør det. Samtidig, kombinert med
// taket på 3 per mottaker, betyr grensen at en misbrukskonto nå når maksimalt
// ~4 forskjellige personer i døgnet i stedet for alle 400.
export const DUEL_SENDER_MAX_PER_DAY = 10

export type DuelSenderQuotaInput = {
  /** Antall utfordringer denne kontoen har sendt i vinduet. */
  sentLastDay: number
}

export type DuelSenderQuotaDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; message: string }

/**
 * Har denne kontoen brukt opp døgnkvoten sin på utgående utfordringer?
 *
 * Ren funksjon — all I/O (tellingen og bokføringen) ligger i ruten.
 */
export function decideDuelSenderQuota({
  sentLastDay,
}: DuelSenderQuotaInput): DuelSenderQuotaDecision {
  if (sentLastDay >= DUEL_SENDER_MAX_PER_DAY) {
    return {
      allowed: false,
      message:
        'Du har sendt mange utfordringer det siste døgnet. Vent litt før du utfordrer flere.',
    }
  }
  return { allowed: true, remaining: DUEL_SENDER_MAX_PER_DAY - sentLastDay }
}
