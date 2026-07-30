// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectQuizMessage,
  computeTopCategory,
  STREAK_MESSAGE_THRESHOLD,
  CATEGORY_MESSAGE_THRESHOLD,
} from './select-quiz-message'
import type { QuizMessageState } from './select-quiz-message'
import { quizMessages } from './quiz-messages'
import type { QuizMessageCategory, QuizMessage } from './quiz-messages'

const SEED = 'attempt-abc:5'

// Basistilstand som IKKE treffer noen gren over default: 4 besvarte av 15
// (ikke halvtid=7, remaining 11 > 3), 1 riktig (ikke perfekt), ingen
// streak/feilrekke, ingen rival, ingen kategori → generic.
function state(over: Partial<QuizMessageState> = {}): QuizMessageState {
  return {
    streak: 0,
    wrongInARow: 0,
    correctSoFar: 1,
    totalQuestions: 15,
    questionIndex: 3,
    rival: null,
    topCategory: null,
    ...over,
  }
}

// Matcher en faktisk melding mot en mal der plassholdere ({streak} osv.) er
// wildcards. Brukes til å avgjøre hvilken KATEGORI en returnert melding kom fra.
function matchesTemplate(template: string | null, actual: string | null): boolean {
  if (template === null || actual === null) return template === actual
  const re = new RegExp(
    '^' +
      template
        .replace(/[.*+?^${}()|[\]\\]/g, m => '\\' + m)
        .replace(/\\\{\w+\\\}/g, '.+') +
      '$'
  )
  return re.test(actual)
}

function categoryOf(msg: QuizMessage): QuizMessageCategory | null {
  for (const [cat, msgs] of Object.entries(quizMessages) as [QuizMessageCategory, QuizMessage[]][]) {
    if (msgs.some(m => matchesTemplate(m.headline, msg.headline) && matchesTemplate(m.subline, msg.subline))) {
      return cat
    }
  }
  return null
}

function assertCategory(s: QuizMessageState, expected: QuizMessageCategory, seed = SEED) {
  const msg = selectQuizMessage(s, seed)
  assert.equal(categoryOf(msg), expected, `forventet ${expected}, fikk: «${msg.headline}»`)
}

// Sanity for categoryOf selv: ingen tekst må kunne matche to kategorier,
// ellers er alle kategori-assertions under upålitelige.
test('ingen headline+subline er tvetydig på tvers av kategorier', () => {
  for (const [cat, msgs] of Object.entries(quizMessages) as [QuizMessageCategory, QuizMessage[]][]) {
    for (const m of msgs) {
      const hits = (Object.entries(quizMessages) as [QuizMessageCategory, QuizMessage[]][])
        .filter(([, other]) => other.some(o => matchesTemplate(o.headline, m.headline) && matchesTemplate(o.subline, m.subline)))
        .map(([c]) => c)
      assert.deepEqual(hits, [cat], `«${m.headline}» matcher ${hits.join(', ')}`)
    }
  }
})

// ── Regresjonen som utløste økten: perfect_run skal være NÅBAR ──────────────

test('perfect_run er nåbar selv med streak >= 5 (fram til 30. juli vant streak alltid)', () => {
  // 5 riktige av 5 besvarte — perfekt rekke OG streak 5. perfect_run skal vinne.
  assertCategory(state({ streak: 5, correctSoFar: 5, questionIndex: 4 }), 'perfect_run')
})

test('perfect_run på spørsmål 2', () => {
  assertCategory(state({ streak: 2, correctSoFar: 2, questionIndex: 1 }), 'perfect_run')
})

test('perfect_run krever minst 2 besvarte', () => {
  // 1 av 1 riktig på første spørsmål — ikke perfect_run (og heller ingen annen
  // gren) → generic. (totalQuestions 15: questionIndex 0 er heller ikke halvtid.)
  assertCategory(state({ streak: 1, correctSoFar: 1, questionIndex: 0 }), 'generic')
})

// ── Prioritetskjeden — hver gren velges når den skal, og ikke ellers ────────

test('halftime slår final_push-lignende tilstander og alt under seg', () => {
  // Q7 av 15, med både feilrekke, rival og kategori satt — halvtid vinner.
  assertCategory(
    state({ questionIndex: 6, correctSoFar: 3, wrongInARow: 2, rival: { name: 'Kari' }, topCategory: 'Historie' }),
    'halftime'
  )
})

