// Kjøres med:  npm test
//
// STRUKTURELL SPERRE for «feil er ikke tomt» i components/SeasonLeaderboard.tsx
// (29. august 2026). Guard-logikken er oppførselstestet i
// lib/expanded-history-state.test.ts; det denne filen vokter er det den ikke
// KAN se: at komponenten faktisk BRUKER den, og at feil-grenene står FORAN
// faktapåstandene i JSX-en. Samme husform som lib/analytics-call-sites.test.ts
// — logikken ligger inline i en React-komponent uten React-testoppsett.
//
// Feilklassen som voktes: catch-grenen skrev en TOM LISTE ([] i expandedData,
// [] i histData), som ble rendret som «Ingen data for denne perioden» /
// «Ingen avsluttede perioder ennå» — faktapåstander om et felt vi aldri fikk
// svar på. Og fordi guarden var has()/histData !== null, ble feilen CACHET:
// ingen ny henting uten full sidelast.
//
// MUTASJONSBEVIS — feilendringene disse fanger:
//   • Catch i fetchExpanded tilbake til `.set(key, [])` → «catch skriver
//     'error'» OG «catch skriver aldri tom liste» ryker.
//   • Catch/!ok i loadHistory tilbake til `setHistData([])` → «loadHistory
//     skriver aldri tom liste ved feil» ryker.
//   • Guarden tilbake til `if (expandedData.has(key)) return` → «guarden går
//     via shouldFetchExpanded» ryker (feilen ville igjen blitt cachet).
//   • Feil-grenen fjernes fra JSX-en → «feil rendres FØR tom-påstanden» ryker.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FIL = 'components/SeasonLeaderboard.tsx'
const SRC = readFileSync(FIL, 'utf8')

// Samme klammetelling som lib/analytics-call-sites.test.ts: [start, slutt) for
// blokken som åpner rett etter `decl` — en ekte syntaktisk grense.
function blokkVed(source: string, braceStart: number, hva: string): { start: number; slutt: number; tekst: string } {
  assert.equal(source[braceStart], '{', `${hva}: forventet «{» ved ${braceStart}`)
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return { start: braceStart, slutt: i + 1, tekst: source.slice(braceStart, i + 1) }
    }
  }
  throw new Error(`fant ikke slutten på ${hva}`)
}

function blokk(source: string, decl: string): { start: number; slutt: number; tekst: string } {
  const start = source.indexOf(decl)
  assert.notEqual(start, -1, `fant ikke «${decl}» i ${FIL} — er koden omskrevet?`)
  assert.equal(source.indexOf(decl, start + 1), -1, `«${decl}» finnes flere ganger — ankeret skiller ikke lenger`)
  return blokkVed(source, source.indexOf('{', start), decl)
}

function antall(source: string, nøkkel: string): number {
  let n = 0
  let i = source.indexOf(nøkkel)
  while (i !== -1) { n++; i = source.indexOf(nøkkel, i + 1) }
  return n
}

describe('fetchExpanded — feilet henting caches som FEIL, ikke som tom liste', () => {
  const fn = blokk(SRC, 'async function fetchExpanded(key: string)')

  test("catch skriver 'error' inn i cachen", () => {
    assert.ok(fn.tekst.includes(".set(key, 'error')"),
      "fetchExpanded sin catch skriver ikke 'error' — en feilet henting vil da utgi seg for noe annet")
  })

  test('catch skriver ALDRI tom liste', () => {
    assert.ok(!fn.tekst.includes('.set(key, [])'),
      'fetchExpanded skriver en tom liste — den rendres som «Ingen data for denne perioden» og caches')
  })

  test('guarden går via shouldFetchExpanded — has() ville cachet feilen', () => {
    assert.ok(fn.tekst.includes('if (!shouldFetchExpanded(expandedData.get(key))) return'),
      "guarden bruker ikke shouldFetchExpanded — da hentes ikke en 'error'-verdi på nytt")
    assert.ok(!fn.tekst.includes('expandedData.has(key)'),
      'has()-guarden er tilbake — den skiller ikke «vet» fra «feilet»')
  })

  test('komponenten importerer guarden fra lib', () => {
    assert.ok(SRC.includes("from '@/lib/expanded-history-state'"),
      'importen av shouldFetchExpanded er borte — bruker komponenten en lokal kopi?')
  })
})

