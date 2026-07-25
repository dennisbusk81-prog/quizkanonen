// Kjøres med:  npm test
// (node --import ./scripts/ts-node-resolve.mjs --test lib/answer-key-correction.test.ts)
//
// Testene her vokter to ting:
//   1. At en fasitretting med FLERE riktige svar scorer likt som spillmotoren
//      i app/api/quiz/[id]/submit/route.ts ville gjort — inkludert streak.
//   2. At den skjulte regraderingsveien i PATCH er stengt, UTEN at vanlig
//      redigering av en spilt quiz ble kollateral skade.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAnswerKey,
  readStoredKey,
  answerKeyColumns,
  sameAnswerKey,
  gradeAnswerRows,
  planAttemptTotals,
  decideAnswerKeyPatch,
  type AttemptAnswerRow,
} from '@/lib/answer-key-correction'

const stored = (correct_answer: string | null, correct_answers: string[] | null = null) =>
  ({ correct_answer, correct_answers })

// ── 1. Parsing og normalisering ─────────────────────────────────────────────

test('parseAnswerKey: enkelt-verdi (gammel form) og array gir samme resultat', () => {
  assert.deepEqual(parseAnswerKey('A'), { ok: true, keys: ['A'] })
  assert.deepEqual(parseAnswerKey(['A']), { ok: true, keys: ['A'] })
})

test('parseAnswerKey: normaliserer store/små bokstaver og mellomrom', () => {
  assert.deepEqual(parseAnswerKey([' a ', 'c']), { ok: true, keys: ['A', 'C'] })
})

test('parseAnswerKey: fjerner duplikater, men beholder rekkefølgen', () => {
  // Rekkefølgen er ikke kosmetikk: keys[0] blir correct_answer.
  assert.deepEqual(parseAnswerKey(['C', 'A', 'C']), { ok: true, keys: ['C', 'A'] })
})

test('parseAnswerKey: avviser tomt sett', () => {
  const res = parseAnswerKey([])
  assert.equal(res.ok, false)
})

test('parseAnswerKey: avviser bokstav utenfor A–D', () => {
  const res = parseAnswerKey(['A', 'E'])
  assert.equal(res.ok, false)
})

test('parseAnswerKey: avviser alternativ over quizens num_options', () => {
  // En 3-alternativs quiz har ingen D å rette til.
  const res = parseAnswerKey(['D'], 3)
  assert.equal(res.ok, false)
  assert.deepEqual(parseAnswerKey(['C'], 3), { ok: true, keys: ['C'] })
})

test('parseAnswerKey: avviser ikke-strenger', () => {
  assert.equal(parseAnswerKey([1]).ok, false)
  assert.equal(parseAnswerKey({}).ok, false)
})

test('readStoredKey: arrayet vinner når det har innhold, ellers enkelt-kolonnen', () => {
  assert.deepEqual(readStoredKey(stored('A', ['A', 'C'])), ['A', 'C'])
  assert.deepEqual(readStoredKey(stored('B', [])), ['B'])
  assert.deepEqual(readStoredKey(stored('B', null)), ['B'])
  assert.deepEqual(readStoredKey(stored(null, null)), [])
})

test('answerKeyColumns: ett svar gir correct_answers = null, flere gir array', () => {
  assert.deepEqual(answerKeyColumns(['B']), { correct_answer: 'B', correct_answers: null })
  assert.deepEqual(answerKeyColumns(['C', 'A']), { correct_answer: 'C', correct_answers: ['C', 'A'] })
})

test('sameAnswerKey: sammenligner som mengde, ikke som rekkefølge', () => {
  assert.equal(sameAnswerKey(['A', 'C'], ['C', 'A']), true)
  assert.equal(sameAnswerKey(['A'], ['A', 'C']), false)
  assert.equal(sameAnswerKey(['A', 'C'], ['A', 'B']), false)
})

// ── 2. Regradering ──────────────────────────────────────────────────────────

test('gradeAnswerRows: ETT riktig svar oppfører seg som før', () => {
  const rows = [
    { id: 'r1', selected_answer: 'A' },
    { id: 'r2', selected_answer: 'B' },
    { id: 'r3', selected_answer: null }, // timeout
  ]
  assert.deepEqual(gradeAnswerRows(rows, ['B']), [
    { id: 'r1', is_correct: false },
    { id: 'r2', is_correct: true },
    { id: 'r3', is_correct: false },
  ])
})