test('perfect_run slår halftime', () => {
  assertCategory(state({ streak: 7, correctSoFar: 7, questionIndex: 6 }), 'perfect_run')
})

test('final_push ved 3 igjen, også med streak og kategori', () => {
  // Q12 av 15 → 3 igjen. Ikke perfekt (1 feil underveis).
  assertCategory(
    state({ questionIndex: 11, correctSoFar: 11, streak: 6, topCategory: 'Sport' }),
    'final_push'
  )
})

test('final_push ikke ved 4 igjen', () => {
  assertCategory(state({ questionIndex: 10, correctSoFar: 5 }), 'generic')
})

test('comeback ved 2 feil på rad — slår streak/after_wrong/kategori', () => {
  assertCategory(state({ wrongInARow: 2, topCategory: 'Musikk' }), 'comeback')
})

test('comeback er IKKE default lenger', () => {
  // Basistilstanden (1 riktig, 1 feil bak seg, ingen rekker) ga før 30. juli
  // «Du kan snu dette» — nå skal den gi generic.
  assertCategory(state(), 'generic')
})

test('streak ved terskelen 5, ikke ved 4', () => {
  // Streak 5 med en tidligere feil (ikke perfekt): Q9 av 15, 5 riktige.
  assertCategory(state({ streak: STREAK_MESSAGE_THRESHOLD, correctSoFar: 5, questionIndex: 8 }), 'streak')
  assertCategory(state({ streak: 4, correctSoFar: 4, questionIndex: 8 }), 'generic')
})

test('streak-melding inneholder faktisk streak-tallet der {streak} brukes', () => {
  // Alle tre streak-tekster bruker {streak} — verifiser utfyllingen.
  const msg = selectQuizMessage(state({ streak: 6, correctSoFar: 6, questionIndex: 8 }), SEED)
  assert.ok(msg.headline.includes('6') || (msg.subline ?? '').includes('6'), `mangler tallet: «${msg.headline}» / «${msg.subline}»`)
})

test('after_wrong ved nøyaktig 1 feil sist — ikke ved 0, ikke ved 2', () => {
  assertCategory(state({ wrongInARow: 1, topCategory: 'Historie' }), 'after_wrong')
  assertCategory(state({ wrongInARow: 0 }), 'generic')
  assertCategory(state({ wrongInARow: 2 }), 'comeback')
})

test('category når topCategory er satt, faller stille gjennom ved null', () => {
  assertCategory(state({ topCategory: 'Historie' }), 'category')
  const msg = selectQuizMessage(state({ topCategory: 'Historie' }), SEED)
  assert.ok(
    msg.headline.includes('Historie') || (msg.subline ?? '').includes('Historie'),
    `kategorinavnet mangler: «${msg.headline}»`
  )
  assertCategory(state({ topCategory: null, rival: { name: 'Kari' } }), 'rival_intro')
})

test('category slår rival_intro', () => {
  assertCategory(state({ topCategory: 'Sport', rival: { name: 'Kari' } }), 'category')
})

test('generic er default', () => {
  assertCategory(state(), 'generic')
})

// ── Halvtid ved ulike quizlengder ───────────────────────────────────────────

test('halvtid treffer riktig spørsmål ved 15, 14, 10 og 3 spørsmål', () => {
  // floor(total/2) besvarte. Ikke-perfekt score så perfect_run ikke skygger.
  const cases: [number, number][] = [
    [15, 6], // etter Q7
    [14, 6], // etter Q7
    [10, 4], // etter Q5
  ]
  for (const [total, qi] of cases) {
    assertCategory(state({ totalQuestions: total, questionIndex: qi, correctSoFar: 1 }), 'halftime')
    // Nabospørsmålene er IKKE halvtid (naboen kan treffe andre grener, men
    // aldri halftime — sjekk eksplisitt).
    for (const other of [qi - 1, qi + 1]) {
      const msg = selectQuizMessage(state({ totalQuestions: total, questionIndex: other, correctSoFar: 1 }), SEED)
      assert.notEqual(categoryOf(msg), 'halftime', `total=${total}, qi=${other} ga halftime`)
    }
  }
  // 3 spørsmål: floor(3/2)=1 → etter Q1. perfect_run krever >= 2 besvarte, så
  // selv 1 av 1 riktig gir halvtid her.
  assertCategory(state({ totalQuestions: 3, questionIndex: 0, correctSoFar: 1, streak: 1 }), 'halftime')
})

