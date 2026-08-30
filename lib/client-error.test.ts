// Kjøres med:  npm test
//
// To lag:
//   1. EKTE oppførselstest av dempingen (decideClientErrorReport er ren).
//   2. STRUKTURELL sperre på at de to error boundaries faktisk KALLER
//      logClientError. Kildetekst-test av samme grunn som
//      lib/historikk-load-catch.test.ts oppgir: effekten ligger i en
//      klientkomponent, og prosjektet har ikke React-testoppsett — testglobben
//      er lib/**/*.test.ts og det finnes ingen DOM å rendre i.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes logClientError fra ErrorBoundary.componentDidCatch → «forsidens
//     ErrorBoundary rapporterer» ryker.
//   • Samme i NavErrorBoundary → «nav-boundaryen rapporterer» ryker.
//   • Byttes >= til > i area-taket → «fjerde i samme area dempes» ryker.
//   • Fjernes `state.total += 1` → «totaltaket griper» ryker.
//   • Flyttes `total += 1` ut av 'send'-grenen → «dempede events spiser ikke
//     totalbudsjettet» ryker.
//   • Fjernes area-taggen fra captureException → «taggen har samme form som
//     app/page.tsx» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createThrottleState,
  decideClientErrorReport,
  MAX_PER_AREA,
  MAX_TOTAL,
} from './client-error'

// ── 1. Dempingen ────────────────────────────────────────────────────────────

test(`de første ${MAX_PER_AREA} i samme area sendes`, () => {
  const s = createThrottleState()
  for (let i = 0; i < MAX_PER_AREA; i++) {
    assert.equal(decideClientErrorReport(s, 'error-boundary'), 'send', `nr ${i + 1} ble dempet`)
  }
})

test('fjerde i samme area dempes — én looping fane kan ikke fyre i det uendelige', () => {
  const s = createThrottleState()
  for (let i = 0; i < MAX_PER_AREA; i++) decideClientErrorReport(s, 'error-boundary')
  assert.equal(decideClientErrorReport(s, 'error-boundary'), 'area-capped')
  assert.equal(decideClientErrorReport(s, 'error-boundary'), 'area-capped')
})

test('et annet area har sitt eget tak', () => {
  const s = createThrottleState()
  for (let i = 0; i < MAX_PER_AREA; i++) decideClientErrorReport(s, 'error-boundary')
  assert.equal(decideClientErrorReport(s, 'error-boundary'), 'area-capped')
  assert.equal(decideClientErrorReport(s, 'global-nav-boundary'), 'send')
})

test('totaltaket griper på tvers av mange areas', () => {
  const s = createThrottleState()
  let sent = 0
  // Nok areas til at area-taket aldri er det bindende: 20 × MAX_PER_AREA
  // sendinger ville vært mulig hvis bare totaltaket manglet.
  for (let a = 0; a < 20; a++) {
    for (let i = 0; i < MAX_PER_AREA; i++) {
      if (decideClientErrorReport(s, `area-${a}`) === 'send') sent++
    }
  }
  assert.equal(sent, MAX_TOTAL, `sendte ${sent}, taket er ${MAX_TOTAL}`)
})

test('over totaltaket er avslaget merket total-capped, ikke area-capped', () => {
  const s = createThrottleState()
  for (let a = 0; a < MAX_TOTAL; a++) decideClientErrorReport(s, `area-${a}`)
  assert.equal(decideClientErrorReport(s, 'helt-ny-area'), 'total-capped')
})

test('dempede events spiser ikke totalbudsjettet til de andre', () => {
  const s = createThrottleState()
  // Brenn ett area langt over sitt tak. Kun MAX_PER_AREA av disse er sendinger.
  for (let i = 0; i < 50; i++) decideClientErrorReport(s, 'støyende')
  // Resten av totalbudsjettet skal fortsatt være tilgjengelig for andre areas.
  let sent = 0
  for (let a = 0; a < 20; a++) {
    if (decideClientErrorReport(s, `annen-${a}`) === 'send') sent++
  }
  assert.equal(sent, MAX_TOTAL - MAX_PER_AREA,
    'de 47 dempede forsøkene har spist av totalbudsjettet — total økes utenfor send-grenen')
})

