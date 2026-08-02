// Kjøres med:  npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectQuizMessage,
  computeStrongCategory,
  buildWeightedPool,
  STREAK_MESSAGE_THRESHOLD,
  CATEGORY_MESSAGE_THRESHOLD,
  CATEGORY_MESSAGE_EXCLUDED,
} from './select-quiz-message'
import type { QuizMessageState } from './select-quiz-message'
import { quizMessages, categoryMessages } from './quiz-messages'
import type { QuizMessageCategory, QuizMessage } from './quiz-messages'

const SEED = 'attempt-abc:5'

// Alle tekstsett med grenen de tilhører. categoryMessages er ni separate
// lister, men de betjener ÉN gren (category) — de skal derfor ikke regnes som
// tvetydige mot hverandre eller mot fallback-settet.
const ALL_SETS: [QuizMessageCategory, QuizMessage[]][] = [
  ...(Object.entries(quizMessages) as [QuizMessageCategory, QuizMessage[]][]),
  ...Object.values(categoryMessages).map(
    msgs => ['category', msgs] as [QuizMessageCategory, QuizMessage[]]
  ),
]

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
    strongCategory: null,
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
  for (const [cat, msgs] of ALL_SETS) {
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

// Sanity for categoryOf selv: ingen tekst må kunne matche to ULIKE grener,
// ellers er alle kategori-assertions under upålitelige. (Innenfor category er
// overlapp greit — fallback-templaten «{category} sitter.» matcher med vilje
// «Musikken sitter.», og begge er samme gren.)
test('ingen headline+subline er tvetydig på tvers av grener', () => {
  for (const [cat, msgs] of ALL_SETS) {
    for (const m of msgs) {
      const hits = [
        ...new Set(
          ALL_SETS
            .filter(([, other]) => other.some(o => matchesTemplate(o.headline, m.headline) && matchesTemplate(o.subline, m.subline)))
            .map(([c]) => c)
        ),
      ]
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
    state({ questionIndex: 6, correctSoFar: 3, wrongInARow: 2, rival: { name: 'Kari' }, strongCategory: 'Historie' }),
    'halftime'
  )
})

test('perfect_run slår halftime', () => {
  assertCategory(state({ streak: 7, correctSoFar: 7, questionIndex: 6 }), 'perfect_run')
})

test('final_push ved 3 igjen, også med streak og kategori', () => {
  // Q12 av 15 → 3 igjen. Ikke perfekt (1 feil underveis).
  assertCategory(
    state({ questionIndex: 11, correctSoFar: 11, streak: 6, strongCategory: 'Sport' }),
    'final_push'
  )
})

test('final_push ikke ved 4 igjen', () => {
  assertCategory(state({ questionIndex: 10, correctSoFar: 5 }), 'generic')
})

// ── Entall i innspurten (QK_4 punkt 12) ─────────────────────────────────────

test('nøyaktig 1 igjen gir final_push_last, 2 igjen gir final_push', () => {
  // Q14 av 15 → 1 igjen. «Gi alt på de siste 1.» var grammatisk havari; ved 1
  // skal entallssettet uten {remaining} brukes.
  assertCategory(state({ questionIndex: 13, correctSoFar: 7 }), 'final_push_last')
  // Q13 av 15 → 2 igjen — flertallssettet, som før.
  assertCategory(state({ questionIndex: 12, correctSoFar: 7 }), 'final_push')
})

test('final_push_last-tekster inneholder aldri tallet 1 rått', () => {
  // Mutasjonsvern: ryker entalls-rutingen (remaining=1 inn i flertallssettet),
  // fylles «{remaining}» med 1 og teksten inneholder « 1». Entallstekstene
  // skriver «ett»/«siste» i klartekst og skal aldri ha sifferet.
  for (let qi = 0; qi < 20; qi++) {
    const msg = selectQuizMessage(
      state({ questionIndex: 13, correctSoFar: 7 }),
      `attempt-${qi}:13`
    )
    const text = `${msg.headline} ${msg.subline ?? ''}`
    assert.ok(!/\b1\b/.test(text), `sifferet 1 i entallsmelding: «${text}»`)
  }
})

test('comeback ved 2 feil på rad — slår streak/after_wrong/kategori', () => {
  assertCategory(state({ wrongInARow: 2, strongCategory: 'Musikk' }), 'comeback')
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

test('streak-melding fyller {streak} med faktisk tall når teksten bruker den', () => {
  // Ikke alle streak-tekster bruker {streak} lenger, så vi sveiper seeds:
  // hver tekst som HAR plassholderen skal få tallet, og ingen skal slippe ut rå.
  let sawNumber = false
  for (let i = 0; i < 300; i++) {
    const msg = selectQuizMessage(state({ streak: 6, correctSoFar: 6, questionIndex: 8 }), `a-${i}:8`)
    const text = `${msg.headline} ${msg.subline ?? ''}`
    assert.ok(!text.includes('{'), `rå plassholder sluppet ut: «${text}»`)
    if (text.includes('6')) sawNumber = true
  }
  assert.ok(sawNumber, 'ingen av 300 seeds traff en tekst med {streak}')
})

test('ingen gren slipper ut en rå plassholder til spilleren', () => {
  // Bredt vern: en tekst med en plassholder som ikke fylles i sin egen gren
  // vises bokstavelig som «{n}». Sveiper alle grener over mange seeds.
  const cases: Partial<QuizMessageState>[] = [
    { streak: 6, correctSoFar: 6, questionIndex: 8 },              // streak
    { correctSoFar: 5, questionIndex: 4 },                          // perfect_run
    { questionIndex: 6, correctSoFar: 1 },                          // halftime
    { questionIndex: 12, correctSoFar: 7 },                         // final_push
    { questionIndex: 13, correctSoFar: 7 },                         // final_push_last
    { wrongInARow: 2 },                                             // comeback
    { wrongInARow: 1 },                                             // after_wrong
    { strongCategory: 'Historie' },                                 // category (egen liste)
    { strongCategory: 'Ukjent Kategori' },                          // category (fallback)
    { rival: { name: 'Kari' } },                                    // rival_intro
    {},                                                             // generic
  ]
  for (const over of cases) {
    for (let i = 0; i < 60; i++) {
      const msg = selectQuizMessage(state(over), `seed-${i}:${i}`)
      const text = `${msg.headline} ${msg.subline ?? ''}`
      assert.ok(!text.includes('{') && !text.includes('}'), `rå plassholder: «${text}» (${JSON.stringify(over)})`)
    }
  }
})

test('after_wrong ved nøyaktig 1 feil sist — ikke ved 0, ikke ved 2', () => {
  assertCategory(state({ wrongInARow: 1, strongCategory: 'Historie' }), 'after_wrong')
  assertCategory(state({ wrongInARow: 0 }), 'generic')
  assertCategory(state({ wrongInARow: 2 }), 'comeback')
})

test('category når strongCategory er satt, faller stille gjennom ved null', () => {
  // Merk: teksten gjentar IKKE nødvendigvis kategorinavnet lenger. Kjente
  // kategorier har skreddersydde tekster («Du har lest deg opp.» for Historie)
  // nettopp for å slippe å skrive inn navnet — se categoryMessages. At riktig
  // liste velges dekkes av «hver kjent kategori får sine egne tekster».
  assertCategory(state({ strongCategory: 'Historie' }), 'category')
  assertCategory(state({ strongCategory: null, rival: { name: 'Kari' } }), 'rival_intro')
})

test('category slår rival_intro', () => {
  assertCategory(state({ strongCategory: 'Sport', rival: { name: 'Kari' } }), 'category')
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
  const s = state({ strongCategory: 'Historie' })
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
  final_push_last: [],
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

test('kategorienes egne tekster har navnet skrevet inn — ingen plassholdere', () => {
  // Hele poenget med per-kategori-listene: ingen {category} å fylle, og dermed
  // ingen lange kategorinavn som sprenger headline-høyden.
  for (const [cat, msgs] of Object.entries(categoryMessages)) {
    for (const m of msgs) {
      const text = `${m.headline} ${m.subline ?? ''}`
      assert.ok(!/\{\w+\}/.test(text), `«${m.headline}» (${cat}) bruker en plassholder`)
    }
  }
})

test('{percent} finnes ikke lenger i noen tekst', () => {
  const all = JSON.stringify(quizMessages) + JSON.stringify(categoryMessages)
  assert.ok(!all.includes('{percent}'))
})

// ── Vekting av Dennis' favoritter (★ → priority: true) ──────────────────────

test('buildWeightedPool gir prioriterte tekster nøyaktig to plasser', () => {
  const msgs: QuizMessage[] = [
    { headline: 'a', subline: null },
    { headline: 'b', subline: null, priority: true },
    { headline: 'c', subline: null },
    { headline: 'd', subline: null, priority: true },
  ]
  assert.deepEqual(buildWeightedPool(msgs), [0, 1, 1, 2, 3, 3])
})

test('buildWeightedPool uten prioriterte er identitet', () => {
  const msgs: QuizMessage[] = [
    { headline: 'a', subline: null },
    { headline: 'b', subline: null },
  ]
  assert.deepEqual(buildWeightedPool(msgs), [0, 1])
})

test('priority: false teller som vanlig vekt', () => {
  const msgs: QuizMessage[] = [
    { headline: 'a', subline: null, priority: false },
    { headline: 'b', subline: null, priority: true },
  ]
  assert.deepEqual(buildWeightedPool(msgs), [0, 1, 1])
})

test('prioriterte tekster velges omtrent dobbelt så ofte som vanlige', () => {
  // comeback: 14 tekster, 5 prioriterte → pool 19. Prioritert 2/19, vanlig 1/19.
  // Måler snitt-treff per prioritert mot snitt-treff per vanlig; forventet 2,0.
  // Romslig toleranse — dette er en hash-fordeling, ikke en perfekt uniform.
  const counts = new Map<string, number>()
  const N = 20000
  for (let i = 0; i < N; i++) {
    const msg = selectQuizMessage(state({ wrongInARow: 2 }), `vekt-${i}:3`)
    counts.set(msg.headline, (counts.get(msg.headline) ?? 0) + 1)
  }
  const prioritized = quizMessages.comeback.filter(m => m.priority)
  const plain = quizMessages.comeback.filter(m => !m.priority)
  assert.ok(prioritized.length >= 2 && plain.length >= 2, 'comeback må ha begge slag for at testen skal si noe')

  const avg = (msgs: QuizMessage[]) =>
    msgs.reduce((s, m) => s + (counts.get(m.headline) ?? 0), 0) / msgs.length
  const ratio = avg(prioritized) / avg(plain)
  assert.ok(
    ratio > 1.7 && ratio < 2.3,
    `forventet ~2x for prioriterte, målte ${ratio.toFixed(2)}x`
  )
})

test('vektingen bryter ikke determinismen — samme seed gir samme tekst', () => {
  // Vektingen legger til indekser i poolen; gjøres den rekkefølgen ustabil
  // (f.eks. med en shuffle), ruller teksten om under spillerens re-render.
  for (const over of [{ wrongInARow: 2 }, { streak: 6, correctSoFar: 6, questionIndex: 8 }, {}]) {
    const first = selectQuizMessage(state(over), 'stabil:9')
    for (let i = 0; i < 100; i++) {
      assert.deepEqual(selectQuizMessage(state(over), 'stabil:9'), first)
    }
  }
})

test('valgt melding lekker aldri priority-feltet ut til komponenten', () => {
  const msg = selectQuizMessage(state({ wrongInARow: 2 }), SEED)
  assert.deepEqual(Object.keys(msg).sort(), ['headline', 'subline'])
})

// ── Lengde: headline må få plass på to linjer (296px, målt 30. juli 2026) ────

test('ingen headline er lengre enn 35 tegn med verste plassholderverdi', () => {
  const worst = (s: string) =>
    s.replace(/\{streak\}/g, '15')
      .replace(/\{remaining\}/g, '3')
      .replace(/\{category\}/g, 'Vitenskap & Natur')
      .replace(/\{rivalName\}/g, 'X')
  for (const [cat, msgs] of ALL_SETS) {
    for (const m of msgs) {
      const h = worst(m.headline)
      assert.ok(h.length <= 35, `«${h}» (${cat}) er ${h.length} tegn — over taket på 35`)
    }
  }
})

test('rivalens navn står aldri i en headline', () => {
  // display_name kan være 40 tegn; i headline (28px) sprenger det høyden, i
  // subline bryter det pent.
  for (const m of quizMessages.rival_intro) {
    assert.ok(!m.headline.includes('{rivalName}'), `«${m.headline}» har navnet i headline`)
  }
})

// ── Kategorilistene ─────────────────────────────────────────────────────────

test('hver kjent kategori får sine egne tekster, ikke fallback-settet', () => {
  const known = ['Musikk', 'Sport', 'Historie', 'Geografi', 'Film & TV',
    'Mat & Drikke', 'Vitenskap & Natur', 'Kunst & Kultur', 'Politikk & Samfunn']
  for (const cat of known) {
    const own = categoryMessages[cat.toLowerCase()]
    assert.ok(own && own.length > 0, `«${cat}» mangler egen tekstliste`)
    const headlines = new Set(own.map(m => m.headline))
    for (let i = 0; i < 40; i++) {
      const msg = selectQuizMessage(state({ strongCategory: cat }), `kat-${i}:4`)
      assert.ok(headlines.has(msg.headline), `«${cat}» ga «${msg.headline}», som ikke er i dens egen liste`)
    }
  }
})

test('kategorioppslaget tåler casing og whitespace fra admin', () => {
  const own = new Set(categoryMessages['film & tv'].map(m => m.headline))
  for (const variant of ['Film & TV', 'film & tv', ' FILM & TV ', 'Film & TV ']) {
    const msg = selectQuizMessage(state({ strongCategory: variant }), 'case:2')
    assert.ok(own.has(msg.headline), `variant «${variant}» falt til fallback: «${msg.headline}»`)
  }
})

test('ukjent kategori faller tilbake på {category}-settet med navnet innfylt', () => {
  // En kategori lagt til i admin etter at tekstene ble skrevet skal fortsatt
  // gi en melding — ikke krasje og ikke vise rå «{category}».
  const msg = selectQuizMessage(state({ strongCategory: 'Litteratur' }), SEED)
  const text = `${msg.headline} ${msg.subline ?? ''}`
  assert.ok(text.includes('Litteratur'), `fallback fylte ikke inn navnet: «${text}»`)
  assert.ok(!text.includes('{'), `rå plassholder: «${text}»`)
  assert.equal(categoryOf(msg), 'category')
})

test('«Diverse» har ingen kategoritekster og når aldri kategorigrenen', () => {
  for (const key of Object.keys(categoryMessages)) {
    assert.ok(
      !CATEGORY_MESSAGE_EXCLUDED.includes(key),
      `«${key}» er ekskludert i computeStrongCategory, men har likevel tekster`
    )
  }
  assert.ok(!('diverse' in categoryMessages))
})

test('alle kategorilister har minst tre varianter', () => {
  // Under tre blir gjentakelsen påfallende for en spiller som treffer samme
  // kategori flere ganger i én quiz.
  for (const [cat, msgs] of Object.entries(categoryMessages)) {
    assert.ok(msgs.length >= 3, `«${cat}» har bare ${msgs.length}`)
  }
})

// ── computeStrongCategory ───────────────────────────────────────────────────
// Semantikk fra 2. august 2026 (QK_4 punkt 12): kategorien til det SIST
// besvarte spørsmålet, kun når svaret var riktig og spilleren har minst 3
// riktige i samme kategori totalt. Siste element i answers er per withAnswer
// alltid spørsmålet som nettopp ble besvart.

type A = { questionId: string; isCorrect: boolean }
type Q = { id: string; category: string | null }

function q(id: string, category: string | null): Q {
  return { id, category }
}

test('terskel: 2 riktige i kategorien gir null, 3 gir kategorien', () => {
  const questions = [q('a', 'Historie'), q('b', 'Historie'), q('c', 'Historie'), q('d', 'Sport')]
  const two: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'd', isCorrect: true },
    { questionId: 'c', isCorrect: false },
    { questionId: 'b', isCorrect: true }, // sist besvart: riktig Historie, men bare 2 i kategorien
  ]
  assert.equal(computeStrongCategory(two, questions), null)
  const three: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: true },
  ]
  assert.equal(computeStrongCategory(three, questions), 'Historie')
  assert.equal(CATEGORY_MESSAGE_THRESHOLD, 3)
})

test('siste svar FEIL → null, selv med 3 riktige i kategorien fra før', () => {
  const questions = ['a', 'b', 'c', 'd'].map(id => q(id, 'Historie'))
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: true },
    { questionId: 'd', isCorrect: false },
  ]
  // Prioritetskjeden ville uansett valgt after_wrong før category — men den
  // rene funksjonen skal ikke lene seg på det.
  assert.equal(computeStrongCategory(answers, questions), null)
})

