// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den EKTE GET /api/arkiv/[id]/plassering mot en fake som
// EVALUERER filtrene (ikke bare registrerer dem) og pagineres som PostgREST.
// Ruten, lib/premium-check, lib/archive-play-gate, lib/archive-placement,
// lib/org-membership og lib/ranking kjøres uendret. Kun supabase-admin og
// lib/globally-blocked-set er mocket — det siste fordi settet har en
// modul-lokal cache nøklet på quiz-id som ellers ville lekket mellom tester,
// og fordi «ble det slått opp i det hele tatt?» er nettopp det org-/global-
// skillet skal bevises på.
//
// Evalueringen er poenget: en fake som returnerer alle rader uansett filter
// forblir grønn selv om eierskaps- eller populasjonsfilteret aldri legges på
// (husregel: grep teller navn, ikke oppførsel).
//
// FIXTURE-REGELEN er fulgt: hver feltrad har distinkte verdier i
// correct_answers og total_time_ms, og hver bruker distinkt id.
//
// MUTASJONSBEVIS (alle kjørt 27. august 2026 og revertert):
//   • fjern `.eq('user_id', user.id)` fra forsøksoppslaget           (1 rød)
//   • fjern `.eq('quiz_id', archiveQuizId)` samme sted               (1 rød)
//   • fjern `if (attempt.submitted_at === null)`-grenen              (1 rød)
//   • fjern `quiz.quiz_type !== 'archive'`-leddet                    (1 rød)
//   • fjern decideArchivePlayGate sin avvisning                      (2 røde)
//       → gratis fikk plassering (403 → 200) og lesefeil ble ikke 503
//   • `orgMemberIds = orgGate.memberIds` → `= null`                  (1 rød)
//       → verifisert medlemskap, men globalt felt
//   • fjern `.eq('is_team', false)` fra feltoppslaget                (1 rød)
//   • fjern `.not('submitted_at','is',null)` fra feltoppslaget       (1 rød)
//   • kall getGloballyBlockedSet også i org-modus                    (1 rød)
//   • skygg `fetchAllRows` med en variant som kun henter FØRSTE side (2 røde)
//       → nevneren stoppet på 1000 av 1050, og lesefeilen sluttet å gi 503
//
// TO AV DEM OVERLEVDE FØRSTE RUNDE, og testene ble strammet FØR de ble
// notert her — begge er verdt å kjenne:
//
//   1. Arkiv-typekravet. Testen kalte ruten med fredagsquizens id og MITT
//      arkivforsøk. Den fikk 404 uansett, fordi forsøksoppslaget ikke fant
//      noe — grønn av feil grunn, nøyaktig «naboen kan oppfylle test-ankeret
//      ditt». Fixturen har nå et EKTE forsøk på fredagsquizen, så bare
//      typekravet kan gi 404-en.
//   2. `.not('submitted_at','is',null)` i feltoppslaget. Nevneren stemte
//      likevel, fordi rankQuizAttempts filtrerer på `requireSubmitted` en
//      gang til. Databasefilteret er BÅNDBREDDE, ikke korrekthet, og felles
//      derfor strukturelt — på filterlisten spørringen faktisk sendte.
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000

const MEG = '11111111-1111-4111-8111-111111111111'
const ANNEN = '22222222-2222-4222-8222-222222222222'
const KOLLEGA = '33333333-3333-4333-8333-333333333333'
const ARKIV_QUIZ = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const ORIGINAL_QUIZ = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const MITT_FORSOK = 'cccccccc-3333-4333-8333-cccccccccccc'
const ANNET_FORSOK = 'dddddddd-4444-4444-8444-dddddddddddd'
const ORG_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'

type Row = Record<string, unknown>
type Filter = { method: string; args: unknown[] }
type Op = {
  table: string
  action: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  filters: Filter[]
}

const state = {
  quizzes: [] as Row[],
  attempts: [] as Row[],
  profiles: [] as Row[],
  organizations: [] as Row[],
  organization_members: [] as Row[],
  quizLookupFails: false,
  attemptLookupFails: false,
  profileLookupFails: false,
  fieldQueryFails: false,
  authFails: false,
  blockedSet: new Set<string>(),
  blockedCalls: [] as { quizId: string; userIds: string[]; awarded: boolean }[],
  ops: [] as Op[],
}

