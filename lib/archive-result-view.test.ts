// Kjøres med:  npm test
//
// Ren tolkningstest av spøkelsesplasseringens klientvisning. Kontrakten den
// feller: de tre «ingen plassering»-grunnene vises IDENTISK, 'feil' og
// 'ingen' er aldri samme tilstand, og selfWasInField-skillet gir to ULIKE
// forklaringer (nevneren betyr to forskjellige ting).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseArchivePlacementResponse,
  archivePlacementText,
} from '@/lib/archive-result-view'

// ── Kollapsen: alle tre grunnene → nøyaktig samme visningstilstand ──────────

test('ingen-kilde, tomt-felt og lagforsok tolkes identisk', () => {
  const outcomes = ['ingen-kilde', 'tomt-felt', 'lagforsok'].map((reason) =>
    parseArchivePlacementResponse(200, { placement: null, reason })
  )
  for (const o of outcomes) {
    assert.deepEqual(o, { kind: 'ingen' })
  }
})

test('reason-feltet leses ikke — også en ukjent grunn vises som «ingen»', () => {
  assert.deepEqual(
    parseArchivePlacementResponse(200, { placement: null, reason: 'noe-nytt' }),
    { kind: 'ingen' }
  )
})

// ── Plassering: feltene mappes, scope normaliseres ──────────────────────────

test('gyldig plassering mappes felt for felt', () => {
  assert.deepEqual(
    parseArchivePlacementResponse(200, {
      placement: { rank: 7, total: 42, fieldSize: 41, selfWasInField: true, scope: 'org' },
      sourceQuizId: 'abc',
    }),
    { kind: 'plassering', rank: 7, total: 42, selfWasInField: true, scope: 'org' }
  )
})

test('alt annet enn scope org faller til global', () => {
  const view = parseArchivePlacementResponse(200, {
    placement: { rank: 1, total: 2, selfWasInField: false, scope: 'global' },
  })
  assert.equal(view.kind, 'plassering')
  if (view.kind === 'plassering') assert.equal(view.scope, 'global')
})

// ── «Vet ikke» er aldri «ingen plassering» ──────────────────────────────────

test('feilstatuser og søppelkropper blir «feil», aldri «ingen»', () => {
  const cases: [number, unknown][] = [
    [503, { error: 'Kunne ikke hente' }],
    [404, { error: 'Finnes ikke.' }],
    [409, { error: 'Forsøket er ikke levert.' }],
    [401, null],
    [200, null], // JSON-parse feilet hos kalleren
    [200, { placement: { rank: 'sju', total: 42 } }], // manglende talltype
    [200, {}], // placement mangler helt — et gammelt/fremmed svar
  ]
  for (const [status, json] of cases) {
    assert.deepEqual(
      parseArchivePlacementResponse(status, json),
      { kind: 'feil' },
      `status=${status} json=${JSON.stringify(json)}`
    )
  }
})

// ── selfWasInField: to nevnerbetydninger, to forklaringer ───────────────────

test('selfWasInField gir to ulike forklaringer — skillet skjules ikke', () => {
  const base = { rank: 3, total: 57, scope: 'global' as const }
  const var_ = archivePlacementText({ ...base, selfWasInField: true }, null)
  const varIkke = archivePlacementText({ ...base, selfWasInField: false }, null)
  assert.notEqual(var_.forklaring, varIkke.forklaring)
  assert.match(var_.forklaring, /deltok også/)
  assert.match(varIkke.forklaring, /deltok ikke/)
})

// ── Scope-merkingen: kortet sier alltid hvilket felt tallet gjelder ─────────

test('org-scope navngir bedriften, global sier feltet den uken', () => {
  const p = { rank: 3, total: 29, selfWasInField: false, scope: 'org' as const }
  assert.equal(
    archivePlacementText(p, 'Elkjøp Nordic').kontekst,
    'av 29 deltakere hos Elkjøp Nordic'
  )
  assert.equal(
    archivePlacementText(p, null).kontekst,
    'av 29 deltakere hos bedriften din'
  )
  assert.equal(
    archivePlacementText({ ...p, scope: 'global' }, null).kontekst,
    'av 29 deltakere i hele feltet den uken'
  )
})