test('siste riktige svar i ANNEN kategori enn den sterke → null (ikke totalens vinner)', () => {
  // Gammel semantikk hadde returnert Historie her («Du kan Historie, du» på et
  // Geografi-spørsmål) — nøyaktig funnet fra gjennomspillingen 30. juli.
  const questions = [
    q('h1', 'Historie'), q('h2', 'Historie'), q('h3', 'Historie'),
    q('g1', 'Geografi'),
  ]
  const answers: A[] = [
    { questionId: 'h1', isCorrect: true },
    { questionId: 'h2', isCorrect: true },
    { questionId: 'h3', isCorrect: true },
    { questionId: 'g1', isCorrect: true }, // nettopp besvart: Geografi, kun 1 riktig der
  ]
  assert.equal(computeStrongCategory(answers, questions), null)
})

test('sterk kategori trenger IKKE være spillerens beste — 3 riktige holder', () => {
  // Historie står i 4, men spilleren svarte nettopp riktig på sin 3. Sport —
  // «Sterk i Sport» er sann og skal vises i akkurat det øyeblikket.
  const questions = [
    q('h1', 'Historie'), q('h2', 'Historie'), q('h3', 'Historie'), q('h4', 'Historie'),
    q('s1', 'Sport'), q('s2', 'Sport'), q('s3', 'Sport'),
  ]
  const answers: A[] = [
    { questionId: 'h1', isCorrect: true },
    { questionId: 'h2', isCorrect: true },
    { questionId: 'h3', isCorrect: true },
    { questionId: 'h4', isCorrect: true },
    { questionId: 's1', isCorrect: true },
    { questionId: 's2', isCorrect: true },
    { questionId: 's3', isCorrect: true },
  ]
  assert.equal(computeStrongCategory(answers, questions), 'Sport')
})

