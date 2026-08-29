// Kjøres med:  npm test
//
// STRUKTURELL SPERRE for «feil er ikke tomt» i app/leaderboard/[id]/page.tsx
// (29. august 2026). Samme husform som lib/analytics-call-sites.test.ts —
// logikken ligger inline i en React-komponent uten React-testoppsett.
//
// To lesere voktes:
//   1. Browse-effekten (Premium søk/paginering): !ok og catch kollapset begge
//      til browseData=null, som renderBrowseList leste som «Ingen resultater.»
//      — en faktapåstand om et søk vi aldri fikk svar på. Søk og bla er
//      Premiums hovedløfte.
//   2. Hovedlasten: `.then(r => r.ok ? r.json() : null)` gjorde et !ok-svar
//      til soloRes=null → attempts=[] → «Ingen resultater ennå», med
//      fetchError fortsatt false. Nå kastes !ok til catch (fetchError-skjerm
//      med ekte retry).
//
// MUTASJONSBEVIS — feilendringene disse fanger:
//   • Browse-catch tilbake til `setBrowseData(null)` uten setBrowseError
//     → «catch setter browseError» OG «catch nuller ikke data» ryker.
//   • `.then(r => r.ok ? r.json() : null)` tilbake i browse-effekten
//     → «!ok kaster» ryker.
//   • Feil-grenen fjernes fra renderBrowseList → «feil foran tom-påstanden» ryker.
//   • `: null` tilbake på hovedlast-linjen → «hovedlasten kaster på !ok» ryker.
//   • fetchAttempt/browseAttempt ut av dep-listene → retry blir en knapp som
//     ikke virker → dep-testene ryker.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FIL = 'app/leaderboard/[id]/page.tsx'
const SRC = readFileSync(FIL, 'utf8')

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

// Browse-effekten avgrenses av URL-byggingen (unik: eneste med &page=) fram til
// effektens cleanup — en ekte grense, ikke et tegnantall.
function browseEffekt(): string {
  const anker = 'let url = `/api/leaderboard/${quizId}?is_team=false&page=${browsePage}`'
  const start = SRC.indexOf(anker)
  assert.notEqual(start, -1, 'fant ikke browse-effektens URL-bygging — er koden omskrevet?')
  const slutt = SRC.indexOf('return () => { cancelled = true }', start)
  assert.notEqual(slutt, -1, 'fant ikke browse-effektens cleanup etter URL-byggingen')
  return SRC.slice(start, slutt)
}

describe('browse-effekten — !ok og nettverksfeil blir browseError, aldri «tomt»', () => {
  const effekt = browseEffekt()

  test('!ok kaster i stedet for å kollapse til null', () => {
    assert.ok(effekt.includes('if (!r.ok) throw'),
      'browse-fetchen kaster ikke på !ok — et 500-svar blir da til «Ingen resultater.»')
    assert.ok(!effekt.includes('r.ok ? r.json() : null'),
      'kollaps-formen `r.ok ? r.json() : null` er tilbake i browse-effekten')
  })

  test('catch setter browseError — og nuller ikke data til en falsk tom-tilstand', () => {
    assert.ok(effekt.includes('setBrowseError(true)'),
      'browse-catch setter ikke browseError — feilen har ingen egen tilstand')
    assert.ok(!effekt.includes('setBrowseData(null)'),
      'browse-effekten nuller browseData ved feil — null leses som «Ingen resultater.»')
  })

  test('retry-knappen kan faktisk re-kjøre effekten (browseAttempt i deps)', () => {
    assert.ok(SRC.includes('orgSlug, browseAttempt])'),
      'browseAttempt mangler i browse-effektens dep-liste — «Prøv igjen» blir en knapp som ikke virker')
  })
})

describe('renderBrowseList — feil rendres FØR faktapåstanden, med en vei ut', () => {
  const fn = blokk(SRC, 'function renderBrowseList()')

  test('browseError sjekkes før «Ingen resultater.»', () => {
    const feil = fn.tekst.indexOf('if (browseError)')
    const påstand = fn.tekst.indexOf("'Ingen resultater.'")
    assert.notEqual(feil, -1, 'feil-grenen er borte fra renderBrowseList')
    assert.notEqual(påstand, -1, 'tom-grenen («Ingen resultater.») er borte — ekte tom skal fortsatt vises som ingen')
    assert.ok(feil < påstand, 'feil-grenen står ETTER tom-påstanden — en feilet henting vil da vises som «Ingen resultater.»')
  })

  test('ekte tomt søk har fortsatt sin egen tekst', () => {
    assert.ok(fn.tekst.includes('Ingen treff på'),
      'søke-tom-teksten er borte — et ekte tomt søk skal fortsatt si «ingen treff»')
  })

  test('feil-grenen har retry og foreslående ordlyd', () => {
    assert.ok(fn.tekst.includes('setBrowseAttempt'),
      'feil-grenen mangler retry — brukeren har ingen vei ut uten full sidelast')
    assert.ok(fn.tekst.includes('Kunne ikke hente resultatene.'),
      'feilteksten er borte eller omskrevet til noe som påstår noe om feltet')
  })
})

describe('hovedlasten — !ok på liste-kallet er en FEIL, ikke en tom liste', () => {
  test('limit=50-kallet kaster på !ok', () => {
    const anker = 'is_team=false&limit=50'
    assert.equal(antall(SRC, anker), 1, 'limit=50-ankeret skiller ikke lenger — flere forekomster')
    const idx = SRC.indexOf(anker)
    const linjeSlutt = SRC.indexOf('\n', idx)
    const linje = SRC.slice(SRC.lastIndexOf('\n', idx), linjeSlutt)
    assert.ok(linje.includes('throw'),
      'hovedlastens liste-kall kaster ikke på !ok — et 500-svar blir da «Ingen resultater ennå» med fetchError=false')
    assert.ok(!linje.includes('r.ok ? r.json() : null'),
      'kollaps-formen er tilbake på hovedlast-linjen')
  })

  test('feilskjermen har en ekte retry, ikke en beskjed om omlasting', () => {
    const tekst = SRC.indexOf('Kunne ikke laste resultatene.')
    assert.notEqual(tekst, -1, 'feilskjermens tekst er borte')
    const rundt = SRC.slice(tekst, tekst + 1200)
    assert.ok(rundt.includes('setFetchAttempt'), 'feilskjermen mangler retry-knappen')
    assert.ok(rundt.includes('listFetchKeyRef.current = null'),
      'retry nuller ikke paritetsnøkkelen — effektens vakt kortslutter da forsøket (samme identitet)')
    assert.ok(rundt.includes('setLoading(true)'),
      'retry eier ikke loading — knappen ville virket død mens forsøket pågår (lib/retry-affordance.ts)')
    assert.ok(SRC.includes('orgScopeUpgradeRequested, fetchAttempt])'),
      'fetchAttempt mangler i hovedeffektens dep-liste — retry re-kjører ingenting')
  })
})
