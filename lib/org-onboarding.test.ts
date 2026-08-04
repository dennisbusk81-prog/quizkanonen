// Kjøres med:  npm test
//
// Dekker betingelsen bak redirecten fra bedriftspanelet til velkomstsiden.
//
// DEN VIKTIGSTE TESTEN ER AT DEN SLUTTER Å FYRE. En redirect som ikke slår seg
// av, er en løkke: admin havner på velkomstsiden, lagrer, kommer tilbake til
// panelet, og sendes ut igjen. Derfor står «fyrer ikke når stempelet er satt»
// først, og derfor er mutasjonsbeviset knyttet nettopp til den.
//
// MUTASJONSBEVIS (kjørt 4. august 2026): endres siste linje i
// shouldRedirectToWelcome fra
//     return !org.onboarding_completed_at
// til
//     return true
// faller nøyaktig de to «slutter å fyre»-testene under (2 av 9). De tre
// låse-testene overlever mutasjonen, fordi låsesjekken returnerer før den
// linja — de dekker en annen gren, og verner den ikke.
//
// Den grenen er mutasjonstestet for seg: fjernes `if (isOrgLocked(org))
// return false`, faller «låst org sendes IKKE til oppsett» og camelCase-testen.
// («låst org med stempel» overlever begge mutasjonene — stempelet alene holder
// den nede. Den er dokumentasjon, ikke vern.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldRedirectToWelcome } from './org-onboarding'

const STAMP = '2026-08-04T18:30:00.000Z'

// ── Slutter å fyre ───────────────────────────────────────────────────────────

test('fyrer IKKE når onboarding_completed_at er satt', () => {
  assert.equal(
    shouldRedirectToWelcome({ subscription_status: 'active', onboarding_completed_at: STAMP }),
    false,
  )
})

test('fyrer IKKE for en trial-org som har fullført oppsettet', () => {
  assert.equal(
    shouldRedirectToWelcome({ subscription_status: 'trialing', onboarding_completed_at: STAMP }),
    false,
  )
})

// ── Fyrer når oppsettet mangler ──────────────────────────────────────────────

test('fyrer når onboarding_completed_at er null', () => {
  assert.equal(
    shouldRedirectToWelcome({ subscription_status: 'active', onboarding_completed_at: null }),
    true,
  )
})

test('fyrer når feltet mangler helt i responsen', () => {
  // En klient som kjører mot en eldre respons (uten feltet) skal be om oppsett,
  // ikke hoppe over det stille.
  assert.equal(shouldRedirectToWelcome({ subscription_status: 'active' }), true)
})

test('fyrer for en fersk trial-org — det er hovedtilfellet', () => {
  assert.equal(
    shouldRedirectToWelcome({ subscription_status: 'trialing', onboarding_completed_at: null }),
    true,
  )
})

// ── Låsen vinner over oppsettet ──────────────────────────────────────────────

test('låst org sendes IKKE til oppsett, selv uten stempel', () => {
  // Settings-ruten avviser en låst org med 403 (requireUnlockedOrg), så et
  // oppsett den ikke får lagre ville vært en blindvei.
  assert.equal(
    shouldRedirectToWelcome({ subscription_status: 'locked', onboarding_completed_at: null }),
    false,
  )
})

test('låst org med stempel sendes heller ikke', () => {
  assert.equal(
    shouldRedirectToWelcome({ subscription_status: 'locked', onboarding_completed_at: STAMP }),
    false,
  )
})

test('låsen gjenkjennes også i camelCase (my-orgs-formen)', () => {
  assert.equal(
    shouldRedirectToWelcome({ subscriptionStatus: 'locked', onboarding_completed_at: null }),
    false,
  )
})

// ── Ingen data ───────────────────────────────────────────────────────────────

test('null org gir ingen redirect — vi vet ikke noe ennå', () => {
  assert.equal(shouldRedirectToWelcome(null), false)
  assert.equal(shouldRedirectToWelcome(undefined), false)
})