test('«Diverse» er ekskludert — uansett casing og whitespace, uansett antall', () => {
  for (const variant of ['Diverse', 'diverse', ' DIVERSE ', 'Diverse ']) {
    const questions = ['a', 'b', 'c', 'd', 'e'].map(id => q(id, variant))
    const answers: A[] = questions.map(x => ({ questionId: x.id, isCorrect: true }))
    assert.equal(computeStrongCategory(answers, questions), null, `variant «${variant}» slapp gjennom`)
  }
})

test('kategori uten verdi (null/tom/whitespace) teller ikke', () => {
  const questions = [q('a', 'Sport'), q('b', 'Sport'), q('c', 'Sport'), q('d', null), q('e', ''), q('f', '   ')]
  // Sist besvart mangler kategori → null, selv med 3 riktige i Sport.
  for (const lastId of ['d', 'e', 'f']) {
    const answers: A[] = [
      { questionId: 'a', isCorrect: true },
      { questionId: 'b', isCorrect: true },
      { questionId: 'c', isCorrect: true },
      { questionId: lastId, isCorrect: true },
    ]
    assert.equal(computeStrongCategory(answers, questions), null, `lastId=${lastId}`)
  }
})

test('case-varianter teller sammen; visningsform er det nettopp besvarte spørsmålets variant', () => {
  const questions = [q('a', 'Historie '), q('b', 'historie'), q('c', 'HISTORIE')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: true },
    { questionId: 'c', isCorrect: true },
  ]
  assert.equal(computeStrongCategory(answers, questions), 'HISTORIE')
})

