// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// POPULASJONSDEFINISJONEN for sesongpoeng (lib/season-attempts.ts): kun
// LEVERTE forsøk (submitted_at IS NOT NULL) teller — «å ha STARTET en quiz er
// ikke å ha DELTATT». Testene driver den EKTE processQuiz og den EKTE
// resyncSeasonScoresForQuiz gjennom en fake supabase-admin.
//
// Faken her skiller seg fra søstertestene på ett avgjørende punkt: `.not()`
// og `.eq()` HÅNDHEVES mot radene. I award-season-points.pagination.test.ts
// er `.not()` en no-op — den faken kan derfor per konstruksjon ikke felle et
// fjernet filter. Denne kan.
//
// MUTASJONSBEVIS (verifisert 19. august 2026 ved å fjerne
// `.not('submitted_at', 'is', null)` i lib/season-attempts.ts midlertidig):
//   - «et påbegynt, aldri levert forsøk får ingen sesongrad» feiler
//     (spøkelsesbrukeren får global rad)
//   - «en ekte spiller med 0 riktige rangeres ikke bak et forlatt forsøk»
//     feiler (0/0-raden med 0 ms sorterer foran og skyver rank fra 3 til 4)
//   - «quiz der ingen leverte gjøres opp tomt» feiler (spøkelset får rad)
//   - «resync ser samme populasjon som skrivingen» feiler (spøkelset går inn
//     i global-rangeringen og «retter» en korrekt rad)
// Begge kallstedene felles altså av samme mutasjon — det er beviset på at
// begge faktisk leser gjennom den delte hjelperen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const QUIZ = 'quiz-1'
const CLOSES = '2026-08-21T20:00:00.000Z'

type Row = Record<string, unknown>

const db: Record<string, Row[]> = {
  attempts: [],
  season_scores: [],
  quizzes: [],
  organization_members: [],
  organizations: [],
  league_members: [],
}

