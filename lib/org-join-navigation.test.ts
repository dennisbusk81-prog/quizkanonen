import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideOrgJoinNavigation } from './org-join-navigation'

// ── MUTASJONER SOM SKAL GI RØDT ─────────────────────────────────────────────
//   1. "kind: 'hard-navigate'" → "kind: 'soft-navigate'" (eller noe annet):
//      hele fiksen er at navigasjonen er HARD — en myk push beholder
//      ProfileProviders myOrgs fra før innmeldingen.
//   2. "`/org/${slug}`" → "`/org/`" eller "`/${slug}`": feil destinasjon.
//   3. Fjern typeof-vakten: /org/undefined ved manglende slug.

test('gyldig slug: HARD navigasjon til bedriftssiden', () => {
  assert.deepEqual(decideOrgJoinNavigation('elkjop-nordic'), {
    kind: 'hard-navigate',
    url: '/org/elkjop-nordic',
  })
})

test('INVARIANTEN: en vellykket innmelding gir aldri en myk navigasjon', () => {
  // Dette er selve buggen som ble rettet: router.push etter innmelding lot
  // ProfileProvider stå montert med org-listen fra FØR innmeldingen, og
  // /org/[slug] viste «Ingen tilgang» til et ferskt medlem. Enhver annen
  // kind enn 'hard-navigate' på suksesstien er en regresjon.
  const nav = decideOrgJoinNavigation('en-hvilken-som-helst-org')
  assert.equal(nav.kind, 'hard-navigate')
})

test('manglende eller ubrukelig slug: feilmelding, ikke /org/undefined', () => {
  for (const bad of [undefined, null, '', 42, {}, ['slug'], true]) {
    assert.deepEqual(
      decideOrgJoinNavigation(bad),
      { kind: 'invalid-response' },
      `slug=${JSON.stringify(bad)}`
    )
  }
})
