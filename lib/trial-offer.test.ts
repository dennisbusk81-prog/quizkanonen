// Kjøres med:  npm test
//
// decideTrialOffer / isTrialEligible / parseTrialDays — betingelsen bak den
// synlige 14-dagers prøveperioden. Tre flater spør den om det samme:
// forsidens Premium-CTA-er (server-side), /premium og upsell-kortet på
// resultatskjermen (begge via /api/premium/trial-offer).
//
// HVA TESTENE VOKTER
//  1. At UKJENT eligibility (utlogget, eller et oppslag som ikke landet) VISER
//     tilbudet. Klientsjekken er visning; founders-activate er gaten, og den er
//     fail-closed. Skjuler vi ved «vet ikke», mister en kvalifisert bruker
//     tilbudet uten at noen får vite det — den stille retningen av feilen.
//  2. At et manglende/ugyldig dagtall gir DAGENS tekst, aldri et gjettet «14».
//     Samme fail-closed-holdning som ruten: uten et bestemt tall skal ingen
//     flate love en lengde. Nøkkelen er en INNSTILLING
//     (site_settings.founders_new_trial_days), ikke en konstant.
//  3. At både «har alt Premium» og «har brukt prøveperioden» skjuler tilbudet.
//
// MUTASJONER testene feller (alle kjørt 12. august 2026 — se rapporten):
//   • `eligible === false` → `eligible !== true`  (null begynner å skjule)
//       feller «UKJENT viser tilbudet» (utlogget)
//   • `if (days === null) return NO_OFFER` fjernet, days ?? 14
//       feller «manglende dagtall gir ingen dagangivelse»
//   • `if (input.hasUsedTrial) return false` fjernet
//       feller «har brukt prøveperioden»
//   • `if (input.isPremium) return false` fjernet
//       feller «premium»
//   • `days <= 0` → `days < 0`  (0 dager slipper gjennom)
//       feller «0 er ikke en lengde»

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTrialOffer, isTrialEligible, parseTrialDays } from './trial-offer'

// ── parseTrialDays ──────────────────────────────────────────────────────────

test('parseTrialDays: prod-verdien "14" (streng fra site_settings)', () => {
  assert.equal(parseTrialDays('14'), 14)
})

test('parseTrialDays: tall like godt som tallstreng', () => {
  assert.equal(parseTrialDays(14), 14)
})

test('parseTrialDays: 0 er ikke en lengde', () => {
  assert.equal(parseTrialDays('0'), null)
  assert.equal(parseTrialDays(0), null)
})

test('parseTrialDays: negativt og desimalt avvises', () => {
  assert.equal(parseTrialDays('-7'), null)
  assert.equal(parseTrialDays('14.5'), null)
})

test('parseTrialDays: manglende nøkkel, tom streng og søppel', () => {
  assert.equal(parseTrialDays(undefined), null)
  assert.equal(parseTrialDays(null), null)
  assert.equal(parseTrialDays(''), null)
  assert.equal(parseTrialDays('   '), null)
  assert.equal(parseTrialDays('fjorten'), null)
})

test('parseTrialDays: true og [] konverterer til 1 og 0 med naken Number() — begge avvises', () => {
  // Number(true) === 1, Number([]) === 0. Uten typesjekken ville en boolean i
  // site_settings blitt til «gratis i 1 dag».
  assert.equal(parseTrialDays(true), null)
  assert.equal(parseTrialDays([]), null)
  assert.equal(parseTrialDays({}), null)
})

// ── isTrialEligible ─────────────────────────────────────────────────────────

test('kvalifisert: ingen Premium, ingen brukt prøveperiode', () => {
  assert.equal(isTrialEligible({ isPremium: false, hasUsedTrial: false }), true)
})

test('har brukt prøveperioden → ikke kvalifisert (det varige merket)', () => {
  assert.equal(isTrialEligible({ isPremium: false, hasUsedTrial: true }), false)
})

test('premium → ikke kvalifisert', () => {
  assert.equal(isTrialEligible({ isPremium: true, hasUsedTrial: false }), false)
})

test('premium OG brukt prøveperiode → ikke kvalifisert', () => {
  assert.equal(isTrialEligible({ isPremium: true, hasUsedTrial: true }), false)
})

// ── decideTrialOffer — de fire tilstandene fra bestillingen ─────────────────

test('KVALIFISERT: viser tilbudet med dagtallet fra site_settings', () => {
  assert.deepEqual(
    decideTrialOffer({ trialDays: '14', eligible: true }),
    { show: true, days: 14 },
  )
})

test('IKKE KVALIFISERT: dagens tekst, ingen dagangivelse', () => {
  assert.deepEqual(
    decideTrialOffer({ trialDays: '14', eligible: false }),
    { show: false, days: null },
  )
})

test('UTLOGGET (eligible = null = ukjent): VISER tilbudet — serveren avgjør', () => {
  // Kjernen i kravet «aldri vis falsk visshet». En utlogget besøkende kan godt
  // være kvalifisert; skjuler vi tilbudet, får hen aldri vite at det finnes.
  // Trykker en ukvalifisert bruker likevel, svarer founders-activate 409 med en
  // rolig forklaring — det er den forventede utgangen, ikke en feil.
  assert.deepEqual(
    decideTrialOffer({ trialDays: '14', eligible: null }),
    { show: true, days: 14 },
  )
})

test('PREMIUM: ruten svarer eligible=false → dagens tekst', () => {
  const eligible = isTrialEligible({ isPremium: true, hasUsedTrial: false })
  assert.deepEqual(
    decideTrialOffer({ trialDays: '14', eligible }),
    { show: false, days: null },
  )
})

// ── decideTrialOffer — dagtallet ────────────────────────────────────────────

test('manglende dagtall skjuler tilbudet selv for en kvalifisert bruker', () => {
  // Nøkkelen founders_new_trial_days mangler i site_settings. Da svarer
  // founders-activate 503 og oppretter INGEN prøveperiode — en knapp som lovet
  // «gratis i 14 dager» ville sendt brukeren rett i en feilmelding.
  assert.deepEqual(
    decideTrialOffer({ trialDays: null, eligible: true }),
    { show: false, days: null },
  )
})

test('manglende dagtall skjuler også når eligibility er ukjent', () => {
  assert.deepEqual(
    decideTrialOffer({ trialDays: undefined, eligible: null }),
    { show: false, days: null },
  )
})

test('ugyldig dagtall behandles som manglende, ikke som 14', () => {
  assert.deepEqual(decideTrialOffer({ trialDays: '0', eligible: true }), { show: false, days: null })
  assert.deepEqual(decideTrialOffer({ trialDays: 'fjorten', eligible: true }), { show: false, days: null })
})

test('endret innstilling slår gjennom i teksten — tallet er ikke hardkodet', () => {
  // Setter Dennis nøkkelen til 7, skal flatene si 7. En hardkodet 14 ville
  // overlevd endringen og løyet.
  assert.deepEqual(decideTrialOffer({ trialDays: '7', eligible: true }), { show: true, days: 7 })
  assert.deepEqual(decideTrialOffer({ trialDays: 30, eligible: null }), { show: true, days: 30 })
})

test('days finnes aldri uten show — typen og verdien er enige', () => {
  for (const trialDays of ['14', '0', null, undefined, 'x', 7]) {
    for (const eligible of [true, false, null]) {
      const offer = decideTrialOffer({ trialDays, eligible })
      if (offer.show) assert.equal(typeof offer.days, 'number')
      else assert.equal(offer.days, null)
    }
  }
})
