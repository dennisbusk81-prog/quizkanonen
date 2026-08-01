// Kjøres med:  npm test
//
// Ren logikk for det totale døgntaket per avsender (lib/duel-quota.ts).
// Rutenivået — at tellingen faktisk leses og bokføres — dekkes av
// lib/duel-quota-route.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DUEL_SENDER_MAX_PER_DAY,
  DUEL_SENDER_WINDOW_MS,
  DUEL_SENT_ACTION,
  decideDuelSenderQuota,
} from '@/lib/duel-quota'

test('under grensen slipper gjennom, og forteller hvor mye som er igjen', () => {
  assert.deepEqual(decideDuelSenderQuota({ sentLastDay: 0 }), {
    allowed: true,
    remaining: DUEL_SENDER_MAX_PER_DAY,
  })
  assert.deepEqual(decideDuelSenderQuota({ sentLastDay: DUEL_SENDER_MAX_PER_DAY - 1 }), {
    allowed: true,
    remaining: 1,
  })
})

test('grensen er inklusiv — nøyaktig DUEL_SENDER_MAX_PER_DAY sendte stopper neste', () => {
  const decision = decideDuelSenderQuota({ sentLastDay: DUEL_SENDER_MAX_PER_DAY })
  assert.equal(decision.allowed, false)
})

test('avvisningen sier hva brukeren skal gjøre (vente), ikke bare at det gikk galt', () => {
  const decision = decideDuelSenderQuota({ sentLastDay: DUEL_SENDER_MAX_PER_DAY + 50 })
  assert.equal(decision.allowed, false)
  assert.match(decision.allowed ? '' : decision.message, /siste døgnet/)
  assert.match(decision.allowed ? '' : decision.message, /[Vv]ent/)
})

test('grensen er lav nok til å ha en effekt, og høy nok til normal bruk', () => {
  // Vokteren mot at noen «bare setter den litt høyere» uten å tenke: ruten
  // tillater kun ÉN åpen duell av gangen, så selv 10 forutsetter ni
  // kanselleringer. Kombinert med taket på 3 per mottaker (duel-cooldown) er
  // maks antall forskjellige personer én konto kan nå i døgnet:
  assert.ok(DUEL_SENDER_MAX_PER_DAY >= 5, 'for lavt — ville rammet en ivrig, ekte spiller')
  assert.ok(DUEL_SENDER_MAX_PER_DAY <= 15, 'for høyt — poenget er å avgrense en spam-løkke')
})

test('vinduet er et rullerende døgn', () => {
  assert.equal(DUEL_SENDER_WINDOW_MS, 24 * 60 * 60 * 1000)
})

test('action_type er distinkt, så tellingen ikke blander seg med annen bokføring', () => {
  // admin_actions deles med org-invitasjoner og kode-bom. Kolliderende
  // action_type ville fått de tellingene til å lekke inn i hverandre.
  assert.equal(DUEL_SENT_ACTION, 'duel_challenge_sent')
})