describe('loadHistory — feilet henting settes i histError, histData forblir null', () => {
  const fn = blokk(SRC, 'const loadHistory = useCallback')

  test('både !ok og catch setter histError', () => {
    assert.equal(antall(fn.tekst, 'setHistError(true)'), 2,
      'forventet setHistError(true) i BÅDE !ok-grenen og catch — én av dem har mistet den')
  })

  test('ingen gren skriver tom liste ved feil', () => {
    assert.ok(!fn.tekst.includes('setHistData([])'),
      'loadHistory skriver [] ved feil — det rendres som «Ingen avsluttede perioder ennå» og caches (histData !== null-guarden henter aldri på nytt)')
  })

  test('ok-veien skriver fortsatt serverens liste — ekte tom bevart', () => {
    assert.ok(fn.tekst.includes('setHistData(json.entries ?? [])'),
      'ok-veien skriver ikke lenger entries — ekte tomme perioder må fortsatt kunne vises som «ingen»')
  })

  test('feilen nullstilles ved nytt forsøk OG ved periodebytte', () => {
    // Én i loadHistory (etter guarden) + én i period-reset-effekten.
    assert.equal(antall(SRC, 'setHistError(false)'), 2,
      'forventet setHistError(false) nøyaktig to steder: loadHistory-start og period-reset')
    assert.ok(fn.tekst.includes('setHistError(false)'),
      'loadHistory nullstiller ikke feilen — en stående feil ville overlevd et vellykket nytt forsøk')
  })
})

describe('JSX — feil rendres FØR faktapåstanden, med en vei ut', () => {
  test('utvidet rad: error-gren foran «Ingen data for denne perioden»', () => {
    const feil = SRC.indexOf("expanded === 'error'")
    const påstand = SRC.indexOf('Ingen data for denne perioden')
    assert.notEqual(feil, -1, 'error-grenen for utvidet rad er borte fra JSX-en')
    assert.notEqual(påstand, -1, 'tom-grenen («Ingen data for denne perioden») er borte — ekte tom skal fortsatt vises som ingen')
    assert.ok(feil < påstand, 'error-grenen står ETTER tom-påstanden — feilen vil da rendres som «ingen data»')
    assert.ok(SRC.slice(feil, påstand).includes('fetchExpanded(entry.key)'),
      'error-grenen mangler retry — brukeren har ingen vei ut uten full sidelast')
  })

  test('akkordion: histError-gren foran «Ingen avsluttede perioder ennå»', () => {
    const feil = SRC.indexOf('histError ? (')
    const påstand = SRC.indexOf('Ingen avsluttede perioder ennå')
    assert.notEqual(feil, -1, 'histError-grenen er borte fra akkordion-JSX-en')
    assert.notEqual(påstand, -1, 'tom-grenen («Ingen avsluttede perioder ennå») er borte — ekte tom skal fortsatt vises som ingen')
    assert.ok(feil < påstand, 'histError-grenen står ETTER tom-påstanden — feilen vil da rendres som «ingen perioder»')
    assert.ok(SRC.slice(feil, påstand).includes('loadHistory()'),
      'histError-grenen mangler retry — brukeren har ingen vei ut uten full sidelast')
  })

  test('ordlyden foreslår, ikke låser — «kunne ikke hente», ingen påstand om feltet', () => {
    assert.ok(SRC.includes('Kunne ikke hente topplisten for perioden.'),
      'feilteksten for utvidet rad er borte eller omskrevet til noe som påstår')
    assert.ok(SRC.includes('Kunne ikke hente tidligere perioder.'),
      'feilteksten for akkordionen er borte eller omskrevet til noe som påstår')
  })
})
