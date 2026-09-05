// Kjøres med:  npm test
//
// OPPFØRSELSTEST av decideTop10Context. Wiringen — at
// components/QuizInterlude.tsx faktisk spør predikatet og TEGNER svaret — er
// dekket av lib/top10-gap-wiring.test.ts. De to hører sammen: denne alene
// ville godtatt at kallstedet sluttet å spørre, og wiring-filen alene ville
// godtatt at predikatet svarte feil.
//
// ── BEGGE RETNINGER ─────────────────────────────────────────────────────────
// Ikke bare «ingenting når målet er uoppnåelig». Like viktig: at tallet står
// UENDRET når det faktisk er oppnåelig. En fiks som skrudde av hele linja, or
// som klamret tallet ned til antall gjenværende spørsmål, ville vært en ny
// bug i motsatt retning — den siste fordi «du trenger 2» til en som trenger 9
// er samme løgn med et penere tall.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes `needed <= questionsLeft` → «uoppnåelig gir ingenting» ryker
//     (det var nøyaktig 4. september-tilstanden).
//   • Byttes `needed <= questionsLeft` mot `<` → «gapet er akkurat lukkbart» ryker.
//   • Klamres tallet (`Math.min(needed, questionsLeft)`) → «tallet er det ekte
//     gapet, ikke et nedskalert» ryker.
//   • Fjernes `questionsLeft < MAX_QUESTIONS_LEFT_FOR_PROMISE` → «timing-regelen
//     består» ryker.
//   • Fjernes populasjonsterskelen → «for lite felt gir ingenting» ryker.
//   • Snus rekkefølgen (gap før «er jeg inne») → «inne vinner» ryker.
//   • Fjernes Number.isFinite-vakten → «manglende felt gir ingenting» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTop10Context } from './top10-gap'

const snap = (top10MinCorrect: number, totalPlayers = 67) => ({ top10MinCorrect, totalPlayers })

// ── Den observerte feilen, 4. september 2026 ────────────────────────────────

test('spørsmål 13 av 15, gap 9, to igjen → ingenting (den observerte feilen)', () => {
  // Gratiskontoen: top10MinCorrect 13, score 4, questionsLeft 2.
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 4, questionsLeft: 2 }),
    { kind: 'none' },
  )
})

test('samme øyeblikk, gap 8 → også ingenting (premiumkontoen)', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 5, questionsLeft: 2 }),
    { kind: 'none' },
  )
})

test('uoppnåelig med bare ett igjen gir ingenting, uansett hvor lite gapet er', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 11, questionsLeft: 1 }),
    { kind: 'none' },
  )
})

test('null gjenværende gir aldri et løfte — selv med gap 1', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 12, questionsLeft: 0 }),
    { kind: 'none' },
  )
})

// ── Motsatt retning: tallet skal stå uendret når det ER oppnåelig ───────────

test('gapet er akkurat lukkbart (needed === questionsLeft) → løftet står', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 11, questionsLeft: 2 }),
    { kind: 'needed', needed: 2 },
  )
})

test('gapet er mindre enn gjenværende → løftet står, med det ekte tallet', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 12, questionsLeft: 2 }),
    { kind: 'needed', needed: 1 },
  )
})

test('tallet er det EKTE gapet — det klamres aldri ned til gjenværende', () => {
  // Fangst mot en «fiks» som viser questionsLeft i stedet for gapet: da ville
  // en spiller som trenger 9 fått «du trenger 2», som er samme løgn.
  const r = decideTop10Context({ snapshot: snap(13), score: 4, questionsLeft: 2 })
  assert.equal(r.kind, 'none')
  assert.ok(!('needed' in r), 'et tall ble returnert for et uoppnåelig mål')
})

// ── Timing-regelen (uendret fra før) ────────────────────────────────────────

test('tidlig i quizen vises ingenting, selv om gapet er lukkbart', () => {
  // questionsLeft 3 => timing-regelen (< 3) stenger. Uendret oppførsel:
  // klamringen skal ikke ha utvidet når løftet vises.
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 11, questionsLeft: 3 }),
    { kind: 'none' },
  )
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 12, questionsLeft: 9 }),
    { kind: 'none' },
  )
})

// ── «Du er i topp 10 akkurat nå» — uendret gren ─────────────────────────────

test('score på terskelen → inne i topp 10', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 13, questionsLeft: 2 }),
    { kind: 'in-top10' },
  )
})

test('«inne» vinner over gap-grenen, og gjelder også tidlig i quizen', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(5), score: 9, questionsLeft: 11 }),
    { kind: 'in-top10' },
  )
})

test('terskel 0 og score 0: feltet har levert, men ingen har svart riktig', () => {
  // top10MinCorrect === 0 → andre ledd i «inne»-uttrykket avgjør. Med
  // totalPlayers >= 3 er det sant, og oppførselen er uendret fra kallstedet.
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(0), score: 0, questionsLeft: 2 }),
    { kind: 'in-top10' },
  )
})

// ── Manglende eller ugyldige inndata → ingenting, aldri et fallback-tall ────

test('ingen snapshot → ingenting', () => {
  assert.deepEqual(decideTop10Context({ snapshot: null, score: 4, questionsLeft: 2 }), { kind: 'none' })
  assert.deepEqual(decideTop10Context({ snapshot: undefined, score: 4, questionsLeft: 2 }), { kind: 'none' })
})

test('for lite felt (< 3 leverte) → ingenting', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13, 2), score: 12, questionsLeft: 2 }),
    { kind: 'none' },
  )
})

test('nyttelast uten top10MinCorrect → ingenting, ikke NaN-tilfeldigheter', () => {
  const raa = { totalPlayers: 67 } as unknown as { top10MinCorrect: number; totalPlayers: number }
  assert.deepEqual(decideTop10Context({ snapshot: raa, score: 4, questionsLeft: 2 }), { kind: 'none' })
})

test('top10MinCorrect = null gir ingenting — IKKE «du er i topp 10»', () => {
  // Den farlige varianten, og den eneste der isFinite-vakten er observerbar:
  // uten den er `score >= null` det samme som `score >= 0`, altså sant for
  // enhver score, og andre ledd er sant fordi feltet har spillere. Resultatet
  // ville vært en gullfarget «Du er i topp 10 akkurat nå» bygget på et felt
  // som ikke fantes. `undefined` faller derimot gjennom av seg selv (NaN-
  // sammenligninger er usanne) — derfor er den varianten ikke nok som bevis.
  const raa = { top10MinCorrect: null, totalPlayers: 67 } as unknown as { top10MinCorrect: number; totalPlayers: number }
  assert.deepEqual(decideTop10Context({ snapshot: raa, score: 4, questionsLeft: 2 }), { kind: 'none' })
})

test('ugyldig score eller questionsLeft → ingenting', () => {
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: NaN, questionsLeft: 2 }),
    { kind: 'none' },
  )
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 12, questionsLeft: NaN }),
    { kind: 'none' },
  )
})

test('negativ questionsLeft (ulastet totalQuestions) gir ingenting', () => {
  // totalQuestions er 0 til spørsmålene er hentet; questionIndex + 1 gjør da
  // uttrykket negativt. Før klamringen slapp dette gjennom timing-regelen.
  assert.deepEqual(
    decideTop10Context({ snapshot: snap(13), score: 4, questionsLeft: -1 }),
    { kind: 'none' },
  )
})
