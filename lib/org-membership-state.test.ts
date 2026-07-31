// Kjøres med:  npm test
//
// Ren tilstandsutledning for /org/[slug]. Ingen React, ingen nettverk.
//
// Poenget med testene er ÉN invariant: «ikke medlem» skal kreve et bekreftet
// svar fra my-orgs. Hver måte den kunne bli vist på uten et slikt svar — mens
// hentingen pågår, ved 401/500, ved timeout — har sin egen test.
//
// MUTASJONSBEVIS (verifisert manuelt ved å endre lib/org-membership-state.ts):
//   * Byttes `myOrgsLoaded`-sjekken ut med «ikke lenger loading» (den gamle
//     oppførselen), feiler «henting pågår» og «timeout» — begge gir da
//     'notfound' i stedet for 'loading'. Det var nøyaktig produksjonsbuggen.
//   * Fjernes myOrgsError-grenen, feiler begge feiltestene: de faller til
//     'notfound' og påstår «ikke medlem» der sannheten er «vet ikke».
//   * Flyttes hasOrg-sjekken UNDER myOrgsError, feiler «bekreftet org
//     overlever en senere feil» — en synlig bedrift ville forsvunnet bak en
//     feilskjerm ved en mislykket re-henting.
//   * Fjernes session-vakten, feiler begge de to første testene.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveOrgLoadState, type OrgMembershipInput } from './org-membership-state'

// Utgangspunkt: innlogget bruker, ingenting hentet ennå.
function input(over: Partial<OrgMembershipInput> = {}): OrgMembershipInput {
  return {
    session: 'authenticated',
    hasOrg: false,
    myOrgsLoaded: false,
    myOrgsError: false,
    ...over,
  }
}

test('sesjonen er ikke avklart ennå → laster (aldri «ikke medlem»)', () => {
  assert.equal(deriveOrgLoadState(input({ session: 'unchecked' })), 'loading')
  // Selv med et bekreftet tomt svar: uten avklart sesjon vet vi ikke hvem det gjelder.
  assert.equal(
    deriveOrgLoadState(input({ session: 'unchecked', myOrgsLoaded: true })),
    'loading'
  )
})

test('utlogget → laster (siden redirigerer selv til /login)', () => {
  assert.equal(deriveOrgLoadState(input({ session: 'anonymous', myOrgsLoaded: true })), 'loading')
})

test('PRODUKSJONSBUGGEN: my-orgs-hentingen pågår fortsatt → laster, ikke «ikke medlem»', () => {
  assert.equal(deriveOrgLoadState(input()), 'loading')
})

test('dedupe/timeout satte loading=false med tom liste → fortsatt laster', () => {
  // Disse grenene i ProfileProvider rører ikke myOrgsLoaded i det hele tatt.
  // Utledningen her ser derfor nøyaktig samme input som «henting pågår».
  assert.equal(deriveOrgLoadState(input({ myOrgsLoaded: false })), 'loading')
})

test('bekreftet henting uten treff → ikke medlem', () => {
  assert.equal(deriveOrgLoadState(input({ myOrgsLoaded: true })), 'notfound')
})

test('bekreftet treff → klar', () => {
  assert.equal(deriveOrgLoadState(input({ hasOrg: true, myOrgsLoaded: true })), 'ready')
})

test('my-orgs feilet (401/500/nettverk) → feilskjerm, ALDRI «ikke medlem»', () => {
  assert.equal(deriveOrgLoadState(input({ myOrgsError: true })), 'error')
})

test('feil som kommer etter et tidligere bekreftet tomt svar → feil vinner over «ikke medlem»', () => {
  // Et nytt forsøk som feilet gjør ikke det gamle svaret mer sant.
  assert.equal(
    deriveOrgLoadState(input({ myOrgsLoaded: true, myOrgsError: true })),
    'error'
  )
})

test('bekreftet org overlever en senere transient feil', () => {
  // Brukeren ser bedriften sin. En mislykket re-henting skal ikke kaste dem ut.
  assert.equal(
    deriveOrgLoadState(input({ hasOrg: true, myOrgsLoaded: true, myOrgsError: true })),
    'ready'
  )
})

test('ingen input-kombinasjon for en innlogget bruker gir «ikke medlem» uten bekreftet henting', () => {
  for (const hasOrg of [false, true]) {
    for (const myOrgsError of [false, true]) {
      const state = deriveOrgLoadState(input({ hasOrg, myOrgsError, myOrgsLoaded: false }))
      assert.notEqual(state, 'notfound', `hasOrg=${hasOrg} myOrgsError=${myOrgsError}`)
    }
  }
})
