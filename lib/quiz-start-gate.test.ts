// Kjøres med:  npm test
//
// STRUKTURELL SPERRE mot at startskjermen i app/quiz/[id]/page.tsx igjen viser
// «Start quiz» på en quiz start-attempt vil avvise med 403.
//
// BAKGRUNN (24. august 2026)
// Tre flater lovet spilling på en quiz som var over eller ikke hadde åpnet.
// 66007ee rettet kortet på /leaderboard/[id], 700347d rettet innloggings-
// panelet — men den INNLOGGEDE spilleren møtte fortsatt startskjermen med
// Start-knappen, og trykket ga «Quizen er ikke åpen» fra start-attempt.
//
// HVORFOR EN KILDETEKST-TEST: samme begrunnelse som lib/start-quiz-timeout.ts
// og lib/finish-quiz-timeout.test.ts — grenen ligger inline i en 4400-linjers
// klientkomponent uten React-testoppsett i prosjektet. SELVE REGELEN er
// oppførselstestet og mutasjonsbevist i lib/quiz-availability.test.ts. Det
// denne testen dekker, er KOBLINGEN: at regelen faktisk står foran knappen.
// Uten den kunne decideQuizAvailability fjernes fra kallstedet uten at én
// eneste test ble rød — nøyaktig det ærlige hullet CLAUDE.md beskriver for
// middleware-cookie-vakten.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes importen/kallet av decideQuizAvailability → «regelen hentes fra
//     den delte kilden» ryker.
//   • Flyttes den ærlige grenen NEDENFOR registreringsskjermen → «står FØR»
//     ryker (registreringsskjermen ville returnert først).
//   • Fjernes hasResumableProgress fra kallet → «gjenbruk-stien overlever»
//     ryker (en avbrutt spiller ville møtt stengt-skjerm i submit-vinduet).
//   • Regnes tilstanden inline i panelet igjen → «panelet deler kilde» ryker.
//   • Byttes gaten til en oppramsing av tilstander → «slipper kun gjennom
//     'open'» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const CR = String.fromCharCode(13)
const SRC = readFileSync('app/quiz/[id]/page.tsx', 'utf8')
const LINES = SRC.split('\n').map(l => l.endsWith(CR) ? l.slice(0, -1) : l)

/**
 * Tegn-indeksen til en linje som er NØYAKTIG `line` — innrykk og alt.
 *
 * Ikke `includes`: en delstreng-sjekk passerer også på utkommentert kode. Men
 * ikke trimmet heller, og det er poenget: `if (phase === 'already_played') {`
 * finnes TO steder i page.tsx — én gang med fire mellomrom inne i fetchData,
 * og én gang med to som render-gren. Et trimmet anker fant den FØRSTE, og
 * rekkefølge-testen under ble grønn uansett hvor render-grenen lå. Fanget av
 * mutasjonsrunden 24. august 2026. Innrykket er her det eneste som SKILLER de
 * to, så uniktheten sjekkes eksplisitt.
 */
function lineIndex(line: string): number {
  const hits = LINES.filter(l => l === line).length
  assert.equal(hits, 1, `«${line}» skal finnes nøyaktig én gang i page.tsx, fant ${hits}`)
  let offset = 0
  for (const l of LINES) {
    if (l === line) return offset
    offset += l.length + 1
  }
  assert.fail('uoppnåelig')
}

function hasActiveLine(prefix: string): boolean {
  return LINES.some(l => l.trimStart().startsWith(prefix))
}

test('regelen hentes fra den delte kilden, ikke fra en lokal kopi', () => {
  assert.ok(
    hasActiveLine("import { decideQuizAvailability, lateSubmitDeadline } from '@/lib/quiz-availability'"),
    'page.tsx må importere decideQuizAvailability fra lib/quiz-availability',
  )
  assert.ok(
    SRC.includes('decideQuizAvailability(quiz, new Date()'),
    'tilstanden må regnes ut med quiz-raden og klokka — ikke hardkodes',
  )
})

