// Kjøres med:  npm test
//
// Ren beslutningslogikk for karensperioden ved ufrivillig B2C-betalingsfeil.
// Ingen Stripe, ingen database. Koblingen til premium-dekningen — at karensen
// faktisk gir Premium, og at kode/org fortsatt overstyrer — ligger i
// premium-state.test.ts.
//
// MUTASJONSBEVIS: se listen nederst i filen. Alle kjørt 17. august 2026.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidePersonalGrace,
  isPersonalGraceActive,
  PERSONAL_GRACE_DAYS,
  PERSONAL_DUNNING_STATUSES,
} from './personal-grace'

const NOW = new Date('2026-08-17T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString()
}

// ── Lengden er ikke en avrunding ───────────────────────────────────────────

test('karensperioden er 14 dager — like lang som Stripes dunning-vindu', () => {
  // Hele poenget: karensen må ikke utløpe mens Stripe fortsatt purrer. Sju
  // dager (org-verdien) ville stengt brukeren ute på dag 7 og deretter sendt
  // henne e-post på dag 9 om at betalingen forsøkes igjen.
  assert.equal(PERSONAL_GRACE_DAYS, 14)
})

// ── Ufrivillig betalingsfeil → karens ──────────────────────────────────────

test('past_due gir karensperiode på 14 dager', () => {
  const d = decidePersonalGrace({
    stripeStatus: 'past_due',
    existingGraceUntil: null,
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'payment_failed')
  // BEVISST hardkodet 14 og ikke daysFromNow(PERSONAL_GRACE_DAYS): en
  // assert som leser konstanten flytter seg sammen med den, og ville bestått
  // like fint om noen satte lengden til 7. Målt: uten denne linja feller en
  // 14 → 7-mutasjon kun én test i hele fila.
  assert.equal(d.grace && d.until, daysFromNow(14))
})

test('unpaid gir karensperiode på samme grunnlag som past_due', () => {
  const d = decidePersonalGrace({
    stripeStatus: 'unpaid',
    existingGraceUntil: null,
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.reason, 'payment_failed')
  assert.equal(d.grace && d.until, daysFromNow(PERSONAL_GRACE_DAYS))
})

// ── Frivillig oppsigelse → INGEN karens (krav 1) ───────────────────────────

test('canceled gir INGEN karens — brukeren har tatt en beslutning', () => {
  const d = decidePersonalGrace({
    stripeStatus: 'canceled',
    existingGraceUntil: null,
    now: NOW,
  })
  assert.equal(d.grace, false)
  assert.equal(d.reason, 'not_dunning')
})

test('incomplete_expired gir INGEN karens', () => {
  const d = decidePersonalGrace({
    stripeStatus: 'incomplete_expired',
    existingGraceUntil: null,
    now: NOW,
  })
  assert.equal(d.grace, false)
})

test('en frisk status gir ingen karens — active og trialing er ikke dunning', () => {
  for (const status of ['active', 'trialing', 'paused', 'incomplete']) {
    const d = decidePersonalGrace({ stripeStatus: status, existingGraceUntil: null, now: NOW })
    assert.equal(d.grace, false, `${status} skal ikke gi karens`)
    assert.equal(d.reason, 'not_dunning', `${status} skal klassifiseres som not_dunning`)
  }
})

test('manglende status gir ingen karens', () => {
  assert.equal(decidePersonalGrace({ stripeStatus: null, existingGraceUntil: null, now: NOW }).grace, false)
  assert.equal(decidePersonalGrace({ stripeStatus: undefined, existingGraceUntil: null, now: NOW }).grace, false)
})

test('dunning-statusene er nøyaktig past_due og unpaid', () => {
  // Låser settet: legges 'canceled' inn her, ryker krav 1 stille.
  assert.deepEqual([...PERSONAL_DUNNING_STATUSES], ['past_due', 'unpaid'])
})

// ── Purring nr. 2 skal ikke forlenge karensen ──────────────────────────────

test('en løpende karens forlenges IKKE av neste purring', () => {
  // Stripe purrer 3-4 ganger og går past_due → unpaid underveis. Uten denne
  // vakten skjøv hver purring sluttdatoen 14 nye dager fram, og karensen ville
  // aldri tatt slutt så lenge Stripe fortsatte å prøve.
  const running = daysFromNow(9)
  const d = decidePersonalGrace({
    stripeStatus: 'unpaid',
    existingGraceUntil: running,
    now: NOW,
  })
  assert.equal(d.grace, false)
  assert.equal(d.reason, 'already_running')
})

test('en UTLØPT karens blokkerer ikke en ny — neste måneds faktura er en ny sak', () => {
  // Betalte brukeren i mellomtiden og feiler igjen en måned senere, skal hun ha
  // en ny full karensperiode, ikke null.
  const d = decidePersonalGrace({
    stripeStatus: 'past_due',
    existingGraceUntil: daysFromNow(-3),
    now: NOW,
  })
  assert.equal(d.grace, true)
  assert.equal(d.grace && d.until, daysFromNow(14))
})

test('søppel i grace-kolonnen blokkerer ikke en ny karens', () => {
  const d = decidePersonalGrace({
    stripeStatus: 'past_due',
    existingGraceUntil: 'ikke-en-dato',
    now: NOW,
  })
  assert.equal(d.grace, true)
})

// ── isPersonalGraceActive ──────────────────────────────────────────────────

test('karensen er aktiv fram til sluttidspunktet, ikke etter', () => {
  assert.equal(isPersonalGraceActive(daysFromNow(1), NOW), true)
  assert.equal(isPersonalGraceActive(daysFromNow(-1), NOW), false)
  // Nøyaktig grensen: utløpt er utløpt.
  assert.equal(isPersonalGraceActive(NOW.toISOString(), NOW), false)
})

test('null, tom og ugyldig dato er ALDRI aktiv karens', () => {
  assert.equal(isPersonalGraceActive(null, NOW), false)
  assert.equal(isPersonalGraceActive(undefined, NOW), false)
  assert.equal(isPersonalGraceActive('', NOW), false)
  assert.equal(isPersonalGraceActive('tull', NOW), false)
})

// ── MUTASJONSBEVIS (kjørt mot kilden 17. august 2026, tall er målt) ────────
//
//  1. PERSONAL_GRACE_DAYS 14 → 7:  3 tester feiler.
//     FØRSTE forsøk felte bare ÉN, fordi de to `until`-assertene leste
//     konstanten selv (`daysFromNow(PERSONAL_GRACE_DAYS)`) og flyttet seg
//     med mutasjonen. De er nå hardkodet til 14. En test som henter fasiten
//     fra koden den tester, beviser ingenting om verdien.
//  2. `already_running`-vakten nøytralisert (`if (false)`):  1 test feiler
//     («en løpende karens forlenges IKKE av neste purring»).
//  3. PERSONAL_DUNNING_STATUSES utvidet med 'canceled' — altså karens ved
//     frivillig oppsigelse, brudd på krav 1:  2 tester feiler.
//  4. `ts > now` → `ts >= now` i isPersonalGraceActive:  1 test feiler
//     («karensen er aktiv fram til sluttidspunktet, ikke etter»).
//
// IKKE MUTERBART, og derfor fjernet fra kilden: en `Number.isNaN`-vakt i
// isPersonalGraceActive. Den ble målt til å felle 0 tester — `NaN > n` er
// allerede false, så vakten kunne ikke endre noe utfall. Testen «null, tom og
// ugyldig dato er ALDRI aktiv karens» står igjen og dekker oppførselen; det var
// linja som var overflødig, ikke kravet.
//
// KOBLINGEN til webhooken (at stempelet faktisk skrives, at past_due slutter å
// bli behandlet som kansellering, og at karensen ryddes igjen) er felt i
// lib/stripe-webhook-route.test.ts — ren logikk som er riktig, men aldri kalt,
// er nøyaktig den feilen mutasjonsbevis er til for å avdekke.