function evalFilter(row: Row, f: Filter): boolean {
  const [col, ...rest] = f.args as [string, ...unknown[]]
  const v = row[col]
  switch (f.method) {
    case 'eq':
      return v === rest[0]
    case 'in':
      return (rest[0] as unknown[]).includes(v)
    case 'not': {
      const [op, val] = rest as [string, unknown]
      if (op !== 'is') throw new Error(`uventet not-operator i test: ${op}`)
      return !(v === val)
    }
    default:
      throw new Error(`uventet filter i test: ${f.method}`)
  }
}

function tableRows(table: string): Row[] {
  const t = state as unknown as Record<string, Row[]>
  const rows = t[table]
  if (!rows) throw new Error(`uventet tabell i test: ${table}`)
  return rows
}

function fails(table: string, single: boolean): boolean {
  if (table === 'profiles') return state.profileLookupFails
  if (table === 'quizzes') return state.quizLookupFails
  if (table === 'attempts') return single ? state.attemptLookupFails : state.fieldQueryFails
  return false
}

function makeBuilder(table: string) {
  const op: Op = { table, action: 'select', filters: [] }
  const orders: { col: string; asc: boolean }[] = []
  let from = 0
  let to = PG_ROW_CAP - 1
  let single = false

  const b: Record<string, unknown> = {
    select() { return b },
    // Skrivemetodene finnes KUN for at en framtidig skriving skal bli
    // REGISTRERT (og felt av «ingen skriving»-testen) i stedet for å krasje
    // med «is not a function», som ville sett ut som en annen feil.
    insert() { op.action = 'insert'; return b },
    update() { op.action = 'update'; return b },
    upsert() { op.action = 'upsert'; return b },
    delete() { op.action = 'delete'; return b },
    eq(...args: unknown[]) { op.filters.push({ method: 'eq', args }); return b },
    in(...args: unknown[]) { op.filters.push({ method: 'in', args }); return b },
    not(...args: unknown[]) { op.filters.push({ method: 'not', args }); return b },
    order(col: string, opts?: { ascending?: boolean }) {
      orders.push({ col, asc: opts?.ascending ?? true })
      return b
    },
    range(f: number, t: number) { from = f; to = t; return b },
    maybeSingle() { single = true; return b },
    single() { single = true; return b },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      state.ops.push(op)
      if (fails(table, single)) {
        return Promise.resolve({ data: null, error: { message: 'simulert DB-feil' } })
          .then(resolve, reject)
      }
      const matched = tableRows(table).filter((r) => op.filters.every((f) => evalFilter(r, f)))
      if (single) {
        return Promise.resolve({ data: matched[0] ?? null, error: null }).then(resolve, reject)
      }
      const sorted = [...matched].sort((x, y) => {
        for (const o of orders) {
          const a = x[o.col]
          const c = y[o.col]
          if (a === c) continue
          const cmp = String(a) < String(c) ? -1 : 1
          return o.asc ? cmp : -cmp
        }
        return 0
      })
      const window = sorted.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(resolve, reject)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () =>
          state.authFails
            ? { data: { user: null }, error: { message: 'ugyldig token' } }
            : { data: { user: { id: MEG } }, error: null },
      },
      from: (table: string) => makeBuilder(table),
    },
  },
})

mock.module('@/lib/globally-blocked-set', {
  namedExports: {
    getGloballyBlockedSet: async (
      quizId: string,
      attemptUserIds: string[],
      seasonPointsAwarded: boolean
    ) => {
      state.blockedCalls.push({
        quizId,
        userIds: [...attemptUserIds],
        awarded: seasonPointsAwarded,
      })
      return state.blockedSet
    },
  },
})

const { GET } = await import('@/app/api/arkiv/[id]/plassering/route')

function feltrad(id: string, userId: string | null, correct: number, timeMs: number, over: Row = {}): Row {
  return {
    id,
    quiz_id: ORIGINAL_QUIZ,
    user_id: userId,
    player_name: `spiller-${id}`,
    correct_answers: correct,
    total_time_ms: timeMs,
    correct_streak: 0,
    submitted_at: '2026-08-14T20:30:00.000Z',
    is_team: false,
    ...over,
  }
}

async function kall(over: { quizId?: string; attempt?: string | null; org?: string; medToken?: boolean } = {}) {
  const params = new URLSearchParams()
  if (over.attempt !== null) params.set('attempt', over.attempt ?? MITT_FORSOK)
  if (over.org) params.set('org', over.org)
  const url = `https://quizkanonen.no/api/arkiv/${over.quizId ?? ARKIV_QUIZ}/plassering?${params}`
  const request = new Request(url, {
    headers: over.medToken === false ? {} : { authorization: 'Bearer test-token' },
  })
  return GET(request as never, { params: Promise.resolve({ id: over.quizId ?? ARKIV_QUIZ }) })
}

