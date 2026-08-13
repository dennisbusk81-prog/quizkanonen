import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countPlayersByQuiz,
  buildFrozenRanks,
  pickBestePlassering,
  type SeasonRankRow,
} from './frozen-rank'

const MEG = 'meg'
const ANNEN = 'annen'

// ── countPlayersByQuiz ──────────────────────────────────────────────────────

test('teller forsøk per quiz', () => {
  assert.deepEqual(
    countPlayersByQuiz([{ quiz_id: 'a' }, { quiz_id: 'a' }, { quiz_id: 'b' }]),
    { a: 2, b: 1 },
  )
})

test('tom liste gir tomt objekt', () => {
  assert.deepEqual(countPlayersByQuiz([]), {})
})

// ── buildFrozenRanks ────────────────────────────────────────────────────────

test('plukker brukerens egen rank og feltstørrelsen fra forsøkene', () => {
  const rader: SeasonRankRow[] = [
    { user_id: MEG, quiz_id: 'q', rank: 12 },
    { user_id: ANNEN, quiz_id: 'q', rank: 1 },
  ]
  assert.deepEqual(buildFrozenRanks(rader, { q: 63 }, MEG), {
    q: { rank: 12, total_players: 63 },
  })
})

test('andre brukeres rader påvirker ikke resultatet', () => {
  const rader: SeasonRankRow[] = [{ user_id: ANNEN, quiz_id: 'q', rank: 1 }]
  assert.deepEqual(buildFrozenRanks(rader, { q: 63 }, MEG), {})
})

test('ingen rad for brukeren → ingen plassering (opt-out, 7 brukere i prod)', () => {
  // Seks Elkjøp-ansatte med opt-out og én ekskludert. De har valgt seg vekk
  // fra den åpne konkurransen og skal ikke se en plassering i den.
  assert.deepEqual(buildFrozenRanks([], { q: 63 }, MEG), {})
})

test('rank null → ingen plassering', () => {
  const rader: SeasonRankRow[] = [{ user_id: MEG, quiz_id: 'q', rank: null }]
  assert.deepEqual(buildFrozenRanks(rader, { q: 63 }, MEG), {})
})

// ── DEN KRITISKE VAKTEN: rank kan ikke overstige feltet ─────────────────────
// season_scores.rank regnes over ALLE som spilte; rader finnes kun for dem som
// ikke har meldt seg ut. Målt i prod: 31.07 har 59 globale rader og høyeste
// rank 63. Telles nevneren fra rader, får en spiller «#63 av 59».

test('rank større enn feltstørrelsen forkastes framfor å vise «#63 av 59»', () => {
  const rader: SeasonRankRow[] = [{ user_id: MEG, quiz_id: 'q', rank: 63 }]
  assert.deepEqual(buildFrozenRanks(rader, { q: 59 }, MEG), {})
})

test('rank nøyaktig lik feltstørrelsen er gyldig — sisteplass er en plassering', () => {
  const rader: SeasonRankRow[] = [{ user_id: MEG, quiz_id: 'q', rank: 63 }]
  assert.deepEqual(buildFrozenRanks(rader, { q: 63 }, MEG), {
    q: { rank: 63, total_players: 63 },
  })
})

test('prod-tallene: 59 rader og rank 63 på 31.07 gir ingen plassering fra radantall', () => {
  // Regresjonen i tallform. Feltstørrelsen MÅ komme fra forsøkene (63), ikke
  // fra radene (59) — med riktig nevner er plasseringen gyldig.
  const rader: SeasonRankRow[] = [{ user_id: MEG, quiz_id: 'q', rank: 63 }]
  assert.deepEqual(buildFrozenRanks(rader, { q: 59 }, MEG), {}, 'radantall som nevner')
  assert.deepEqual(
    buildFrozenRanks(rader, { q: 63 }, MEG),
    { q: { rank: 63, total_players: 63 } },
    'forsøksantall som nevner',
  )
})

test('manglende feltstørrelse → ingen plassering', () => {
  const rader: SeasonRankRow[] = [{ user_id: MEG, quiz_id: 'q', rank: 5 }]
  assert.deepEqual(buildFrozenRanks(rader, {}, MEG), {})
})

test('delte plasseringer er gyldige — 19.06 har 75 forsøk og 72 unike ranks', () => {
  const rader: SeasonRankRow[] = [
    { user_id: MEG, quiz_id: 'q', rank: 5 },
    { user_id: ANNEN, quiz_id: 'q', rank: 5 },
  ]
  assert.deepEqual(buildFrozenRanks(rader, { q: 75 }, MEG), {
    q: { rank: 5, total_players: 75 },
  })
})

