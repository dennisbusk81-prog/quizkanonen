// Kjøres med:  npm test
//
// Premium-fordelslista (lib/premium-features.ts, 9. september 2026): ÉN kilde,
// lest av forsiden og /premium. Fram til nå lå lista i to kopier holdt like
// på ære; kanonkule-punktet ville vært det første som driftet. Testen binder:
//   • innholdet: kanonkule-punktet står, ordrett, med tallet fra kvoten
//   • flatene: begge importerer og mapper PREMIUM_FEATURES, og ingen av dem
//     har en egen kopi av lista lenger (aktive linjer — en utkommentert
//     kopi teller ikke)
//
// MUTASJONSBEVIS (9. september 2026):
//   • `${GENERATION_QUOTA.premium}` → `30` skrevet som tekst   → kvote-bindingen rød
//   • PREMIUM_GENERATOR_FEATURE fjernet fra lista              → «står i lista»-testen rød
//   • forsiden får en egen kopi av ett punkt tilbake            → «ingen kopi»-testen rød
//   • /premium mapper en lokal FEATURES igjen                  → import-/map-testen rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PREMIUM_FEATURES, PREMIUM_GENERATOR_FEATURE } from '@/lib/premium-features'
import { GENERATION_QUOTA } from '@/lib/generated-quiz-rules'

function les(rel: string): string {
  const raw = readFileSync(path.join(process.cwd(), rel), 'utf8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/** Kun linjer som faktisk kjører — en utkommentert kopi skal ikke telle. */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*')
    })
    .join('\n')
}

const FORSIDEN = aktiveLinjer(les('app/page.tsx'))
const PREMIUM = aktiveLinjer(les('app/premium/page.tsx'))

// ── Innholdet ───────────────────────────────────────────────────────────────

test('kanonkule-punktet er ordrett, og tallet er kvoten fra generatoren', () => {
  assert.equal(PREMIUM_GENERATOR_FEATURE, 'Generer opptil 30 ekstraquizer i måneden fra spørsmålsbanken — du velger kategori')
  assert.equal(GENERATION_QUOTA.premium, 30)
  assert.equal(
    PREMIUM_GENERATOR_FEATURE,
    `Generer opptil ${GENERATION_QUOTA.premium} ekstraquizer i måneden fra spørsmålsbanken — du velger kategori`,
    'tallet i punktet følger ikke GENERATION_QUOTA.premium',
  )
})

test('tallet er IKKE skrevet som tekst i kildefila', () => {
  const src = aktiveLinjer(les('lib/premium-features.ts'))
  assert.doesNotMatch(src, /opptil 30 /, '«30» står som tekst — skal komme fra GENERATION_QUOTA.premium')
  assert.match(src, /\$\{GENERATION_QUOTA\.premium\}/)
})

test('kanonkule-punktet står i lista, nøyaktig én gang', () => {
  assert.equal(PREMIUM_FEATURES.filter(f => f === PREMIUM_GENERATOR_FEATURE).length, 1)
})

test('lista er unik og uten tomme punkter', () => {
  assert.equal(new Set(PREMIUM_FEATURES).size, PREMIUM_FEATURES.length)
  assert.ok(PREMIUM_FEATURES.every(f => f.trim().length > 0))
})

// ── Flatene ─────────────────────────────────────────────────────────────────

test('forsiden importerer og mapper PREMIUM_FEATURES', () => {
  assert.match(FORSIDEN, /import \{ PREMIUM_FEATURES \} from '@\/lib\/premium-features'/)
  assert.match(FORSIDEN, /\{PREMIUM_FEATURES\.map\(f => \(/)
})

test('/premium importerer og mapper PREMIUM_FEATURES — ingen lokal FEATURES', () => {
  assert.match(PREMIUM, /import \{ PREMIUM_FEATURES \} from '@\/lib\/premium-features'/)
  assert.match(PREMIUM, /\{PREMIUM_FEATURES\.map\(f => \(/)
  assert.doesNotMatch(PREMIUM, /const FEATURES\b/)
  assert.doesNotMatch(PREMIUM, /\{FEATURES\.map/)
})

test('ingen av flatene har en egen kopi av lista lenger', () => {
  // Hvert punkt i den delte lista skal finnes NULL steder i flatene selv —
  // står ett av dem der, er kopien tilbake og listene kan drifte.
  for (const punkt of PREMIUM_FEATURES) {
    assert.ok(!FORSIDEN.includes(punkt), `forsiden har en egen kopi: «${punkt.slice(0, 40)}…»`)
    assert.ok(!PREMIUM.includes(punkt), `/premium har en egen kopi: «${punkt.slice(0, 40)}…»`)
  }
})

test('POSITIV KONTROLL: kortet og oppsalgsteksten på forsiden finnes fortsatt', () => {
  // Uten denne ville «ingen kopi» passert like fint om hele Premium-kortet
  // var slettet.
  assert.match(FORSIDEN, /Dette får du med Premium/)
  assert.match(FORSIDEN, /Premium for deg som vil mer enn bare svare riktig/)
})
