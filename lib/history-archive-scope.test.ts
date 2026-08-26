// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av de ekte getPlayerHistory/getPlayerStats/getAttemptDetail
// mot arkivseparasjonen (26. august 2026). `mock.module` bytter ut
// lib/supabase-admin med en fake som ANVENDER filtrene — ikke bare noterer
// dem. Det er poenget: en fake som returnerer alle rader uansett filter
// forblir grønn selv om populasjonsfilteret aldri legges på.
//
// BESLUTNINGENE SOM TESTES (Dennis, 25.–26. august 2026):
//   • Arkivforsøk teller IKKE i spillerens statistikk — ingen av delene.
//   • Arkivforsøk får egen seksjon (scope='archive'), ikke merkede rader.
//   • scope='archive' er SMALERE enn «ikke ekte»: testquizer og ukjente
//     typer skal ikke inn i arkivseksjonen.
//   • getAttemptDetail filtreres BEVISST ikke — arkivseksjonen lenker dit,
//     og eierskapssjekken er gaten.
//
// FIXTURE-REGELEN (fellen som bet tre ganger 26. august): quiz_type og
// is_test skiller seg UAVHENGIG av hverandre — det finnes en rad som kun
// is_test-leddet feller (a-weekly-test) og en rad som kun type-leddet feller
// (a-type-test). Et filter på feil felt kan derfor ikke se riktig ut.
//
// MUTASJONSBEVIS (alle kjørt 26. august 2026):
//   • fjern onlyRealQuizAttempts fra dataspørringen i getPlayerHistory
//       → hovedliste-testen ryker (7 rader i stedet for 2)
//   • fjern filteret KUN fra count-spørringen
//       → «count og data er enige»-testen ryker (total 7, items 2)
//   • fjern embeden fra count-selecten (tilbake til select('*'))
//       → PGRST108-pariteten i faken gir error, total 0 ≠ items 2
//   • bytt onlyArchiveQuizAttempts → onlyArtificialQuizzes-semantikk
//       → arkiv-testen ryker (testquizene a-test/a-type-test/a-weekly-test
//         dukker opp i arkivet)
//   • fjern is_test-leddet i onlyArchiveQuizAttempts
//       → arkiv-testen ryker (a-arkiv-test dukker opp)
//   • fjern onlyRealQuizAttempts fra statsspørringen i getPlayerStats
//       → stats-testen ryker (best_streak 15, avg endres)
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

type Row = Record<string, unknown>

type Op =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'not'; col: string; operator: string; val: unknown }
  | { op: 'in'; col: string; vals: readonly unknown[] }
  | { op: 'is'; col: string; val: unknown }

const state: { tables: Record<string, Row[]> } = { tables: {} }

function getPath(row: Row, col: string): unknown {
  let v: unknown = row
  for (const part of col.split('.')) {
    if (v == null || typeof v !== 'object') return undefined
    v = (v as Row)[part]
  }
  return v
}

function applyOps(rows: Row[], ops: Op[]): Row[] {
  return rows.filter((row) =>
    ops.every((o) => {
      const v = getPath(row, o.col)
      if (o.op === 'eq') return v === o.val
      if (o.op === 'is') return v === o.val
      if (o.op === 'in') return o.vals.includes(v)
      // not(col, 'is', val) — PostgREST-semantikk: NOT (col IS val).
      return !(v === o.val)
    })
  )
}