test('taket per fane holder en 60-spillers utetid under månedskvoten', () => {
  const s = createThrottleState()
  let sent = 0
  // Trinn 1 har nøyaktig TO areas. Da er det area-taket som binder, ikke
  // totaltaket: 2 × MAX_PER_AREA = 6 sendinger per fane, uansett hvor mange
  // ganger boundaryene krasjer. Totaltaket er backstoppen for trinn 2, når
  // antall areas vokser.
  for (let i = 0; i < 1000; i++) {
    if (decideClientErrorReport(s, i % 2 === 0 ? 'error-boundary' : 'global-nav-boundary') === 'send') sent++
  }
  assert.equal(sent, 2 * MAX_PER_AREA, 'taket per fane i trinn 1 er ikke 2 × MAX_PER_AREA')
  assert.ok(sent <= MAX_TOTAL, 'area-takene til sammen overstiger totaltaket')
  assert.ok(sent * 60 < 5000,
    `60 samtidige faner ville sendt ${sent * 60} events mot en månedskvote på 5000`)
})

// ── 2. Wiringen i de to boundaries ──────────────────────────────────────────

const ERROR_BOUNDARY = readFileSync('components/ErrorBoundary.tsx', 'utf8')
// Omdøpt fra UserMenuErrorBoundary i B-30/A2 steg 2 — wrapper nå GlobalNav
// (hele toppnavigasjonen) i app/layout.tsx.
const NAV_BOUNDARY = readFileSync('components/NavErrorBoundary.tsx', 'utf8')

/**
 * Henter kroppen til componentDidCatch. Ankeret er selve metoden og ikke
 * filstart: et `logClientError` nevnt i en kommentar lenger oppe i fila skal
 * ikke kunne oppfylle testen.
 */
function componentDidCatchBody(src: string, file: string): string {
  const idx = src.indexOf('componentDidCatch(')
  assert.notEqual(idx, -1, `fant ingen componentDidCatch i ${file}`)
  const open = src.indexOf('{', idx)
  let depth = 0
  let i = open
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(open + 1, i)
}

test('forsidens ErrorBoundary rapporterer krasjen — den når ikke GlobalHandlers selv', () => {
  const body = componentDidCatchBody(ERROR_BOUNDARY, 'components/ErrorBoundary.tsx')
  assert.match(body, /logClientError\(\s*'error-boundary'\s*,/,
    'componentDidCatch i ErrorBoundary kaller ikke logClientError — en render-krasj på forsiden, quiz-siden, /historikk, /arkiv og /toppliste blir usynlig')
  assert.match(ERROR_BOUNDARY, /^import \{ logClientError \} from '@\/lib\/client-error'$/m,
    'ErrorBoundary importerer ikke logClientError')
})

test('nav-boundaryen rapporterer krasjen — den rendrer ingenting ved feil', () => {
  const body = componentDidCatchBody(NAV_BOUNDARY, 'components/NavErrorBoundary.tsx')
  assert.match(body, /logClientError\(\s*'global-nav-boundary'\s*,/,
    'componentDidCatch i NavErrorBoundary kaller ikke logClientError — hele toppnavigasjonen forsvinner sporløst på hver side')
  assert.match(NAV_BOUNDARY, /^import \{ logClientError \} from '@\/lib\/client-error'$/m,
    'NavErrorBoundary importerer ikke logClientError')
})

// ── 3. Formen trinn 2 skal kopiere ──────────────────────────────────────────

const HELPER = readFileSync('lib/client-error.ts', 'utf8')
const HOME = readFileSync('app/page.tsx', 'utf8')

test('area-taggen har samme form som app/page.tsx sin', () => {
  assert.match(HELPER, /^\s*Sentry\.captureException\(err, \{ tags: \{ area \} \}\)$/m,
    'logClientError sender ikke area som Sentry-tagg på formen { tags: { area } }')
  assert.match(HOME, /Sentry\.captureException\(err, \{ tags: \{ area: 'home-page-insights' \} \}\)/,
    'forbildet i app/page.tsx har endret form — trinn 2 kopierer da feil mønster')
})

test('konsollen beholdes ved siden av Sentry, ikke erstattet av den', () => {
  assert.match(HELPER, /^\s*console\.error\(`\[\$\{area\}\]`, err\)$/m,
    'logClientError skriver ikke til konsollen på send-stien — lokal utvikling (SENTRY_ENABLED=false) blir da blind')
  assert.match(HELPER, /dempet: \$\{decision\}/,
    'den dempede stien skriver ikke til konsollen — en dempet feil forsvinner da helt')
})
