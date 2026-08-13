import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideSisteQuiz,
  settPersonligRekord,
  type SisteQuizInput,
  type RekordKandidat,
} from './siste-quiz'

const kort = (o: Partial<SisteQuizInput> = {}) =>
  decideSisteQuiz({
    quizTittel: 'Fredagsquiz 07.08.2026',
    riktige: 11,
    totalt: 15,
    feltSnittRiktige: 10.32,
    plassering: { rank: 12, total_players: 63 },
    erPersonligRekord: false,
    ...o,
  })

// ── Kortet ──────────────────────────────────────────────────────────────────

test('fullt kort med alle deler', () => {
  assert.deepEqual(kort(), {
    eyebrow: 'Din siste quiz',
    tittel: 'Fredagsquiz 07.08.2026',
    resultat: '11 av 15 riktige',
    felt: 'Feltet traff 10,3 av 15 i snitt',
    plassering: '#12 av 63',
  })
})

test('personlig rekord bytter eyebrow', () => {
  assert.equal(kort({ erPersonligRekord: true })?.eyebrow, 'Ny personlig rekord')
})

test('«vet ikke» gir den nøytrale eyebrowen, ikke en rekordpåstand', () => {
  // null = historikken er ikke komplett. Da vet vi ikke om det er en rekord.
  assert.equal(kort({ erPersonligRekord: null })?.eyebrow, 'Din siste quiz')
})

test('feltlinja bruker SAMME nevner som resultatlinja', () => {
  const r = kort({ riktige: 9, totalt: 20, feltSnittRiktige: 12.5 })
  assert.equal(r?.resultat, '9 av 20 riktige')
  assert.equal(r?.felt, 'Feltet traff 12,5 av 20 i snitt')
})

test('manglende feltsnitt utelater feltlinja', () => {
  assert.equal(kort({ feltSnittRiktige: null })?.felt, null)
})

test('ingen frossen plassering → linja utelates helt', () => {
  // 7 brukere / 17 forsøk i prod. Ingen fallback, ingen «ukjent».
  const r = kort({ plassering: null })
  assert.equal(r?.plassering, null)
  assert.equal(r?.resultat, '11 av 15 riktige')
  assert.equal(r?.felt, 'Feltet traff 10,3 av 15 i snitt')
})

test('sisteplass vises som en vanlig plassering', () => {
  assert.equal(kort({ plassering: { rank: 63, total_players: 63 } })?.plassering, '#63 av 63')
})

test('0 riktige er et ekte resultat', () => {
  assert.equal(kort({ riktige: 0 })?.resultat, '0 av 15 riktige')
})

test('uten spørsmål finnes ikke noe kort', () => {
  assert.equal(kort({ totalt: 0 }), null)
})

test('skadde tall gir null i stedet for NaN-tekst', () => {
  assert.equal(decideSisteQuiz({} as SisteQuizInput), null)
})

test('ordet «kveld» står ikke i kortet', () => {
  const r = kort({ erPersonligRekord: true })!
  const alt = [r.eyebrow, r.tittel, r.resultat, r.felt, r.plassering].join(' ')
  assert.equal(/kveld/i.test(alt), false)
})

test('feltsnittet har alltid én desimal og komma', () => {
  assert.equal(kort({ feltSnittRiktige: 8 })?.felt, 'Feltet traff 8,0 av 15 i snitt')
  assert.equal(kort({ feltSnittRiktige: 8.25 })?.felt, 'Feltet traff 8,3 av 15 i snitt')
  assert.equal(kort({ feltSnittRiktige: 6.43 })?.felt?.includes('.'), false)
})

// ── settPersonligRekord ─────────────────────────────────────────────────────

const a = (riktige: number, dato: string): RekordKandidat => ({
  correct_answers: riktige,
  completed_at: dato,
})

test('nyeste er strengt bedre enn alle tidligere → rekord', () => {
  assert.equal(
    settPersonligRekord([
      a(13, '2026-08-07T18:00:00Z'),
      a(11, '2026-07-24T18:00:00Z'),
      a(9, '2026-06-19T18:00:00Z'),
    ]),
    true,
  )
})

test('å tangere rekorden er ikke å sette en ny', () => {
  assert.equal(
    settPersonligRekord([a(13, '2026-08-07T18:00:00Z'), a(13, '2026-07-24T18:00:00Z')]),
    false,
  )
})

test('dårligere enn tidligere → ingen rekord', () => {
  assert.equal(
    settPersonligRekord([a(8, '2026-08-07T18:00:00Z'), a(13, '2026-07-24T18:00:00Z')]),
    false,
  )
})

test('rekkefølgen på inn-lista spiller ingen rolle — nyeste avgjøres på dato', () => {
  const rader = [a(9, '2026-06-19T18:00:00Z'), a(13, '2026-08-07T18:00:00Z')]
  assert.equal(settPersonligRekord(rader), true)
  assert.equal(settPersonligRekord([...rader].reverse()), true)
})

test('første quiz er ikke en «ny personlig rekord»', () => {
  // Trivielt det beste man har gjort. En tom påstand.
  assert.equal(settPersonligRekord([a(13, '2026-08-07T18:00:00Z')]), false)
})

test('null inn (ukomplett historikk) → null ut, aldri en gjetning', () => {
  // Historikken er paginert med 50 per side. En rekord er en påstand om ALLE
  // tidligere forsøk, og på en delvis liste ville påstanden vært feil for
  // nettopp de mest trofaste spillerne.
  assert.equal(settPersonligRekord(null), null)
})

test('tom liste → null', () => {
  assert.equal(settPersonligRekord([]), null)
})

test('skadde rader hoppes over', () => {
  const rader = [
    { completed_at: '2026-08-07T18:00:00Z' },
    a(13, '2026-07-24T18:00:00Z'),
    a(9, '2026-06-19T18:00:00Z'),
  ] as RekordKandidat[]
  assert.equal(settPersonligRekord(rader), true)
})

test('0 riktige kan være en rekord hvis alt tidligere var dårligere — men ikke her', () => {
  assert.equal(
    settPersonligRekord([a(0, '2026-08-07T18:00:00Z'), a(0, '2026-07-24T18:00:00Z')]),
    false,
  )
})
