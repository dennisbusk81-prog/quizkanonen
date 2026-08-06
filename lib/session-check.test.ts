// Kjøres med:  npm test
//
// FUNN 2 (7. august 2026): et hengende getSession() skal ikke kunne låse
// lastetilstanden i SeasonLeaderboard. To ledd må holde, og begge bevises her:
//
//   1. withTimeout gir et utfall selv om promiset aldri settles (dekket fra før
//      i lib/with-timeout.test.ts — gjentas her mot det EKTE kallmønsteret, så
//      beviset henger sammen fra hengende oppslag til satt flagg).
//   2. decideSessionCheck setter `checked` uansett utfall, men skriver ALDRI
//      en null-sesjon på timeout.
//
// MUTASJONSBEVIS (kjørt, ikke påstått — se rapporten for kjøringene)
//   • `checked: false` i timeout-grenen → 3 av 7 ryker, inkludert hele
//     kjede-testen. Det er nøyaktig den permanente skjelett-tilstanden funn 2
//     handlet om.
//   • `applySession: true` i timeout-grenen → 3 av 7 ryker: en innlogget
//     bruker ville fått «Logg inn»-kortet av vår egen tidsgrense.
//   • Grenene byttet om (`if (!outcome.ok)` → `if (outcome.ok)`) → alle 7.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Session } from '@supabase/supabase-js'
import { decideSessionCheck } from './session-check'
import { withTimeout, type TimerApi } from './with-timeout'

// Nok av Session til at typen holder — feltene leses ikke av logikken.
const fakeSession = { access_token: 'abc' } as unknown as Session

// ── Leddet som avgjør: hva gjør vi med utfallet? ─────────────────────────────

test('FUNN 2: timeout låser ikke opp — checked settes uansett', () => {
  const d = decideSessionCheck({ ok: false, timedOut: true })
  assert.equal(d.checked, true, 'uten dette står org-/ligatopplisten i skjelettet for alltid')
})

test('FUNN 2: timeout påstår ALDRI at brukeren er utlogget', () => {
  const d = decideSessionCheck({ ok: false, timedOut: true })
  assert.equal(
    d.applySession,
    false,
    'å skrive null her ville gitt en innlogget bruker «Logg inn» av vår egen tidsgrense',
  )
})

test('en ren FEIL (ikke timeout) behandles likt — vi vet like lite', () => {
  const d = decideSessionCheck({ ok: false, timedOut: false })
  assert.equal(d.checked, true)
  assert.equal(d.applySession, false)
})

test('positiv kontroll: et svar i tide skriver sesjonen', () => {
  const d = decideSessionCheck({ ok: true, value: { data: { session: fakeSession } } })
  assert.equal(d.checked, true)
  assert.equal(d.applySession, true)
  assert.equal(d.session, fakeSession)
})

test('positiv kontroll: bekreftet utlogget skrives som null — det ER et svar', () => {
  // Skillet mot timeout-grenen: her VET vi at det ikke finnes noen sesjon, og
  // da skal «Logg inn» vises. applySession er derfor true, ikke false.
  const d = decideSessionCheck({ ok: true, value: { data: { session: null } } })
  assert.equal(d.applySession, true)
  assert.equal(d.session, null)
})

// ── Hele kjeden: hengende oppslag → satt flagg ───────────────────────────────

test('FUNN 2: et getSession som ALDRI settles gir likevel checked=true', async () => {
  // Manuelle timere, så testen ikke bruker 1500 ms veggklokketid.
  let fire: (() => void) | null = null
  const timers: TimerApi = {
    setTimeout: fn => { fire = fn; return 1 },
    clearTimeout: () => {},
  }

  // Nøyaktig formen komponenten bruker: et oppslag som aldri svarer.
  const hanging = new Promise<{ data: { session: Session | null } }>(() => {})
  const pending = withTimeout(hanging, { ms: 1500, timers })

  assert.ok(fire, 'tidsgrensen skal være armert')
  ;(fire as unknown as () => void)()

  const decision = decideSessionCheck(await pending)
  assert.equal(decision.checked, true, 'flagget MÅ settes — det er det scopede kall venter på')
  assert.equal(decision.applySession, false)
})

test('positiv kontroll: rekker oppslaget fram, brukes svaret og ikke tidsgrensen', async () => {
  const timers: TimerApi = { setTimeout: () => 1, clearTimeout: () => {} }
  const outcome = await withTimeout(
    Promise.resolve({ data: { session: fakeSession } }),
    { ms: 1500, timers },
  )
  const decision = decideSessionCheck(outcome)
  assert.equal(decision.applySession, true)
  assert.equal(decision.session, fakeSession)
})