test('gjenbruk-stien overlever: lagret fremdrift sendes inn i regelen', () => {
  // Uten dette argumentet blir en spiller som ble avbrutt av stengetid (B-10 /
  // cc9b14a) møtt av «Quizen er avsluttet» i de minuttene serveren fortsatt
  // ville svart reused: true — altså nektet å levere det hun har svart.
  assert.ok(
    SRC.includes('hasResumableProgress: !!resumeData'),
    'kallet må sende hasResumableProgress fra resumeData',
  )
})

test('den ærlige grenen står FØR registreringsskjermen', () => {
  const honest = lineIndex("  if (phase === 'register' && quizAvailability !== 'open') {")
  const register = lineIndex("  if (phase === 'register') return (")
  assert.ok(
    honest < register,
    'stengt/ikke-åpnet-grenen må returnere før registreringsskjermen — ellers vises Start-knappen først',
  )
})

test('Start-knappen ligger bak grenen', () => {
  const honest = lineIndex("  if (phase === 'register' && quizAvailability !== 'open') {")
  const startButton = SRC.indexOf('onClick={startQuiz}')
  assert.notEqual(startButton, -1, 'fant ikke Start-knappen — er onClick omdøpt?')
  assert.ok(
    honest < startButton,
    'Start-knappen må rendres etter grenen, ellers kan den nås på en stengt quiz',
  )
})

test('grenen slipper kun gjennom en quiz som faktisk er åpen', () => {
  // !== 'open' framfor en oppramsing av de to stengte tilstandene: kommer det
  // en tredje tilstand i lib/quiz-availability (f.eks. «krever tilgangskode»),
  // skal den falle i den ærlige grenen, ikke stille lande på Start-knappen.
  assert.ok(
    hasActiveLine("if (phase === 'register' && quizAvailability !== 'open') {"),
    "grenen må gate på !== 'open'",
  )
})

test('innloggingspanelet deler kilde med startskjermen', () => {
  // Panelet (700347d) regnet tilstanden inline. To kopier av samme regel er
  // nettopp det lib/next-quiz-label ble skilt ut for å hindre.
  assert.ok(hasActiveLine("const notYetOpen = quizAvailability === 'not-open-yet'"))
  assert.ok(hasActiveLine("const isClosed = quizAvailability === 'closed'"))
  assert.ok(
    !SRC.includes('const notYetOpen = !!(quiz?.opens_at'),
    'panelet skal ikke regne tilstanden inline igjen',
  )
})

test('allerede-spilt-skjermen står foran og rammes ikke', () => {
  // Den har sin egen tekst og sin egen fremtidsvakt (c4e7d27 / nextQuizLabel).
  // Havner den BAK den nye grenen, ville en spiller som HAR spilt en stengt
  // quiz fått «Denne quizen er avsluttet» i stedet for «Du har spilt denne
  // quizen» — en dårligere og mindre presis beskjed enn den hun hadde før.
  const alreadyPlayed = lineIndex("  if (phase === 'already_played') {")
  const honest = lineIndex("  if (phase === 'register' && quizAvailability !== 'open') {")
  assert.ok(
    alreadyPlayed < honest,
    'already_played må returnere før stengt/ikke-åpnet-grenen',
  )
})

test('grace-banneret påstår «du var i gang» kun når det finnes fremdrift', () => {
  // Betingelsen må bære resumeData, ikke bare klokka: quizAvailability er
  // memoisert på [quiz, resumeData], så en side som lå åpen over closes_at har
  // stale 'open' i memoen mens en fersk new Date() i banneret sier stengt. Uten
  // resumeData i betingelsen ville en spiller uten påbegynt quiz blitt lovet en
  // innleveringsfrist hun ikke har. Målt i nettleseren 24. august 2026.
  assert.ok(
    SRC.includes('const lateDeadline = resumeData && new Date(quiz.closes_at) < now'),
    'lateDeadline må kreve resumeData',
  )
})
