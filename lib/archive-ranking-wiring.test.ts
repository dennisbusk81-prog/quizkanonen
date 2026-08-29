// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: at app/quiz/[id]/page.tsx faktisk SPØR arkiv-gatene i
// lib/archive-ranking-gates.ts før hvert av de åtte rangeringskallene.
//
// Denne filen og lib/archive-ranking-gates.test.ts er to halvdeler av ett
// bevis, og ingen av dem holder alene:
//   • Oppførselstesten alene ville godtatt at et kallsted sluttet å spørre.
//   • Denne alene ville godtatt at predikatet svarte feil.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/dead-session-finish-wiring.test.ts og lib/finish-quiz-timeout.test.ts —
// npm test kjører kun lib/**/*.test.ts under Node sin egen runner, uten jsdom,
// og logikken ligger i en 5000-linjers klientkomponent. Selve BESLUTNINGEN er
// derfor flyttet ut til rene funksjoner og oppførselstestet der; det denne
// filen vokter er wiringen mellom dem.
//
// ── HVA DEN BEVISER, OG HVA DEN IKKE BEVISER ────────────────────────────────
// Beviser: vakten står på en AKTIV linje (ikke utkommentert), i SAMME funksjon
// som kallet den gater, FØR det, og i en betinget posisjon (`if (…)` eller en
// ternær tilordning) — ikke som et kall hvis svar kastes.
// Beviser IKKE: syntaktisk dominans. At vakten faktisk omslutter kallet er
// sikret av mutasjonsbeviset (fjernes vakten, blir denne filen rød) sammen med
// oppførselstesten, ikke av en parser.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes et `shouldFetch…`-kall fra et kallsted → den gatens test ryker.
//   • Kommenteres vakten ut i stedet for å slettes → samme test ryker
//     (linjene filtreres på aktive linjer, se `aktiveLinjer`).
//   • Erstattes vakten med en rå `quiz?.quiz_type !== 'archive'` → «ingen rå
//     archive-literal i vaktposisjonene» ryker, og navnetesten ryker.
//   • Flyttes vakten til ETTER fetchen den gater → «vakten står foran kallet» ryker.
//   • Kalles vakten uten å bruke svaret (`shouldFetchX(...)` som setning) →
//     «vakten står i betinget posisjon» ryker.
//   • Gates bare den ene av G6/G7 → «begge mellomskjerm-stiene er gatet» ryker.
//   • Legges en niende gate til modulen uten kallsted → «alle eksporterte gater
//     er i bruk» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('app/quiz/[id]/page.tsx', 'utf8')
const GATES_SRC = readFileSync('lib/archive-ranking-gates.ts', 'utf8')

// ── Klammetelling, samme helper som lib/dead-session-finish-wiring.test.ts ──
function functionBody(source: string, decl: string): string {
  const start = source.indexOf(decl)
  assert.notEqual(start, -1, `fant ikke «${decl}» i page.tsx — er funksjonen omdøpt?`)
  const braceStart = source.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(braceStart, i + 1)
    }
  }
  throw new Error(`fant ikke slutten på «${decl}»`)
}

/**
 * Klammetelling fra en KONKRET posisjon, ikke fra første tekst-treff i fila.
 * `useEffect(() => {` er ikke unik — functionBody ville landet på den første
 * forekomsten i hele page.tsx uansett hvilken effekt vi mente. Det er
 * nøyaktig fella «mutasjon uten /g treffer første sted i hele fila», bare på
 * lesesiden.
 */
function bodyFrom(source: string, braceStart: number): string {
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(braceStart, i + 1)
    }
  }
  throw new Error('fant ikke slutten på blokken')
}

function effectBody(source: string, unikLinje: string): string {
  const hit = source.indexOf(unikLinje)
  assert.notEqual(hit, -1, `fant ikke ankeret «${unikLinje}» i page.tsx`)
  const start = source.lastIndexOf('useEffect(() => {', hit)
  assert.notEqual(start, -1, `fant ingen useEffect foran «${unikLinje}»`)
  return bodyFrom(source, source.indexOf('{', start))
}

/**
 * Kildetekst uten kommentarlinjer. Uten dette ville en utkommentert vakt
 * oppfylt testen — nøyaktig fella beskrevet i
 * lib/dead-session-finish-wiring.test.ts sitt slektskap: en regex bryr seg
 * ikke om at linjen er død.
 */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

