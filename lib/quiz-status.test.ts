// Kjøres med:  npm test  (eller smalt: --test lib/quiz-status.test.ts)
//
// getQuizStatus + formatQuizDateOrDash — NULL-semantikken fra NONNULL-sveipet
// 26. august 2026 (B3/B4 i .claude/QK_SVEIP_NONNULL_QUIZDATOER_26AUG.md).
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes `opensAt &&`-guarden → new Date(null) = epoch 1970 <= now, og
//     (null, null) blir aldri 'kommende', men fjernes `closesAt &&` → epoch
//     < now → 'stengt': «quiz uten datoer er åpen» ryker.
//   • Byttes retningen (NULL tolket som «stengt for lenge siden») → samme test
//     ryker — det er nøyaktig new Date(null)-fella sveipet handler om.
//   • Endres grensesemantikken (<= / >=) → «likhet på grensen»-testene ryker;
//     de låser at flyttingen fra /quizer og /admin/quizzes var tegn-for-tegn.
//   • Returnerer formatQuizDateOrDash en formatert epoch for null →
//     «NULL vises som strek»-testen ryker.
//
// FIXTUR-REGEL (fella som bet to ganger, se oppdraget): alle datoer er EKTE,
// ULIKE verdier — aldri epoch, og opens/closes er aldri samme tidspunkt, så et
// filter på feil felt ikke kan se riktig ut.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getQuizStatus, formatQuizDateOrDash } from './quiz-status'

const NOW = new Date('2026-08-26T12:00:00Z')
const OPENS_FORTID = '2026-08-21T18:00:00Z'   // fredag før — har åpnet
const OPENS_FRAMTID = '2026-08-28T18:00:00Z'  // kommende fredag
const CLOSES_FORTID = '2026-08-23T20:30:00Z'  // stengte søndag kveld
const CLOSES_FRAMTID = '2026-08-28T22:00:00Z' // stenger fredag kveld

// ── Ekte datoer: uendret oppførsel fra begge forgjengerne ────────────────────

test('åpnet og ikke stengt = åpen', () => {
  assert.equal(getQuizStatus(OPENS_FORTID, CLOSES_FRAMTID, NOW), 'åpen')
})

test('opens_at i framtiden = kommende', () => {
  assert.equal(getQuizStatus(OPENS_FRAMTID, CLOSES_FRAMTID, NOW), 'kommende')
})

test('closes_at i fortiden = stengt', () => {
  assert.equal(getQuizStatus(OPENS_FORTID, CLOSES_FORTID, NOW), 'stengt')
})

test('likhet på åpningsgrensen regnes som åpnet (opens_at <= now)', () => {
  // Speiler admin-listas gamle `new Date(opens_at) <= now` eksakt.
  assert.equal(getQuizStatus(NOW.toISOString(), CLOSES_FRAMTID, NOW), 'åpen')
})

test('likhet på stengegrensen regnes som fortsatt åpen (closes_at >= now)', () => {
  assert.equal(getQuizStatus(OPENS_FORTID, NOW.toISOString(), NOW), 'åpen')
})

// ── NULL = «ingen tidsgrense», aldri epoch 1970 ─────────────────────────────

test('quiz uten datoer er åpen — ikke «stengt siden 1970»', () => {
  assert.equal(getQuizStatus(null, null, NOW), 'åpen')
})

test('opens_at NULL = har åpnet; closes_at avgjør alene', () => {
  assert.equal(getQuizStatus(null, CLOSES_FRAMTID, NOW), 'åpen')
  assert.equal(getQuizStatus(null, CLOSES_FORTID, NOW), 'stengt')
})

test('closes_at NULL = stenger aldri; opens_at avgjør alene', () => {
  assert.equal(getQuizStatus(OPENS_FORTID, null, NOW), 'åpen')
  assert.equal(getQuizStatus(OPENS_FRAMTID, null, NOW), 'kommende')
})

// ── formatQuizDateOrDash ────────────────────────────────────────────────────

test('NULL vises som strek, aldri som formatert epoch', () => {
  const vist = formatQuizDateOrDash(null)
  assert.equal(vist, '—')
  assert.ok(!vist.includes('1970'), 'null ble formatert som en dato')
})

test('ekte dato formateres som dato (dd.mm.åååå med klokkeslett)', () => {
  // Kun mønsteret, ikke eksakt streng: toLocaleString er tidssoneavhengig, og
  // testen skal ikke være bundet til maskinen den kjører på.
  const vist = formatQuizDateOrDash(CLOSES_FORTID)
  assert.match(vist, /\d{2}\.\d{2}\.2026/)
  assert.match(vist, /\d{2}[:.]\d{2}/)
})