/** Alle registrerte SKRIVINGER — skal alltid være tom (invarianten). */
function skrivinger(): Op[] {
  return state.ops.filter((o) => o.action !== 'select')
}

beforeEach(() => {
  state.quizzes = [
    { id: ARKIV_QUIZ, quiz_type: 'archive', source_quiz_id: ORIGINAL_QUIZ, season_points_awarded: false },
    { id: ORIGINAL_QUIZ, quiz_type: 'weekly', source_quiz_id: null, season_points_awarded: true },
  ]
  state.attempts = [
    // Mitt arkivforsøk: 12 riktige på 60 s.
    {
      id: MITT_FORSOK,
      quiz_id: ARKIV_QUIZ,
      user_id: MEG,
      correct_answers: 12,
      total_time_ms: 60_000,
      submitted_at: '2026-08-27T18:00:00.000Z',
      is_team: false,
    },
    // Det frosne feltet på originalquizen.
    feltrad('f1', ANNEN, 15, 40_000),
    feltrad('f2', KOLLEGA, 11, 66_000),
  ]
  state.profiles = [
    { id: MEG, premium_status: true, org_premium_grace_until: null, personal_grace_until: null },
  ]
  state.organizations = [{ id: ORG_ID, slug: 'elkjop' }]
  state.organization_members = [
    { organization_id: ORG_ID, user_id: MEG, role: 'member' },
    { organization_id: ORG_ID, user_id: KOLLEGA, role: 'member' },
  ]
  state.quizLookupFails = false
  state.attemptLookupFails = false
  state.profileLookupFails = false
  state.fieldQueryFails = false
  state.authFails = false
  state.blockedSet = new Set<string>()
  state.blockedCalls = []
  state.ops = []
})

// ── Gatene ─────────────────────────────────────────────────────────────────

test('uten token: 401', async () => {
  const res = await kall({ medToken: false })
  assert.equal(res.status, 401)
})

test('ugyldig sesjon: 401', async () => {
  state.authFails = true
  assert.equal((await kall()).status, 401)
})

test('uten attempt-parameter: 400', async () => {
  assert.equal((await kall({ attempt: null })).status, 400)
})

test('gratisbruker: 403 med arkivets egen ordlyd (delt gate med spill-porten)', async () => {
  state.profiles = [
    { id: MEG, premium_status: false, org_premium_grace_until: null, personal_grace_until: null },
  ]
  const res = await kall()
  assert.equal(res.status, 403)
  assert.deepEqual(await res.json(), { error: 'Arkivet krever Premium.' })
})

test('premium-lesefeil: 503 — «vet ikke» er aldri en dom', async () => {
  state.profileLookupFails = true
  const res = await kall()
  assert.equal(res.status, 503)
})

test('org-karens gir tilgang (binder ruten til den EKTE getUserPremium)', async () => {
  state.profiles = [
    {
      id: MEG,
      premium_status: false,
      org_premium_grace_until: new Date(Date.now() + 86_400_000).toISOString(),
      personal_grace_until: null,
    },
  ]
  assert.equal((await kall()).status, 200)
})

test('fredagsquiz (ikke arkiv): 404 — ruten er ikke en tredje vei til plassering', async () => {
  // ANKERET MÅ SKILLE: kalles ruten med MITT_FORSOK (som ligger på
  // arkivquizen), svarer den 404 uansett — forsøksoppslaget finner ingenting.
  // Testen ville da vært grønn av feil grunn, og fjernes arkiv-typekravet
  // merkes det ikke. Derfor et EGET, gyldig forsøk på selve fredagsquizen:
  // uten typekravet ville dette kallet gått gjennom til 200.
  state.attempts.push({
    id: ANNET_FORSOK,
    quiz_id: ORIGINAL_QUIZ,
    user_id: MEG,
    correct_answers: 13,
    total_time_ms: 55_000,
    submitted_at: '2026-08-14T20:30:00.000Z',
    is_team: false,
  })
  const res = await kall({ quizId: ORIGINAL_QUIZ, attempt: ANNET_FORSOK })
  assert.equal(res.status, 404)
})

test('quiz-lesefeil: 503, ikke 404', async () => {
  state.quizLookupFails = true
  assert.equal((await kall()).status, 503)
})

// ── Eierskapet er gaten ────────────────────────────────────────────────────