// UPDATE-er mot season_scores (resync sine rettelser) logges her i stedet for
// å mutere radene — testene asserter på hva som ble FORSØKT skrevet.
let scoreUpdates: Array<{ id: unknown; vals: Row }> = []

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let head = false
  let from: number | null = null
  let to: number | null = null
  let updateVals: Row | null = null

  const b = {
    select(_cols?: string, opts?: { head?: boolean }) { if (opts?.head) head = true; return b },
    update(vals: Row) { updateVals = vals; return b },
    eq(col: string, val: unknown) { filters.push(r => r[col] === val); return b },
    in(col: string, keys: unknown[]) { const s = new Set(keys); filters.push(r => s.has(r[col])); return b },
    not(col: string, op: string, val: unknown) {
      // Håndheves — en no-op her ville gjort hele testfilen blind for
      // nøyaktig mutasjonen den finnes for å felle.
      if (op === 'is' && val === null) filters.push(r => r[col] !== null && r[col] !== undefined)
      return b
    },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    upsert(rows: Row[]) {
      db.season_scores.push(...rows)
      return Promise.resolve({ error: null })
    },
    maybeSingle() { return Promise.resolve({ data: null, error: null }) },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      const done = (v: unknown) => Promise.resolve(v).then(resolve, reject)
      const rows = (db[table] ?? []).filter(r => filters.every(f => f(r)))

      if (updateVals !== null) {
        if (table === 'season_scores') {
          for (const r of rows) scoreUpdates.push({ id: r.id, vals: updateVals! })
        } else {
          for (const r of rows) Object.assign(r, updateVals!)
        }
        return done({ data: [], error: null })
      }
      if (head) return done({ count: rows.length, error: null })

      const f = from ?? 0
      const t = to ?? rows.length - 1
      return done({ data: rows.slice(f, t + 1), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { processQuiz } = await import('@/lib/award-season-points')
const { resyncSeasonScoresForQuiz } = await import('@/lib/resync-season-scores')

// submitted: null = påbegynt-og-forlatt (slik start-attempt oppretter raden:
// 0 riktige, 0 ms — nøyaktig formen de 8 prod-radene fra 19.06–07.08 hadde).
const attempt = (user: string, correct: number, timeMs: number, submitted: string | null): Row => ({
  id: `a-${user}`, quiz_id: QUIZ, user_id: user, is_team: false,
  correct_answers: correct, total_time_ms: timeMs, correct_streak: 0,
  submitted_at: submitted,
})

const SUBMITTED = '2026-08-21T19:55:00.000Z'

const globalRows = () => db.season_scores.filter(r => r.scope_type === 'global')

beforeEach(() => {
  for (const key of Object.keys(db)) db[key] = []
  scoreUpdates = []
})

// ── processQuiz (skrivesiden) ────────────────────────────────────────────────

test('et påbegynt, aldri levert forsøk får ingen sesongrad', async () => {
  db.attempts = [
    attempt('u-vinner', 5, 30_000, SUBMITTED),
    attempt('u-toer', 3, 40_000, SUBMITTED),
    attempt('u-null', 0, 60_000, SUBMITTED),
    attempt('u-spokelse', 0, 0, null), // startet, lukket fanen
  ]
  db.quizzes = [{ id: QUIZ, season_points_awarded: false }]

  const res = await processQuiz(QUIZ, CLOSES)

  assert.equal(res.error, null)
  const users = new Set(globalRows().map(r => r.user_id))
  assert.ok(!users.has('u-spokelse'), 'forlatt forsøk skal ikke ha noen season_scores-rad')
  assert.deepEqual([...users].sort(), ['u-null', 'u-toer', 'u-vinner'])
})

test('en ekte spiller med 0 riktige rangeres ikke bak et forlatt forsøk', async () => {
  // 0/0-raden sorterer med 0 ms FORAN en ekte 0-riktige-spiller på
  // tidsbrytingen. Uten filteret ville u-null fått rank 4 (og spøkelset 3).
  db.attempts = [
    attempt('u-vinner', 5, 30_000, SUBMITTED),
    attempt('u-toer', 3, 40_000, SUBMITTED),
    attempt('u-null', 0, 60_000, SUBMITTED),
    attempt('u-spokelse', 0, 0, null),
  ]
  db.quizzes = [{ id: QUIZ, season_points_awarded: false }]

  await processQuiz(QUIZ, CLOSES)

  const nullRow = globalRows().find(r => r.user_id === 'u-null')
  assert.equal(nullRow?.rank, 3, 'siste EKTE spiller skal ha siste plass i feltet')
})

test('quiz der ingen leverte gjøres opp tomt — men gjøres OPP (flagget settes)', async () => {
  // Bare forlatte forsøk = ingen deltakere. Quizen skal likevel stemples
  // ferdig, ellers plukker cronen den opp igjen hvert minutt for alltid.
  db.attempts = [attempt('u-spokelse', 0, 0, null)]
  db.quizzes = [{ id: QUIZ, season_points_awarded: false }]

  const res = await processQuiz(QUIZ, CLOSES)

  assert.equal(res.error, null)
  assert.equal(res.rows, 0)
  assert.equal(db.season_scores.length, 0, 'ingen rader for en quiz uten leverte forsøk')
  assert.equal(db.quizzes[0].season_points_awarded, true)
})

test('leverte forsøk gjøres opp som før — filteret låser ikke ute noe legitimt', async () => {
  db.attempts = [
    attempt('u-vinner', 5, 30_000, SUBMITTED),
    attempt('u-toer', 3, 40_000, SUBMITTED),
  ]
  db.quizzes = [{ id: QUIZ, season_points_awarded: false }]

  const res = await processQuiz(QUIZ, CLOSES)

  assert.equal(res.error, null)
  assert.equal(res.rows, 2)
  assert.deepEqual(
    globalRows().map(r => [r.user_id, r.rank]),
    [['u-vinner', 1], ['u-toer', 2]],
  )
  assert.equal(db.quizzes[0].season_points_awarded, true)
})

// ── resyncSeasonScoresForQuiz (rettesiden) ───────────────────────────────────

test('resync ser samme populasjon som skrivingen — et forlatt forsøk utløser ingen «retting»', async () => {
  // Lagrede rader er korrekte målt mot LEVERTE forsøk. Uten filteret går
  // 0/0-spøkelset inn i global-rangeringen, skyver u-null til rank 3, og
  // resync «retter» en rad som var riktig.
  db.season_scores = [
    { id: 's1', quiz_id: QUIZ, user_id: 'u-vinner', scope_type: 'global', scope_id: null, points: 12, rank: 1 },
    { id: 's2', quiz_id: QUIZ, user_id: 'u-null', scope_type: 'global', scope_id: null, points: 10, rank: 2 },
  ]
  db.attempts = [
    attempt('u-vinner', 2, 30_000, SUBMITTED),
    attempt('u-null', 0, 60_000, SUBMITTED),
    attempt('u-spokelse', 0, 0, null),
  ]

  const res = await resyncSeasonScoresForQuiz(QUIZ)

  assert.equal(res.error, null)
  assert.equal(res.checked, 2)
  assert.equal(res.changes.length, 0, 'korrekte rader skal ikke røres')
  assert.deepEqual(scoreUpdates, [], 'ingen UPDATE skal gå mot season_scores')
})

test('resync retter fortsatt ekte avvik — filteret gjør den ikke passiv', async () => {
  // Fasitretting har snudd rekkefølgen: lagret sier u-toer foran u-vinner,
  // leverte forsøk sier det motsatte. Begge radene skal rettes.
  db.season_scores = [
    { id: 's1', quiz_id: QUIZ, user_id: 'u-vinner', scope_type: 'global', scope_id: null, points: 10, rank: 2 },
    { id: 's2', quiz_id: QUIZ, user_id: 'u-toer', scope_type: 'global', scope_id: null, points: 12, rank: 1 },
  ]
  db.attempts = [
    attempt('u-vinner', 5, 30_000, SUBMITTED),
    attempt('u-toer', 3, 40_000, SUBMITTED),
    attempt('u-spokelse', 0, 0, null),
  ]

  const res = await resyncSeasonScoresForQuiz(QUIZ)

  assert.equal(res.error, null)
  assert.equal(res.changes.length, 2)
  assert.deepEqual(
    scoreUpdates.map(u => [u.id, u.vals.rank, u.vals.points]).sort(),
    [['s1', 1, 12], ['s2', 2, 10]],
  )
})
