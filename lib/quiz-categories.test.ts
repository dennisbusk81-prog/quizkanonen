// Kjøres med:  npm test
//
// Kategorilista (lib/quiz-categories.ts) og KOBLINGEN til de tre stedene som
// bruker den. Fram til 6. september 2026 lå lista i tre hardkodede kopier:
// to dropdown-er og CSV-importens validering. De to første er visning — en
// glemt kategori der er synlig med én gang. Den tredje er en DATAPORT:
//
//   const category = QUIZ_CATEGORIES.includes(rawCategory) ? rawCategory : null
//
// En verdi utenfor lista blir `null`, uten feilmelding og uten spor. En
// kategori lagt til i dropdown-ene men glemt i importen taper altså data
// stille — og med et Kahoot-bibliotek på vei inn via CSV er det ikke en
// teoretisk risiko. Testene under finnes for at de tre ikke skal kunne
// drifte fra hverandre igjen.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • En kategori legges til/fjernes/flyttes i QUIZ_CATEGORIES → «rekkefølgen
//     er nøyaktig den godkjente» ryker (spec-lista under er skrevet ut
//     uavhengig av konstanten, ikke utledet av den).
//   • «Diverse» flyttes bort fra slutten → «Diverse står sist» ryker.
//   • Én av de tre sidene får sin egen lokale liste igjen (mutasjonen «legg
//     en kategori i den ene og ikke de andre») → «ingen av de tre sidene har
//     sin egen kategoriliste» ryker.
//   • En side slutter å importere den delte konstanten → «alle tre importerer
//     samme kilde» ryker.
//   • En dropdown eller CSV-valideringen slutter å lese QUIZ_CATEGORIES →
//     «alle tre brukstedene leser konstanten» ryker.
//   • Antallet i CSV-malens kolonneoverskrift hardkodes igjen → «malens
//     kategoritall er utledet» ryker.
//
// ÆRLIG HULL: koblingstestene er STRUKTURELLE. CSV-parsingen og dropdown-ene
// ligger inne i 'use client'-sider og kan ikke importeres og kjøres herfra, så
// testene leser kildeteksten. De beviser at lista NÅR fram til de tre stedene,
// ikke at parsingen for øvrig er riktig (den har egen dekning i
// lib/quiz-import-route.test.ts). Måles mot AKTIVE linjer — kommentarer
// strippet — jf. «strukturtester trenger linje-anker».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QUIZ_CATEGORIES, QUIZ_CATEGORY_FALLBACK } from './quiz-categories'

// ── Verdien ─────────────────────────────────────────────────────────────────

// Skrevet ut HER, uavhengig av konstanten. En test som gjenbruker
// QUIZ_CATEGORIES for å sjekke QUIZ_CATEGORIES beviser ingenting — den ville
// vært grønn uansett hva lista inneholdt.
const GODKJENT_REKKEFOLGE = [
  'Film & TV',
  'Geografi',
  'Historie',
  'Kunst & Kultur',
  'Litteratur',
  'Mat & Drikke',
  'Merker & Bedrifter',
  'Musikk',
  'Politikk & Samfunn',
  'Språk & Ord',
  'Sport',
  'Teknologi',
  'Vitenskap & Natur',
  'Diverse',
]

test('rekkefølgen er nøyaktig den godkjente — alfabetisk, Diverse sist', () => {
  assert.deepEqual([...QUIZ_CATEGORIES], GODKJENT_REKKEFOLGE)
  assert.equal(QUIZ_CATEGORIES.length, 14)
})

test('de fire nye kategoriene finnes', () => {
  for (const ny of ['Litteratur', 'Teknologi', 'Merker & Bedrifter', 'Språk & Ord']) {
    assert.ok(QUIZ_CATEGORIES.includes(ny), `«${ny}» mangler i lista`)
  }
})

test('de ti opprinnelige kategoriene er beholdt uendret', () => {
  // Eksisterende spørsmål i prod bærer disse strengene. Endres stavemåten
  // her, slutter dropdown-en å matche radene som allerede ligger i basen —
  // og CSV-importen ville begynt å nulle dem ut.
  const opprinnelige = [
    'Diverse', 'Vitenskap & Natur', 'Geografi', 'Film & TV', 'Musikk',
    'Sport', 'Politikk & Samfunn', 'Mat & Drikke', 'Historie', 'Kunst & Kultur',
  ]
  for (const gammel of opprinnelige) {
    assert.ok(QUIZ_CATEGORIES.includes(gammel), `«${gammel}» er borte fra lista`)
  }
})

test('«Diverse» står sist, og fallback-konstanten peker på den', () => {
  // Restkategorien er den ene posisjonen som ikke skal flytte seg når lista
  // vokser — den er samtidig den mest brukte (34 av 199 spørsmål per
  // 2. august 2026).
  assert.equal(QUIZ_CATEGORIES[QUIZ_CATEGORIES.length - 1], 'Diverse')
  assert.equal(QUIZ_CATEGORY_FALLBACK, 'Diverse')
  assert.equal(QUIZ_CATEGORIES.indexOf(QUIZ_CATEGORY_FALLBACK), QUIZ_CATEGORIES.length - 1)
})

test('ingen duplikater, ingen utrimmede strenger', () => {
  // En utrimmet verdi ville gitt en egen bøtte i computeCategoryStats og en
  // dropdown-verdi som ikke matcher raden i basen.
  assert.equal(new Set(QUIZ_CATEGORIES).size, QUIZ_CATEGORIES.length)
  for (const c of QUIZ_CATEGORIES) {
    assert.equal(c, c.trim(), `«${c}» har whitespace i endene`)
    assert.notEqual(c, '', 'tom kategori')
  }
})

