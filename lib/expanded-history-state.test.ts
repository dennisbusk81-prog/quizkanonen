// Kjøres med:  npm test
//
// Cache-guarden for historikk-panelet i SeasonLeaderboard
// (lib/expanded-history-state.ts). Kravet fra 29. august 2026:
//   en FEILET henting skal ikke caches — neste åpning skal prøve på nytt.
// Forgjengeren var `if (expandedData.has(key)) return`, som cachet
// catch-grenens tomme liste permanent: «Ingen data for denne perioden» sto til
// brukeren lastet hele siden på nytt.
//
// MUTASJONSBEVIS — feilendringene disse fanger:
//   • Guarden tilbake til has()-semantikk (return existing === undefined)
//     → «'error' hentes på nytt» ryker.
//   • Catch-grenen skriver [] igjen (da er verdien en liste, ikke 'error')
//     → sammen med struktur-testene i lib/season-leaderboard-error-views.test.ts.
//   • «alt skal alltid hentes» (return true) → «tom liste er viten» ryker —
//     en EKTE tom periode skal ikke hentes om igjen ved hver åpning.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFetchExpanded } from './expanded-history-state'

describe('shouldFetchExpanded — hent når vi ikke VET', () => {
  test('aldri hentet (undefined) → hent', () => {
    assert.equal(shouldFetchExpanded(undefined), true)
  })

  test("'error' hentes på nytt — en feilet henting caches IKKE (krav 3)", () => {
    assert.equal(shouldFetchExpanded('error'), true)
  })

  test("'loading' hentes ikke — et kall er allerede underveis", () => {
    assert.equal(shouldFetchExpanded('loading'), false)
  })

  test('tom liste er VITEN og caches — ekte «ingen data» skal stå seg', () => {
    assert.equal(shouldFetchExpanded<{ rank: number }>([]), false)
  })

  test('liste med innhold caches', () => {
    assert.equal(shouldFetchExpanded([{ rank: 1 }]), false)
  })
})
