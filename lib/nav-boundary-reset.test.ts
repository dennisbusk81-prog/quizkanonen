// Kjøres med:  npm test
//
// To lag, samme mønster som lib/client-error.test.ts:
//   1. EKTE oppførselstest av reset-beslutningen (shouldResetNavBoundary er
//      ren — se lib/nav-boundary-reset.ts for hvorfor den er løftet ut).
//   2. STRUKTURELL sperre på at components/NavErrorBoundary.tsx faktisk
//      KALLER beslutningen og setState-er på svaret. Dette er et
//      kildetekst-anker, IKKE en oppførselstest (B-13-skillet): det beviser
//      at kallet står i koden, ikke at React fyrer componentDidUpdate med ny
//      pathname ved navigasjon. Den delen ER utestet — klientkomponent uten
//      React-testrigg.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes resetten i den rene funksjonen (returner alltid false) →
//     «nav kommer tilbake ved navigasjon» ryker.
//   • Fjernes pathname-sammenligningen (alltid reset ved krasj) →
//     «samme rute nullstiller ikke» ryker — det er render-løkke-vakten.
//   • Fjernes hasError-vakten → «uten krasj skjer ingenting» ryker.
//   • Fjernes componentDidUpdate-resetten i komponenten → den strukturelle
//     wiring-testen ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldResetNavBoundary } from './nav-boundary-reset'

// ── 1. Oppførselen ──────────────────────────────────────────────────────────

test('nav kommer tilbake ved navigasjon: krasj + ny pathname → reset', () => {
  assert.equal(shouldResetNavBoundary(true, '/quiz/abc', '/'), true,
    'krasjet nav på /quiz/abc kom ikke tilbake ved navigasjon til forsiden')
  assert.equal(shouldResetNavBoundary(true, '/', '/toppliste'), true,
    'krasjet nav på forsiden kom ikke tilbake ved navigasjon til /toppliste')
})

test('samme rute nullstiller ikke — render-løkke-vakten', () => {
  // En komponent som krasjer konsekvent får hasError=true igjen umiddelbart
  // etter reset. Skulle samme pathname også resette, kom render-syklusen
  // aldri til ro. Derfor: identisk pathname → aldri reset.
  assert.equal(shouldResetNavBoundary(true, '/', '/'), false,
    're-render på samme rute nullstiller — konsekvent krasj blir render-løkke')
  assert.equal(shouldResetNavBoundary(true, '/quiz/abc', '/quiz/abc'), false,
    're-render på samme quiz-side nullstiller — konsekvent krasj blir render-løkke')
  // Ukjent pathname to ganger på rad er heller ikke en navigasjon.
  assert.equal(shouldResetNavBoundary(true, null, null), false,
    'null → null regnes som navigasjon')
})

test('uten krasj skjer ingenting — ingen reset-beslutning på frisk nav', () => {
  assert.equal(shouldResetNavBoundary(false, '/', '/toppliste'), false,
    'frisk nav får reset-beslutning ved navigasjon')
  assert.equal(shouldResetNavBoundary(false, '/', '/'), false,
    'frisk nav får reset-beslutning på samme rute')
})

// ── 2. STRUKTURELL sperre på wiringen ───────────────────────────────────────

const NAV_BOUNDARY = readFileSync('components/NavErrorBoundary.tsx', 'utf8')

/**
 * Henter kroppen til en metode. Ankeret er `navn(` og ikke filstart, så prosa
 * om metoden i en kommentar (uten parentes) ikke kan oppfylle testen — samme
 * grep som componentDidCatchBody i lib/client-error.test.ts.
 */
function metodeKropp(src: string, metode: string, file: string): string {
  const idx = src.indexOf(`${metode}(`)
  assert.notEqual(idx, -1, `fant ingen ${metode} i ${file}`)
  const open = src.indexOf('{', idx)
  let depth = 0
  let i = open
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(open + 1, i)
}

test('componentDidUpdate spør shouldResetNavBoundary og nullstiller hasError', () => {
  const body = metodeKropp(NAV_BOUNDARY, 'componentDidUpdate', 'components/NavErrorBoundary.tsx')
  assert.match(body, /shouldResetNavBoundary\(/,
    'componentDidUpdate i NavErrorBoundary kaller ikke shouldResetNavBoundary — ' +
    'en krasjet nav kommer aldri tilbake før full omlasting')
  assert.match(body, /setState\(\{ hasError: false \}\)/,
    'componentDidUpdate nullstiller ikke hasError — beslutningen tas, men får ingen effekt')
  assert.match(NAV_BOUNDARY, /^import \{ shouldResetNavBoundary \} from '@\/lib\/nav-boundary-reset'$/m,
    'NavErrorBoundary importerer ikke shouldResetNavBoundary')
})

test('wrapperen mater pathname fra usePathname inn i klassekomponenten', () => {
  // Uten usePathname i en funksjonswrapper finnes ikke navigasjonssignalet:
  // rot-layouten er en serverkomponent og klassen kan ikke bruke hooks.
  assert.match(NAV_BOUNDARY, /^import \{ usePathname \} from 'next\/navigation'$/m,
    'NavErrorBoundary leser ikke usePathname')
  assert.match(NAV_BOUNDARY, /pathname=\{pathname\}/,
    'wrapperen sender ikke pathname videre til klassekomponenten')
})
