// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCategoryStats, UNCATEGORIZED_LABEL } from './category-stats'

type A = { questionId: string; isCorrect: boolean }
type Q = { id: string; category: string | null }

function q(id: string, category: string | null): Q {
  return { id, category }
}

function sumTotal(stats: { total: number }[]): number {
  return stats.reduce((s, r) => s + r.total, 0)
}

// ── Invarianten (QK_4 punkt 12): summen går alltid opp ──────────────────────

test('svar uten kategori havner i «Uten kategori» — summen er antall besvarte', () => {
  const questions = [q('a', 'Historie'), q('b', 'Historie'), q('c', null), q('d', 'Sport')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: true },
    { questionId: 'd', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(sumTotal(stats), answers.length)
  const uncat = stats.find(r => r.category === UNCATEGORIZED_LABEL)
  assert.ok(uncat, 'mangler «Uten kategori»-raden')
  assert.deepEqual(uncat, { category: UNCATEGORIZED_LABEL, correct: 1, total: 1 })
})

test('whitespace-kategori og ukjent questionId regnes også som uten kategori', () => {
  const questions = [q('a', 'Sport'), q('b', '   '), q('c', '')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: false },
    { questionId: 'finnes-ikke', isCorrect: false },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(sumTotal(stats), answers.length)
  const uncat = stats.find(r => r.category === UNCATEGORIZED_LABEL)
  assert.deepEqual(uncat, { category: UNCATEGORIZED_LABEL, correct: 1, total: 3 })
})

test('«Uten kategori» står alltid nederst', () => {
  const questions = [q('u', null), q('a', 'Historie'), q('b', 'Sport')]
  // Det ukategoriserte svaret kommer FØRST — raden skal likevel sist.
  const answers: A[] = [
    { questionId: 'u', isCorrect: false },
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(stats[stats.length - 1].category, UNCATEGORIZED_LABEL)
})

// ── «Diverse» telles som vanlig kategori her ────────────────────────────────

test('«Diverse» får egen rad — ekskluderingen gjelder kun mellomskjerm-meldingen', () => {
  const questions = [q('a', 'Diverse'), q('b', 'Diverse'), q('c', 'Historie')]
  const answers: A[] = questions.map(x => ({ questionId: x.id, isCorrect: true }))
  const stats = computeCategoryStats(answers, questions)
  assert.equal(sumTotal(stats), answers.length)
  assert.deepEqual(
    stats.find(r => r.category === 'Diverse'),
    { category: 'Diverse', correct: 2, total: 2 }
  )
})

// ── Normalisering ───────────────────────────────────────────────────────────

test('trim- og case-varianter slås sammen til én rad', () => {
  const questions = [q('a', 'Historie '), q('b', 'historie'), q('c', 'Sport')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(stats.length, 2)
  const historie = stats.find(r => r.category.toLowerCase() === 'historie')
  assert.ok(historie)
  assert.equal(historie!.total, 2)
  assert.equal(historie!.correct, 1)
  assert.equal(historie!.category, historie!.category.trim())
})

test('rekkefølge: kategoriene kommer i første-svar-rekkefølge', () => {
  const questions = [q('a', 'Sport'), q('b', 'Historie'), q('c', 'Musikk')]
  const answers: A[] = [
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: true },
    { questionId: 'a', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.deepEqual(stats.map(r => r.category), ['Historie', 'Musikk', 'Sport'])
})

// ── Kanter ──────────────────────────────────────────────────────────────────

test('kun ukategoriserte svar → tom liste (seksjonen skjules)', () => {
  const questions = [q('a', null), q('b', '')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
  ]
  assert.deepEqual(computeCategoryStats(answers, questions), [])
})

test('ingen svar → tom liste', () => {
  assert.deepEqual(computeCategoryStats([], [q('a', 'Sport')]), [])
})

test('en reell kategori som heter «Uten kategori» slås sammen med restbøtta', () => {
  const questions = [q('a', 'Uten kategori'), q('b', null), q('c', 'Sport')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: true },
  ]
  const stats = computeCategoryStats(answers, questions)
  assert.equal(sumTotal(stats), answers.length)
  const rows = stats.filter(r => r.category.toLowerCase() === 'uten kategori')
  assert.equal(rows.length, 1, 'to «Uten kategori»-rader')
  assert.equal(rows[0].total, 2)
  assert.equal(rows[0].correct, 1)
})

// ── pickCategoryStrength — sterkeste/svakeste på tvers av all historikk ──────

import {
  pickCategoryStrength,
  STRENGTH_MIN_ANSWERS,
  STRENGTH_EXCLUDED_CATEGORIES,
} from './category-stats'

function stat(category: string, correct: number, total: number) {
  return { category, correct, total }
}

// Brukes med deepEqual, ikke felt-for-felt: da fanger testene også et NYTT
// felt som ved et uhell får en verdi i tom-tilstanden.
const INGEN_STYRKE = {
  sterkeste: null, sterkesteProsent: null, sterkesteRiktige: null, sterkesteBesvart: null,
  svakeste: null, svakesteProsent: null, svakesteRiktige: null, svakesteBesvart: null,
}

test('velger høyeste og laveste andel riktige', () => {
  const s = pickCategoryStrength([
    stat('Historie', 1, 4),   // 25 %
    stat('Sport', 3, 4),      // 75 %
    stat('Musikk', 2, 4),     // 50 %
  ])
  assert.deepEqual(s, {
    sterkeste: 'Sport',    sterkesteProsent: 75, sterkesteRiktige: 3, sterkesteBesvart: 4,
    svakeste: 'Historie',  svakesteProsent: 25,  svakesteRiktige: 1,  svakesteBesvart: 4,
  })
})

test('andel — ikke antall riktige — avgjør', () => {
  // Historie har FLEST riktige, men dårligst andel.
  const s = pickCategoryStrength([
    stat('Historie', 5, 20),  // 25 %
    stat('Sport', 3, 4),      // 75 %
  ])
  assert.equal(s.sterkeste, 'Sport')
  assert.equal(s.svakeste, 'Historie')
})

// ── MUTASJONSBEVIS: terskelen ───────────────────────────────────────────────

test('kategori under terskelen kan ikke bli svakeste', () => {
  // Kunst 0/1 = 0 % er den svakeste på papiret, men hviler på ett svar.
  const s = pickCategoryStrength([
    stat('Kunst & Kultur', 0, 1),
    stat('Historie', 1, 4),
    stat('Sport', 3, 4),
  ])
  assert.equal(s.svakeste, 'Historie', 'ett enkelt svar ble valgt som svakeste')
  assert.equal(s.sterkeste, 'Sport')
})

test('kategori under terskelen kan ikke bli sterkeste', () => {
  const s = pickCategoryStrength([
    stat('Kunst & Kultur', 2, 2),  // 100 %, men bare 2 svar
    stat('Historie', 1, 4),
    stat('Sport', 3, 4),           // 75 %
  ])
  assert.equal(s.sterkeste, 'Sport', 'to svar ble valgt som sterkeste')
})

test('terskelen er inklusiv — nøyaktig STRENGTH_MIN_ANSWERS teller med', () => {
  const s = pickCategoryStrength([
    stat('Kunst & Kultur', 3, STRENGTH_MIN_ANSWERS),
    stat('Historie', 1, 4),
  ])
  assert.equal(s.sterkeste, 'Kunst & Kultur')
})

test('ingen kategori når terskelen → BEGGE null, ikke en tilfeldig kategori', () => {
  const s = pickCategoryStrength([
    stat('Sport', 2, 2),
    stat('Historie', 0, 1),
    stat('Musikk', 1, 1),
  ])
  assert.deepEqual(s, INGEN_STYRKE)
})

test('kun ÉN kvalifisert kategori → begge null (sterkest/svakest krever sammenligning)', () => {
  const s = pickCategoryStrength([
    stat('Sport', 3, 5),
    stat('Historie', 1, 2),
  ])
  assert.deepEqual(s, INGEN_STYRKE)
})

test('tom liste → begge null', () => {
  assert.deepEqual(pickCategoryStrength([]), INGEN_STYRKE)
})

// ── MUTASJONSBEVIS: «Uten kategori» ─────────────────────────────────────────

test('«Uten kategori» kan ikke bli sterkeste selv med 100 % og mange svar', () => {
  const s = pickCategoryStrength([
    stat(UNCATEGORIZED_LABEL, 40, 40),
    stat('Sport', 3, 4),
    stat('Historie', 1, 4),
  ])
  assert.equal(s.sterkeste, 'Sport')
  assert.notEqual(s.sterkeste, UNCATEGORIZED_LABEL)
})

test('«Uten kategori» kan ikke bli svakeste selv med 0 % og mange svar', () => {
  const s = pickCategoryStrength([
    stat(UNCATEGORIZED_LABEL, 0, 40),
    stat('Sport', 3, 4),
    stat('Historie', 1, 4),
  ])
  assert.equal(s.svakeste, 'Historie')
  assert.notEqual(s.svakeste, UNCATEGORIZED_LABEL)
})

test('«Uten kategori» teller ikke som den andre kategorien i to-kravet', () => {
  // Kun Sport er en ekte kategori — «Uten kategori» skal ikke fylle plassen.
  const s = pickCategoryStrength([
    stat(UNCATEGORIZED_LABEL, 10, 20),
    stat('Sport', 3, 4),
  ])
  assert.deepEqual(s, INGEN_STYRKE)
})

// ── MUTASJONSBEVIS: Diverse ─────────────────────────────────────────────────

test('Diverse ekskluderes fra begge ender', () => {
  const s = pickCategoryStrength([
    stat('Diverse', 20, 20),   // beste andel
    stat('Sport', 3, 4),
    stat('Historie', 1, 4),
  ])
  assert.equal(s.sterkeste, 'Sport')
  const s2 = pickCategoryStrength([
    stat('Diverse', 0, 20),    // dårligste andel
    stat('Sport', 3, 4),
    stat('Historie', 1, 4),
  ])
  assert.equal(s2.svakeste, 'Historie')
})

test('Diverse matches trimmet og case-insensitivt', () => {
  for (const variant of ['diverse', ' Diverse ', 'DIVERSE']) {
    const s = pickCategoryStrength([
      stat(variant, 20, 20),
      stat('Sport', 3, 4),
      stat('Historie', 1, 4),
    ])
    assert.equal(s.sterkeste, 'Sport', `«${variant}» slapp gjennom`)
  }
})

test('STRENGTH_EXCLUDED_CATEGORIES er lista som faktisk brukes', () => {
  // Beviser at konstanten ikke bare er dekorasjon: en tom overstyring slipper
  // Diverse inn igjen.
  assert.ok(STRENGTH_EXCLUDED_CATEGORIES.includes('diverse'))
  const s = pickCategoryStrength(
    [stat('Diverse', 20, 20), stat('Sport', 3, 4), stat('Historie', 1, 4)],
    { excluded: [] },
  )
  assert.equal(s.sterkeste, 'Diverse')
})

// ── Determinisme ────────────────────────────────────────────────────────────

test('uavgjort andel brytes av flest svar, deretter navn — og er stabil', () => {
  const stats = [
    stat('Sport', 2, 4),      // 50 %, 4 svar
    stat('Musikk', 4, 8),     // 50 %, 8 svar  ← mest belegg
    stat('Historie', 1, 4),   // 25 %
  ]
  const a = pickCategoryStrength(stats)
  const b = pickCategoryStrength([...stats].reverse())
  assert.equal(a.sterkeste, 'Musikk')
  assert.deepEqual(a, b, 'resultatet avhenger av inn-rekkefølgen')
})

test('helt lik andel og likt antall brytes alfabetisk i BEGGE ender', () => {
  const stats = [stat('Sport', 2, 4), stat('Historie', 2, 4), stat('Musikk', 2, 4)]
  const s = pickCategoryStrength(stats)
  assert.equal(s.sterkeste, 'Historie')
  assert.equal(s.svakeste, 'Historie')
  // Samme rad i begge ender er riktig her: alle tre er identiske, så det
  // finnes ingen reell forskjell å vise. Kalleren avgjør om den vil vise noe.
  assert.deepEqual(pickCategoryStrength([...stats].reverse()), s)
})

test('sterkeste og svakeste er aldri samme kategori når andelene faktisk skiller', () => {
  const s = pickCategoryStrength([stat('Sport', 3, 4), stat('Historie', 1, 4)])
  assert.notEqual(s.sterkeste, s.svakeste)
})

// ── Prosent riktige per kategori ────────────────────────────────────────────

test('prosenten hører til kategorien som faktisk ble valgt', () => {
  const s = pickCategoryStrength([
    stat('Historie', 1, 4),   // 25 %
    stat('Sport', 3, 4),      // 75 %
    stat('Musikk', 2, 4),     // 50 %
  ])
  assert.equal(s.sterkesteProsent, 75)
  assert.equal(s.svakesteProsent, 25)
})

test('prosenten er andel av BESVARTE i kategorien, ikke av alle svar', () => {
  // Historie har flest riktige (5) av 34 svar totalt, men 5/20 = 25 %.
  const s = pickCategoryStrength([
    stat('Historie', 5, 20),
    stat('Sport', 3, 4),
    stat('Musikk', 5, 10),
  ])
  assert.equal(s.svakesteProsent, 25, 'nevneren var ikke kategoriens egne svar')
  assert.equal(s.sterkesteProsent, 75)
})

test('prosenten avrundes med Math.round, som resten av /historikk', () => {
  const s = pickCategoryStrength([stat('Sport', 2, 3), stat('Historie', 1, 3)])
  assert.equal(s.sterkesteProsent, 67)  // 66,67 →  67
  assert.equal(s.svakesteProsent, 33)   // 33,33 →  33
})

// ── MUTASJONSBEVIS: prosenten følger utvalget, ikke rådataene ───────────────
// Uten disse ville en implementasjon som regner prosent FØR filtreringen —
// eller som slår opp kategorinavnet på nytt i den ufiltrerte lista — bestått
// alle testene over.

test('en ekskludert kategori gir ikke prosenten sin til den valgte', () => {
  const s = pickCategoryStrength([
    stat('Diverse', 20, 20),   // 100 %, men ekskludert
    stat('Sport', 3, 4),       // 75 %  ← faktisk sterkeste
    stat('Historie', 0, 4),    // 0 %   ← faktisk svakeste
  ])
  assert.equal(s.sterkeste, 'Sport')
  assert.equal(s.sterkesteProsent, 75, 'Diverse sin andel lekket inn i tallet')
  assert.equal(s.svakesteProsent, 0)
})

test('en kategori under terskelen gir ikke prosenten sin til den valgte', () => {
  const s = pickCategoryStrength([
    stat('Kunst & Kultur', 0, 1),  // 0 %, under terskel
    stat('Historie', 1, 4),        // 25 % ← faktisk svakeste
    stat('Sport', 3, 4),
  ])
  assert.equal(s.svakeste, 'Historie')
  assert.equal(s.svakesteProsent, 25, 'et enkeltsvar under terskelen satte tallet')
})

test('0 % er et ekte tall her, ikke fravær av tall', () => {
  // En kategori der brukeren har svart feil på alt skal vise 0, ikke skjules
  // som om den manglet data — nullen er hele poenget med «svakeste».
  const s = pickCategoryStrength([stat('Historie', 0, 4), stat('Sport', 3, 4)])
  assert.equal(s.svakesteProsent, 0)
  assert.notEqual(s.svakesteProsent, null)
})

test('prosent og kategori er null sammen — aldri én av dem alene', () => {
  // Invarianten UI-et hviler på: /historikk viser kortene kun når kategorien
  // finnes, og antar da at tallet også gjør det.
  const cases = [
    pickCategoryStrength([]),
    pickCategoryStrength([stat('Sport', 3, 4)]),                    // kun én kvalifisert
    pickCategoryStrength([stat('Sport', 2, 2), stat('Historie', 1, 1)]), // ingen når terskel
    pickCategoryStrength([stat(UNCATEGORIZED_LABEL, 10, 20), stat('Sport', 3, 4)]),
    pickCategoryStrength([stat('Historie', 1, 4), stat('Sport', 3, 4)]),  // begge finnes
  ]
  for (const s of cases) {
    for (const felt of ['Prosent', 'Riktige', 'Besvart'] as const) {
      assert.equal(
        s.sterkeste === null, s[`sterkeste${felt}`] === null,
        `sterkeste og sterkeste${felt} stod fra hverandre`,
      )
      assert.equal(
        s.svakeste === null, s[`svakeste${felt}`] === null,
        `svakeste og svakeste${felt} stod fra hverandre`,
      )
    }
  }
})

test('råtallene hører til den valgte kategorien, og skiller 3/3 fra 11/11', () => {
  // Begge er 100 %. Uten egne råtall ville UI-et ikke kunne vise forskjell på
  // en kategori som hviler på 3 svar og en som hviler på 11 — nettopp
  // forskjellen tallene ble lagt til for å vise. Målt mot prod 4. august 2026
  // er dette ikke et konstruert tilfelle: Carlos Medellín har Film & TV 11/11
  // og Kunst & Kultur 3/3 samtidig.
  const s = pickCategoryStrength([
    stat('Film & TV', 11, 11),
    stat('Kunst & Kultur', 3, 3),
    stat('Geografi', 10, 17),
  ])
  assert.equal(s.sterkeste, 'Film & TV', 'flest svar skal vinne uavgjort')
  assert.equal(s.sterkesteProsent, 100)
  assert.equal(s.sterkesteRiktige, 11)
  assert.equal(s.sterkesteBesvart, 11, 'råtallene kom fra feil kategori')

  assert.equal(s.svakeste, 'Geografi')
  assert.equal(s.svakesteRiktige, 10)
  assert.equal(s.svakesteBesvart, 17)
})

test('råtallene er kategoriens egne, ikke summen over alle kategorier', () => {
  const s = pickCategoryStrength([stat('Sport', 3, 4), stat('Historie', 1, 4)])
  assert.equal(s.sterkesteBesvart, 4, 'nevneren var totalen over alle kategorier')
  assert.equal(s.svakesteBesvart, 4)
  assert.equal(s.sterkesteRiktige! + s.svakesteRiktige!, 4)
})
