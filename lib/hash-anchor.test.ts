// Kjøres med:  npm test
//   enkelt:    node --import ./scripts/ts-node-resolve.mjs --test lib/hash-anchor.test.ts
//
// ÆRLIG AVGRENSNING, les denne før du stoler på at testene dekker feilen:
// selve hoppet er NETTLESEROPPFØRSEL. At `window.scrollTo` faktisk flytter
// siden, at 68 px klarerer den klebrige topplinja, og at elementet er malt når
// vi måler det, kan ikke felles av node --test — det finnes ingen DOM her.
// Det som ER ren logikk — «skal vi hoppe nå?» — er skilt ut i
// lib/hash-anchor.ts og testet under. Resten er en KOBLINGS-test: at
// beslutningen henger på `loadState` og ikke på en timeout, og at effekten
// kjører på nytt når et ankerkort kan ha dukket opp. Den siste biten (at det
// ser riktig ut i en ekte nettleser, innlogget) må verifiseres manuelt.
//
// MUTASJONSBEVIS (9. september 2026):
//   • `if (!input.contentReady) return { jump: false }` fjernet i hash-anchor.ts
//        → «ingen hopp før innholdet er lastet» rød
//   • `contentReady: loadState === 'ready'` → `contentReady: true` i profilsiden
//        → «hoppet henger på loadState» rød
//   • deps `[loadState, abonnement]` → `[]` (fjerner det ANDRE forsøket, så
//     hoppet kun kan skje ved montering)
//        → «effekten prøver på nytt» rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { decideHashScroll, ANCHOR_SCROLL_OFFSET } from './hash-anchor'

// ── 1) Beslutningen ─────────────────────────────────────────────────────────

test('ingen hopp før innholdet er lastet — dette er hele feilen', () => {
  // Ved første render står skjelettene der og #varsler finnes ikke i DOM-en.
  assert.deepEqual(
    decideHashScroll({ hash: '#varsler', contentReady: false, alreadyJumped: false }),
    { jump: false },
  )
})

test('hopp når innholdet ER lastet', () => {
  assert.deepEqual(
    decideHashScroll({ hash: '#varsler', contentReady: true, alreadyJumped: false }),
    { jump: true, targetId: 'varsler' },
  )
})

test('#abonnement behandles av samme beslutning — ikke en egen løsning', () => {
  assert.deepEqual(
    decideHashScroll({ hash: '#abonnement', contentReady: true, alreadyJumped: false }),
    { jump: true, targetId: 'abonnement' },
  )
})

test('ingen hash → ingen hopp', () => {
  assert.deepEqual(decideHashScroll({ hash: '', contentReady: true, alreadyJumped: false }), { jump: false })
  assert.deepEqual(decideHashScroll({ hash: '#', contentReady: true, alreadyJumped: false }), { jump: false })
})

test('ett hopp per sidevisning — vi drar ikke brukeren tilbake mens hun scroller', () => {
  assert.deepEqual(
    decideHashScroll({ hash: '#varsler', contentReady: true, alreadyJumped: true }),
    { jump: false },
  )
})

test('hash-en kommer fra URL-en og hvitelistes', () => {
  for (const hash of ['#a b', '#<script>', '#"onload=x', '#1tall', '#%E0%A4%A', '#' + 'a'.repeat(200)]) {
    assert.deepEqual(
      decideHashScroll({ hash, contentReady: true, alreadyJumped: false }),
      { jump: false },
      `hash ${hash} skulle vært avvist`,
    )
  }
})

test('offseten klarerer den klebrige topplinja (SiteNav er 54 px høy)', () => {
  assert.ok(ANCHOR_SCROLL_OFFSET > 54, 'et hopp uten klaring legger kortets overkant under topplinja')
})

// ── 2) Koblingen på profilsiden ─────────────────────────────────────────────

function les(rel: string): string {
  const raw = readFileSync(path.join(process.cwd(), rel), 'utf8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/** Kun linjer som faktisk kjører — en utkommentert effekt skal ikke telle. */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*')
    })
    .join('\n')
}

const PROFIL = aktiveLinjer(les('app/profil/page.tsx'))

/** Selve hopp-effekten, fra decideHashScroll-kallet til dens deps-liste. */
function hoppEffekt(): string {
  const start = PROFIL.indexOf('const beslutning = decideHashScroll({')
  assert.ok(start > 0, 'fant ikke hopp-effekten på profilsiden')
  const slutt = PROFIL.indexOf('})', PROFIL.indexOf('window.scrollTo({', start))
  assert.ok(slutt > start, 'fant ikke slutten av hopp-effekten')
  return PROFIL.slice(start, PROFIL.indexOf('\n', PROFIL.indexOf(', [', slutt)))
}

test('hoppet henger på loadState — ikke på en timeout', () => {
  const effekt = hoppEffekt()
  assert.ok(
    effekt.includes("contentReady: loadState === 'ready'"),
    'hoppet skal betinges av at profildata er inne',
  )
  assert.ok(!effekt.includes('setTimeout'), 'en timeout gjetter på når siden er ferdig')
})

test('effekten prøver på nytt — deps dekker BEGGE gatene et ankerkort kan ligge bak', () => {
  const effekt = hoppEffekt()
  assert.ok(
    effekt.includes('}, [loadState, abonnement])'),
    'uten loadState skjer hoppet kun ved montering (der ankeret ikke finnes); ' +
    'uten abonnement bommer #abonnement når ProfileProvider lander etter loadState',
  )
})

test('vi stempler først når elementet FAKTISK ble funnet', () => {
  const effekt = hoppEffekt()
  const funnet = effekt.indexOf('if (!el) return')
  const stemplet = effekt.indexOf('hashJumpedRef.current = true')
  assert.ok(funnet > 0 && stemplet > funnet, 'stemples det før oppslaget, får kortet aldri et nytt forsøk')
})

test('begge ankrene finnes i DOM-en profilsiden rendrer når den er ferdig', () => {
  assert.ok(PROFIL.includes('id="varsler"'), '#varsler mangler')
  assert.ok(PROFIL.includes('id="abonnement"'), '#abonnement mangler')
})

test('ÉN løsning for begge ankrene — ingen id-spesifikk gren', () => {
  const effekt = hoppEffekt()
  assert.ok(!effekt.includes('varsler'), 'hopp-effekten skal ikke nevne en konkret id')
  assert.ok(!effekt.includes('abonnement') || effekt.includes('}, [loadState, abonnement])'),
    'eneste tillatte forekomst av «abonnement» i effekten er deps-lista')
  assert.equal(PROFIL.split('decideHashScroll(').length - 1, 1, 'beslutningen skal tas ett sted')
})
