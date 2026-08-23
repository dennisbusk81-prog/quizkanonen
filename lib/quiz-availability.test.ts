// Kjøres med:  npm test
//
// Gaten som avgjør om spilleren i det hele tatt får se «Start quiz». Feiler
// den ÉN vei, vises en knapp som svarer 403 fra start-attempt; feiler den den
// ANDRE veien, nektes en spiller som ble avbrutt av stengetid å levere det hun
// allerede har svart (B-10-vinduet, `cc9b14a`). Begge er stille i UI-et — det
// er derfor regelen er skilt ut og testet, ikke bare skrevet inline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideQuizAvailability, lateSubmitDeadline } from './quiz-availability'
import { SUBMIT_GRACE_MS } from './late-play-window'

const iso = (ms: number) => new Date(ms).toISOString()
const NOW = new Date('2026-08-21T20:30:00Z')
const nowMs = NOW.getTime()

test('åpen quiz: opens_at passert, closes_at i framtiden', () => {
  assert.equal(
    decideQuizAvailability({ opens_at: iso(nowMs - 3_600_000), closes_at: iso(nowMs + 3_600_000) }, NOW),
    'open',
  )
})

test('ikke åpnet ennå: opens_at i framtiden', () => {
  assert.equal(
    decideQuizAvailability({ opens_at: iso(nowMs + 60_000), closes_at: iso(nowMs + 7_200_000) }, NOW),
    'not-open-yet',
  )
})

test('«ikke åpnet» vinner over «stengt» ved inkonsistente datoer', () => {
  // opens_at i framtiden OG closes_at i fortiden er en umulig rad. «Åpner
  // <dato>» er den eneste av de to tekstene som kan bli sann.
  assert.equal(
    decideQuizAvailability({ opens_at: iso(nowMs + 60_000), closes_at: iso(nowMs - 60_000) }, NOW),
    'not-open-yet',
  )
})

test('stengt: closes_at passert og ingen påbegynt quiz', () => {
  assert.equal(
    decideQuizAvailability({ opens_at: iso(nowMs - 7_200_000), closes_at: iso(nowMs - 60_000) }, NOW),
    'closed',
  )
})

// ── Gjenbruk-vinduet (B-10 / cc9b14a) ───────────────────────────────────────
// Serveren gir `reused: true` for et uferdig forsøk innenfor SUBMIT_GRACE_MS.
// Viser klienten «stengt» der, blir den ene lovlige veien videre usynlig.
test('påbegynt quiz INNENFOR submit-vinduet er fortsatt spillbar', () => {
  const closesAt = iso(nowMs - (SUBMIT_GRACE_MS - 60_000))
  assert.equal(
    decideQuizAvailability({ closes_at: closesAt }, NOW, { hasResumableProgress: true }),
    'open',
  )
})

test('påbegynt quiz UTENFOR submit-vinduet er stengt', () => {
  // Ett sekund etter fristen svarer start-attempt 403. Da skal «Fortsett quiz»
  // ikke stå der og love noe serveren nekter.
  const closesAt = iso(nowMs - (SUBMIT_GRACE_MS + 1_000))
  assert.equal(
    decideQuizAvailability({ closes_at: closesAt }, NOW, { hasResumableProgress: true }),
    'closed',
  )
})

test('nøyaktig på fristen regnes fortsatt som innenfor', () => {
  // isWithinGrace bruker `<=` — samme grense som ruten. Et avvik på det ene
  // millisekundet er nettopp uenigheten paritetsregelen finnes for.
  assert.equal(
    decideQuizAvailability({ closes_at: iso(nowMs - SUBMIT_GRACE_MS) }, NOW, { hasResumableProgress: true }),
    'open',
  )
})

test('uten påbegynt quiz hjelper vinduet ikke', () => {
  assert.equal(
    decideQuizAvailability({ closes_at: iso(nowMs - 60_000) }, NOW, { hasResumableProgress: false }),
    'closed',
  )
})

test('vinduet gjelder ikke FØR stengetid — der er quizen åpen uansett', () => {
  assert.equal(
    decideQuizAvailability({ closes_at: iso(nowMs + 60_000) }, NOW, { hasResumableProgress: true }),
    'open',
  )
})

// ── Manglende og ugyldige data ──────────────────────────────────────────────
test('ingen quiz-rad gir «open» — kalleren beholder sin generiske tekst', () => {
  // En SKJULT quiz er usynlig for anon via RLS. Panelet skal ikke bekrefte
  // hvilke quiz-id-er som finnes ved å gjette en tilstand.
  assert.equal(decideQuizAvailability(null, NOW), 'open')
  assert.equal(decideQuizAvailability(undefined, NOW), 'open')
})

test('tomme eller ugyldige datoer stenger ingenting', () => {
  assert.equal(decideQuizAvailability({}, NOW), 'open')
  assert.equal(decideQuizAvailability({ opens_at: null, closes_at: null }, NOW), 'open')
  assert.equal(decideQuizAvailability({ opens_at: 'tull', closes_at: 'tøys' }, NOW), 'open')
})

// ── Innleveringsfristen som vises i gjenbruk-vinduet ────────────────────────
test('lateSubmitDeadline er stengetid + submit-vinduet', () => {
  const closesAt = '2026-08-21T20:00:00Z'
  const deadline = lateSubmitDeadline(closesAt)
  assert.ok(deadline)
  assert.equal(deadline.getTime(), new Date(closesAt).getTime() + SUBMIT_GRACE_MS)
})

test('lateSubmitDeadline er null uten gyldig stengetid', () => {
  // Ingen frist å love — kalleren skal utelate setningen, ikke skrive «kl.
  // Invalid Date».
  assert.equal(lateSubmitDeadline(null), null)
  assert.equal(lateSubmitDeadline(undefined), null)
  assert.equal(lateSubmitDeadline(''), null)
  assert.equal(lateSubmitDeadline('ikke en dato'), null)
})

// ── Grensetilfellet nøyaktig PÅ stengetid ───────────────────────────────────
// Ruten regner `afterClose = now > closesAt` — altså er selve stengesekundet
// fortsatt ÅPENT. Bruker klienten `>=` her, ser en spiller «Quizen er
// avsluttet» i det sekundet serveren fortsatt ville startet forsøket hennes.
// Nøyaktig samme uenighet som paritetsregelen for admin-sesjonen i CLAUDE.md,
// bare på et annet felt.
test('nøyaktig på closes_at er quizen fortsatt åpen — som i start-attempt', () => {
  assert.equal(
    decideQuizAvailability({ closes_at: iso(nowMs) }, NOW),
    'open',
  )
  // Ett millisekund senere er den stengt. Grensen ligger altså der ruten har den.
  assert.equal(
    decideQuizAvailability({ closes_at: iso(nowMs - 1) }, NOW),
    'closed',
  )
})

test('nøyaktig på opens_at er quizen åpen, ikke «åpner snart»', () => {
  // Ruten avviser på `now < opensAt`. Er klienten strengere, står spilleren og
  // ser «Åpner snart» på en quiz som nettopp åpnet.
  assert.equal(decideQuizAvailability({ opens_at: iso(nowMs) }, NOW), 'open')
  assert.equal(decideQuizAvailability({ opens_at: iso(nowMs + 1) }, NOW), 'not-open-yet')
})