test('kun riktige svar teller mot terskelen', () => {
  const questions = ['a', 'b', 'c', 'd'].map(id => q(id, 'Musikk'))
  // 3 riktige (a, c, d) → terskelen nås, feilsvaret på b trekker ikke ned.
  const overTerskel: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: true },
    { questionId: 'd', isCorrect: true },
  ]
  assert.equal(computeStrongCategory(overTerskel, questions), 'Musikk')
  // Bare 2 riktige (a, d) — feilsvarene på b og c teller ikke som riktige.
  const underTerskel: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'b', isCorrect: false },
    { questionId: 'c', isCorrect: false },
    { questionId: 'd', isCorrect: true },
  ]
  assert.equal(computeStrongCategory(underTerskel, questions), null)
})

test('siste svar på ukjent questionId (hull i questions) → null', () => {
  const questions: (Q | undefined)[] = [q('a', 'Sport'), undefined, q('c', 'Sport')]
  const answers: A[] = [
    { questionId: 'a', isCorrect: true },
    { questionId: 'c', isCorrect: true },
    { questionId: 'ukjent', isCorrect: true },
  ]
  assert.equal(computeStrongCategory(answers, questions), null)
})

test('tom answers-liste → null', () => {
  assert.equal(computeStrongCategory([], [q('a', 'Sport')]), null)
})
