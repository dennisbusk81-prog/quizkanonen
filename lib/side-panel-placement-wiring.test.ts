// Kjøres med:  npm test
//
// STRUKTURELL SPERRE (N-8): at høyre panel under spilling i
// app/quiz/[id]/page.tsx faktisk SPØR decideSidePanelPlacement, mater den med
// den server-gatede kilden, og TEGNER svaret.
//
// Denne filen og lib/side-panel-placement.test.ts er to halvdeler av ett
// bevis. Oppførselstesten alene ville godtatt at kallstedet sluttet å spørre;
// denne alene ville godtatt at predikatet svarte feil. Samme deling som
// lib/archive-ranking-gates.ts + lib/archive-ranking-wiring.test.ts, og av
// samme grunn: npm test kjører uten jsdom, og komponenten er 5000 linjer.
//
// Bakgrunnen for at den finnes: hele panelets plasseringsvisning ble slått av
// på kallstedet (`{false ? (`) den 4. september 2026, og 3050 tester forble
// grønne. Det var målt, ikke lest.
//
// ── HVA DEN BEVISER, OG HVA DEN IKKE BEVISER ────────────────────────────────
// Beviser: kallet står på en AKTIV linje i spillefasen; argumentet er
// interLiveRanking (ikke liveRank — se modulkommentaren i
// lib/side-panel-placement.ts for hvorfor det skillet er reelt); det eksakte
// tallet faktisk rendres; det gamle rå båndet er borte; og «estimert»-
// etiketten fortsatt står under tallet (avgjort, ikke glemt).
// Beviser IKKE: at JSX-en er syntaktisk gyldig. Det gjør next build.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes decideSidePanelPlacement-kallet → «spillefasen spør predikatet» ryker.
//   • Kommenteres det ut → samme test ryker (aktive linjer, se aktiveLinjer).
//   • Byttes `liveRanking: interLiveRanking` mot `liveRanking: liveRank` →
//     «kilden er interLiveRanking» ryker.
//   • Tegnes `sidePlacement.low` i eksakt-grenen i stedet for `.rank` →
//     «det eksakte tallet rendres» ryker.
//   • Legges det rå `#{interLow}–{interHigh}` tilbake → «ingen rå bånd-JSX» ryker.
//   • Fjernes «estimert» under tallet → «etiketten står» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('app/quiz/[id]/page.tsx', 'utf8')

// ── Helpere, samme form som lib/archive-ranking-wiring.test.ts ──────────────

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

function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

/** Kroppen til `if (phase === 'playing') { … }` — spillefasen, en ekte grense. */
function spillefasen(): string {
  const decl = "if (phase === 'playing') {"
  const hit = SRC.indexOf(decl)
  assert.notEqual(hit, -1, `fant ikke «${decl}» i page.tsx — er fasen omdøpt?`)
  assert.equal(SRC.indexOf(decl, hit + 1), -1, `«${decl}» finnes flere ganger — ankeret er ikke unikt`)
  return aktiveLinjer(bodyFrom(SRC, SRC.indexOf('{', hit)))
}

/**
 * Argumentteksten til decideSidePanelPlacement( … ) — KUN den, ikke et vindu
 * rundt. `interLiveRanking` forekommer titalls steder i fila; en sjekk på
 * nærhet ville blitt oppfylt av naboen (feedback-nearby-code-can-satisfy-
 * your-test-anchor).
 */
function predikatArgument(kropp: string): string {
  const navn = 'decideSidePanelPlacement('
  const start = kropp.indexOf(navn)
  assert.notEqual(start, -1, 'decideSidePanelPlacement kalles ikke på en aktiv linje i spillefasen')
  assert.equal(kropp.indexOf(navn, start + 1), -1, 'decideSidePanelPlacement kalles flere ganger i spillefasen')
  let depth = 0
  for (let i = start + navn.length - 1; i < kropp.length; i++) {
    if (kropp[i] === '(') depth++
    else if (kropp[i] === ')') {
      depth--
      if (depth === 0) return kropp.slice(start + navn.length, i)
    }
  }
  throw new Error('fant ikke slutten på kallet')
}