test('alle unntatt «Språk & Ord»/«Sport»-paret følger nb-kollasjon', () => {
  // Rekkefølgen er en BESLUTNING, ikke en sortering i kode — men avviket fra
  // maskinsortering skal være akkurat ETT dokumentert par, ikke et generelt
  // frafall. `'Sport'.localeCompare('Språk & Ord', 'nb')` er −1 (tredje tegn
  // «o» mot «r»), så en sortering ville byttet de to. Denne testen låser at
  // det er det ENESTE stedet lista avviker: skulle noen legge inn en ny
  // kategori på feil plass, blir den rød.
  const utenDiverse = GODKJENT_REKKEFOLGE.slice(0, -1)
  const maskinsortert = [...utenDiverse].sort((a, b) => a.localeCompare(b, 'nb'))
  const avvik = utenDiverse
    .map((c, i) => (c === maskinsortert[i] ? null : `${i}: ${c} ≠ ${maskinsortert[i]}`))
    .filter((x): x is string => x !== null)
  assert.deepEqual(avvik, [
    '9: Språk & Ord ≠ Sport',
    '10: Sport ≠ Språk & Ord',
  ])
})

// ── Koblingen: én kilde, tre lesere ─────────────────────────────────────────

const ROT = join(import.meta.dirname, '..')

const NEW_QUIZ = 'app/admin/quizzes/new/page.tsx'
const REDIGER = 'app/admin/quizzes/[id]/questions/page.tsx'
const OVERSIKT = 'app/admin/quizzes/page.tsx'
const SIDENE = [NEW_QUIZ, REDIGER, OVERSIKT]

/**
 * Kildeteksten uten kommentarer og uten BOM.
 *
 * BOM-en må vekk FØR noe leses: filene her starter med «﻿'use client'»,
 * og et linjestart-anker treffer da ikke første linje (jf. «BOM slår ut
 * linjestart-ankeret»). Blokkommentarer strippes med, ellers ville en
 * utkommentert liste oppfylt fraværstesten under.
 */
function aktivKilde(fil: string): string {
  const rå = readFileSync(join(ROT, fil), 'utf8')
  const utenBom = rå.charCodeAt(0) === 0xfeff ? rå.slice(1) : rå
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')
}

test('strippingen virker BEGGE veier — aktiv linje overlever, kommentar ikke', () => {
  // Uten dette beviset kan fraværstesten under være grønn fordi den ikke
  // finner noe som helst, ikke fordi koden er riktig.
  const enFil = aktivKilde(OVERSIKT)
  assert.match(enFil, /QUIZ_CATEGORIES/, 'strippingen spiste hele fila')
  assert.doesNotMatch(enFil, /DATAPORTEN/, 'linjekommentar overlevde strippingen')
})

test('alle tre sidene importerer samme kilde', () => {
  for (const fil of SIDENE) {
    assert.match(
      aktivKilde(fil),
      /^import \{ QUIZ_CATEGORIES \} from '@\/lib\/quiz-categories'\r?$/m,
      `${fil} importerer ikke den delte kategorilista`
    )
  }
})

test('alle tre brukstedene leser konstanten', () => {
  // Importen alene beviser ingenting: en side kunne importert konstanten og
  // likevel rendret noe annet. Her ankres selve kallstedet.
  const spesifikke: Array<[string, RegExp, string]> = [
    [NEW_QUIZ, /\{QUIZ_CATEGORIES\.map\(/, 'dropdown i quiz-byggeren'],
    [REDIGER, /\{QUIZ_CATEGORIES\.map\(/, 'dropdown i spørsmålsredigeringen'],
    [OVERSIKT, /QUIZ_CATEGORIES\.includes\(rawCategory\)/, 'CSV-importens validering'],
  ]
  for (const [fil, re, hva] of spesifikke) {
    assert.match(aktivKilde(fil), re, `${hva} (${fil}) leser ikke QUIZ_CATEGORIES`)
  }
})

test('ingen av de tre sidene har sin egen kategoriliste', () => {
  // DETTE er testen som feller drift-mutasjonen «legg en kategori i den ene
  // og ikke de andre»: enhver gjeninnføring av en lokal liste inneholder
  // flere kategorinavn i samme array-literal.
  //
  // Terskelen er 3 og ikke 1 med vilje. CSV-malens EKSEMPELRADER i
  // app/admin/quizzes/page.tsx inneholder legitimt 'Geografi' og 'Historie'
  // — én kategori hver, som datainnhold og ikke som liste. En liste har
  // mange. Et sted mellom «én eksempelverdi» og «hele lista» må grensen gå,
  // og 3 skiller de to formene som faktisk finnes.
  const arrayLiteraler = /\[[^[\]]*\]/g
  for (const fil of SIDENE) {
    for (const match of aktivKilde(fil).match(arrayLiteraler) ?? []) {
      const treff = QUIZ_CATEGORIES.filter(c => match.includes(`'${c}'`))
      assert.ok(
        treff.length < 3,
        `${fil} har en egen kategoriliste (${treff.length} kategorier: ${treff.join(', ')}). ` +
          'Lista skal komme fra lib/quiz-categories.ts — en kopi her drifter stille.'
      )
    }
  }
})

test('CSV-malens kategoritall er utledet, ikke hardkodet', () => {
  // Kolonneoverskriften i den nedlastbare malen sa «en av de 10 kategoriene».
  // Det er arket Dennis fyller ut FØR en import, så et feil tall der peker
  // rett mot data. Nå leses lengden av lista.
  const kilde = aktivKilde(OVERSIKT)
  assert.match(kilde, /en av de \$\{QUIZ_CATEGORIES\.length\} kategoriene/)
  assert.doesNotMatch(
    kilde,
    /en av de \d+ kategoriene/,
    'antallet er hardkodet igjen — det drifter neste gang lista endres'
  )
})