test('gradeAnswerRows: TO riktige svar godkjenner begge alternativene', () => {
  const rows = [
    { id: 'r1', selected_answer: 'A' },
    { id: 'r2', selected_answer: 'B' },
    { id: 'r3', selected_answer: 'C' },
    { id: 'r4', selected_answer: 'D' },
  ]
  assert.deepEqual(gradeAnswerRows(rows, ['A', 'C']), [
    { id: 'r1', is_correct: true },
    { id: 'r2', is_correct: false },
    { id: 'r3', is_correct: true },
    { id: 'r4', is_correct: false },
  ])
})

test('gradeAnswerRows: timeout er alltid feil, også når fasiten er flere svar', () => {
  // Den skjulte PATCH-veien brukte .neq('selected_answer', ...), som i Postgres
  // ALDRI matcher NULL-rader — timeout-svar beholdt derfor gammel is_correct.
  const rows = [{ id: 'r1', selected_answer: null }]
  assert.deepEqual(gradeAnswerRows(rows, ['A', 'B', 'C', 'D']), [{ id: 'r1', is_correct: false }])
})

// ── 3. Nye totaler per forsøk ───────────────────────────────────────────────

const order = ['q1', 'q2', 'q3', 'q4']

const row = (attempt_id: string, question_id: string, is_correct: boolean): AttemptAnswerRow =>
  ({ attempt_id, question_id, is_correct })

test('planAttemptTotals: teller riktige og finner lengste rekke i spillerekkefølge', () => {
  const rows = [
    // Radene kommer med vilje i "feil" rekkefølge — streaken skal regnes over
    // order-arrayet, ikke over rad-rekkefølgen.
    row('a1', 'q3', true),
    row('a1', 'q1', true),
    row('a1', 'q4', true),
    row('a1', 'q2', false),
  ]
  const totals = planAttemptTotals(rows, order)
  assert.deepEqual(totals.get('a1'), { correctAnswers: 3, correctStreak: 2 })
})

test('planAttemptTotals: fasitretting med to riktige svar oppdaterer scoringen korrekt', () => {
  // Scenario ende-til-ende: spørsmål q2 rettes fra fasit ['B'] til ['B','C'].
  // a1 svarte C på q2 og skal gå fra 1 riktig til 2 — og fra streak 1 til 3.
  const answerRows = [
    { id: 'x1', selected_answer: 'C' }, // a1 sitt svar på q2
    { id: 'x2', selected_answer: 'D' }, // a2 sitt svar på q2
  ]
  const regraded = gradeAnswerRows(answerRows, ['B', 'C'])
  assert.deepEqual(regraded, [
    { id: 'x1', is_correct: true },
    { id: 'x2', is_correct: false },
  ])

  const rowsAfter = [
    row('a1', 'q1', true),
    row('a1', 'q2', regraded[0].is_correct),
    row('a1', 'q3', true),
    row('a1', 'q4', false),
    row('a2', 'q1', false),
    row('a2', 'q2', regraded[1].is_correct),
    row('a2', 'q3', true),
    row('a2', 'q4', true),
  ]
  const totals = planAttemptTotals(rowsAfter, order)

  assert.deepEqual(totals.get('a1'), { correctAnswers: 3, correctStreak: 3 })
  // a2 svarte D og er upåvirket av at C ble godkjent.
  assert.deepEqual(totals.get('a2'), { correctAnswers: 2, correctStreak: 2 })
})

test('planAttemptTotals: fasitretting med ETT riktig svar fungerer som før', () => {
  // Samme spørsmål, men fasiten flyttes fra B til C (klassisk enkelt-retting).
  const regraded = gradeAnswerRows(
    [{ id: 'x1', selected_answer: 'C' }, { id: 'x2', selected_answer: 'B' }],
    ['C'],
  )
  assert.deepEqual(regraded, [
    { id: 'x1', is_correct: true },
    { id: 'x2', is_correct: false },
  ])

  const totals = planAttemptTotals(
    [
      row('a1', 'q1', true),
      row('a1', 'q2', regraded[0].is_correct),
      row('a1', 'q3', false),
      row('a1', 'q4', false),
      row('a2', 'q1', true),
      row('a2', 'q2', regraded[1].is_correct),
      row('a2', 'q3', true),
      row('a2', 'q4', false),
    ],
    order,
  )
  assert.deepEqual(totals.get('a1'), { correctAnswers: 2, correctStreak: 2 })
  assert.deepEqual(totals.get('a2'), { correctAnswers: 2, correctStreak: 1 })
})