// ── Testene ─────────────────────────────────────────────────────────────────

test('spillefasen spør predikatet, på en aktiv linje, og bruker svaret', () => {
  const kropp = spillefasen()
  const linje = kropp.split('\n').find(l => l.includes('decideSidePanelPlacement('))
  assert.ok(linje, 'decideSidePanelPlacement kalles ikke på en aktiv linje i spillefasen')
  // Tilordnet, ikke kastet: et bart kall som setning ville bestått en
  // navnesjekk og tegnet ingenting.
  assert.match(linje!, /=\s*decideSidePanelPlacement\(/,
    `svaret fra predikatet brukes ikke: «${linje!.trim()}»`)
})

test('kilden er interLiveRanking — ikke liveRank, ikke isPremium', () => {
  const arg = predikatArgument(spillefasen())
  assert.match(arg, /liveRanking:\s*interLiveRanking\b/,
    `liveRanking-feltet mates ikke med interLiveRanking: «${arg.trim()}»`)
  // liveRank (pillens kilde) er gatet på show_live_placement; panelet er det
  // ikke. En quiz med flagget av ville gitt et tomt panel.
  assert.ok(!/\bliveRank\b/.test(arg),
    'predikatet mates med liveRank — den er gatet på show_live_placement, panelet er det ikke')
  // Paritetskontrakten fra 2749d59: tegn det du FIKK, ikke det du trodde.
  assert.ok(!/isPremium/.test(arg),
    'predikatet mates med isPremium — attempt-tokenet utstedes ved start, og klientens flagg kan avvike')
  assert.match(arg, /low:\s*interLow\b/, 'low mates ikke med interLow')
  assert.match(arg, /high:\s*interHigh\b/, 'high mates ikke med interHigh')
})

test('det eksakte tallet rendres — sidePlacement.rank, ikke bare besluttes', () => {
  const kropp = spillefasen()
  assert.ok(kropp.includes('`#${sidePlacement.rank}`'),
    'eksakt-grenen tegner ikke sidePlacement.rank — predikatet spørres, men svaret vises ikke')
  assert.ok(kropp.includes('`#${sidePlacement.low}–${sidePlacement.high}`'),
    'bånd-grenen tegner ikke sidePlacement.low–high — gratisvisningen er borte')
})

test('ingen rå bånd-JSX igjen: #{interLow}–{interHigh} skal ikke tegnes direkte', () => {
  // Det var nøyaktig denne linja som var hullet. Kommer den tilbake ved siden
  // av predikatet, har vi to meninger om samme sak på samme skjerm.
  const aktiv = aktiveLinjer(SRC)
  assert.ok(!aktiv.includes('#{interLow}–{interHigh}'),
    'det rå båndet «#{interLow}–{interHigh}» tegnes fortsatt et sted i page.tsx')
})

test('«estimert» står fortsatt under tallet — også det eksakte (avgjort 4. sept 2026)', () => {
  // Etiketten skal IKKE fjernes for eksakt: midt i en quiz er plasseringen
  // reelt foreløpig. Ankeret er posisjonen — etter rank-linja, før den første
  // ventetekst-grenen — så en «estimert» et annet sted i fila ikke oppfyller den.
  const kropp = spillefasen()
  const rankIdx = kropp.indexOf('`#${sidePlacement.rank}`')
  const fallbackIdx = kropp.indexOf('answers.length < MIN_ANSWERED_FOR_PLACEMENT ?')
  assert.notEqual(rankIdx, -1)
  assert.notEqual(fallbackIdx, -1, 'fant ikke ventetekst-grenen — er panelet omskrevet?')
  assert.ok(rankIdx < fallbackIdx)
  const mellom = kropp.slice(rankIdx, fallbackIdx)
  assert.match(mellom, />estimert</,
    '«estimert»-etiketten mangler mellom tallet og ventetekstene')
})