function builder(table: string) {
  const ops: Op[] = []
  let selected = ''
  let head = false
  let wantCount = false
  let orderCol: string | null = null
  let orderAsc = true
  let from: number | null = null
  let to: number | null = null

  const finish = () => {
    // PostgREST-paritet: filter på en embed som ikke står i select-listen gir
    // 400 PGRST108 — høylytt. Fanger «filter lagt på, embed glemt».
    if (
      ops.some((o) => o.col.includes('quizzes.')) &&
      !selected.includes('quizzes')
    ) {
      return { data: null, error: { message: 'PGRST108' }, count: null }
    }
    let rows = applyOps(state.tables[table] ?? [], ops)
    if (orderCol) {
      const col = orderCol
      rows = [...rows].sort((a, b) => {
        const av = String(getPath(a, col) ?? '')
        const bv = String(getPath(b, col) ?? '')
        return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    const count = wantCount ? rows.length : null
    if (head) return { data: null, error: null, count }
    if (from !== null && to !== null) rows = rows.slice(from, to + 1)
    return { data: rows, error: null, count }
  }

  const b = {
    select(sel?: string, opts?: { count?: string; head?: boolean }) {
      selected = sel ?? ''
      head = opts?.head === true
      wantCount = opts?.count === 'exact'
      return b
    },
    eq(col: string, val: unknown) { ops.push({ op: 'eq', col, val }); return b },
    not(col: string, operator: string, val: unknown) {
      ops.push({ op: 'not', col, operator, val }); return b
    },
    in(col: string, vals: readonly unknown[]) { ops.push({ op: 'in', col, vals }); return b },
    is(col: string, val: unknown) { ops.push({ op: 'is', col, val }); return b },
    lte() { return b },
    gte() { return b },
    limit() { return b },
    order(col: string, opts?: { ascending?: boolean }) {
      if (!orderCol) { orderCol = col; orderAsc = opts?.ascending !== false }
      return b
    },
    range(f: number, t: number) { from = f; to = t; return b },
    single() {
      const r = finish()
      if (r.error) return Promise.resolve({ data: null, error: r.error })
      const row = (r.data ?? [])[0] ?? null
      return Promise.resolve({
        data: row,
        error: row ? null : { message: 'PGRST116: no rows' },
      })
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(finish()).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { getPlayerHistory, getPlayerStats, getAttemptDetail } = await import('@/lib/history')

// ── Fixturer ────────────────────────────────────────────────────────────────
//
// Sju forsøk, der quiz_type og is_test varierer UAVHENGIG. Arkiv-/testforsøkene
// har alle full pott (15 riktige, streak 15) slik at en lekkasje inn i
// statistikken gir et ANNET tall, ikke bare flere rader.

function attempt(
  id: string, quizId: string, title: string, quizType: string,
  isTest: boolean | null, correct: number, streak: number, completedAt: string
): Row {
  return {
    id, quiz_id: quizId, user_id: 'user-1',
    correct_answers: correct, total_questions: 15, total_time_ms: 60_000,
    correct_streak: streak, completed_at: completedAt,
    quizzes: { id: quizId, title, quiz_type: quizType, is_test: isTest },
  }
}

function seed() {
  state.tables = {
    attempts: [
      attempt('a-weekly',      'q-weekly',      'Fredagsquiz uke 31', 'weekly',  false, 10, 4,  '2026-08-01T20:00:00Z'),
      // is_test NULL skal telle som ekte (NULL-semantikken i gulvet):
      attempt('a-bonus',       'q-bonus',       'Bonusquiz',          'bonus',   null,   8, 2,  '2026-08-08T20:00:00Z'),
      attempt('a-arkiv',       'q-arkiv',       'Fredagsquiz uke 12', 'archive', false, 15, 15, '2026-08-10T20:00:00Z'),
      // Testflagget arkivforsøk — skal vises INGEN steder:
      attempt('a-arkiv-test',  'q-arkiv-test',  'Arkiv testkjøring',  'archive', true,  15, 15, '2026-08-11T20:00:00Z'),
      attempt('a-test',        'q-test',        'Testquiz',           'test',    true,  15, 15, '2026-08-12T20:00:00Z'),
      // Felles KUN av is_test-leddet (typen er weekly):
      attempt('a-weekly-test', 'q-weekly-test', 'Adminbryter-test',   'weekly',  true,  15, 15, '2026-08-13T20:00:00Z'),
      // Felles KUN av type-leddet (is_test er false):
      attempt('a-type-test',   'q-type-test',   'Oppskrift-testquiz', 'test',    false, 15, 15, '2026-08-14T20:00:00Z'),
    ],
    season_scores: [],
    attempt_answers: [],
    questions: [],
    quizzes: [],
  }
}

// ── Hovedlista og count ─────────────────────────────────────────────────────

test('hovedlista (scope real) inneholder kun ekte forsøk — og count er enig', async () => {
  seed()

  const { items, total } = await getPlayerHistory('user-1')

  assert.deepEqual(
    items.map((i) => i.id),
    ['a-bonus', 'a-weekly'],
    'kun ekte forsøk, nyeste først — arkiv/test skal ikke være her'
  )
  // count-spørringen har SITT EGET filter (og sin egen embed i select-listen);
  // er de uenige, brekker total/hasMore-regnestykket i klienten.
  assert.equal(total, items.length, 'count og data må bruke samme populasjon')
  assert.equal(total, 2)
})

test('kontroll: ufiltrert ville hovedlista hatt 7 rader, ikke 2', () => {
  // Uten denne kontrollen kunne testen over passert med et datasett der
  // filteret ikke gjør noen forskjell — et bevis som ikke beviser.
  seed()
  assert.equal(state.tables.attempts.length, 7)
})

test('quiz_type følger med radene i API-svaret', async () => {
  seed()

  const { items } = await getPlayerHistory('user-1')

  assert.equal(items[0].quiz_type, 'bonus')
  assert.equal(items[1].quiz_type, 'weekly')
  assert.equal(items[0].quiz_title, 'Bonusquiz')
})

// ── Arkiv-scopet ────────────────────────────────────────────────────────────

test('scope=archive returnerer arkivforsøket og INGENTING annet — særlig ikke testquizer', async () => {
  seed()

  const { items, total } = await getPlayerHistory('user-1', { scope: 'archive' })

  assert.deepEqual(items.map((i) => i.id), ['a-arkiv'],
    'arkivet er quiz_type=archive OG ikke testflagget — ikke komplementet av «ekte»')
  assert.equal(total, 1, 'count og data må være enige også i arkiv-scopet')
  assert.equal(items[0].quiz_type, 'archive')
  // Eksplisitt, fordi hver av dem feller sin egen mutasjon:
  const ids = items.map((i) => i.id)
  assert.ok(!ids.includes('a-arkiv-test'), 'testflagget arkivforsøk skal ikke inn (is_test-leddet)')
  assert.ok(!ids.includes('a-test'), 'testquiz skal ikke inn (type-leddet)')
  assert.ok(!ids.includes('a-type-test'), 'oppskrift-testquiz skal ikke inn (type-leddet)')
})

test('et testflagget arkivforsøk vises INGEN steder — utenfor begge scopene', async () => {
  seed()

  const [real, arkiv] = await Promise.all([
    getPlayerHistory('user-1'),
    getPlayerHistory('user-1', { scope: 'archive' }),
  ])

  const alle = [...real.items, ...arkiv.items].map((i) => i.id)
  assert.ok(!alle.includes('a-arkiv-test'),
    'archive+is_test faller utenfor både «ekte» og «arkiv» — det er riktig')
})

// ── Statistikken er real-only ───────────────────────────────────────────────

test('arkiv-/testforsøk påvirker ikke snitt, rekorder eller feltsnittgrafen', async () => {
  seed()

  const stats = await getPlayerStats('user-1')

  assert.equal(stats.total_attempts, 2, 'kun de to ekte forsøkene teller')
  assert.equal(stats.total_correct, 18, '10 + 8 — full-pott-forsøkene på arkiv/test er ute')
  assert.equal(stats.best_streak, 4, 'arkivforsøkets streak på 15 skal ikke bli rekord')
  assert.equal(stats.avg_score_pct, 60, '18 av 30 — ikke løftet av 15/15-forsøkene')
  // quizIds er inngangen til alt nedstrøms — feltsnittet skal derfor ikke
  // engang SLÅ OPP arkivquizen.
  assert.ok(!('q-arkiv' in stats.felt_snitt_riktige),
    'feltsnittgrafen skal ikke ha en linje for arkivquizen')
  assert.ok('q-weekly' in stats.felt_snitt_riktige,
    'positiv kontroll: de ekte quizene HAR feltsnitt i denne fixturen')
})

// ── Detaljvisningen er bevisst ufiltrert ────────────────────────────────────

test('getAttemptDetail virker fortsatt for et arkivforsøk — eierskap er gaten', async () => {
  seed()

  const detail = await getAttemptDetail('a-arkiv', 'user-1')

  assert.ok(detail, 'arkivseksjonen lenker til detaljsiden — den må svare')
  assert.equal(detail.quiz_title, 'Fredagsquiz uke 12')
  assert.equal(detail.correct_answers, 15)
})

test('getAttemptDetail avviser fortsatt feil eier — også for arkivforsøk', async () => {
  seed()

  assert.equal(await getAttemptDetail('a-arkiv', 'user-2'), null)
})