test('en annens forsøk: 404 — eierskapsleddet står i spørringen', async () => {
  state.attempts.push({
    id: ANNET_FORSOK,
    quiz_id: ARKIV_QUIZ,
    user_id: ANNEN,
    correct_answers: 15,
    total_time_ms: 30_000,
    submitted_at: '2026-08-27T18:00:00.000Z',
    is_team: false,
  })
  const res = await kall({ attempt: ANNET_FORSOK })
  assert.equal(res.status, 404)
})

test('eget forsøk på en ANNEN quiz: 404', async () => {
  state.attempts.push({
    id: ANNET_FORSOK,
    quiz_id: ORIGINAL_QUIZ,
    user_id: MEG,
    correct_answers: 9,
    total_time_ms: 80_000,
    submitted_at: '2026-08-14T20:30:00.000Z',
    is_team: false,
  })
  const res = await kall({ attempt: ANNET_FORSOK })
  assert.equal(res.status, 404)
})

test('uferdig forsøk: 409 — egen tilstand, ikke «ingen plassering»', async () => {
  ;(state.attempts[0] as Row).submitted_at = null
  const res = await kall()
  assert.equal(res.status, 409)
})

// ── FELLE 1: tomt felt og manglende kilde ─────────────────────────────────

test('FELLE 1: uten source_quiz_id → «ingen-kilde», og feltet slås ikke opp', async () => {
  ;(state.quizzes[0] as Row).source_quiz_id = null
  const res = await kall()
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { placement: null, reason: 'ingen-kilde' })
  // Ingen attempts-spørring mot originalquizen — svaret var gitt.
  const feltOppslag = state.ops.filter(
    (o) => o.table === 'attempts' &&
      o.filters.some((f) => f.method === 'eq' && f.args[0] === 'quiz_id' && f.args[1] === ORIGINAL_QUIZ)
  )
  assert.equal(feltOppslag.length, 0)
})

test('FELLE 1: tomt frosset felt → «tomt-felt», ALDRI «nr. 1 av 1»', async () => {
  state.attempts = state.attempts.filter((a) => a.quiz_id !== ORIGINAL_QUIZ)
  const res = await kall()
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { placement: null, reason: 'tomt-felt' })
})

test('feltoppslaget feilet: 503 — et halvt felt gir et tall som ser like presist ut', async () => {
  state.fieldQueryFails = true
  assert.equal((await kall()).status, 503)
})

// ── Populasjonen i feltoppslaget ──────────────────────────────────────────

test('uleverte forsøk teller ikke i feltet — og filteret ligger i SPØRRINGEN', async () => {
  state.attempts.push(feltrad('f3', 'ny-bruker', 14, 45_000, { submitted_at: null }))
  const res = await kall()
  const body = await res.json()
  assert.equal(body.placement.fieldSize, 2)

  // ÆRLIG OM HVA TALLET OVER BEVISER: det ville stemt også uten
  // `.not('submitted_at','is',null)` i spørringen, fordi rankQuizAttempts
  // filtrerer på `requireSubmitted` en gang til inne i decideArchivePlacement.
  // Databasefilteret er derfor ikke korrektheten — det er BÅNDBREDDEN (en
  // quiz kan ha mange påbegynte forsøk som aldri ble levert). Den egenskapen
  // kan bare felles strukturelt, på spørringen som faktisk ble sendt.
  const feltOppslag = state.ops.find(
    (o) =>
      o.table === 'attempts' &&
      o.filters.some((f) => f.method === 'eq' && f.args[0] === 'quiz_id' && f.args[1] === ORIGINAL_QUIZ)
  )
  assert.ok(feltOppslag, 'feltoppslaget skal ha skjedd')
  assert.deepEqual(feltOppslag.filters, [
    { method: 'eq', args: ['quiz_id', ORIGINAL_QUIZ] },
    { method: 'eq', args: ['is_team', false] },
    { method: 'not', args: ['submitted_at', 'is', null] },
  ])
})

test('lagforsøk teller ikke i feltet', async () => {
  state.attempts.push(feltrad('f4', 'lagleder', 14, 45_000, { is_team: true }))
  const res = await kall()
  const body = await res.json()
  assert.equal(body.placement.fieldSize, 2)
})

