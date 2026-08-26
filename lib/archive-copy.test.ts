// Kjøres med:  npm test
//
// Tester for buildArchiveCopy (lib/archive-copy.ts) — den rene beslutningen om
// hva en arkivkopi består av. Ingen rute finnes ennå; dette er kontrakten den
// framtidige ruten skal kalle.
//
// FIXTURE-REGEL (fella som bet to ganger 25.–26. august): hvert felt testene
// hviler på har en DISTINKT, ikke-tom verdi — kildequizen har quiz_type
// 'weekly', is_test TRUE, hide-flagget TRUE og ekte, ulike datoer, og hver
// kilderad har ulik usage_count, order_index osv. Et filter eller en arv fra
// FEIL felt kan da ikke se riktig ut ved et sammentreff: hver eneste verdi som
// SKAL erstattes i utgangen er forskjellig fra verdien den erstattes med.
//
// MUTASJONSBEVIS: kjørt og rapportert i økta 26. august 2026 — én mutasjon per
// bestilt punkt (arv av quiz_type/datoer/hide-flagg/is_test, bruksdata inn i
// utgangen, order_index 0-basert regresjon, arvet kildens order_index, delt
// array-referanse, mutasjon av inngangen). Se øktrapportene 26. august
// (0-basert ble bygget først; Dennis byttet til husets 1-baserte konvensjon
// samme kveld, og mutasjonen ble kjørt på nytt begge veier).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArchiveCopy, type ArchiveSourceQuestion } from './archive-copy'

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as object)) deepFreeze(v)
    Object.freeze(obj)
  }
  return obj
}

// Kildequiz med verdier som ALLE avviker fra det utgangen skal ha — arv av
// noe som helst felt gir rød test.
const KILDE_QUIZ = deepFreeze({
  quiz_type: 'weekly',
  is_test: true,
  hide_leaderboard_until_closed: true,
  opens_at: '2026-08-07T15:00:00.000Z',
  closes_at: '2026-08-14T19:30:00.000Z',
})

// Kilderadene bærer bruksdata/identitet med distinkte, ikke-default-verdier —
// havner noe av det i utgangen, feller uttømmingstesten det.
const SP_A = deepFreeze({
  id: 'id-a',
  question_text: 'Hva heter hovedstaden i Frankrike?',
  option_a: 'Paris',
  option_b: 'Lyon',
  option_c: 'Marseille',
  option_d: null,
  correct_answer: 'A',
  correct_answers: null,
  explanation: 'Paris har vært hovedstad siden 987.',
  category: 'Geografi',
  time_limit_seconds: 20,
  shuffle_options: true,
  quiz_id: 'kilde-quiz-1',
  order_index: 14,
  usage_count: 7,
  last_used_at: '2026-05-01T10:00:00.000Z',
  is_classic: true,
  created_at: '2026-01-15T09:00:00.000Z',
}) as ArchiveSourceQuestion

const SP_B = deepFreeze({
  id: 'id-b',
  question_text: 'Hvilke av disse er nordiske hovedsteder?',
  option_a: 'Hamburg',
  option_b: 'Oslo',
  option_c: 'Helsingfors',
  option_d: 'Rotterdam',
  correct_answer: 'B',
  correct_answers: ['B', 'C'],
  explanation: null,
  category: null,
  time_limit_seconds: null,
  shuffle_options: false,
  quiz_id: 'kilde-quiz-2',
  order_index: 21,
  usage_count: 13,
  last_used_at: '2026-06-12T18:30:00.000Z',
  is_classic: false,
  created_at: '2026-02-20T11:45:00.000Z',
}) as ArchiveSourceQuestion

const SP_C = deepFreeze({
  id: 'id-c',
  question_text: 'Hvilket år falt Berlinmuren?',
  option_a: '1987',
  option_b: '1989',
  option_c: '1991',
  option_d: '1993',
  correct_answer: 'B',
  correct_answers: null,
  explanation: 'Muren falt 9. november 1989.',
  category: 'Historie',
  time_limit_seconds: 45,
  shuffle_options: true,
  quiz_id: 'kilde-quiz-1',
  order_index: 9,
  usage_count: 2,
  last_used_at: '2026-04-03T08:15:00.000Z',
  is_classic: true,
  created_at: '2026-03-01T14:00:00.000Z',
}) as ArchiveSourceQuestion

const ALLE = deepFreeze([SP_A, SP_B, SP_C]) as ArchiveSourceQuestion[]

function kallStandard() {
  return buildArchiveCopy({
    title: 'Arkivkopi under test',
    questionIds: deepFreeze(['id-a', 'id-b', 'id-c']) as string[],
    sourceQuestions: ALLE,
    sourceQuiz: KILDE_QUIZ,
  })
}

// De ENESTE nøklene en utgangs-spørsmålsrad skal ha. Uttømming, ikke
// stikkprøve: en ny nøkkel (usage_count, is_classic, quiz_id …) feller testen
// uansett hvilken det er.
const FORVENTEDE_SPORSMAL_NOKLER = [
  'category',
  'correct_answer',
  'correct_answers',
  'explanation',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'order_index',
  'question_text',
  'shuffle_options',
  'time_limit_seconds',
].sort()

test('quiz-raden er EKSAKT de besluttede kolonnene — ingenting arves fra en kilde med alle verdier "feil vei"', () => {
  const res = kallStandard()
  assert.equal(res.ok, true)
  if (!res.ok) return
  // Eksakt objektlikhet: en arvet verdi ELLER en ny/utelatt nøkkel feller
  // testen. Kilden har quiz_type 'weekly', is_test true, hide-flagg true og
  // ekte datoer — hver eneste kollisjon ville synes.
  assert.deepEqual(res.quiz, {
    title: 'Arkivkopi under test',
    quiz_type: 'archive',
    opens_at: null,
    closes_at: null,
    hide_leaderboard_until_closed: false,
    is_test: false,
    is_active: true,
  })
})

