// Kjøres med:  npm test
// (node --import ./scripts/ts-node-resolve.mjs --test lib/season-resync-plan.test.ts)
//
// Testene her vokter ÉN ting framfor alt: at en fasitretting aldri omskriver
// historikk for spillere som har endret medlemskap siden quizen ble spilt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSeasonResync, type StoredSeasonRow } from '@/lib/season-resync-plan'
import type { SeasonAttempt } from '@/lib/season-points'

const attempt = (
  user_id: string,
  correct_answers: number,
  total_time_ms: number,
  correct_streak: number | null = 0
): SeasonAttempt => ({ user_id, correct_answers, total_time_ms, correct_streak })

const row = (
  id: string,
  user_id: string,
  scope_type: string,
  scope_id: string | null,
  rank: number,
  points: number
): StoredSeasonRow => ({ id, user_id, scope_type, scope_id, rank, points })

const changeFor = (plan: ReturnType<typeof planSeasonResync>, userId: string) =>
  plan.changes.find(c => c.user_id === userId)

// ── 1. Kjent utfall ─────────────────────────────────────────────────────────
// Fasitrettingen gir u2 ett riktig svar til, slik at u2 går forbi u1 på global.
// u3 er upåvirket og skal derfor IKKE dukke opp i changes.
test('kjent utfall: rettingen flytter u2 forbi u1, uendret rad utelates', () => {
  const attempts = [
    attempt('u1', 8, 30_000),
    attempt('u2', 9, 40_000), // hadde 7 før rettingen
    attempt('u3', 5, 20_000),
  ]
  const stored = [
    row('r1', 'u1', 'global', null, 1, 12),
    row('r2', 'u2', 'global', null, 2, 10),
    row('r3', 'u3', 'global', null, 3, 8),
  ]

  const plan = planSeasonResync(stored, attempts)

  assert.equal(plan.checked, 3)
  assert.equal(plan.unresolvable.length, 0)
  assert.equal(plan.changes.length, 2)

  assert.deepEqual(
    { rank: changeFor(plan, 'u2')?.toRank, points: changeFor(plan, 'u2')?.toPoints },
    { rank: 1, points: 12 }
  )
  assert.deepEqual(
    { rank: changeFor(plan, 'u1')?.toRank, points: changeFor(plan, 'u1')?.toPoints },
    { rank: 2, points: 10 }
  )
  assert.equal(changeFor(plan, 'u3'), undefined, 'u3 var allerede riktig og skal ikke skrives')
})

// ── 2. Spiller som har meldt seg ut av ligaen ────────────────────────────────
// u3 er IKKE lenger medlem av L1, og u2 ER medlem i dag men var det ikke da
// quizen stengte. Populasjonen utledes derfor fra de lagrede radene, ikke fra
// medlemskap: {u1, u3}.
//
// Beviset ligger i tallene: hadde dagens medlemskap blitt brukt og u2 sneket seg
// inn i ligapopulasjonen, ville u1 endt på rank 3 (8 poeng), ikke rank 2 (10).
// Og u3 ville mistet raden sin helt.
test('utmeldt liga-spiller beholder historisk plassering', () => {
  const attempts = [
    attempt('u1', 6, 30_000),
    attempt('u2', 8, 25_000), // medlem i dag, men har ingen lagret rad for denne quizen
    attempt('u3', 9, 20_000), // har meldt seg ut av ligaen siden quizen ble spilt
  ]
  const stored = [
    row('L-u1', 'u1', 'league', 'L1', 1, 12),
    row('L-u3', 'u3', 'league', 'L1', 2, 10),
  ]

  const plan = planSeasonResync(stored, attempts)

  assert.equal(plan.checked, 2)
  assert.equal(plan.unresolvable.length, 0, 'den utmeldte raden må fortsatt kunne utledes')

  assert.deepEqual(
    { rank: changeFor(plan, 'u3')?.toRank, points: changeFor(plan, 'u3')?.toPoints },
    { rank: 1, points: 12 },
    'u3 skal rangeres normalt selv om medlemskapet er borte i dag'
  )
  assert.deepEqual(
    { rank: changeFor(plan, 'u1')?.toRank, points: changeFor(plan, 'u1')?.toPoints },
    { rank: 2, points: 10 },
    'u2 skal ikke være med i ligapopulasjonen — da ville u1 blitt rank 3'
  )

  // Ingen rad kan oppstå av seg selv: hver endring peker på en lagret rad-id.
  const storedIds = new Set(stored.map(r => r.id))
  for (const change of plan.changes) {
    assert.ok(storedIds.has(change.id), `ukjent rad-id i changes: ${change.id}`)
  }
  assert.equal(changeFor(plan, 'u2'), undefined, 'u2 har ingen lagret rad og skal aldri settes inn')
})

// ── 3. Global opt-out ───────────────────────────────────────────────────────
// u2 har global_league_opt_out = true i dag, men har en legitim global rad fra
// da hen ikke var utmeldt — raden skal bli stående og oppdatert.
// u4 er blokkert fra global (org med allow_global_league = false) og har derfor
// ingen lagret rad, men SKAL likevel telle med i rangeringen: kilden rangerer
// hele populasjonen først og filtrerer blokkerte bort etterpå.
test('global rangerer full populasjon; opt-out-bruker beholder raden sin', () => {
  const attempts = [
    attempt('u4', 10, 10_000), // blokkert fra global — ingen lagret rad
    attempt('u2', 9, 20_000),  // opt-out i dag, har lagret rad
    attempt('u1', 7, 30_000),
  ]
  const stored = [
    row('g-u2', 'u2', 'global', null, 1, 12),
    row('g-u1', 'u1', 'global', null, 2, 10),
  ]

  const plan = planSeasonResync(stored, attempts)

  assert.equal(plan.checked, 2)
  assert.equal(plan.unresolvable.length, 0)
  assert.equal(plan.changes.length, 2)

  assert.deepEqual(
    { rank: changeFor(plan, 'u2')?.toRank, points: changeFor(plan, 'u2')?.toPoints },
    { rank: 2, points: 10 },
    'u2 skal beholde raden og få rank 2 fordi u4 opptar rank 1'
  )
  assert.deepEqual(
    { rank: changeFor(plan, 'u1')?.toRank, points: changeFor(plan, 'u1')?.toPoints },
    { rank: 3, points: 8 }
  )
  assert.equal(changeFor(plan, 'u4'), undefined, 'u4 har ingen lagret rad og skal ikke få en')
})

// ── 4. Rad uten utledbar plassering ─────────────────────────────────────────
// En lagret rad for en bruker uten forsøk på quizen (f.eks. fordi forsøket er
// fjernet i ettertid). Da finnes ingen plassering å regne ut, og raden skal
// rapporteres og lates i fred — ikke gjettes på, ikke slettes.
test('rad for bruker uten forsøk rapporteres som unresolvable og røres ikke', () => {
  const attempts = [attempt('u1', 5, 15_000)]
  const stored = [
    row('g-u1', 'u1', 'global', null, 1, 12),
    row('g-u9', 'u9', 'global', null, 2, 10),
  ]

  const plan = planSeasonResync(stored, attempts)

  assert.equal(plan.checked, 2)
  assert.equal(plan.unresolvable.length, 1)
  assert.equal(plan.unresolvable[0].id, 'g-u9')
  assert.equal(plan.changes.length, 0, 'u1 var allerede riktig, og u9 skal ikke skrives')
})