test('feltet pagineres: 1050 rader gir en nevner på 1050, ikke 1000', async () => {
  state.attempts = state.attempts.filter((a) => a.quiz_id !== ORIGINAL_QUIZ)
  for (let i = 0; i < 1050; i++) {
    // Distinkte tall per rad, alle DÅRLIGERE enn mine 12 riktige, så
    // plasseringen er 1 og nevneren er hele feltet + meg.
    state.attempts.push(feltrad(`p${String(i).padStart(4, '0')}`, `bruker-${i}`, 5, 90_000 + i))
  }
  const res = await kall()
  const body = await res.json()
  assert.equal(body.placement.fieldSize, 1050)
  assert.equal(body.placement.total, 1051)
  assert.equal(body.placement.rank, 1)
})

// ── FELLE 2: egen original rad ────────────────────────────────────────────

test('FELLE 2: min egen originale rad trekkes ut av feltet', async () => {
  // Jeg spilte originalen og fikk 15 riktige — bedre enn arkivscoren på 12.
  // Uten uttrekket ville jeg konkurrert mot meg selv: 3. plass av 4.
  state.attempts.push(feltrad('min-gamle', MEG, 15, 35_000))
  const res = await kall()
  const body = await res.json()
  assert.deepEqual(body.placement, {
    rank: 2,
    total: 3,
    fieldSize: 2,
    selfWasInField: true,
    previous: { rank: 1, correctAnswers: 15 },
    scope: 'global',
  })
})

test('spilte jeg ikke originalen, trer jeg inn i feltet (selfWasInField=false)', async () => {
  const res = await kall()
  const body = await res.json()
  assert.deepEqual(body.placement, {
    rank: 2,
    total: 3,
    fieldSize: 2,
    selfWasInField: false,
    previous: null,
    scope: 'global',
  })
})

// ── FELLE 3: org-scope ────────────────────────────────────────────────────

test('FELLE 3: ?org= måler mot det interne feltet, og slår ikke opp blocked-settet', async () => {
  // Internt felt: kun KOLLEGA (11 riktige). Min 12 → 1. plass av 2.
  const res = await kall({ org: 'elkjop' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body.placement, {
    rank: 1,
    total: 2,
    fieldSize: 1,
    selfWasInField: false,
    previous: null,
    scope: 'org',
  })
  // Globalt ville ANNEN (15) ligget foran — beviser at feltet faktisk krympet.
  assert.equal(state.blockedCalls.length, 0, 'blocked-settet er en GLOBAL regel')
})

test('FELLE 3: ?org= for en org jeg ikke er medlem av: 403 (delt gate)', async () => {
  state.organization_members = state.organization_members.filter((m) => m.user_id !== MEG)
  assert.equal((await kall({ org: 'elkjop' })).status, 403)
})

test('FELLE 3: ukjent org-slug: 403', async () => {
  assert.equal((await kall({ org: 'finnes-ikke' })).status, 403)
})

test('globalt felt slår OPP blocked-settet, med originalquizens oppgjørsstatus', async () => {
  await kall()
  assert.equal(state.blockedCalls.length, 1)
  assert.equal(state.blockedCalls[0].quizId, ORIGINAL_QUIZ)
  assert.equal(state.blockedCalls[0].awarded, true)
  assert.deepEqual([...state.blockedCalls[0].userIds].sort(), [ANNEN, KOLLEGA].sort())
})

test('blokkert spiller faller ut av det globale feltet', async () => {
  state.blockedSet = new Set([ANNEN])
  const res = await kall()
  const body = await res.json()
  assert.equal(body.placement.fieldSize, 1)
  assert.equal(body.placement.rank, 1)
})

// ── Invarianten ───────────────────────────────────────────────────────────

test('INGEN SKRIVING: ikke én insert/update/upsert/delete på noen sti', async () => {
  await kall()
  assert.deepEqual(skrivinger(), [])

  state.ops = []
  await kall({ org: 'elkjop' })
  assert.deepEqual(skrivinger(), [])

  state.ops = []
  ;(state.quizzes[0] as Row).source_quiz_id = null
  await kall()
  assert.deepEqual(skrivinger(), [])
})

test('INGEN ranking_snapshots-berøring — cachen skrives ikke for en frosset quiz', async () => {
  await kall()
  assert.equal(
    state.ops.some((o) => o.table === 'ranking_snapshots'),
    false
  )
})

test('svaret bærer kun tall — ingen navn fra det frosne feltet', async () => {
  const res = await kall()
  const body = await res.json()
  assert.deepEqual(Object.keys(body).sort(), ['placement', 'sourceQuizId'])
  assert.deepEqual(
    Object.keys(body.placement).sort(),
    ['fieldSize', 'previous', 'rank', 'scope', 'selfWasInField', 'total']
  )
  assert.equal(JSON.stringify(body).includes('spiller-'), false)
})
