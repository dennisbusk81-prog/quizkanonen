import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { autoDismissMs, ADMIN_FEEDBACK_SUCCESS_MS } from './admin-feedback'

// ── MUTASJONER SOM SKAL GI RØDT ─────────────────────────────────────────────
//   1. "type === 'error' ? null : ADMIN_FEEDBACK_SUCCESS_MS"
//      → "ADMIN_FEEDBACK_SUCCESS_MS"      (tilbake til gammel oppførsel)
//   2. samme uttrykk → "null"             (også kvitteringer blir stående)
//   3. "? null :" → "? 30000 :"           (feil «løst» med en lengre timer)

test('en kvittering forsvinner av seg selv — uendret', () => {
  assert.equal(autoDismissMs('success'), ADMIN_FEEDBACK_SUCCESS_MS)
})

test('en FEIL får ingen timer i det hele tatt', () => {
  // Kjernen i fiksen. null, ikke «lenge» — se kommentaren i kilden.
  assert.equal(autoDismissMs('error'), null)
})

test('feil får ALDRI et tall, uansett hvor stort', () => {
  // Denne feller «vi løser det med 30 sekunder i stedet». En feilmelding som
  // rekker å forsvinne er den samme feilen, bare tregere.
  const ms = autoDismissMs('error')
  assert.equal(typeof ms, 'object', `fikk ${ms} — en timer er ikke svaret`)
})

test('de to typene behandles ULIKT — det er hele poenget', () => {
  assert.notEqual(autoDismissMs('error'), autoDismissMs('success'))
})

// ── SØSKEN, funnet 19. august ───────────────────────────────────────────────
//
// 6424f85 tok de fire sidene som hadde et `showFeedback`. To sider til hadde
// SAMME feil i en annen innpakning — et bart `setTimeout(() => setFeedback(null),
// N)` rett på et typet {type, msg}-objekt, altså en feilmelding som forsvant på
// nøyaktig samme måte som en kvittering:
//
//   app/admin/page.tsx:471                       3000 ms
//   app/admin/quizzes/[id]/analytics/page.tsx:592 5000 ms
//
// Testene under er strukturelle fordi effekten ligger inline i en
// klientkomponent uten React-testoppsett i prosjektet — samme begrunnelse som
// lib/historikk-load-catch.ts. Ankeret ^\s* holder påstandene på AKTIVE linjer;
// en substring-regex ville bestått på utkommentert kode.
//
// MUTASJONSBEVIS (alle kjørt):
//   • `if (delay !== null)` fjernet fra showFeedback → «timeren er betinget» ryker
//   • et bart `setTimeout(() => setFeedback(null), 5000)` lagt tilbake → «ingen
//     ubetinget nullstilling» ryker
//   • «Lukk»-knappen fjernet → «feilen har en vei ut» ryker

const FEEDBACK_PAGES: { file: string; label: string }[] = [
  { file: 'app/admin/codes/page.tsx',                   label: 'codes' },
  { file: 'app/admin/org-trial-codes/page.tsx',         label: 'org-trial-codes' },
  { file: 'app/admin/quizzes/page.tsx',                 label: 'quizzes' },
  { file: 'app/admin/quizzes/[id]/questions/page.tsx',  label: 'quizzes/[id]/questions' },
  { file: 'app/admin/page.tsx',                         label: 'admin/page' },
  { file: 'app/admin/quizzes/[id]/analytics/page.tsx',  label: 'analytics' },
]

for (const { file, label } of FEEDBACK_PAGES) {
  const src = readFileSync(file, 'utf8')

  test(`${label}: timeren er BETINGET av autoDismissMs`, () => {
    assert.match(src, /^import \{[^}]*autoDismissMs[^}]*\} from '@\/lib\/admin-feedback'/m,
      `${label} importerer ikke autoDismissMs`)
    assert.match(src, /^\s*const delay = autoDismissMs\(type\)/m,
      `${label} spør ikke autoDismissMs om typen`)
    assert.match(src, /^\s*if \(delay !== null\) \{/m,
      `${label} setter timeren ubetinget — da får en feil timer igjen`)
  })

  test(`${label}: ingen bar setFeedback(null)-timer utenom den betingede`, () => {
    // Nøyaktig formen som var feilen: en timer rett på setFeedback(null) uten
    // at noen har spurt hvilken TYPE melding som står der.
    const bare = src.match(/^\s*setTimeout\(\(\) => setFeedback\(null\)[^\n]*\)$/gm) ?? []
    assert.deepEqual(bare, [],
      `${label} har en ubetinget setFeedback(null)-timer igjen: ${bare.join(' | ')}`)
  })

  test(`${label}: en feil har en vei ut som ikke er å laste siden på nytt`, () => {
    assert.match(src, /^\s*function dismissFeedback\(\) \{/m,
      `${label} mangler dismissFeedback`)
    assert.match(src, /aria-label="Lukk feilmelding"/,
      `${label}: feilmeldingen blir stående uten en «Lukk»-knapp — verre enn før`)
  })
}
