// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte rutehandleren i
// app/api/leagues/[id]/members-activity. `mock.module` bytter ut
// lib/supabase-admin med en fake som faktisk HÅNDHEVER filtrene den får
// (.eq/.in/.gte/.not(col,'is',null)) mot rader i minnet. Det er hele poenget:
// en fake som ignorerer filtre ville bestått uansett hva ruten spør om, og da
// beviser testen ingenting.
//
// Bakgrunn: liga-panelet hadde samme feil som bedriftspanelet hadde før
// commit 1297661 — AKTIV-prikken ble utledet av season_scores i den
// kalenderperioden toppliste-fanen tilfeldigvis sto på.
//
// MUTASJONSBEVIS — endre linjen, og navngitt test skal feile:
//   1. La `activeLast30Days` peke på `!!stats` (season_scores) igjen
//      → «aktiv-prikken følger rullerende 30 dager, ikke kalenderperioden»
//        OG «poeng i perioden gir ikke aktiv-prikk uten ferskt forsøk» feiler
//   2. Fjern `.eq('is_team', false)` på attempts-spørringen
//      → «lagforsøk gir ikke aktiv-prikk» feiler
//   3. Fjern `.not('submitted_at','is',null)` på attempts-spørringen
//      → «attempts-spørringen uttrykker begge invariantene» feiler
//   4. Fjern `if (recentErr) return 500`
//      → «feilet attempts-oppslag gir 500, ikke en stille inaktiv liga» feiler
//   4b. Fjern `if (scoresErr) …` / `if (excludedErr) …` / `if (profilesErr) …`
//      (19. august 2026) → tilhørende «feilet …-oppslag»-test feiler. De tre
//      oppslagene hadde samme form som attempts-oppslaget, men manglet vakten.
//   5. La CSV-kolonnen bruke `hasPeriodScore` igjen
//      → «CSV-kolonnen Aktiv siste 30 dager følger 30-dagersvinduet» feiler
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type Row = Record<string, unknown>

const state: {
  tables: Record<string, Row[]>
  authUserId: string
  // Tabell som skal svare med feil i stedet for data — for å teste at ruten
  // ikke degraderer stille.
  failTable: string | null
  // Registrerte spørringer, slik at en test kan slå fast at en invariant
  // faktisk er UTTRYKT i spørringen. Nødvendig for
  // `.not('submitted_at','is',null)`: PostgREST filtrerer NULL bort allerede
  // via `.gte(...)`, så den linjen kan ikke felles av data alene.
  queries: Array<{ table: string; ops: string[] }>
} = { tables: {}, authUserId: 'owner-1', failTable: null, queries: [] }

function rowsFor(table: string): Row[] {
  return state.tables[table] ?? []
}

// Minimal PostgREST-etterligning. Kun operatorene ruten faktisk bruker —
// men de som er med, virker på ordentlig.
function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = []
  const ops: string[] = []
  state.queries.push({ table, ops })

  const settle = () => {
    if (state.failTable === table) {
      return { data: null, error: { message: `simulert feil på ${table}` } }
    }
    const rows = rowsFor(table).filter(r => preds.every(p => p(r)))
    return { data: rows, error: null }
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { ops.push(`eq:${col}:${String(val)}`); preds.push(r => r[col] === val); return b },
    in(col: string, vals: unknown[]) {
      ops.push(`in:${col}`)
      const s = new Set(vals)
      preds.push(r => s.has(r[col]))
      return b
    },
    // NULL >= x er NULL i Postgres, altså «ikke sant» → raden faller ut.
    gte(col: string, val: string) { ops.push(`gte:${col}`); preds.push(r => r[col] != null && String(r[col]) >= val); return b },
    lt(col: string, val: string) { ops.push(`lt:${col}`); preds.push(r => r[col] != null && String(r[col]) < val); return b },
    // Kun formen ruten bruker: .not(col, 'is', null) = "kolonnen er satt".
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) {
        ops.push(`not-null:${col}`)
        preds.push(r => r[col] != null && r[col] !== undefined)
      }
      return b
    },
    order() { return b },
    limit() { return b },
    range() { return b },
    maybeSingle() {
      const { data, error } = settle()
      return Promise.resolve({ data: (data ?? [])[0] ?? null, error })
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(settle()).then(res, rej)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: state.authUserId } }, error: null }),
      },
    },
  },
})

const { GET } = await import('@/app/api/leagues/[id]/members-activity/route')

const LEAGUE = 'league-1'

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

// Garantert FØR periodStart for period=month (1. i inneværende måned UTC),
// uansett hvilken dag i måneden testen kjøres.
const lastMonth = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString()
}
// Garantert ETTER periodStart for period=month.
const thisMonth = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12)).toISOString()
}

