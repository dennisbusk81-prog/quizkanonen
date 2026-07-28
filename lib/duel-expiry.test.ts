// Kjøres med:  npm test
//
// FUNN 2.2 (høy) — dødlås: en ubesvart utfordring sendt dag 1–17 i måneden ble
// borte fra UI-et etter 14 dager, men fortsatte å blokkere nye dueller for
// begge parter resten av måneden.
//
// MUTASJONSBEVIS: byttes blocksNewDuel tilbake til den gamle regelen
// («status er pending/active OG created_at >= månedsstart»), feiler
// «utløpt pending blokkerer ikke lenger» — som er selve dødlåsen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isDuelExpired,
  blocksNewDuel,
  monthStartUtc,
  PENDING_REPLY_WINDOW_MS,
} from './duel-expiry'

test('DØDLÅS: pending eldre enn 14 dager blokkerer ikke, selv samme måned', () => {
  // Utfordring sendt 3. juli, aldri besvart. «Nå» er 20. juli — altså 17 dager
  // senere og fortsatt samme kalendermåned. Dette er nøyaktig tilfellet som
  // låste begge parter ute resten av måneden.
  const created = '2026-07-03T09:00:00.000Z'
  const now = new Date('2026-07-20T09:00:00.000Z')
  const row = { status: 'pending', created_at: created }

  assert.equal(isDuelExpired('pending', created, now), true, 'skal regnes som utløpt')
  assert.equal(blocksNewDuel(row, now), false, 'skal IKKE blokkere en ny duell')

  // Kontroll: den gamle regelen ville blokkert her.
  const gammelRegel = ['pending', 'active'].includes(row.status)
    && new Date(created) >= monthStartUtc(now)
  assert.equal(gammelRegel, true, 'den gamle regelen blokkerte — det var dødlåsen')
})

test('fersk pending blokkerer fortsatt', () => {
  const created = '2026-07-18T09:00:00.000Z'
  const now = new Date('2026-07-20T09:00:00.000Z')
  assert.equal(blocksNewDuel({ status: 'pending', created_at: created }, now), true)
})

test('grensen går nøyaktig ved 14 døgn', () => {
  const created = new Date('2026-07-01T00:00:00.000Z')
  const akkuratInnenfor = new Date(created.getTime() + PENDING_REPLY_WINDOW_MS)
  const rettEtter = new Date(created.getTime() + PENDING_REPLY_WINDOW_MS + 1)

  assert.equal(isDuelExpired('pending', created.toISOString(), akkuratInnenfor), false)
  assert.equal(isDuelExpired('pending', created.toISOString(), rettEtter), true)
})

test('active bruker kalendermåned, ikke 14 dager', () => {
  // En duell akseptert 2. juli er fortsatt i gang 20. juli (18 dager), fordi
  // poengene telles ut måneden. Et flatt 14-dagersvindu ville skjult den mens
  // poengsummen fortsatt tikket.
  const created = '2026-07-02T09:00:00.000Z'
  assert.equal(isDuelExpired('active', created, new Date('2026-07-20T09:00:00.000Z')), false)
  assert.equal(blocksNewDuel({ status: 'active', created_at: created }, new Date('2026-07-20T09:00:00.000Z')), true)

  // 1. august er den over.
  assert.equal(isDuelExpired('active', created, new Date('2026-08-01T00:00:00.000Z')), true)
  assert.equal(blocksNewDuel({ status: 'active', created_at: created }, new Date('2026-08-01T00:00:00.000Z')), false)
})

test('avslåtte og kansellerte blokkerer aldri', () => {
  const now = new Date('2026-07-20T09:00:00.000Z')
  const created = '2026-07-19T09:00:00.000Z'
  assert.equal(blocksNewDuel({ status: 'declined', created_at: created }, now), false)
  assert.equal(blocksNewDuel({ status: 'cancelled', created_at: created }, now), false)
})

test('materialisert expired-status blokkerer aldri, uansett alder', () => {
  // Jobben /api/cron/expire-duels kan ha merket raden. Da skal svaret være
  // det samme som tidsregelen uansett ville gitt.
  const now = new Date('2026-07-05T09:00:00.000Z')
  const ferskt = '2026-07-04T09:00:00.000Z'
  assert.equal(isDuelExpired('expired', ferskt, now), true)
  assert.equal(blocksNewDuel({ status: 'expired', created_at: ferskt }, now), false)
})

test('pending fra forrige måned blokkerer ikke (var allerede riktig)', () => {
  const created = '2026-06-10T09:00:00.000Z'
  const now = new Date('2026-07-05T09:00:00.000Z')
  assert.equal(blocksNewDuel({ status: 'pending', created_at: created }, now), false)
})

test('pending sendt rett før månedsskiftet blokkerer fortsatt i ny måned', () => {
  // Bevisst endring av semantikk: den gamle regelen slapp denne fri 1. august
  // selv om mottakeren hadde 12 dager igjen å svare, mens UI-et samtidig viste
  // utfordringen som levende. Nå er POST og UI enige.
  const created = '2026-07-30T09:00:00.000Z'
  const now = new Date('2026-08-01T09:00:00.000Z')
  assert.equal(isDuelExpired('pending', created, now), false)
  assert.equal(blocksNewDuel({ status: 'pending', created_at: created }, now), true)
})

test('monthStartUtc treffer første dag i måneden i UTC', () => {
  assert.equal(monthStartUtc(new Date('2026-07-20T23:30:00.000Z')).toISOString(), '2026-07-01T00:00:00.000Z')
  assert.equal(monthStartUtc(new Date('2026-01-01T00:00:00.000Z')).toISOString(), '2026-01-01T00:00:00.000Z')
})
