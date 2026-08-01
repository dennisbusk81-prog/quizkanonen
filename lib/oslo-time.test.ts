// Kjøres med:  npm test
//
// Vokter tidssone-tolkningen av org-quiz-tidene (`organizations.org_quiz_*_at`).
// Feilen disse testene finnes for var STILLE: en admin satte "15:00", ingenting
// klaget, og quizen stengte reelt kl. 17:00 norsk tid — med en «en time igjen»-
// e-post som også viste feil klokkeslett. Den var inert i prod fordi ingen org
// hadde satt feltet ennå, så det finnes ingen levende data å verifisere mot;
// testene under er beviset i stedet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { osloWallClockToUtcIso, osloDateString } from '@/lib/oslo-time'
import { orgCloseReminderEmail } from '@/lib/email-templates'

test('sommertid (CEST, UTC+2): "15:00" lagret → 13:00Z', () => {
  assert.equal(
    osloWallClockToUtcIso('2026-08-07', '15:00'),
    '2026-08-07T13:00:00.000Z'
  )
})

test('vintertid (CET, UTC+1): samme "15:00" → 14:00Z', () => {
  assert.equal(
    osloWallClockToUtcIso('2026-12-04', '15:00'),
    '2026-12-04T14:00:00.000Z'
  )
})

test('godtar både "HH:MM" og "HH:MM:SS" (TIME-kolonnen gir det siste)', () => {
  assert.equal(
    osloWallClockToUtcIso('2026-08-07', '15:00:00'),
    osloWallClockToUtcIso('2026-08-07', '15:00')
  )
})

test('DST-overgangene treffer riktig side', () => {
  // Sommertid starter søndag 29. mars 2026 kl. 02:00 → 03:00.
  // 01:00 er fortsatt CET (+1), 04:00 er CEST (+2).
  assert.equal(osloWallClockToUtcIso('2026-03-29', '01:00'), '2026-03-29T00:00:00.000Z')
  assert.equal(osloWallClockToUtcIso('2026-03-29', '04:00'), '2026-03-29T02:00:00.000Z')
  // Sommertid slutter søndag 25. oktober 2026 kl. 03:00 → 02:00.
  assert.equal(osloWallClockToUtcIso('2026-10-25', '05:00'), '2026-10-25T04:00:00.000Z')
})

test('ugyldig input gir null, ikke en Invalid Date', () => {
  // `new Date(NaN).toISOString()` KASTER RangeError. Kallerne hopper over
  // raden på null; en kastet feil ville tatt ned hele cron-kjøringen.
  assert.equal(osloWallClockToUtcIso('2026-08-07', ''), null)
  assert.equal(osloWallClockToUtcIso('2026-08-07', '25:00'), null)
  assert.equal(osloWallClockToUtcIso('2026-08-07', 'tullball'), null)
  assert.equal(osloWallClockToUtcIso('ikke-en-dato', '15:00'), null)
})

test('osloDateString bruker norsk kalenderdøgn, ikke UTC-døgnet', () => {
  // Fredagsquizen stenger 20:00Z = 22:00 norsk tid — samme dato.
  assert.equal(osloDateString('2026-08-07T20:00:00+00:00'), '2026-08-07')
  // 23:30Z er derimot 01:30 NESTE dag i Norge.
  assert.equal(osloDateString('2026-08-07T23:30:00Z'), '2026-08-08')
  assert.equal(osloDateString('tull'), null)
})

test('e-posten viser klokkeslettet admin faktisk skrev inn', () => {
  // Hele kjeden: "15:00" i org-admin → UTC-instant → e-postmal.
  // Malen formaterer selv i Europe/Oslo, så den eneste måten den kan vise feil
  // tid på er at instantet er bygget feil — nettopp buggen dette retter.
  const closesAt = osloWallClockToUtcIso('2026-08-07', '15:00')!
  const html = orgCloseReminderEmail('Elkjøp Nordic', closesAt, 'Fredagsquiz 07.08.2026')
  assert.match(html, /15:00/, 'e-posten skal si 15:00, ikke 17:00')
  assert.doesNotMatch(html, /17:00/)

  // Samme klokkeslett om vinteren skal fortsatt vise 15:00.
  const vinter = osloWallClockToUtcIso('2026-12-04', '15:00')!
  assert.match(orgCloseReminderEmail('Elkjøp Nordic', vinter), /15:00/)
})

test('den gamle sammenlimingen var faktisk feil (regresjonsvakt)', () => {
  // Dokumenterer avviket eksplisitt, så ingen «forenkler» tilbake til
  // `${dato}T${tid}.000Z`.
  const gammel = new Date('2026-08-07T15:00:00.000Z').getTime()
  const ny = new Date(osloWallClockToUtcIso('2026-08-07', '15:00')!).getTime()
  assert.equal((gammel - ny) / 3_600_000, 2, 'gammel tolkning lå 2 timer feil om sommeren')
})
