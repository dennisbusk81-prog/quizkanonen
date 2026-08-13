// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// ENHETSTEST av lib/public-snapshot.ts — filteret + den posisjonelle re-ranken
// som fram til 13. august 2026 lå inline i app/api/quiz/[id]/standings/route.ts.
// Uttrekket finnes fordi tre andre flater (social-proof, rival, live-ranking)
// skal gates senere, og en håndskrevet kopi per flate er tre sjanser til å
// avvike fra originalen.
//
// getGloballyBlockedSet er EKTE her — kun supabase-admin under den er mocket.
// Det er hele poenget med fail-stengt-testen nederst: fail-safe-retningen bor
// inne i den lib-en, så en mock som «returnerer hele lista ved feil» ville bare
// testet mocken. Her provoseres en ekte DB-feil, og vi ser hva helperen faktisk
// gjør med svaret.
//
// MERK: getGloballyBlockedSet har en modul-lokal 30s-cache nøklet på quiz-id.
// Hver test bruker derfor sin EGEN quiz-id — ellers arver test N svaret fra
// test N-1 og beviser ingenting.
//
// MUTASJONSBEVIS (kjørt 13. august 2026)
//   • Fjernes den posisjonelle re-ranken (.map med i+1), beholder gjenværende
//     hull i rank, og «noen blokkerte …» ryker på rank-listen [1,2,3].
//   • Fjernes filteret, står den blokkerte igjen i publicSnapshot og både
//     «noen blokkerte …» og «alle innloggede blokkert …» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { SnapshotEntry } from './ranking-snapshot'

function entry(id: string, userId: string | null, name: string, rank: number): SnapshotEntry {
  return {
    id, user_id: userId, player_name: name, rank,
    correct_answers: 20 - rank, total_time_ms: 60_000 + rank * 1000, correct_streak: 0,
  }
}

type QueryResult = { data: unknown[] | null; error: { message: string } | null }

const state: {
  // Hvem som fikk en global season_scores-rad. Blokkert = spurt om, men ikke her.
  scoredUserIds: string[]
  // Når satt: season_scores-oppslaget feiler, slik fetchAllRows ville kastet i prod.
  scoredError: string | null
  // Snapshoten getOrBuildSnapshot skal finne i cache-raden (kun getPublicSnapshot-testen).
  cachedSnapshot: SnapshotEntry[]
  tablesTouched: string[]
} = { scoredUserIds: [], scoredError: null, cachedSnapshot: [], tablesTouched: [] }

function rowsBuilder(produce: () => QueryResult) {
  const b = {
    select() { return b },
    eq() { return b },
    is() { return b },
    in() { return b },
    order() { return b },
    async range() { return produce() },
  }
  return b
}

function snapshotRowBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    // Fersk cache-rad → getOrBuildSnapshot returnerer den uten rebuild og uten
    // skriving (testene sender ingen ensureAttemptId).
    async maybeSingle() {
      return { data: { snapshot: state.cachedSnapshot, created_at: new Date().toISOString() } }
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        state.tablesTouched.push(table)
        if (table === 'ranking_snapshots') return snapshotRowBuilder() as never
        if (table === 'season_scores') {
          return rowsBuilder(() =>
            state.scoredError
              ? { data: null, error: { message: state.scoredError } }
              : { data: state.scoredUserIds.map(user_id => ({ user_id })), error: null }
          ) as never
        }
        // Live-grenen (season_points_awarded = false) — tom, vi trenger bare å
        // se AT den ble valgt.
        if (table === 'organizations' || table === 'organization_members') {
          return rowsBuilder(() => ({ data: [], error: null })) as never
        }
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

const { filterSnapshotToPublic, getPublicSnapshot } = await import('@/lib/public-snapshot')

// Anna/Bjørn/Cato er innlogget, Gjest har user_id = null.
function field(): SnapshotEntry[] {
  return [
    entry('a-anna', 'u-anna', 'Anna', 1),
    entry('a-bjorn', 'u-bjorn', 'Bjørn', 2),
    entry('a-cato', 'u-cato', 'Cato', 3),
    entry('a-gjest', null, 'Gjest Gjestesen', 4),
  ]
}

const names = (list: SnapshotEntry[]) => list.map(e => e.player_name)
const ranks = (list: SnapshotEntry[]) => list.map(e => e.rank)

beforeEach(() => {
  state.scoredUserIds = []
  state.scoredError = null
  state.cachedSnapshot = []
  state.tablesTouched = []
})

// ── 1. Ingen blokkerte i feltet ─────────────────────────────────────────────

test('ingen blokkerte: det synlige feltet ER det ufiltrerte, urørt', async () => {
  state.scoredUserIds = ['u-anna', 'u-bjorn', 'u-cato']
  const snapshot = field()

  const r = await filterSnapshotToPublic('q-ingen', snapshot, true)

  assert.equal(r.blocked.size, 0)
  assert.deepEqual(names(r.publicSnapshot), ['Anna', 'Bjørn', 'Cato', 'Gjest Gjestesen'])
  assert.deepEqual(ranks(r.publicSnapshot), [1, 2, 3, 4])
  // Samme referanse, ikke bare samme innhold: uten blokkerte skal ingen kopi
  // eller re-rank skje i det hele tatt (fast-path-en i helperen).
  assert.equal(r.publicSnapshot, r.snapshot)
  assert.equal(r.snapshot, snapshot)
})

// ── 2. Noen blokkerte + posisjonell re-rank ─────────────────────────────────

test('noen blokkerte: fjernet fra synlig felt, gjenværende re-rankes uten hull', async () => {
  // Bjørn mangler en global season_scores-rad → blokkert.
  state.scoredUserIds = ['u-anna', 'u-cato']
  const snapshot = field()

  const r = await filterSnapshotToPublic('q-noen', snapshot, true)

  assert.deepEqual([...r.blocked], ['u-bjorn'])
  assert.deepEqual(names(r.publicSnapshot), ['Anna', 'Cato', 'Gjest Gjestesen'])
  // MUTASJONSANKERET: uten re-ranken blir dette [1, 3, 4].
  assert.deepEqual(ranks(r.publicSnapshot), [1, 2, 3])

  // KRAV 1: det ufiltrerte feltet er urørt — /standings trenger det for at en
  // blokkert kaller skal beholde sin egen plassering.
  assert.deepEqual(names(r.snapshot), ['Anna', 'Bjørn', 'Cato', 'Gjest Gjestesen'])
  assert.deepEqual(ranks(r.snapshot), [1, 2, 3, 4])
  // Re-ranken skal ikke mutere originalobjektene (den kopierer med spread).
  assert.equal(snapshot[2].rank, 3)
})

// ── 3. Alle blokkerte ───────────────────────────────────────────────────────

test('alle innloggede blokkert: kun gjesten står igjen, som nr. 1', async () => {
  state.scoredUserIds = []
  const r = await filterSnapshotToPublic('q-alle-innloggede', field(), true)

  assert.equal(r.blocked.size, 3)
  assert.deepEqual(names(r.publicSnapshot), ['Gjest Gjestesen'])
  assert.deepEqual(ranks(r.publicSnapshot), [1])
})

test('alle blokkerte og ingen gjester: synlig felt er tomt, ufiltrert er intakt', async () => {
  state.scoredUserIds = []
  const snapshot = [
    entry('a-anna', 'u-anna', 'Anna', 1),
    entry('a-bjorn', 'u-bjorn', 'Bjørn', 2),
  ]

  const r = await filterSnapshotToPublic('q-alle', snapshot, true)

  assert.deepEqual(r.publicSnapshot, [])
  assert.equal(r.snapshot.length, 2)
})

// ── 4. Tomt felt ────────────────────────────────────────────────────────────

test('tomt felt: ingen gate-oppslag i det hele tatt', async () => {
  const r = await filterSnapshotToPublic('q-tomt', [], true)

  assert.deepEqual(r.publicSnapshot, [])
  assert.deepEqual(r.snapshot, [])
  assert.equal(r.blocked.size, 0)
  // Ingen brukere å spørre om → ingen DB-rundtur. Et tomt svar på et tomt
  // spørsmål skjuler ingen, så dette er ikke et brudd på fail-stengt.
  assert.deepEqual(state.tablesTouched, [])
})

test('felt med bare gjester: heller ingen gate-oppslag', async () => {
  const snapshot = [entry('a-g1', null, 'Gjest A', 1), entry('a-g2', null, 'Gjest B', 2)]

  const r = await filterSnapshotToPublic('q-bare-gjester', snapshot, true)

  assert.deepEqual(names(r.publicSnapshot), ['Gjest A', 'Gjest B'])
  assert.deepEqual(state.tablesTouched, [])
})

// ── 5. Feil fra getGloballyBlockedSet — FAIL-STENGT ─────────────────────────

test('DB-feil i gaten: alle innloggede skjules (fail-stengt), og feilen logges høyt', async () => {
  state.scoredError = 'boom: season_scores utilgjengelig'

  const logged: unknown[][] = []
  const realError = console.error
  console.error = (...args: unknown[]) => { logged.push(args) }
  let r: Awaited<ReturnType<typeof filterSnapshotToPublic>>
  try {
    r = await filterSnapshotToPublic('q-feil', field(), true)
  } finally {
    console.error = realError
  }

  // Vet vi ikke hvem som er blokkert, blokkeres ALLE vi spurte om. En nesten
  // tom liste framfor en feilaktig komplett en — retningen skal ikke snus til
  // «fall tilbake på det ufiltrerte feltet».
  assert.deepEqual([...r.blocked].sort(), ['u-anna', 'u-bjorn', 'u-cato'])
  assert.deepEqual(names(r.publicSnapshot), ['Gjest Gjestesen'])
  assert.deepEqual(ranks(r.publicSnapshot), [1])
  // Det ufiltrerte feltet er fortsatt komplett — helperen svelger ikke feilen
  // ved å tømme begge.
  assert.equal(r.snapshot.length, 4)
  // Fail-safe-en er synlig for brukerne (tom liste), så den skal aldri være
  // stille. En stille fail-safe ser ut som at ingen har spilt.
  assert.equal(logged.length, 1)
  assert.match(String(logged[0][0]), /globally-blocked-set/)
})

// ── Pass-through av seasonPointsAwarded ─────────────────────────────────────

test('seasonPointsAwarded=false velger live-grenen, ikke season_scores', async () => {
  await filterSnapshotToPublic('q-live', field(), false)

  assert.ok(!state.tablesTouched.includes('season_scores'))
  assert.ok(state.tablesTouched.includes('organizations'))
})

// ── getPublicSnapshot: samme filtrering, men henter snapshoten selv ─────────

test('getPublicSnapshot henter snapshoten og filtrerer den likt', async () => {
  state.cachedSnapshot = field()
  state.scoredUserIds = ['u-anna', 'u-cato']

  const r = await getPublicSnapshot('q-hent', { seasonPointsAwarded: true })

  assert.ok(state.tablesTouched.includes('ranking_snapshots'))
  assert.deepEqual(names(r.snapshot), ['Anna', 'Bjørn', 'Cato', 'Gjest Gjestesen'])
  assert.deepEqual(names(r.publicSnapshot), ['Anna', 'Cato', 'Gjest Gjestesen'])
  assert.deepEqual(ranks(r.publicSnapshot), [1, 2, 3])
})
