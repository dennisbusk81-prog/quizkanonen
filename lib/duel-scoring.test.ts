// Kjøres med:  npm test
//
// FUNN 4.3 (kritisk) — en avsluttet duell viste poeng fra INNEVÆRENDE måned i
// stedet for måneden duellen faktisk gikk i.
//
// MUTASJONSBEVIS: byttes oppslaget i pointsForDuel til å alltid bruke
// inneværende måned (altså den gamle oppførselen — f.eks. ved å hardkode
// månedsnøkkelen for juli), feiler «juni-duellen låses til juni-tallene» og
// «vinneren snus ikke av senere måneder».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePointsByMonth, monthKeyOf, pointsForDuel, type ScoredAttempt } from './duel-scoring'

const CARLOS = 'carlos'
const RENE = 'rene'
const FYLL = (n: number) => `fyll-${n}`

// Bygger et felt der `winner` tar 1. plass og `loser` en dårligere plass, med
// nok fyll-spillere til at plasseringene blir realistiske.
function quiz(quizId: string, order: string[]): ScoredAttempt[] {
  return order.map((user_id, i) => ({
    user_id,
    quiz_id: quizId,
    correct_answers: 20 - i,
    total_time_ms: 1000 + i * 100,
    correct_streak: 0,
  }))
}

const involved = new Set([CARLOS, RENE])

test('juni-duellen låses til juni-tallene, uavhengig av juli', () => {
  // Juni: Carlos vinner begge quizene (12 + 12 = 24), René nr. 3 begge (8 + 8 = 16)
  const attempts: ScoredAttempt[] = [
    ...quiz('juni-1', [CARLOS, FYLL(1), RENE, FYLL(2)]),
    ...quiz('juni-2', [CARLOS, FYLL(1), RENE, FYLL(2)]),
    // Juli: René dominerer, Carlos faller ned
    ...quiz('juli-1', [RENE, FYLL(1), FYLL(2), CARLOS]),
    ...quiz('juli-2', [RENE, FYLL(1), FYLL(2), CARLOS]),
  ]

  const monthByQuiz = new Map([
    ['juni-1', '2026-06'], ['juni-2', '2026-06'],
    ['juli-1', '2026-07'], ['juli-2', '2026-07'],
  ])

  const byMonth = computePointsByMonth(attempts, monthByQuiz, involved)
  const duellOpprettet = '2026-06-26T10:00:00.000Z'

  assert.equal(pointsForDuel(byMonth, duellOpprettet, CARLOS), 24)
  assert.equal(pointsForDuel(byMonth, duellOpprettet, RENE), 16)
})

test('vinneren av en avsluttet duell snus ikke av en senere måned', () => {
  // Juni: Carlos vant klart. Juli: René vant klart, med høyere absolutte tall.
  // Den gamle koden ville vist juli-tallene og utropt René som vinner av en
  // duell Carlos faktisk vant.
  const attempts: ScoredAttempt[] = [
    ...quiz('juni-1', [CARLOS, RENE]),                      // Carlos 12, René 10
    ...quiz('juli-1', [RENE, FYLL(1), FYLL(2), CARLOS]),    // René 12, Carlos 7
    ...quiz('juli-2', [RENE, FYLL(1), FYLL(2), CARLOS]),    // René 12, Carlos 7
  ]
  const monthByQuiz = new Map([
    ['juni-1', '2026-06'], ['juli-1', '2026-07'], ['juli-2', '2026-07'],
  ])
  const byMonth = computePointsByMonth(attempts, monthByQuiz, involved)

  const juniDuell = '2026-06-15T08:00:00.000Z'
  const carlosJuni = pointsForDuel(byMonth, juniDuell, CARLOS)
  const reneJuni = pointsForDuel(byMonth, juniDuell, RENE)

  assert.equal(carlosJuni, 12)
  assert.equal(reneJuni, 10)
  assert.ok(carlosJuni > reneJuni, 'Carlos skal fortsatt stå som vinner av juni-duellen')

  // Juli-tallene finnes, og er motsatt — nettopp derfor er månedsvalget kritisk.
  const juliDuell = '2026-07-05T08:00:00.000Z'
  assert.ok(
    pointsForDuel(byMonth, juliDuell, RENE) > pointsForDuel(byMonth, juliDuell, CARLOS),
    'juli-måneden skal isolert sett vise René foran — beviset på at månedene er ulike',
  )
})

test('to dueller i ulike måneder får ULIKE tall for samme bruker', () => {
  // Den gamle koden ga samme myPoints på hver eneste historikk-rad.
  const attempts: ScoredAttempt[] = [
    ...quiz('juni-1', [CARLOS, RENE]),
    ...quiz('juli-1', [RENE, CARLOS]),
  ]
  const byMonth = computePointsByMonth(
    attempts,
    new Map([['juni-1', '2026-06'], ['juli-1', '2026-07']]),
    involved,
  )
  const juni = pointsForDuel(byMonth, '2026-06-10T00:00:00.000Z', CARLOS)
  const juli = pointsForDuel(byMonth, '2026-07-10T00:00:00.000Z', CARLOS)
  assert.equal(juni, 12)
  assert.equal(juli, 10)
  assert.notEqual(juni, juli)
})

test('rangeringen skjer mot hele feltet, ikke bare duellantene', () => {
  // Carlos nr. 3 av 4 → 8 poeng. Hadde vi rangert kun duellantene ville han
  // fått 10 (nr. 2 av 2), og duellen vist feil tall.
  const attempts: ScoredAttempt[] = quiz('q', [FYLL(1), FYLL(2), CARLOS, RENE])
  const byMonth = computePointsByMonth(attempts, new Map([['q', '2026-06']]), involved)
  assert.equal(pointsForDuel(byMonth, '2026-06-01T00:00:00.000Z', CARLOS), 8)
  assert.equal(pointsForDuel(byMonth, '2026-06-01T00:00:00.000Z', RENE), 7)
})

test('måned uten quizer gir 0, ikke tall fra en annen måned', () => {
  const attempts: ScoredAttempt[] = quiz('juli-1', [CARLOS, RENE])
  const byMonth = computePointsByMonth(attempts, new Map([['juli-1', '2026-07']]), involved)
  assert.equal(pointsForDuel(byMonth, '2026-06-15T00:00:00.000Z', CARLOS), 0)
  assert.equal(pointsForDuel(byMonth, '2026-06-15T00:00:00.000Z', RENE), 0)
})

test('monthKeyOf bruker UTC og nullpadder måneden', () => {
  assert.equal(monthKeyOf('2026-06-26T10:00:00.000Z'), '2026-06')
  assert.equal(monthKeyOf('2026-12-31T23:59:59.000Z'), '2026-12')
  // Rett før månedsskiftet i UTC — lokal tidssone skal ikke flytte nøkkelen.
  assert.equal(monthKeyOf('2026-07-01T00:30:00.000Z'), '2026-07')
})
