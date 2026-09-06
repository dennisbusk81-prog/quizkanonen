// Kjøres med:  npm test
//
// Beslutningstabellen for «Abonnement» — delt av kontomenyen (lib/nav-model.ts)
// og profilsidens abonnementskort (app/profil/page.tsx).
//
// MUTASJONSBEVIS:
//   • `if (!isPremium && hasUsedTrial)` mister hasUsedTrial-leddet → «avvist
//     kort går til portalen» ryker (den brukeren må kunne oppdatere kortet).
//   • Grenen for utløpt trial fjernes → «utløpt kortløs trial går IKKE til
//     portalen» ryker — det er nøyaktig blindveien fila finnes for.
//   • free-premium sendes til /premium → «Premium uten Stripe peker på
//     profilkortet» ryker.
//   • Profilsiden slutter å kalle decideSubscriptionEntry → wiring-testen
//     nederst ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideSubscriptionEntry, subscriptionMenuHref } from './subscription-entry'

test('gratis uten Stripe-kunde: ingenting å administrere → /premium', () => {
  const e = decideSubscriptionEntry({ isPremium: false, hasStripeCustomer: false, hasUsedTrial: false })
  assert.equal(e, 'none')
  assert.equal(subscriptionMenuHref(e), '/premium')
  // has_used_trial uten Stripe-kunde finnes ikke i praksis (founders-activate
  // lager kunden), men skal ikke endre svaret om det skulle skje.
  assert.equal(decideSubscriptionEntry({ isPremium: false, hasStripeCustomer: false, hasUsedTrial: true }), 'none')
})

test('Premium uten Stripe (kode/org) peker på profilkortet, ikke på salgsflaten', () => {
  const e = decideSubscriptionEntry({ isPremium: true, hasStripeCustomer: false, hasUsedTrial: false })
  assert.equal(e, 'free-premium')
  assert.equal(subscriptionMenuHref(e), '/profil#abonnement')
})

test('utløpt kortløs trial går IKKE til portalen', () => {
  // Stripe-kunde finnes (founders-activate laget den), Premium er av, og
  // prøveperioden er brukt. Portalen har ingen abonnement og ingen
  // betalingshistorikk å vise — en blindvei. Veien videre er /premium.
  const e = decideSubscriptionEntry({ isPremium: false, hasStripeCustomer: true, hasUsedTrial: true })
  assert.equal(e, 'trial-expired')
  assert.equal(subscriptionMenuHref(e), '/premium')
})

test('avvist kort går til portalen — der oppdateres kortet', () => {
  // Stripe-kunde, Premium slått av av webhooken, trial IKKE brukt: dette er
  // B2C-kunden med avvist kort som betalingsfeil-e-posten sender hit.
  const e = decideSubscriptionEntry({ isPremium: false, hasStripeCustomer: true, hasUsedTrial: false })
  assert.equal(e, 'portal')
  assert.equal(subscriptionMenuHref(e), null)
})

test('betalende og trialing Premium går til portalen, uansett has_used_trial', () => {
  for (const hasUsedTrial of [false, true]) {
    const e = decideSubscriptionEntry({ isPremium: true, hasStripeCustomer: true, hasUsedTrial })
    assert.equal(e, 'portal', `hasUsedTrial=${hasUsedTrial}`)
  }
})

test('alle åtte kombinasjonene gir en av de fire tilstandene', () => {
  const sett = new Set<string>()
  for (const isPremium of [false, true])
    for (const hasStripeCustomer of [false, true])
      for (const hasUsedTrial of [false, true])
        sett.add(decideSubscriptionEntry({ isPremium, hasStripeCustomer, hasUsedTrial }))
  assert.deepEqual([...sett].sort(), ['free-premium', 'none', 'portal', 'trial-expired'])
})

// ── Wiring: profilsiden leser beslutningen, ikke sin egen kopi ──────────────

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

test('profilsiden bruker decideSubscriptionEntry for abonnementskortet', () => {
  const src = aktivKode('app/profil/page.tsx')
  assert.match(src, /const abonnement = decideSubscriptionEntry\(\{ isPremium, hasStripeCustomer, hasUsedTrial \}\)/,
    'profilsiden regner ikke lenger abonnementstilstanden via decideSubscriptionEntry')
  // Kortet vises for alle tilstander unntatt 'none', og har ankeret
  // kontomenyens «Abonnement» peker på for Premium uten Stripe.
  assert.match(src, /\{abonnement !== 'none' && \(\s*<div id="abonnement"/,
    'abonnementskortet er ikke lenger gatet på abonnement !== \'none\' med id="abonnement"')
  assert.match(src, /\{abonnement === 'trial-expired' \? \(/, 'grenen for utløpt kortløs trial er borte fra profilsiden')
  assert.match(src, /\) : abonnement === 'portal' \? \(/, 'portal-grenen leser ikke beslutningen')
  // Den gamle kopien av gaten skal ikke finnes lenger — to kopier drifter.
  assert.doesNotMatch(src, /\(isPremium \|\| hasStripeCustomer\) &&/, 'den gamle inline-gaten er tilbake på profilsiden')
  assert.doesNotMatch(src, /!isPremium && hasUsedTrial \?/, 'den gamle inline-grenen for utløpt trial er tilbake på profilsiden')
})
