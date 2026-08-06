// Kjøres med:  npm test
//
// STRUKTURELL SPERRE mot at load() i app/historikk/page.tsx igjen kalles uten
// .catch — og mot at feiltilstanden mister utveien sin.
//
// BAKGRUNN
// 6. august 2026: load() ble kalt bart. Kastet fetch('/api/historikk?page=0')
// (offline, DNS, avbrutt forbindelse) eller res.json(), ble det en uhåndtert
// rejection og loadState sto på 'loading' for alltid — spinner uten tekst,
// uten utvei. !res.ok VAR håndtert; det var den kastede fetchen som ikke var
// det. Forbildet er app/liga/page.tsx, som har hatt nøyaktig dette mønsteret
// hele tiden: load().catch(() => setLoadState('error')).
//
// Hvorfor en kildetekst-test: samme begrunnelse som lib/finish-quiz-timeout
// .test.ts — effekten ligger inline i en klientkomponent uten React-testoppsett
// i prosjektet, og det som gikk galt var wiringen (et manglende .catch), ikke
// logikk som kan trekkes ut.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes .catch fra load()-kallet → «load() bærer en .catch» ryker.
//   • Ruter catchen til noe annet enn 'error'-tilstanden → samme test ryker.
//   • Fjernes «Prøv igjen»-lenken fra feilskjermen → «feiltilstanden har en
//     vei videre» ryker.
//   • Samme mutasjoner i forbildet /liga fanges av speiltestene nederst —
//     mønsteret skal ikke kunne råtne i kilden det kopieres fra heller.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HISTORIKK = readFileSync('app/historikk/page.tsx', 'utf8')
const LIGA = readFileSync('app/liga/page.tsx', 'utf8')

test('historikk: load() bærer en .catch som ruter til error-tilstanden', () => {
  assert.ok(
    /load\(\)\.catch\(\(\) => \{ if \(!cancelled\) setLoadState\('error'\) \}\)/.test(HISTORIKK),
    'load() i /historikk kalles uten .catch(() => setLoadState(\'error\')) — en kastende fetch lar spinneren stå for alltid',
  )
})

test('historikk: feiltilstanden har en vei videre', () => {
  const idx = HISTORIKK.indexOf("loadState === 'error'")
  assert.notEqual(idx, -1, 'fant ikke error-grenen i /historikk')
  const branch = HISTORIKK.slice(idx, idx + 1200)
  assert.ok(/href="\/historikk"/.test(branch),
    'feilskjermen i /historikk mangler «Prøv igjen»-lenken — brukeren står uten vei videre')
})

test('forbildet /liga har fortsatt samme mønster', () => {
  assert.ok(
    /load\(\)\.catch\(\(\) => \{ if \(!cancelled\) setLoadState\('error'\) \}\)/.test(LIGA),
    'load() i /liga har mistet .catch-en sin — det er forbildet /historikk kopierer',
  )
  const idx = LIGA.indexOf("loadState === 'error'")
  assert.notEqual(idx, -1, 'fant ikke error-grenen i /liga')
  assert.ok(/href="\/liga"/.test(LIGA.slice(idx, idx + 1200)),
    'feilskjermen i /liga mangler «Prøv igjen»-lenken')
})