// Ruten leser kun request.headers og request.url. Unik IP per kall, ellers
// slår den ekte rate-limiten (20/60s) inn midt i testsuiten.
let ipSeq = 0
const req = (query = '') =>
  ({
    headers: new Headers({ authorization: 'Bearer t', 'x-forwarded-for': `10.0.0.${++ipSeq}` }),
    url: `https://quizkanonen.no/api/leagues/${LEAGUE}/members-activity${query}`,
  }) as unknown as Parameters<typeof GET>[0]

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

type Member = {
  userId: string
  displayName: string
  activeLast30Days: boolean
  hasPeriodScore: boolean
  totalPoints: number
  quizCount: number
}

const baseTables = () => ({
  leagues: [{ id: LEAGUE, owner_id: 'owner-1' }],
  league_members: [
    { league_id: LEAGUE, user_id: 'owner-1', joined_at: '2026-01-01T00:00:00Z' },
    { league_id: LEAGUE, user_id: 'a1', joined_at: '2026-01-01T00:00:00Z' },
  ],
  profiles: [
    { id: 'owner-1', display_name: 'Eier' },
    { id: 'a1', display_name: 'Anne' },
  ],
  excluded_members: [],
  season_scores: [] as Row[],
  attempts: [] as Row[],
})

beforeEach(() => {
  state.tables = {}
  state.authUserId = 'owner-1'
  state.failTable = null
  state.queries = []
})

// ── Kjernen: prikken er rullerende, ikke periodebasert ────────────────────────

test('aktiv-prikken følger rullerende 30 dager, ikke kalenderperioden', async () => {
  const t = baseTables()
  // Anne leverte for 5 dager siden. Den quizen ble gjort opp FORRIGE måned i
  // season_scores — altså utenfor period=month sitt vindu.
  t.attempts = [
    { user_id: 'a1', is_team: false, submitted_at: daysAgo(5) },
  ]
  t.season_scores = [
    { scope_type: 'league', scope_id: LEAGUE, user_id: 'a1', points: 40, quiz_id: 'q-old', closes_at: lastMonth() },
  ]
  state.tables = t

  const res = await GET(req('?period=month'), ctx(LEAGUE))
  assert.equal(res.status, 200)
  const json = await res.json() as { members: Member[] }
  const anne = json.members.find(m => m.userId === 'a1')!

  assert.equal(anne.activeLast30Days, true, 'leverte for 5 dager siden — prikken skal lyse')
  assert.equal(anne.hasPeriodScore, false, 'poengene ligger i forrige måned, ikke i valgt periode')
  assert.equal(anne.totalPoints, 0, 'poeng-kolonnen skal fortsatt være periodebasert')
})

test('poeng i perioden gir ikke aktiv-prikk uten ferskt forsøk', async () => {
  const t = baseTables()
  // Har poeng i inneværende måned, men siste leverte forsøk er 60 dager gammelt.
  t.attempts = [
    { user_id: 'a1', is_team: false, submitted_at: daysAgo(60) },
  ]
  t.season_scores = [
    { scope_type: 'league', scope_id: LEAGUE, user_id: 'a1', points: 40, quiz_id: 'q1', closes_at: thisMonth() },
  ]
  state.tables = t

  const res = await GET(req('?period=month'), ctx(LEAGUE))
  const json = await res.json() as { members: Member[] }
  const anne = json.members.find(m => m.userId === 'a1')!

  assert.equal(anne.activeLast30Days, false, 'prikken skal IKKE utledes av season_scores')
  assert.equal(anne.hasPeriodScore, true)
  assert.equal(anne.totalPoints, 40, 'poeng-kolonnen er uendret periodebasert')
})

test('prikken lyser under en pågående quiz, før cronen har skrevet season_scores', async () => {
  const t = baseTables()
  // Leverte i dag. `award-season-points` kjører først når quizen stenger, så
  // season_scores er fortsatt tom — den gamle logikken viste ingen prikk.
  t.attempts = [{ user_id: 'a1', is_team: false, submitted_at: daysAgo(0) }]
  state.tables = t

  const res = await GET(req('?period=month'), ctx(LEAGUE))
  const json = await res.json() as { members: Member[] }

  assert.equal(json.members.find(m => m.userId === 'a1')!.activeLast30Days, true)
})

test('fanebytte til kvartal/år endrer ikke aktiv-prikken', async () => {
  const t = baseTables()
  t.attempts = [{ user_id: 'a1', is_team: false, submitted_at: daysAgo(5) }]
  state.tables = t

  const flags: boolean[] = []
  for (const period of ['month', 'quarter', 'year'] as const) {
    const res = await GET(req(`?period=${period}`), ctx(LEAGUE))
    const json = await res.json() as { members: Member[] }
    flags.push(json.members.find(m => m.userId === 'a1')!.activeLast30Days)
  }

  assert.deepEqual(flags, [true, true, true], 'prikken skal være uavhengig av toppliste-fanen')
})

