// Kjøres med:  npm test  (eller smalt: --test lib/nonnull-quiz-date-sites.test.ts)
//
// STRUKTURELLE SPERRER for NONNULL-sveipet 26. august 2026
// (.claude/QK_SVEIP_NONNULL_QUIZDATOER_26AUG.md, B1–B5): kallstedene i app/
// kan ikke importeres i denne testriggen (next/navigation, JSX), så sperrene
// felles på kildenivå. Logikken selv felles i lib/quiz-status.test.ts og
// lib/leaderboard-visibility.test.ts — denne fila feller at kallstedene
// faktisk BRUKER den, og at ingen rå epoch-tolkning står igjen.
//
// Fella som motiverer alt: `new Date(null)` er epoch 1970, ikke Invalid Date.
// En uguardet `new Date(quiz.closes_at)` feiltolker NULL stille som «stengt
// for lenge siden» — motsatt av den kanoniske lesningen (NULL = stenger aldri).
//
// LINJE-ANKER-REGELEN (feedback-structural-tests-need-active-line-anchors +
// -nearby-code-can-satisfy-your-test-anchor): all matching skjer mot AKTIV
// kode — blokk- og linjekommentarer strippes først, siden forklaringene i
// kallstedene siterer nettopp de forbudte formene. Positive anker er valgt så
// de SKILLER ny form fra gammel (f.eks. `= formatQuizDateOrDash`, ikke bare
// funksjonsnavnet et sted i fila).
//
// MUTASJONSBEVIS — hver sperre peker på endringen den fanger:
//   • Klienten (leaderboard-siden) går tilbake til egen isOpen/new Date-form
//     → «B1 klient»-testene ryker.
//   • Serverruten regner hiddenUntilClosed inline igjen → «B5 server» ryker.
//   • En av sidene bytter felt (leser noe annet enn closes_at inn i
//     beslutningen) → paritetstesten ryker.
//   • answer-distribution går tilbake til `new Date(quiz.closes_at) >` →
//     «B2»-testene ryker. Endres HIGHLIGHT_COUNT → egen sperre ryker
//     (dokumentert sikkerhetsbeslutning 26. juli 2026).
//   • Admin-lista formaterer datoer uguardet igjen → «B3» ryker.
//   • /quizer mister quiz_type-hvitelisten eller får tilbake en lokal
//     getQuizStatus-kopi → «B4» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const rot = join(import.meta.dirname, '..')

/** Fjerner blokk- og linjekommentarer så anker kun treffer aktiv kode.
 *  Forangående tegn må være strengstart, linjeskift eller whitespace — så
 *  `https://` inne i strenger ikke spises, mens kommentarer på linjestart
 *  (etter \n) faktisk strippes. */
function aktivKode(sti: string): string {
  return readFileSync(join(rot, sti), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\n \t])\/\/[^\n]*/g, '$1')
}

const KLIENT_STI = 'app/leaderboard/[id]/page.tsx'
const SERVER_STI = 'app/api/leaderboard/[id]/route.ts'
const DIST_STI = 'app/api/quiz/[id]/answer-distribution/route.ts'
const ADMIN_STI = 'app/admin/quizzes/page.tsx'
const QUIZER_STI = 'app/quizer/page.tsx'

/** Rå datolesing på en quiz-rad — formen som gjør NULL til epoch 1970. */
const RAA_DATO = /new Date\((quiz|q|quizRow)[!?]?\.(opens_at|closes_at)\)/

// ── B1: klienten leser closes_at via de delte funksjonene ───────────────────

