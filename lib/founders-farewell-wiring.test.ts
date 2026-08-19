// Kjøres med:  npm test
//
// KOBLINGSTEST for founders-farvel-flaten. Gate-logikken og stamp-ruta er
// testet for seg (founders-farewell.test.ts, founders-farewell-seen-route.
// test.ts) — men ingen av dem feller at komponenten faktisk BRUKER gaten,
// at alle tre lukkeveiene stempler, eller at forsiden faktisk monterer
// komponenten. Uten denne kunne gaten fjernes fra komponenten, eller
// komponenten fra forsiden, uten at én test ble rød (samme hull som
// middleware-cookie-guard-koblingen, der bare den rene logikken er dekket).
//
// Ankrene måles mot AKTIVE linjer (kommentarer strippet) — en utkommentert
// gate skal ikke passere. Jf. «strukturtester trenger linje-anker».
//
// MUTASJONSBEVIS (alle kjørt, se rapporten 19. august 2026):
//   • Fjernes shouldShowFoundersFarewell-kallet fra komponenten → rød.
//   • Fjernes onClick={stamp} fra én av de tre lukkeveiene → rød.
//   • Fjernes <FoundersFarewellBanner /> fra forsiden → rød.
//   • Byttes fetch-målet bort fra den ekte rutestien → rød.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function activeLines(relPath: string): string[] {
  const raw = readFileSync(join(process.cwd(), relPath), 'utf8')
  return raw
    .split('\n')
    .map(l => l.trim())
    // Strippes: linjekommentarer og JSX-/blokkommentar-linjer. Grovt, men
    // tilstrekkelig: ankrene under er valgt så de ikke kan stå naturlig i
    // løpende kommentartekst (funksjonskall med paren, JSX med `<`).
    .filter(l => l && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('{/*'))
}

test('komponenten gater synligheten via shouldShowFoundersFarewell', () => {
  const lines = activeLines('components/FoundersFarewellBanner.tsx')
  assert.ok(
    lines.some(l => l.includes('!shouldShowFoundersFarewell(')),
    'FoundersFarewellBanner må avgjøre synlighet med gaten i lib/founders-farewell.ts — ikke en lokal kopi',
  )
})

test('alle tre lukkeveiene stempler: X, Premium-CTA og «Ikke nå»', () => {
  const lines = activeLines('components/FoundersFarewellBanner.tsx')
  const stampClicks = lines.filter(l => l.includes('onClick={stamp}')).length
  assert.equal(
    stampClicks,
    3,
    'nøyaktig tre onClick={stamp} — faller én lukkevei ut, kan flaten lukkes uten å stemples og vises igjen',
  )
})

test('stempelet går til den ekte ruta', () => {
  const lines = activeLines('components/FoundersFarewellBanner.tsx')
  assert.ok(
    lines.some(l => l.includes("'/api/profile/founders-farewell-seen'")),
    'komponenten må kalle POST /api/profile/founders-farewell-seen — stien testene i founders-farewell-seen-route.test.ts feller',
  )
})

test('forsiden monterer flaten', () => {
  const lines = activeLines('app/page.tsx')
  assert.ok(
    lines.some(l => l.includes('<FoundersFarewellBanner')),
    'app/page.tsx må rendre <FoundersFarewellBanner /> — gaten er verdiløs hvis komponenten aldri monteres',
  )
})