test('forsøk eldre enn 30 dager gir ikke aktiv-prikk', async () => {
  const t = baseTables()
  t.attempts = [{ user_id: 'a1', is_team: false, submitted_at: daysAgo(31) }]
  state.tables = t

  const res = await GET(req('?period=month'), ctx(LEAGUE))
  const json = await res.json() as { members: Member[] }

  assert.equal(json.members.find(m => m.userId === 'a1')!.activeLast30Days, false)
})

// ── Invariantene på attempts-spørringen ───────────────────────────────────────

test('lagforsøk gir ikke aktiv-prikk', async () => {
  const t = baseTables()
  // Kun et lagforsøk. Lagforsøk gir heller ikke sesongpoeng, så prikken ville
  // ellers vært uenig med poeng-linjen rett under seg.
  t.attempts = [{ user_id: 'a1', is_team: true, submitted_at: daysAgo(2) }]
  state.tables = t

  const res = await GET(req('?period=month'), ctx(LEAGUE))
  const json = await res.json() as { members: Member[] }

  assert.equal(json.members.find(m => m.userId === 'a1')!.activeLast30Days, false)
})

test('påbegynt, aldri levert forsøk gir ikke aktiv-prikk', async () => {
  const t = baseTables()
  // start-attempt oppretter raden med submitted_at: null. Anne åpnet quizen i
  // går og lukket fanen.
  t.attempts = [{ user_id: 'a1', is_team: false, submitted_at: null, completed_at: daysAgo(1) }]
  state.tables = t

  const res = await GET(req('?period=month'), ctx(LEAGUE))
  const json = await res.json() as { members: Member[] }

  assert.equal(json.members.find(m => m.userId === 'a1')!.activeLast30Days, false)
})

test('attempts-spørringen uttrykker begge invariantene', async () => {
  const t = baseTables()
  t.attempts = [{ user_id: 'a1', is_team: false, submitted_at: daysAgo(2) }]
  state.tables = t

  await GET(req('?period=month'), ctx(LEAGUE))

  const q = state.queries.find(x => x.table === 'attempts')
  assert.ok(q, 'ruten skal spørre attempts for aktiv-prikken')
  assert.ok(q!.ops.includes('gte:submitted_at'), 'rullerende vindu måles på submitted_at')
  // Redundant mot gte i praksis (NULL faller ut av sammenligningen), men den
  // står som en uttalt INVARIANT: et uleverte forsøk er ikke «spilt». Uten
  // denne assertsjonen kunne linjen fjernes uten at noen test merket det.
  assert.ok(q!.ops.includes('not-null:submitted_at'), 'uleverte forsøk skal filtreres eksplisitt')
  assert.ok(q!.ops.includes('eq:is_team:false'), 'lagforsøk skal filtreres bort')
})

// ── Ingen stille degradering ──────────────────────────────────────────────────

test('feilet attempts-oppslag gir 500, ikke en stille inaktiv liga', async () => {
  const t = baseTables()
  t.attempts = [{ user_id: 'a1', is_team: false, submitted_at: daysAgo(2) }]
  state.tables = t
  state.failTable = 'attempts'

  const res = await GET(req('?period=month'), ctx(LEAGUE))

  assert.equal(res.status, 500, 'et feilet oppslag skal ikke bli til «alle er inaktive»')
  const json = await res.json() as { members?: Member[]; error?: string }
  assert.equal(json.members, undefined, 'ingen medlemsliste skal returneres ved feil')
  assert.ok(json.error, 'feilen skal være synlig for klienten')
})

test('feilet medlemsoppslag gir 500, ikke en liga uten medlemmer', async () => {
  // Tom liste og feilet spørring så helt like ut for kalleren — og i CSV-
  // eksporten ble forskjellen bare en fil med overskriftsraden alene.
  state.tables = baseTables()
  state.failTable = 'league_members'

  const res = await GET(req('?period=month'), ctx(LEAGUE))

  assert.equal(res.status, 500)
  const json = await res.json() as { members?: Member[]; error?: string }
  assert.equal(json.members, undefined)
  assert.ok(json.error)
})