test('B1 klient: leaderboard-siden bruker den delte skjul-beslutningen', () => {
  const kode = aktivKode(KLIENT_STI)
  assert.match(kode, /from '@\/lib\/leaderboard-visibility'/)
  assert.match(
    kode,
    /const isHidden = decideHiddenUntilClosed\(\{/,
    'isHidden regnes ikke lenger av den delte funksjonen'
  )
})

test('B1 klient: «stengt» leses via isQuizClosed, og ingen rå new Date på quiz-datoer', () => {
  const kode = aktivKode(KLIENT_STI)
  assert.match(kode, /isQuizClosed\(quiz\.closes_at, Date\.now\(\)\)/)
  assert.doesNotMatch(
    kode,
    RAA_DATO,
    'rå new Date(quiz.opens_at/closes_at) er tilbake — NULL blir epoch 1970 her'
  )
})

// ── B5: serverruten bruker SAMME beslutning ─────────────────────────────────

test('B5 server: hiddenUntilClosed kommer fra den delte funksjonen', () => {
  const kode = aktivKode(SERVER_STI)
  assert.match(kode, /from '@\/lib\/leaderboard-visibility'/)
  assert.match(
    kode,
    /const hiddenUntilClosed = !!quizRow\s*&&\s*decideHiddenUntilClosed\(\{/,
    'hiddenUntilClosed regnes inline igjen i stedet for via den delte funksjonen'
  )
  assert.doesNotMatch(kode, RAA_DATO)
})

// ── B1-PARITETEN: begge sidene mater samme felt inn i samme funksjon ────────

test('paritet: klient og server sender closes_at fra quiz-raden inn i samme beslutning', () => {
  // Fanger kall-KROPPEN fram til første `})` — en ekte grense, ikke et
  // tegnantall (feedback-line-start-anchor-is-not-position-guarantee).
  const kallKropp = (kode: string) => {
    const m = kode.match(/decideHiddenUntilClosed\(\{([\s\S]*?)\}\)/)
    assert.ok(m, 'fant ikke decideHiddenUntilClosed-kallet')
    return m![1]
  }
  const klient = kallKropp(aktivKode(KLIENT_STI))
  const server = kallKropp(aktivKode(SERVER_STI))
  assert.match(klient, /closesAt: quiz\.closes_at/, 'klienten sender ikke quiz.closes_at')
  assert.match(server, /closesAt: quizRow\.closes_at/, 'serveren sender ikke quizRow.closes_at')
  assert.match(klient, /hideUntilClosed: quiz\.hide_leaderboard_until_closed/)
  assert.match(server, /hideUntilClosed: quizRow\.hide_leaderboard_until_closed/)
})

// ── B2: answer-distribution tar eksplisitt NULL-standpunkt ──────────────────

test('B2: fordelingen gates av isQuizClosed — NULL åpner ikke porten', () => {
  const kode = aktivKode(DIST_STI)
  assert.match(kode, /from '@\/lib\/standings-cache'/)
  assert.match(
    kode,
    /if \(!isQuizClosed\(quiz\.closes_at, Date\.now\(\)\)\)/,
    'stengt-gaten leser ikke lenger den kanoniske NULL-semantikken'
  )
  assert.doesNotMatch(
    kode,
    RAA_DATO,
    'rå new Date(quiz.closes_at) er tilbake — NULL ville servert hele fasiten'
  )
})

test('B2: HIGHLIGHT_COUNT står urørt på 2 (sikkerhetsbeslutning 26. juli 2026)', () => {
  assert.match(aktivKode(DIST_STI), /const HIGHLIGHT_COUNT = 2\b/)
})

// ── B3: admin-lista viser aldri epoch ───────────────────────────────────────

test('B3: admin-lista formaterer og statusvurderer via de NULL-bevisste hjelperne', () => {
  const kode = aktivKode(ADMIN_STI)
  assert.match(kode, /from '@\/lib\/quiz-status'/)
  assert.match(
    kode,
    /const formatDate = formatQuizDateOrDash\b/,
    'formatDate er ikke lenger den NULL-bevisste hjelperen — «01.01.1970» kan komme tilbake'
  )
  assert.match(kode, /getQuizStatus\(quiz\.opens_at, quiz\.closes_at, new Date\(\)\) === 'åpen'/)
  assert.match(kode, /isQuizClosed\(quiz\.closes_at, Date\.now\(\)\)/)
  assert.doesNotMatch(kode, RAA_DATO)
})

// ── B4: /quizer-populasjonen har quiz_type-vakt ─────────────────────────────

test('B4: /quizer avgrenses av onlyRealQuizzes og beholder is_active-filteret', () => {
  const kode = aktivKode(QUIZER_STI)
  assert.match(kode, /from '@\/lib\/real-quiz-population'/)
  assert.match(
    kode,
    /await onlyRealQuizzes\(quizQuery\)/,
    'quiz_type-hvitelisten er borte — en arkivquiz ville listes som åpen quiz'
  )
  assert.match(kode, /\.eq\('is_active', true\)/)
})

test('B4: getQuizStatus er den delte — ingen lokal kopi igjen', () => {
  const kode = aktivKode(QUIZER_STI)
  assert.match(kode, /import \{ getQuizStatus \} from '@\/lib\/quiz-status'/)
  assert.doesNotMatch(
    kode,
    /function getQuizStatus/,
    'en lokal getQuizStatus-kopi skygger den delte definisjonen'
  )
})