type GateSpec = {
  navn: string
  gate: string
  /** Funksjonen/effekten kallet bor i — en ekte grense, ikke et tegnvindu. */
  kropp: () => string
  /** Teksten til selve nettverkskallet vakten gater. */
  kall: string
}

const GATER: GateSpec[] = [
  {
    navn: 'G1 intern org-plassering',
    gate: 'shouldFetchInternalPlacement',
    kropp: () => effectBody(SRC, 'internalPlacementFetchedFor.current = orgSlug'),
    kall: '`/api/leaderboard/${quizId}?is_team=false&limit=1&org=',
  },
  {
    navn: 'G2 topp-3 ved innlasting',
    gate: 'shouldFetchAlreadyPlayedTop3OnLoad',
    kropp: () => functionBody(SRC, 'async function fetchData() {'),
    kall: 'const t3res = await fetch(`/api/quiz/${quizId}/standings`',
  },
  {
    navn: 'G3 topp-3 fra fase-effekten',
    gate: 'shouldFetchPhaseTop3',
    kropp: () => effectBody(SRC, "if (phase !== 'finished' && phase !== 'already_played') return"),
    kall: 'fetch(`/api/quiz/${quizId}/standings`, { signal: t3Controller.signal })',
  },
  {
    navn: 'G4 live plassering under spilling',
    gate: 'shouldFetchLiveRank',
    kropp: () => functionBody(SRC, 'const fetchLiveRank = useCallback(async ('),
    kall: '`/api/quiz/${quizId}/ranking-snapshot?question=${currentIndex}',
  },
  {
    navn: 'G5 rival + duellforslag',
    gate: 'shouldFetchRival',
    kropp: () => functionBody(SRC, 'const startQuiz = async () => {'),
    kall: 'fetch(`/api/quiz/rival?quizId=${quizId}`',
  },
  {
    navn: 'G6 premium-rangering på mellomskjermen',
    gate: 'shouldFetchPremiumInterludeRanking',
    kropp: () => functionBody(SRC, 'const goToNext = async () => {'),
    kall: 'fetchLiveRankingFull(correctSoFar, totalTimeMs, answeredSoFar, rankingController.signal)',
  },
  {
    navn: 'G7 spenn-rangering på mellomskjermen',
    gate: 'shouldFetchSpanInterludeRanking',
    kropp: () => functionBody(SRC, 'const goToNext = async () => {'),
    kall: 'fetchRankingSnapshot(currentIndex, correctSoFar, totalTimeMs, answeredSoFar, rankingController.signal)',
  },
  {
    navn: 'G8 pynte-blokken ved målstreken',
    gate: 'shouldFetchFinishExtras',
    kropp: () => functionBody(SRC, 'const finishQuiz = async (override?: FinishQuizOverride) => {'),
    kall: 'const stRes = await fetch(`/api/quiz/${quizId}/standings?${stParams.toString()}`',
  },
]

for (const spec of GATER) {
  test(`${spec.navn}: vakten står foran kallet, i samme funksjon, på en AKTIV linje`, () => {
    const aktiv = aktiveLinjer(spec.kropp())

    const gateIdx = aktiv.indexOf(`${spec.gate}(`)
    assert.notEqual(gateIdx, -1,
      `${spec.gate} kalles ikke på en aktiv linje i funksjonen som gjør kallet — ` +
      `arkivquizen vil da treffe ${spec.kall.slice(0, 60)}…`)

    const kallIdx = aktiv.indexOf(spec.kall)
    assert.notEqual(kallIdx, -1,
      `fant ikke selve kallet «${spec.kall}» — er det flyttet? Da må denne testen følge med.`)

    assert.ok(gateIdx < kallIdx,
      `${spec.gate} står ETTER kallet den skal gate — en vakt som kjører for sent gater ingenting`)
  })

  test(`${spec.navn}: vakten står i BETINGET posisjon, ikke som et kastet kall`, () => {
    const aktiv = aktiveLinjer(spec.kropp())
    const linje = aktiv.split('\n').find(l => l.includes(`${spec.gate}(`))
    assert.ok(linje, `fant ingen aktiv linje med ${spec.gate}(`)
    // Enten en if-test (positiv eller negert) eller en tilordning som senere
    // brukes som betingelse (den ternære formen i goToNext). Et bart
    // `shouldFetchX({...})` som setning ville bestått en ren navnesjekk og
    // gatet nøyaktig ingenting.
    const brukt = new RegExp(`(\\bif\\s*\\(\\s*!?\\s*|=\\s*)${spec.gate}\\(`).test(linje!)
    assert.ok(brukt,
      `${spec.gate} kalles uten at svaret brukes som betingelse: «${linje!.trim()}»`)
  })
}