test('feilet season_scores-oppslag gir 500, ikke en liga der alle har 0 poeng', async () => {
  // Den farligste av de tre: 0 poeng ser helt normalt ut de første dagene i en
  // ny periode, så en feilet spørring ville blitt trodd.
  const t = baseTables()
  t.attempts = [{ user_id: 'a1', is_team: false, submitted_at: daysAgo(2) }]
  state.tables = t
  state.failTable = 'season_scores'

  const res = await GET(req('?period=month'), ctx(LEAGUE))

  assert.equal(res.status, 500, 'et feilet poengoppslag skal ikke bli til «alle har 0»')
  const json = await res.json() as { members?: Member[]; error?: string }
  assert.equal(json.members, undefined)
  assert.ok(json.error)
})

test('feilet excluded_members-oppslag gir 500 — utmeldte skal ikke dukke opp igjen', async () => {
  const t = baseTables()
  state.tables = t
  state.failTable = 'excluded_members'

  const res = await GET(req('?period=month'), ctx(LEAGUE))

  assert.equal(res.status, 500, 'et tomt ekskluderingssett er «vet ikke», ikke «ingen er ekskludert»')
  assert.equal((await res.json() as { members?: Member[] }).members, undefined)
})

test('feilet profil-oppslag gir 500, ikke en liste med navnløse medlemmer', async () => {
  const t = baseTables()
  state.tables = t
  state.failTable = 'profiles'

  const res = await GET(req('?period=month'), ctx(LEAGUE))

  assert.equal(res.status, 500)
  assert.equal((await res.json() as { members?: Member[] }).members, undefined)
})

// ── CSV ───────────────────────────────────────────────────────────────────────

test('CSV-kolonnen Aktiv siste 30 dager følger 30-dagersvinduet', async () => {
  const t = baseTables()
  // Anne: fersk levering, men poengene ligger i forrige måned.
  t.attempts = [{ user_id: 'a1', is_team: false, submitted_at: daysAgo(5) }]
  t.season_scores = [
    { scope_type: 'league', scope_id: LEAGUE, user_id: 'a1', points: 40, quiz_id: 'q-old', closes_at: lastMonth() },
  ]
  state.tables = t

  const res = await GET(req('?period=month&format=csv'), ctx(LEAGUE))
  const csv = await res.text()
  const lines = csv.replace(/^﻿/, '').split('\n')

  assert.equal(lines[0], 'Navn,Aktiv siste 30 dager,Poeng,Antall quizer,Sist innlogget eller spilt')
  const anneRow = lines.find(l => l.startsWith('"Anne"'))!
  assert.equal(anneRow.split(',')[1], 'Ja', 'kolonnen skal speile prikken, ikke perioden')
})

test('tom liga gir samme CSV-kolonner som en full liga', async () => {
  const t = baseTables()
  t.league_members = []
  state.tables = t

  const full = await GET(req('?period=month&format=csv'), ctx(LEAGUE))
  state.tables = { ...baseTables() }
  const empty = await GET(req('?period=month&format=csv'), ctx(LEAGUE))

  const header = (s: string) => s.replace(/^﻿/, '').split('\n')[0]
  assert.equal(header(await full.text()), header(await empty.text()))
})

// ── Regresjonsvakt: poeng og sortering er fortsatt periodebaserte ─────────────

test('poeng og sortering er fortsatt periodebaserte', async () => {
  const t = baseTables()
  t.league_members.push({ league_id: LEAGUE, user_id: 'b2', joined_at: '2026-01-01T00:00:00Z' })
  t.profiles.push({ id: 'b2', display_name: 'Bjørn' })
  t.attempts = [
    { user_id: 'a1', is_team: false, submitted_at: daysAgo(3) },
    { user_id: 'b2', is_team: false, submitted_at: daysAgo(3) },
  ]
  t.season_scores = [
    { scope_type: 'league', scope_id: LEAGUE, user_id: 'a1', points: 10, quiz_id: 'q1', closes_at: thisMonth() },
    { scope_type: 'league', scope_id: LEAGUE, user_id: 'b2', points: 30, quiz_id: 'q1', closes_at: thisMonth() },
    // Samme quiz to ganger → skal telles én gang.
    { scope_type: 'league', scope_id: LEAGUE, user_id: 'b2', points: 30, quiz_id: 'q1', closes_at: thisMonth() },
  ]
  state.tables = t

  const res = await GET(req('?period=month'), ctx(LEAGUE))
  const json = await res.json() as { members: Member[] }

  assert.deepEqual(json.members.map(m => m.userId), ['b2', 'a1', 'owner-1'], 'poeng DESC, så resten alfabetisk')
  assert.equal(json.members[0].totalPoints, 30)
  assert.equal(json.members[0].quizCount, 1, 'duplikat quiz_id skal ikke dobbelttelles')
})

test('kun eieren får se medlemsoversikten', async () => {
  state.tables = baseTables()
  state.authUserId = 'a1'

  const res = await GET(req('?period=month'), ctx(LEAGUE))
  assert.equal(res.status, 403)
})
