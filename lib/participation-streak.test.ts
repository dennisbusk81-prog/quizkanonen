// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeParticipationStreak, type StreakQuiz } from './participation-streak'

// Fixturene bærer opens_at selv om funksjonen ikke leser den. Den er der som
// kontrollgrunnlag: flere av testene under må kunne VISE at en dato-basert
// tolkning ville gitt et annet svar, og uten datoene i fixturen ville den
// kontrollen vært en påstand uten belegg.
type Fixture = StreakQuiz & { opensAt: string }

/** Fredager fra og med 19.06.2026, samme kadens som i prod. */
function friday(n: number): string {
  const first = Date.UTC(2026, 5, 19, 10, 0, 0)
  return new Date(first + n * 7 * 24 * 60 * 60 * 1000).toISOString()
}

function quiz(week: number, settled = true): Fixture {
  return { id: `q${week}`, settled, opensAt: friday(week) }
}

/** Sammenhengende ukesserie, alle gjort opp. */
function series(count: number): Fixture[] {
  return Array.from({ length: count }, (_, i) => quiz(i))
}

const ids = (qs: Fixture[]) => qs.map(q => q.id)

// ── Grunntilfellene ─────────────────────────────────────────────────────────

test('aldri spilt → 0, ikke null-feil', () => {
  assert.deepEqual(
    computeParticipationStreak(series(7), []),
    { current: 0, longest: 0 },
  )
})

test('ingen quizer i det hele tatt → 0', () => {
  assert.deepEqual(computeParticipationStreak([], ['q0']), { current: 0, longest: 0 })
})

test('kun ÉN quiz spilt, og den er den siste → rekke = 1', () => {
  const qs = series(7)
  assert.deepEqual(
    computeParticipationStreak(qs, ['q6']),
    { current: 1, longest: 1 },
  )
})

test('spilt alle → rekken er hele historikken', () => {
  const qs = series(7)
  assert.deepEqual(
    computeParticipationStreak(qs, ids(qs)),
    { current: 7, longest: 7 },
  )
})

// ── MUTASJONSBEVIS 1: et hull bryter faktisk rekken ─────────────────────────
//
// Datasettet er valgt slik at «tell alle forsøk» og «tell på rad» gir ULIKE
// tall. Uten den forskjellen ville testen passert også for en naiv
// implementasjon, og da hadde den ikke bevist noe.

test('et hull midt i historikken bryter rekken — naiv opptelling ville feilet', () => {
  const qs = series(7)
  // Spilte 6 av 7, men hoppet over q3. Etter hullet står det 3 igjen.
  const spilt = ['q0', 'q1', 'q2', 'q4', 'q5', 'q6']

  const res = computeParticipationStreak(qs, spilt)

  assert.equal(res.current, 3, 'rekken skal starte på nytt etter hullet')
  assert.equal(res.longest, 3, 'lengste sammenhengende serie er q0–q2 og q4–q6')
  assert.notEqual(
    res.current, spilt.length,
    'en implementasjon som bare teller antall spilte quizer ville gitt 6 her',
  )
})

test('kontroll: datasettet over skiller faktisk de to utfallene', () => {
  // Beviser at «tell alle» og «tell på rad» ER ulike på nettopp dette
  // datasettet — ellers er assert.notEqual over tom.
  const spilt = ['q0', 'q1', 'q2', 'q4', 'q5', 'q6']
  assert.equal(spilt.length, 6)
  assert.notEqual(computeParticipationStreak(series(7), spilt).current, 6)
})

test('flere hull: lengste rekke er den lengste serien, ikke den siste', () => {
  const qs = series(9)
  // q0–q3 (4 på rad), hull, q5–q6 (2 på rad), hull, q8 (1)
  const res = computeParticipationStreak(qs, ['q0', 'q1', 'q2', 'q3', 'q5', 'q6', 'q8'])

  assert.equal(res.current, 1, 'kun q8 er spilt etter siste hull')
  assert.equal(res.longest, 4, 'q0–q3 er den lengste serien')
})

test('longest er aldri lavere enn current', () => {
  const qs = series(7)
  for (const spilt of [[], ['q6'], ['q5', 'q6'], ids(qs), ['q0', 'q2', 'q4', 'q6']]) {
    const res = computeParticipationStreak(qs, spilt)
    assert.ok(res.longest >= res.current, `longest ${res.longest} < current ${res.current}`)
  }
})

// ── MUTASJONSBEVIS 2: en uke UTEN quiz bryter ikke rekken ───────────────────

test('en uke uten quiz bryter ikke rekken — nevneren er quizer, ikke kalenderuker', () => {
  // Uke 2 gikk ingen quiz. Populasjonen inneholder derfor bare tre rader, og
  // spilleren var med på alle tre.
  const qs = [quiz(0), quiz(1), quiz(3)]

  const res = computeParticipationStreak(qs, ids(qs))

  assert.deepEqual(res, { current: 3, longest: 3 })
})