test('hide_leaderboard_until_closed arves aldri — false uansett om kilden har true, false eller mangler', () => {
  for (const kilde of [
    KILDE_QUIZ,
    deepFreeze({ ...KILDE_QUIZ, hide_leaderboard_until_closed: false }),
    null,
  ]) {
    const res = buildArchiveCopy({
      title: 'Flagg-test',
      questionIds: ['id-a'],
      sourceQuestions: ALLE,
      sourceQuiz: kilde,
    })
    assert.equal(res.ok, true)
    if (!res.ok) return
    assert.equal(res.quiz.hide_leaderboard_until_closed, false)
  }
})

test('opens_at og closes_at er alltid null selv når kilden har ekte, ulike datoer', () => {
  const res = kallStandard()
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.quiz.opens_at, null)
  assert.equal(res.quiz.closes_at, null)
})

test('quiz_type er alltid archive og is_test alltid false — kilden er weekly-testquiz', () => {
  const res = kallStandard()
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.quiz.quiz_type, 'archive')
  assert.equal(res.quiz.is_test, false)
})

test('bruksdata og identitet havner aldri i utgangsradene — eksakt nøkkelsett per rad', () => {
  const res = kallStandard()
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.questions.length, 3)
  for (const rad of res.questions) {
    assert.deepEqual(Object.keys(rad).sort(), FORVENTEDE_SPORSMAL_NOKLER)
  }
})

test('order_index er sammenhengende fra 1 (husets konvensjon) i ID-LISTENS rekkefølge, uavhengig av radenes rekkefølge', () => {
  // Id-listen snur rekkefølgen i forhold til sourceQuestions-arrayen, og
  // kilderadenes egne order_index (14/21/9) overlapper ikke 1..3 — både
  // «arv kildens order_index» og «følg array-rekkefølgen» gir rød test.
  const res = buildArchiveCopy({
    title: 'Rekkefølge-test',
    questionIds: ['id-c', 'id-a', 'id-b'],
    sourceQuestions: ALLE,
    sourceQuiz: KILDE_QUIZ,
  })
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.deepEqual(
    res.questions.map((q) => [q.order_index, q.question_text]),
    [
      [1, SP_C.question_text],
      [2, SP_A.question_text],
      [3, SP_B.question_text],
    ]
  )
})

test('innholdskolonnene kopieres verbatim — hele raden, multi-svar inkludert', () => {
  const res = kallStandard()
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.deepEqual(res.questions[1], {
    question_text: 'Hvilke av disse er nordiske hovedsteder?',
    option_a: 'Hamburg',
    option_b: 'Oslo',
    option_c: 'Helsingfors',
    option_d: 'Rotterdam',
    correct_answer: 'B',
    correct_answers: ['B', 'C'],
    explanation: null,
    category: null,
    time_limit_seconds: null,
    shuffle_options: false,
    order_index: 2,
  })
})

test('fasit-arrayet kopieres som verdi, ikke som referanse til kilderaden', () => {
  const res = kallStandard()
  assert.equal(res.ok, true)
  if (!res.ok) return
  const kopi = res.questions[1].correct_answers
  assert.deepEqual(kopi, SP_B.correct_answers)
  assert.notEqual(kopi, SP_B.correct_answers)
})

test('ren funksjon: frosne innganger overlever, og samme input gir samme output', () => {
  // Alle fixtures er dypfryst ('use strict': mutasjon kaster TypeError), så
  // at kallene i det hele tatt fullfører beviser at ingenting muteres.
  const res1 = kallStandard()
  const res2 = kallStandard()
  assert.deepEqual(res1, res2)
})

test('tittelen trimmes, og tom/blank tittel avvises', () => {
  const ok = buildArchiveCopy({
    title: '  Fredagsquiz på nytt  ',
    questionIds: ['id-a'],
    sourceQuestions: ALLE,
    sourceQuiz: KILDE_QUIZ,
  })
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.quiz.title, 'Fredagsquiz på nytt')

  const blank = buildArchiveCopy({
    title: '   ',
    questionIds: ['id-a'],
    sourceQuestions: ALLE,
    sourceQuiz: KILDE_QUIZ,
  })
  assert.deepEqual(blank, { ok: false, error: 'tom-tittel' })
})

test('tom id-liste, duplikat-id og ukjent id avvises med hver sin grunn', () => {
  const tom = buildArchiveCopy({
    title: 'X-quiz',
    questionIds: [],
    sourceQuestions: ALLE,
    sourceQuiz: KILDE_QUIZ,
  })
  assert.deepEqual(tom, { ok: false, error: 'tom-liste' })

  const dup = buildArchiveCopy({
    title: 'X-quiz',
    questionIds: ['id-a', 'id-b', 'id-a'],
    sourceQuestions: ALLE,
    sourceQuiz: KILDE_QUIZ,
  })
  assert.deepEqual(dup, { ok: false, error: 'duplikat-id', detail: 'id-a' })

  const ukjent = buildArchiveCopy({
    title: 'X-quiz',
    questionIds: ['id-a', 'id-finnes-ikke'],
    sourceQuestions: ALLE,
    sourceQuiz: KILDE_QUIZ,
  })
  assert.deepEqual(ukjent, { ok: false, error: 'ukjent-id', detail: 'id-finnes-ikke' })
})
