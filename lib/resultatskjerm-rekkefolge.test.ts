// Kjøres med:  npm test
//
// REKKEFØLGEN PÅ RESULTATSKJERMEN (app/quiz/[id]/page.tsx), låst i kildeorden.
//
// Beslutning 12. september 2026 (Dennis): spillerens eget utfall — riktige
// svar, score/tid/streak og plasseringskortet med premium-linja — skal stå
// samlet, og «Topp 3 denne uken» kommer ETTER. Fram til da lå Topp 3 mellom
// stats-raden og plasseringskortet (225 px om andre spillere midt i eget
// resultat) og skjøv premium-linja til 671 px på 375 px bredde — under
// Safari-folden på både 812- og 667-enheter (synlig høyde ~635/553).
//
// En strukturtest kan ikke se hvor på skjermen noe havner, men den kan se om
// A står før B i kilden — og «finnes» er for svakt når kravet er «sees»
// (arbeidsregel 9. september 2026). Panelets plass i CTA-kolonna er låst i
// lib/premium-cta-tekst.test.ts; denne fila låser resten av kolonna.
//
// MUTASJONSBEVIS:
//   • Topp 3 flyttes tilbake foran org-/plasseringskortet → «etter plasseringskortet» rød
//   • Topp 3 flyttes ned under kategoriene                → «før divideren» rød
//   • Topp 3-blokka fjernes                               → «finnes nøyaktig én gang» rød
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const raw = readFileSync('app/quiz/[id]/page.tsx', 'utf8')
const SRC = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

function en(navn: string, needle: string): number {
  const i = SRC.indexOf(needle)
  assert.notEqual(i, -1, `fant ikke ankeret «${navn}» — er resultatskjermen omskrevet?`)
  assert.equal(SRC.indexOf(needle, i + 1), -1, `ankeret «${navn}» finnes flere ganger og skiller ikke lenger`)
  return i
}

describe('Topp 3 står etter spillerens eget utfall, før kategoriene', () => {
  const topp3 = en('Topp 3-blokka', '{/* ── Topp 3 denne uken — for alle brukere ── */}')
  const riktige = en('riktige svar-kortet', '{/* Riktige svar — stor hero-visning */}')
  const stats = en('støtte-stats', '{/* Tre støtte-stats */}')
  const orgKort = en('org-internt plasseringskort', "{placementDisplay.mode === 'internal-only' && internalPlacement && (() => {")
  const plassering = en('plasseringskortet', 'const placementView = decideResultPlacementView({')
  // Divideren finnes også på tidligere faser — den som gjelder er den første
  // ETTER plasseringskortet.
  const divider = SRC.indexOf('<div className="qk-divider"/>', plassering)
  assert.notEqual(divider, -1, 'fant ikke divideren etter plasseringskortet')
  const kategorier = en('kategoriblokka', 'const cats = computeCategoryStats(answers, questions)')

  test('eget utfall først: riktige svar → stats → plasseringskort (org-variant og global)', () => {
    assert.ok(riktige < stats && stats < orgKort && orgKort < plassering, 'eget-utfall-blokkene har byttet rekkefølge')
  })

  test('Topp 3 står ETTER plasseringskortet — ikke midt i eget resultat', () => {
    assert.ok(topp3 > plassering, 'Topp 3 ligger foran plasseringskortet igjen — premium-linja skyves under folden')
    assert.ok(topp3 > orgKort, 'Topp 3 ligger foran det org-interne plasseringskortet')
  })

  test('Topp 3 står FØR divideren og kategoriene', () => {
    assert.ok(topp3 < divider, 'Topp 3 har havnet under divideren')
    assert.ok(topp3 < kategorier, 'Topp 3 har havnet under kategoriene')
  })

  test('innholdet og gaten i Topp 3 er urørt', () => {
    const blokk = SRC.slice(topp3, divider)
    assert.match(blokk, /\{top3\.length > 0 && \(/, 'gaten `top3.length > 0` er borte')
    assert.match(blokk, /Topp 3 denne uken\s*<\/p>/, 'overskriften er endret')
    assert.match(blokk, /const isMe = !!attemptId && row\.id === attemptId/, 'isMe-markeringen er borte')
  })
})
