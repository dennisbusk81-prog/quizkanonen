// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: at mellomskjermen i components/QuizInterlude.tsx faktisk
// SPØR decideTop10Context, mater den med de riktige kildene, og TEGNER svaret
// — i stedet for å regne differansen selv.
//
// Denne filen og lib/top10-gap.test.ts er to halvdeler av ett bevis.
// Oppførselstesten alene ville godtatt at kallstedet regnet på nytt lokalt;
// denne alene ville godtatt at predikatet svarte feil. Samme deling som
// lib/side-panel-placement.ts + lib/side-panel-placement-wiring.test.ts, og av
// samme grunn: npm test kjører uten jsdom, så JSX-en kan ikke rendres her.
//
// Bakgrunnen for at den finnes: differansen `top10MinCorrect - score` bodde i
// en JSX-IIFE i denne komponenten og ble aldri holdt opp mot gjenværende
// spørsmål. «Du trenger 9 riktige til» med to spørsmål igjen sto på
// spillernes skjermer gjennom fredagsquizen 4. september 2026, med 3082
// grønne tester.
//
// ── HVA DEN BEVISER, OG HVA DEN IKKE BEVISER ────────────────────────────────
// Beviser: kallet står på en AKTIV linje; argumentene er rankingSnapshot,
// score og en questionsLeft utledet av totalQuestions og questionIndex; begge
// grenene tegnes fra predikatets svar; og den rå differansen er BORTE fra hele
// fila. Beviser IKKE at JSX-en er syntaktisk gyldig — det gjør next build.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes/kommenteres kallet → «mellomskjermen spør predikatet» ryker.
//   • Kastes svaret (bart kall som setning) → samme test ryker.
//   • Mates `snapshot: undefined` eller en annen kilde → «kildene» ryker.
//   • Byttes questionsLeft mot et konstanttall → «questionsLeft utledes» ryker.
//   • Tegnes `questionsLeft` i stedet for `top10.needed` → «tallet som tegnes
//     er predikatets» ryker.
//   • Legges `top10MinCorrect - score` tilbake et sted → «ingen rå differanse» ryker.
//   • Slettes «i topp 10»-grenen → «begge grenene tegnes» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// BOM strippes: fila er UTF-8 MED BOM og CRLF. Et `^`-anker ville ellers
// bomme på første linje, og \r ville hengt igjen bakerst på hver linje.
const SRC = readFileSync('components/QuizInterlude.tsx', 'utf8')
  .replace(/^﻿/, '')
  .replace(/\r\n/g, '\n')

function aktiveLinjer(kilde: string): string {
  return kilde
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

const AKTIV = aktiveLinjer(SRC)

/** Argumentteksten til decideTop10Context( … ) — kun den, ikke et vindu rundt. */
function predikatArgument(): string {
  const navn = 'decideTop10Context('
  const start = AKTIV.indexOf(navn)
  assert.notEqual(start, -1, 'decideTop10Context kalles ikke på en aktiv linje i QuizInterlude.tsx')
  assert.equal(AKTIV.indexOf(navn, start + 1), -1, 'decideTop10Context kalles flere ganger — ankeret er ikke unikt')
  let depth = 0
  for (let i = start + navn.length - 1; i < AKTIV.length; i++) {
    if (AKTIV[i] === '(') depth++
    else if (AKTIV[i] === ')') {
      depth--
      if (depth === 0) return AKTIV.slice(start + navn.length, i)
    }
  }
  throw new Error('fant ikke slutten på kallet')
}

// ── Testene ─────────────────────────────────────────────────────────────────

test('mellomskjermen spør predikatet, på en aktiv linje, og bruker svaret', () => {
  assert.match(SRC, /^import \{ decideTop10Context \} from '@\/lib\/top10-gap'$/m,
    'decideTop10Context importeres ikke')
  const linje = AKTIV.split('\n').find(l => l.includes('decideTop10Context('))
  assert.ok(linje, 'decideTop10Context kalles ikke på en aktiv linje')
  // Tilordnet, ikke kastet: et bart kall som setning ville bestått en
  // navnesjekk og tegnet ingenting.
  assert.match(linje!, /=\s*decideTop10Context\(/,
    `svaret fra predikatet brukes ikke: «${linje!.trim()}»`)
})

test('kildene: rankingSnapshot, score og questionsLeft — ikke noe annet', () => {
  const arg = predikatArgument()
  assert.match(arg, /snapshot:\s*rankingSnapshot\b/,
    `snapshot mates ikke med rankingSnapshot: «${arg.trim()}»`)
  assert.match(arg, /\bscore\b/, `score mates ikke inn: «${arg.trim()}»`)
  assert.match(arg, /\bquestionsLeft\b/, `questionsLeft mates ikke inn: «${arg.trim()}»`)
})

test('questionsLeft utledes av totalQuestions og questionIndex, ikke av en konstant', () => {
  // Uttrykket er selve inndataet klamringen hviler på. Byttes det mot et
  // fast tall, eller mot answeredSoFar, blir vakten meningsløs uten at
  // oppførselstesten merker det.
  assert.match(AKTIV, /const questionsLeft = totalQuestions - \(questionIndex \+ 1\)/,
    'questionsLeft utledes ikke av totalQuestions - (questionIndex + 1)')
})

test('begge grenene tegnes fra predikatets svar', () => {
  assert.match(AKTIV, /top10\.kind === 'in-top10'/, '«i topp 10»-grenen leser ikke predikatets svar')
  assert.match(AKTIV, /top10\.kind === 'needed'/, '«du trenger N»-grenen leser ikke predikatets svar')
  assert.ok(AKTIV.includes('Du er i topp 10 akkurat nå'), '«Du er i topp 10 akkurat nå» tegnes ikke lenger')
  assert.ok(AKTIV.includes('til for å komme inn i topp 10'), 'løfte-teksten tegnes ikke lenger')
})

test('tallet som tegnes er predikatets — både i teksten og i entall/flertall', () => {
  assert.ok(AKTIV.includes('{top10.needed} {pluralNo(top10.needed,'),
    'løfte-linja tegner ikke top10.needed i både tallet og pluralNo — tallet kan da avvike fra ordet')
})

test('ingen rå differanse igjen: top10MinCorrect regnes ikke ut i komponenten', () => {
  // Det var nøyaktig denne differansen som var hullet. Kommer den tilbake ved
  // siden av predikatet, har vi to meninger om samme tall på samme skjerm.
  assert.ok(!/top10MinCorrect\s*-/.test(AKTIV),
    'en rå «top10MinCorrect - …»-differanse finnes igjen i QuizInterlude.tsx')
  assert.ok(!AKTIV.includes('neededForTop10'),
    'den gamle uklamrede neededForTop10 finnes fortsatt')
})