test('flere quizer behandles hver for seg', () => {
  const rader: SeasonRankRow[] = [
    { user_id: MEG, quiz_id: 'a', rank: 3 },
    { user_id: MEG, quiz_id: 'b', rank: 40 },
  ]
  assert.deepEqual(buildFrozenRanks(rader, { a: 50, b: 60 }, MEG), {
    a: { rank: 3, total_players: 50 },
    b: { rank: 40, total_players: 60 },
  })
})

test('én quiz uten rad blandet med én med rad', () => {
  const rader: SeasonRankRow[] = [{ user_id: MEG, quiz_id: 'a', rank: 3 }]
  const r = buildFrozenRanks(rader, { a: 50, b: 60 }, MEG)
  // Nøklene sjekkes FØR deepEqual: `assert.deepEqual` har en
  // assertion-signatur som smalner `r` til den forventede formen, og et
  // oppslag på en fraværende nøkkel etterpå blir en typefeil i stedet for en
  // test.
  assert.deepEqual(Object.keys(r), ['a'], 'kun quizen med rad skal ha oppføring')
  assert.deepEqual(r, { a: { rank: 3, total_players: 50 } })
})

test('rank 0 eller negativ forkastes', () => {
  for (const rank of [0, -1]) {
    const rader: SeasonRankRow[] = [{ user_id: MEG, quiz_id: 'q', rank }]
    assert.deepEqual(buildFrozenRanks(rader, { q: 63 }, MEG), {}, `rank=${rank}`)
  }
})

// ── pickBestePlassering ─────────────────────────────────────────────────────

const k = (quizId: string, tittel: string, dato: string) => ({
  quiz_id: quizId,
  quiz_title: tittel,
  completed_at: dato,
})

test('laveste rank vinner', () => {
  const r = pickBestePlassering(
    [
      k('a', 'Quiz A', '2026-06-19T18:00:00Z'),
      k('b', 'Quiz B', '2026-07-24T18:00:00Z'),
      k('c', 'Quiz C', '2026-08-07T18:00:00Z'),
    ],
    {
      a: { rank: 30, total_players: 75 },
      b: { rank: 4, total_players: 54 },
      c: { rank: 12, total_players: 63 },
    },
  )
  assert.deepEqual(r, { rank: 4, total_players: 54, quiz_title: 'Quiz B' })
})

test('uavgjort brytes på nyeste', () => {
  const r = pickBestePlassering(
    [k('a', 'gammel', '2026-06-19T18:00:00Z'), k('b', 'fersk', '2026-08-07T18:00:00Z')],
    { a: { rank: 7, total_players: 75 }, b: { rank: 7, total_players: 63 } },
  )
  assert.equal(r?.quiz_title, 'fersk')
})

test('uavgjort gir samme svar uansett rekkefølge på inn-lista', () => {
  const a = k('a', 'gammel', '2026-06-19T18:00:00Z')
  const b = k('b', 'fersk', '2026-08-07T18:00:00Z')
  const f = { a: { rank: 7, total_players: 75 }, b: { rank: 7, total_players: 63 } }
  assert.equal(pickBestePlassering([a, b], f)?.quiz_title, 'fersk')
  assert.equal(pickBestePlassering([b, a], f)?.quiz_title, 'fersk')
})

test('quizer uten frossen plassering hoppes over', () => {
  const r = pickBestePlassering(
    [k('a', 'uten', '2026-08-07T18:00:00Z'), k('b', 'med', '2026-06-19T18:00:00Z')],
    { b: { rank: 20, total_players: 75 } },
  )
  assert.deepEqual(r, { rank: 20, total_players: 75, quiz_title: 'med' })
})

test('ingen frosne plasseringer i det hele tatt → null', () => {
  // En spiller som har meldt seg ut av den åpne konkurransen skal ikke ha en
  // «beste plassering» i den.
  assert.equal(pickBestePlassering([k('a', 'A', '2026-08-07T18:00:00Z')], {}), null)
})

test('tom kandidatliste → null', () => {
  assert.equal(pickBestePlassering([], { a: { rank: 1, total_players: 10 } }), null)
})

test('sisteplass er også en beste plassering når det er den eneste', () => {
  const r = pickBestePlassering([k('a', 'A', '2026-08-07T18:00:00Z')], {
    a: { rank: 63, total_players: 63 },
  })
  assert.deepEqual(r, { rank: 63, total_players: 63, quiz_title: 'A' })
})