test('halvtid vises aldri etter siste spørsmål (remaining > 0-vakten)', () => {
  // 2 spørsmål: floor(2/2)=1 → etter Q1 med 1 igjen — OK at den treffer.
  // 1 spørsmål: floor(1/2)=0 → kan aldri treffe (0 besvarte finnes ikke her).
  assertCategory(state({ totalQuestions: 2, questionIndex: 0, correctSoFar: 0, wrongInARow: 1 }), 'halftime')
})

test('halvtid er uavhengig av persentildata', () => {
  // QuizMessageState har ikke lenger noe persentilfelt — dette låser at
  // halvtidsvalget kun avhenger av posisjon i quizen. (Kompilerer typen, og
  // samme resultat uansett øvrig tilstand.)
  const keys = Object.keys(state()) as (keyof QuizMessageState)[]
  assert.ok(!keys.includes('scoreIsAboveMedian' as keyof QuizMessageState))
  assertCategory(state({ questionIndex: 6, correctSoFar: 0, wrongInARow: 7 }), 'halftime')
  assertCategory(state({ questionIndex: 6, correctSoFar: 6, streak: 6 }), 'halftime')
})

// ── Seed-determinisme ───────────────────────────────────────────────────────

test('samme seed gir identisk tekst over 50 kall', () => {
  const s = state({ topCategory: 'Historie' })
  const first = selectQuizMessage(s, 'attempt-x:7')
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(selectQuizMessage(s, 'attempt-x:7'), first)
  }
})

test('ulike questionIndex i seeden gir variasjon i valgt tekst', () => {
  // Samme gren (generic) over 15 ulike seeds — minst to ulike tekster.
  // Deterministisk: feiler denne, har seed-avledningen kollapset.
  const seen = new Set<string>()
  for (let qi = 0; qi < 15; qi++) {
    seen.add(selectQuizMessage(state(), `attempt-x:${qi}`).headline)
  }
  assert.ok(seen.size >= 2, `alle 15 seeds ga samme tekst: ${[...seen]}`)
})

test('ulik attemptId i seeden gir variasjon i valgt tekst', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 15; i++) {
    seen.add(selectQuizMessage(state(), `attempt-${i}:3`).headline)
  }
  assert.ok(seen.size >= 2)
})

// ── Plassholder-robusthet ───────────────────────────────────────────────────
// En plassholder som ikke fylles i sin egen gren vises som RÅ TEKST til
// spilleren («{n}»). Denne testen speiler fill-kallene i selectQuizMessage —
// utvides en gren med nye variabler, må mappen her utvides tilsvarende.

const ALLOWED_PLACEHOLDERS: Record<QuizMessageCategory, string[]> = {
  perfect_run: [],
  halftime: [],
  final_push: ['remaining'],
  comeback: [],
  streak: ['streak'],
  after_wrong: [],
  category: ['category'],
  rival_intro: ['rivalName'],
  generic: [],
}

test('alle tekster bruker kun plassholdere som fylles i sin egen gren', () => {
  for (const [cat, msgs] of Object.entries(quizMessages) as [QuizMessageCategory, QuizMessage[]][]) {
    const allowed = ALLOWED_PLACEHOLDERS[cat]
    assert.ok(allowed !== undefined, `kategori ${cat} mangler i ALLOWED_PLACEHOLDERS`)
    for (const m of msgs) {
      const found = [...`${m.headline} ${m.subline ?? ''}`.matchAll(/\{(\w+)\}/g)].map(x => x[1])
      for (const key of found) {
        assert.ok(
          allowed.includes(key),
          `«${m.headline}» (${cat}) bruker {${key}}, som ikke fylles i den grenen`
        )
      }
    }
  }
})

test('{percent} finnes ikke lenger i noen tekst', () => {
  const all = JSON.stringify(quizMessages)
  assert.ok(!all.includes('{percent}'))
})

// ── computeTopCategory ──────────────────────────────────────────────────────

type A = { questionId: string; isCorrect: boolean }
type Q = { id: string; category: string | null }

function q(id: string, category: string | null): Q {
  return { id, category }
}

test('terskel: 2 riktige i samme kategori gir null, 3 gir kategorien', () => {
  const questions = [q('a', 'Historie'), q('b', 'Historie'), q('c', 'Historie'), q('d', 'Sport')]
  const two: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: false },
    { questionId: 'd', isCorrect: true },
  ]
  assert.equal(computeTopCategory(two, questions), null)
  const three: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: true },
  ]
  assert.equal(computeTopCategory(three, questions), 'Historie')
  assert.equal(CATEGORY_MESSAGE_THRESHOLD, 3)
})