test('kontroll: kalendertolkningen ville gitt et annet svar', () => {
  // Uten denne kontrollen kunne testen over passert selv om avstanden mellom
  // quizene var én uke — og da ville den ikke bevist noe om hopp i kadensen.
  const qs = [quiz(0), quiz(1), quiz(3)]
  const spennUker =
    (Date.parse(qs[2].opensAt) - Date.parse(qs[0].opensAt)) / (7 * 24 * 60 * 60 * 1000)

  assert.equal(spennUker, 3, 'fixturen må faktisk hoppe over en uke')
  assert.notEqual(
    computeParticipationStreak(qs, ids(qs)).current,
    qs.length - 1,
    'en implementasjon som talte kalenderuker ville brutt rekken her',
  )
})

test('flere ukers pause i kadensen bryter ikke rekken', () => {
  // Sommerpause: quiz uke 0 og 1, så ingenting før uke 8.
  const qs = [quiz(0), quiz(1), quiz(8), quiz(9)]
  assert.deepEqual(computeParticipationStreak(qs, ids(qs)), { current: 4, longest: 4 })
})

// ── Brutt rekke ─────────────────────────────────────────────────────────────

test('spilte før, men ikke siste gjorte opp quiz → current 0, longest bevart', () => {
  const qs = series(7)
  const res = computeParticipationStreak(qs, ['q0', 'q1', 'q2', 'q3', 'q4'])

  assert.equal(res.current, 0, 'rekken er brutt når siste gjorte opp quiz mangler')
  assert.equal(res.longest, 5, 'rekorden står selv om rekken er brutt')
})

test('to gjorte opp quizer på slutten uten deltakelse gir også 0, ikke negativt', () => {
  const qs = series(7)
  const res = computeParticipationStreak(qs, ['q0', 'q1'])
  assert.deepEqual(res, { current: 0, longest: 2 })
})

// ── Åpen, ikke gjort opp quiz — asymmetrien ─────────────────────────────────

test('en ÅPEN quiz spilleren nettopp har spilt teller med én gang', () => {
  const qs = [...series(7), quiz(7, false)] // kveldens quiz, ikke gjort opp

  const res = computeParticipationStreak(qs, [...ids(series(7)), 'q7'])

  assert.equal(res.current, 8, 'rekken skal telle opp så snart svaret er levert')
  assert.equal(res.longest, 8)
})

test('en ÅPEN quiz spilleren IKKE har spilt bryter ikke rekken', () => {
  const qs = [...series(7), quiz(7, false)]

  const res = computeParticipationStreak(qs, ids(series(7)))

  assert.equal(res.current, 7, 'rekken skal ikke falle før quizen faktisk er gjort opp')
  assert.equal(res.longest, 7)
})

test('samme quiz bryter rekken så snart den ER gjort opp', () => {
  // Nøyaktig samme deltakelse som testen over, kun `settled` er endret. Det
  // isolerer at det er OPPGJØRET, ikke deltakelsen, som avgjør.
  const spilt = ids(series(7))

  const åpen = computeParticipationStreak([...series(7), quiz(7, false)], spilt)
  const gjortOpp = computeParticipationStreak([...series(7), quiz(7, true)], spilt)

  assert.equal(åpen.current, 7)
  assert.equal(gjortOpp.current, 0, 'en gjort opp quiz uten deltakelse skal bryte rekken')
  assert.equal(gjortOpp.longest, 7, 'rekorden overlever bruddet')
})

test('en avlyst quiz — åpnet, aldri gjort opp — er transparent for alle', () => {
  // q3 ble åpnet, men aldri gjort opp. Ingen spilte den. Den skal ikke ligge
  // igjen som et permanent brudd i alles historikk.
  const qs = [quiz(0), quiz(1), quiz(2), quiz(3, false), quiz(4), quiz(5)]
  const spilt = ['q0', 'q1', 'q2', 'q4', 'q5']

  assert.deepEqual(computeParticipationStreak(qs, spilt), { current: 5, longest: 5 })
})

// ── Robusthet i inndata ─────────────────────────────────────────────────────

test('duplikate quiz-id-er i deltakelsen teller én gang', () => {
  // Det finnes ingen unique-constraint på (user_id, quiz_id) i attempts — per
  // 2. august 2026 har ingen faktisk to innsendte forsøk på samme quiz, men
  // funksjonen skal ikke være det som brekker den dagen det skjer.
  const qs = series(3)
  assert.deepEqual(
    computeParticipationStreak(qs, ['q0', 'q0', 'q1', 'q1', 'q1', 'q2']),
    { current: 3, longest: 3 },
  )
})

test('deltakelse på en quiz som ikke er i populasjonen ignoreres', () => {
  // F.eks. en testquiz eller en org-quiz som ikke er del av fredagsserien.
  const qs = series(3)
  const res = computeParticipationStreak(qs, ['q0', 'q1', 'q2', 'testquiz', 'org-quiz'])

  assert.deepEqual(res, { current: 3, longest: 3 })
})

test('kun deltakelse utenfor populasjonen → 0', () => {
  assert.deepEqual(
    computeParticipationStreak(series(3), ['testquiz']),
    { current: 0, longest: 0 },
  )
})