test('begge mellomskjerm-stiene (G6 og G7) er gatet — ikke bare den ene', () => {
  // Den viktige paritetstesten på wiring-siden. Gates bare den ene, faller
  // premium-spilleren stille ned i den andre stien i stedet for til stillhet.
  // Oppførselssiden av samme krav ligger i lib/archive-ranking-gates.test.ts.
  const kropp = aktiveLinjer(functionBody(SRC, 'const goToNext = async () => {'))
  assert.ok(kropp.includes('shouldFetchPremiumInterludeRanking('),
    'premium-stien i goToNext er ikke gatet')
  assert.ok(kropp.includes('shouldFetchSpanInterludeRanking('),
    'spenn-stien i goToNext er ikke gatet')
})

test('G2 og G3 er BEGGE gatet — dobbelthentingen av topp-3 har to innganger', () => {
  const fetchDataKropp = aktiveLinjer(functionBody(SRC, 'async function fetchData() {'))
  const faseKropp = aktiveLinjer(
    effectBody(SRC, "if (phase !== 'finished' && phase !== 'already_played') return"))
  assert.ok(fetchDataKropp.includes('shouldFetchAlreadyPlayedTop3OnLoad('),
    'topp-3-hentingen i fetchData er ikke gatet')
  assert.ok(faseKropp.includes('shouldFetchPhaseTop3('),
    'topp-3-hentingen i fase-effekten er ikke gatet')
})

test('ingen rå «archive»-literal igjen i de åtte vaktposisjonene', () => {
  // Vaktene skal spørre modulen, ikke sammenligne strenger selv. En rå
  // `quiz?.quiz_type !== 'archive'` ved siden av et rangeringskall ville vært
  // en niende, utestet kopi av beslutningen — og en skrivefeil i strengen
  // ville gjort den stille virkningsløs.
  for (const spec of GATER) {
    const aktiv = aktiveLinjer(spec.kropp())
    const kallIdx = aktiv.indexOf(spec.kall)
    assert.notEqual(kallIdx, -1, `fant ikke kallet for ${spec.navn}`)
    // Vinduet er funksjonens egen kropp fram til kallet — en ekte grense.
    const foran = aktiv.slice(0, kallIdx)
    assert.ok(!/quiz_type\s*[!=]==?\s*'archive'/.test(foran),
      `${spec.navn}: rå quiz_type-sammenligning mot 'archive' foran kallet — ` +
      'bruk gatene i lib/archive-ranking-gates.ts')
  }
})

test('alle eksporterte gater i modulen er faktisk i bruk i spillestien', () => {
  // Fanger den motsatte driften: en gate legges til (eller beholdes) i
  // modulen, testes der, og ingen kaller den. Da er den grønn og virkningsløs.
  const eksporterte = [...GATES_SRC.matchAll(/export function (shouldFetch\w+)/g)].map(m => m[1])
  assert.equal(eksporterte.length, 8,
    `forventet åtte shouldFetch-gater i modulen, fant ${eksporterte.length}: ${eksporterte.join(', ')}`)

  const aktivKilde = aktiveLinjer(SRC)
  for (const navn of eksporterte) {
    assert.ok(aktivKilde.includes(`${navn}(`),
      `${navn} er eksportert fra lib/archive-ranking-gates.ts, men kalles ingen steder i page.tsx`)
  }

  // Og motsatt: hver gate i denne testfilens liste finnes i modulen.
  for (const spec of GATER) {
    assert.ok(eksporterte.includes(spec.gate),
      `${spec.gate} står i testens liste, men eksporteres ikke fra modulen`)
  }
})
