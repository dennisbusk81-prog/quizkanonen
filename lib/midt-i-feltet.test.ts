// Kjøres med:  npm test
//
// «Midt i feltet» — én definisjon, og de tre flatene er BUNDET til den.
//
// BAKGRUNN (11. september 2026)
// Regnestykket lå i tre kopier. De to live-flatene brukte `floor(N/2)`; det
// nye resultatkortet ble skrevet med `ceil(N/2)`. For ODDE N gir de to samme
// svar, så uenigheten var usynlig annenhver uke — og traff først ved partall:
// N=68 gir plass 35 med floor+1 og 34 med ceil. Bildet og delingsteksten i
// SAMME Facebook-innlegg kunne dermed oppgi hvert sitt navn på samme plass.
//
// `floor(N/2) + 1` vant fordi den allerede sto i publiserte innlegg.
//
// ── HVORFOR EN BINDINGSTEST OG IKKE BARE VERDITESTER ───────────────────────
// Verditester på helperen ville vært grønne selv om alle tre flatene hadde
// beholdt sine egne kopier. Det var nettopp det som var tilstanden før:
// results-ruta bar kommentaren «Samme definisjon som midt på treet i
// quiz-results-text: floor(total/2)» rett over sin EGEN kopi av uttrykket.
// En påstand om paritet, ikke en kobling — og den fanget ikke opp at en
// tredje flate kom med en tredje formel.
//
// Testene under krever derfor tre ting av hver flate: at den IMPORTERER
// helperen, at den KALLER den på en aktiv linje, og at den ikke har et eget
// halveringsuttrykk igjen.
//
// ÆRLIG HULL: lista `FLATER` er håndholdt. En FJERDE flate som regner ut
// midten selv blir ikke fanget av noen test her — den må legges til i lista
// bevisst. Testen verner mot at de tre kjente drifter fra hverandre igjen,
// ikke mot at en ny kopi oppstår et sted ingen har tenkt på.
//
// Kommentarer strippes før søk. Uten det ville filenes egne kommentarer —
// som siterer `floor(total/2)` for å forklare historikken — holdt
// fraværstesten grønn med uttrykket tilbake i koden.
//
// MUTASJONSBEVIS. Hver mutasjon faktisk skrevet til fila, forekomstene talt
// før og etter, testene kjørt, deretter rullet tilbake. Baseline 34/34 grønne
// både før og etter runden. Antall FEILENDE tester per mutasjon:
//   • `Math.floor` → `Math.ceil` i midtIndeks                     → 7
//   • `indeks + 1` → `indeks` i midtPlassering                    → 9
//   • terskelen `deltakere < MIN_FELT_FOR_MIDTEN` nøytralisert    → 1
//   • quiz-results-text regner `Math.floor(total / 2)` selv igjen → 2
//   • quiz-results-text mister importen                           → 1
//   • resultatkort.ts mister importen                             → 15
//   • results-ruta regner `Math.floor(total / 2)` selv igjen      → 2
//
// De tre siste er poenget med fila: en flate som tar tilbake sitt eget
// regnestykke blir rød, ikke stille uenig.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { midtIndeks, midtPlassering, MIN_FELT_FOR_MIDTEN } from './midt-i-feltet'

// ── Verdiene ────────────────────────────────────────────────────────────────

test('plasseringen er floor(N/2) + 1 — den formen som står i publiserte innlegg', () => {
  assert.equal(midtPlassering(67), 34)
  assert.equal(midtPlassering(68), 35)
  assert.equal(midtPlassering(3), 2)
  assert.equal(midtPlassering(10), 6)
  assert.equal(midtPlassering(100), 51)
})

test('PARTALL er hele poenget: 68 deltakere gir plass 35, ikke 34', () => {
  // ceil(68/2) = 34. Det var kortets gamle svar, og det er dette tallet
  // uenigheten mellom bildet og teksten besto av.
  assert.equal(midtPlassering(68), 35)
  assert.notEqual(midtPlassering(68), Math.ceil(68 / 2))
})

test('ODDE N skjulte feilen: begge formlene ga 34 av 67', () => {
  assert.equal(midtPlassering(67), 34)
  assert.equal(midtPlassering(67), Math.ceil(67 / 2))
})