test('«Diverse» er ekskludert — uansett casing og whitespace, uansett antall', () => {
  for (const variant of ['Diverse', 'diverse', ' DIVERSE ', 'Diverse ']) {
    const questions = ['a', 'b', 'c', 'd', 'e'].map(id => q(id, variant))
    const answers: A[] = questions.map(x => ({ questionId: x.id, isCorrect: true }))
    assert.equal(computeTopCategory(answers, questions), null, `variant «${variant}» slapp gjennom`)
  }
})

test('kategori uten verdi (null/tom/whitespace) teller ikke', () => {
  const questions = [q('a', null), q('b', ''), q('c', '   '), q('d', 'Sport')]
  const answers: A[] = questions.map(x => ({ questionId: x.id, isCorrect: true }))
  assert.equal(computeTopCategory(answers, questions), null)
})

test('case-varianter av samme kategori teller sammen, trimmet form returneres', () => {
  const questions = [q('a', 'Historie '), q('b', 'historie'), q('c', 'HISTORIE')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: true },
  ]
  const result = computeTopCategory(answers, questions)
  assert.ok(result !== null)
  assert.equal(result!.toLowerCase(), 'historie')
  assert.equal(result, result!.trim())
})

test('kun riktige svar teller', () => {
  const questions = [q('a', 'Musikk'), q('b', 'Musikk'), q('c', 'Musikk')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: true },
  ]
  assert.equal(computeTopCategory(answers, questions), null)
})

test('svar på spørsmål som ikke finnes i questions (hull) ignoreres', () => {
  const questions: (Q | undefined)[] = [q('a', 'Sport'), undefined, q('c', 'Sport')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'ukjent', isCorrect: true },
    { questionId: 'c', isCorrect: true },
  ]
  assert.equal(computeTopCategory(answers, questions), null)
})

test('flest riktige vinner uten tie-break når antallet er ulikt', () => {
  const questions = [
    q('h1', 'Historie'), q('h2', 'Historie'), q('h3', 'Historie'),
    q('s1', 'Sport'), q('s2', 'Sport'), q('s3', 'Sport'), q('s4', 'Sport'),
  ]
  const answers: A[] = questions.map(x => ({ questionId: x.id, isCorrect: true }))
  assert.equal(computeTopCategory(answers, questions), 'Sport')
})

test('tie-break: kategorien til det SISTE riktige svaret blant de uavgjorte vinner', () => {
  const questions = [
    q('h1', 'Historie'), q('h2', 'Historie'), q('h3', 'Historie'),
    q('s1', 'Sport'), q('s2', 'Sport'), q('s3', 'Sport'),
  ]
  // 3–3. Siste riktige er Sport → Sport vinner.
  const sportSist: A[] = [
    { questionId: 'h1', isCorrect: true },
    { questionId: 's1', isCorrect: true },
    { questionId: 'h2', isCorrect: true },
    { questionId: 's2', isCorrect: true },
    { questionId: 'h3', isCorrect: true },
    { questionId: 's3', isCorrect: true },
  ]
  assert.equal(computeTopCategory(sportSist, questions), 'Sport')
  // Samme svar, omstokket så Historie kommer sist → Historie vinner.
  // (Alfabetisk hadde gitt Historie i BEGGE tilfeller — rekkefølgen må avgjøre.)
  const historieSist = [...sportSist.slice(0, 4), sportSist[5], sportSist[4]]
  assert.equal(computeTopCategory(historieSist, questions), 'Historie')
})

test('tie-break hopper over feilsvar på slutten', () => {
  const questions = [
    q('h1', 'Historie'), q('h2', 'Historie'), q('h3', 'Historie'),
    q('s1', 'Sport'), q('s2', 'Sport'), q('s3', 'Sport'),
    q('x', 'Musikk'),
  ]
  const answers: A[] = [
    { questionId: 's1', isCorrect: true },
    { questionId: 'h1', isCorrect: true },
    { questionId: 's2', isCorrect: true },
    { questionId: 'h2', isCorrect: true },
    { questionId: 's3', isCorrect: true },
    { questionId: 'h3', isCorrect: true },  // siste RIKTIGE blant uavgjorte
    { questionId: 'x', isCorrect: false },  // feilsvar sist — skal hoppes over
  ]
  assert.equal(computeTopCategory(answers, questions), 'Historie')
})