test('planAttemptTotals: duplikate svarrader telles rått, som før', () => {
  // Bevisst uendret oppførsel — se kommentaren i planAttemptTotals.
  const totals = planAttemptTotals(
    [row('a1', 'q1', true), row('a1', 'q1', true), row('a1', 'q2', false)],
    order,
  )
  assert.equal(totals.get('a1')?.correctAnswers, 2)
  // Streaken regnes over unike spørsmål og blir derfor 1, ikke 2.
  assert.equal(totals.get('a1')?.correctStreak, 1)
})

test('planAttemptTotals: forsøk uten riktige svar får streak 0', () => {
  const totals = planAttemptTotals([row('a1', 'q1', false), row('a1', 'q2', false)], order)
  assert.deepEqual(totals.get('a1'), { correctAnswers: 0, correctStreak: 0 })
})

// ── 4. PATCH-vakten: den skjulte veien ──────────────────────────────────────

test('PATCH: vanlig redigering på en SPILT quiz går gjennom uendret', () => {
  // Dette er den viktigste testen i filen. Begge admin-sidene sender fasiten i
  // hver eneste lagring, også når admin bare rettet en skrivefeil. Hvis den
  // lagringen ble låst, ville en spilt quiz blitt uredigerbar.
  const decision = decideAnswerKeyPatch({
    requested: ['B'],
    stored: stored('B'),
    answeredCount: 137,
  })
  assert.deepEqual(decision, { action: 'unchanged' })
})

test('PATCH: uendret multi-fasit på spilt quiz låses ikke, uansett rekkefølge', () => {
  const decision = decideAnswerKeyPatch({
    requested: ['C', 'A'],
    stored: stored('A', ['A', 'C']),
    answeredCount: 42,
  })
  assert.deepEqual(decision, { action: 'unchanged' })
})

test('PATCH: fasit ikke med i forespørselen (f.eks. kun order_index) er alltid greit', () => {
  const decision = decideAnswerKeyPatch({
    requested: undefined,
    stored: stored('A'),
    answeredCount: 500,
  })
  assert.deepEqual(decision, { action: 'unchanged' })
})

test('PATCH: fasitendring på quiz UNDER BYGGING skrives rett gjennom', () => {
  const decision = decideAnswerKeyPatch({
    requested: ['C'],
    stored: stored('A'),
    answeredCount: 0,
  })
  assert.deepEqual(decision, {
    action: 'write',
    columns: { correct_answer: 'C', correct_answers: null },
    keys: ['C'],
  })
})

test('PATCH: multi-fasit på quiz under bygging skrives rett gjennom', () => {
  const decision = decideAnswerKeyPatch({
    requested: ['a', 'c'],
    stored: stored('A'),
    answeredCount: 0,
  })
  assert.deepEqual(decision, {
    action: 'write',
    columns: { correct_answer: 'A', correct_answers: ['A', 'C'] },
    keys: ['A', 'C'],
  })
})

test('PATCH: fasitendring på SPILT quiz låses — den skjulte veien er stengt', () => {
  const decision = decideAnswerKeyPatch({
    requested: ['C'],
    stored: stored('A'),
    answeredCount: 137,
  })
  assert.deepEqual(decision, {
    action: 'locked',
    currentKey: ['A'],
    requestedKey: ['C'],
    answeredCount: 137,
  })
})

test('PATCH: å UTVIDE en fasit til to svar på en spilt quiz låses også', () => {
  // Dette var den stille korrupsjonen: en ordinær lagring fra «Rediger»-siden
  // sendte bare correct_answer og fikk C-svarene regradert til feil, mens
  // questions.correct_answers fortsatt sa ['A','C'].
  const decision = decideAnswerKeyPatch({
    requested: ['A', 'C'],
    stored: stored('A'),
    answeredCount: 9,
  })
  assert.equal(decision.action, 'locked')
})

test('PATCH: å SNEVRE INN en multi-fasit på en spilt quiz låses også', () => {
  const decision = decideAnswerKeyPatch({
    requested: ['A'],
    stored: stored('A', ['A', 'C']),
    answeredCount: 9,
  })
  assert.deepEqual(decision, {
    action: 'locked',
    currentKey: ['A', 'C'],
    requestedKey: ['A'],
    answeredCount: 9,
  })
})

test('PATCH: ugyldig fasit avvises før noe skrives', () => {
  const decision = decideAnswerKeyPatch({
    requested: ['E'],
    stored: stored('A'),
    answeredCount: 0,
  })
  assert.equal(decision.action, 'invalid')
})

test('PATCH: fasit på et spørsmål uten lagret fasit skrives når ingen har svart', () => {
  const decision = decideAnswerKeyPatch({
    requested: ['A'],
    stored: stored(null, null),
    answeredCount: 0,
  })
  assert.equal(decision.action, 'write')
})