test('indeksen er 0-basert og plasseringen 1-basert, alltid ett fra hverandre', () => {
  for (let n = MIN_FELT_FOR_MIDTEN; n <= 200; n++) {
    const i = midtIndeks(n)
    const p = midtPlassering(n)
    assert.notEqual(i, null, `N=${n} ga ingen indeks`)
    assert.equal(p, (i as number) + 1, `N=${n}: plassering og indeks i utakt`)
    // Indeksen må peke inne i et felt på N.
    assert.ok((i as number) >= 0 && (i as number) < n, `N=${n}: indeks ${i} utenfor feltet`)
  }
})

test('for lite felt gir null, ikke 0 — kalleren indekserer med svaret', () => {
  // Med 0 ville `players[0]` gitt VINNEREN presentert som midtmannen.
  for (const n of [0, 1, 2]) {
    assert.equal(midtIndeks(n), null, `N=${n} skulle gitt null`)
    assert.equal(midtPlassering(n), null, `N=${n} skulle gitt null`)
  }
  assert.equal(MIN_FELT_FOR_MIDTEN, 3)
  assert.equal(midtIndeks(3), 1)
})

test('søppelinput gir null i stedet for NaN videre inn i en spørring', () => {
  assert.equal(midtIndeks(Number.NaN), null)
  assert.equal(midtIndeks(Number.POSITIVE_INFINITY), null)
  assert.equal(midtIndeks(-5), null)
})

// ── Bindingen: flatene leser helperen, og har ingen egen kopi ───────────────

function utenKommentarer(kilde: string): string {
  return kilde
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const FLATER = [
  {
    navn: 'delingsteksten (quiz-results-text)',
    sti: '../app/api/admin/quiz-results-text/route.ts',
    // Trenger både indeksen (som .range()-offset) og plasseringen (vises).
    kall: ['midtIndeks(', 'midtPlassering('],
  },
  {
    navn: 'admin resultatside (quizzes/[id]/results)',
    sti: '../app/api/admin/quizzes/[id]/results/route.ts',
    kall: ['midtIndeks('],
  },
  {
    navn: 'resultatkortet (lib/resultatkort)',
    sti: './resultatkort.ts',
    kall: ['midtPlassering('],
  },
]

// Et eget halveringsuttrykk. Matcher `Math.floor(total / 2)`,
// `Math.ceil(deltakere/2)`, `Math.round(n / 2)` — altså nøyaktig den formen
// de tre kopiene hadde.
const EGEN_HALVERING = /Math\.(floor|ceil|round)\s*\([^\n]*\/\s*2\s*\)/

for (const flate of FLATER) {
  const KILDE = utenKommentarer(
    readFileSync(new URL(flate.sti, import.meta.url), 'utf8')
  )

  test(`${flate.navn}: importerer den delte definisjonen`, () => {
    assert.match(
      KILDE,
      /import\s*\{[^}]*midt(Indeks|Plassering)[^}]*\}\s*from\s*['"][^'"]*midt-i-feltet['"]/,
      'fant ingen aktiv import av midt-i-feltet',
    )
  })

  test(`${flate.navn}: kaller den delte definisjonen`, () => {
    for (const kall of flate.kall) {
      assert.ok(
        KILDE.includes(kall),
        `fant ikke kallet ${kall} på en aktiv linje`,
      )
    }
  })

  test(`${flate.navn}: har ingen egen halvering igjen`, () => {
    const treff = KILDE.match(EGEN_HALVERING)
    assert.equal(
      treff, null,
      `regner ut midten selv: ${treff?.[0]} — definisjonen skal komme fra lib/midt-i-feltet.ts`,
    )
  })
}

test('regexen for egen halvering ville faktisk fanget de gamle kopiene', () => {
  // Uten denne ville en fraværstest som ALDRI kan slå ut sett like grønn ut
  // som en som virker. De tre strengene er de faktiske uttrykkene som sto i
  // koden før 11. september 2026.
  assert.match('  const midIdx = Math.floor(total / 2)', EGEN_HALVERING)
  assert.match('  return Math.ceil(deltakere / 2)', EGEN_HALVERING)
  assert.match('const m = Math.round(n/2)', EGEN_HALVERING)
  // Og den skal ikke slå ut på noe som ikke er en halvering.
  assert.doesNotMatch('const x = Math.floor(ms / 1000)', EGEN_HALVERING)
  assert.doesNotMatch('const y = total / 2', EGEN_HALVERING)
})
