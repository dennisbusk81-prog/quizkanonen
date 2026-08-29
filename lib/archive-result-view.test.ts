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
    { kind: 'plassering', rank: 7, total: 42, selfWasInField: true, previous: null, scope: 'org' }
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
  const base = { rank: 3, total: 57, scope: 'global' as const, previous: null }
  const var_ = archivePlacementText({ ...base, selfWasInField: true }, null)
  const varIkke = archivePlacementText({ ...base, selfWasInField: false }, null)
  assert.notEqual(var_.forklaring, varIkke.forklaring)
  assert.match(var_.forklaring, /deltok også/)
  assert.match(varIkke.forklaring, /deltok ikke/)
})

// ── Scope-merkingen: kortet sier alltid hvilket felt tallet gjelder ─────────

test('org-scope navngir bedriften, global sier feltet den uken', () => {
  const p = { rank: 3, total: 29, selfWasInField: false, scope: 'org' as const, previous: null }
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

// ── «Står i dag»: eget gammelt resultat, begge tilstandene ──────────────────
//
// MUTASJONSBEVIS — konkrete feilendringer testene under fanger:
//   • Fjernes `p.previous ?`-gaten i archivePlacementText (tillegget vises
//     alltid) → «deltok IKKE» ryker, fordi setningen da dukker opp for en
//     spiller som aldri var med.
//   • Snus gaten til `!p.previous` → «deltok» ryker.
//   • Byttes parsePrevious sitt `return null` mot `{ kind: 'feil' }` →
//     «manglende previous feller ikke kortet» ryker.
//   • Fjernes talljekken i parsePrevious → «ødelagt previous gir null» ryker.
//   • Byttes «står i dag» mot «du fikk» → ordlyd-testen ryker. Den er ikke
//     pedanteri: hele grunnen til at tallet kan vises er at setningen ikke
//     påstår hva hun så. Se ArchivePreviousResult i lib/archive-placement.ts.

test('deltok: setningen oppgir eget gammelt resultat', () => {
  const t = archivePlacementText(
    { rank: 3, total: 57, selfWasInField: true, scope: 'global', previous: { rank: 7, correctAnswers: 11 } },
    null
  )
  assert.match(t.forklaring, /deltok også/)
  assert.match(t.forklaring, /11 riktige/)
  assert.match(t.forklaring, /7\. plass/)
})

test('deltok IKKE: ingen tilleggssetning, teksten står som før', () => {
  const t = archivePlacementText(
    { rank: 3, total: 57, selfWasInField: false, scope: 'global', previous: null },
    null
  )
  assert.equal(
    t.forklaring,
    'Du deltok ikke da quizen gikk — plasseringen viser hvor du ville havnet med denne runden i feltet.'
  )
  // Ingen rest av tillegget — hverken tall eller innledning.
  assert.doesNotMatch(t.forklaring, /står i dag/)
  assert.doesNotMatch(t.forklaring, /riktige?/)
})

test('setningen sier «står i dag», ikke «du fikk» — den påstår ikke hva hun så', () => {
  // Tallet er en rekonstruksjon: rader kan være slettet (tre hard-delete-ruter)
  // og fasiten kan være rettet siden den fredagen. Ordlyden er det eneste som
  // gjør tallet forsvarlig å vise, så den er testdekket som en invariant.
  const t = archivePlacementText(
    { rank: 3, total: 57, selfWasInField: true, scope: 'global', previous: { rank: 7, correctAnswers: 11 } },
    null
  )
  assert.match(t.forklaring, /står du i dag/)
  assert.doesNotMatch(t.forklaring, /du fikk/i)
})

test('entall: «1 riktig», ikke «1 riktige»', () => {
  const t = archivePlacementText(
    { rank: 3, total: 57, selfWasInField: true, scope: 'global', previous: { rank: 40, correctAnswers: 1 } },
    null
  )
  assert.match(t.forklaring, /1 riktig og/)
})

test('deltok, men previous mangler: setningen står uten tillegg — kortet felles ikke', () => {
  // En fane som sto åpen over deployen har et svar uten feltet.
  const t = archivePlacementText(
    { rank: 3, total: 57, selfWasInField: true, scope: 'global', previous: null },
    null
  )
  assert.equal(
    t.forklaring,
    'Du deltok også da quizen gikk — denne runden er målt mot det samme feltet, med det gamle resultatet ditt holdt utenfor.'
  )
})

test('parsing: previous leses når det er tall', () => {
  const v = parseArchivePlacementResponse(200, {
    placement: { rank: 3, total: 57, selfWasInField: true, scope: 'global', previous: { rank: 7, correctAnswers: 11 } },
  })
  assert.equal(v.kind, 'plassering')
  assert.deepEqual(v.kind === 'plassering' ? v.previous : undefined, { rank: 7, correctAnswers: 11 })
})

test('parsing: manglende eller ødelagt previous gir null — ALDRI «feil»', () => {
  // Retningen er hele poenget: et gammelt skjema skal degradere tillegget,
  // ikke felle plasseringskortet.
  const varianter: unknown[] = [
    undefined,                            // feltet finnes ikke (gammelt svar)
    null,
    {},                                   // tomt objekt
    { rank: 7 },                          // halvt
    { correctAnswers: 11 },               // halvt andre vei
    { rank: 'sju', correctAnswers: 11 },  // feil type
    'previous',                           // ikke et objekt
  ]
  for (const previous of varianter) {
    const v = parseArchivePlacementResponse(200, {
      placement: { rank: 3, total: 57, selfWasInField: true, scope: 'global', previous },
    })
    assert.equal(v.kind, 'plassering', `previous=${JSON.stringify(previous)} felte kortet`)
    assert.equal(v.kind === 'plassering' ? v.previous : 'x', null, `previous=${JSON.stringify(previous)}`)
  }
})
