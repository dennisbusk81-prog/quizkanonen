// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// TOPPLISTEN SKAL IKKE VISE EN LISTE DEN IKKE VET ER RIKTIG (punkt 6,
// 9. september 2026)
//
// ── FEILEN ──────────────────────────────────────────────────────────────────
// /api/toppliste bygger `excludedSet` av to oppslag — `excluded_members` for
// scopet, og suspenderte profiler — og begge ble lest som `(res.data ?? [])`.
// En feilet spørring gir `data: null`, så `?? []` gjorde «vi vet ikke» om til
// «ingen er ekskludert». Formen har stått siden 559b07d, 14. juni.
//
// Utfallet er ikke en tom eller treg liste, men en FEIL liste: personen noen
// aktivt fjernet står der igjen med navn og plassering, og alle under dem får
// feil plassering fordi de dyttes ned. Scope-gaten like over feiler
// forbilledlig lukket (503 «Kunne ikke bekrefte tilgang») — disse to holdt
// ikke samme standard, i samme fil.
//
// ── HVA TESTEN FELLER ───────────────────────────────────────────────────────
// Den kjører den EKTE ruten mot en fake som kan feile ÉN spørring om gangen,
// og krever tre utfall per oppslag:
//
//   lesefeil    → 503, og INGEN entries i kroppen
//   null rader  → 200, uendret liste (dette er normaltilfellet — de aller
//                 fleste scopes har ingen ekskluderte i det hele tatt)
//   treff       → 200, og den ekskluderte er faktisk borte
//
// Midtraden er halve poenget: en vakt som skiller på «er settet tomt» i
// stedet for «feilet spørringen» ville gjort hver eneste normale henting til
// en 503. Skillet MÅ gå på `error` — samme felle som punkt 7 beskriver for
// PGRST116 i lib/postgrest-errors.ts.
//
// ── HVORFOR JS-FALLBACKEN ───────────────────────────────────────────────────
// Testen tvinger `season_leaderboard_ranked` til å feile, slik at ruten går
// JS-veien der ekskluderingen skjer i JS og er OBSERVERBAR i `entries`. På
// RPC-stien gjør SQL-funksjonen filtreringen, og der felles bruken i stedet
// av de to siste testene: `p_excluded_ids` skal bære id-en, og en lesefeil
// skal stoppe ruten før RPC-en kalles. Begge stiene bruker samme
// `excludedSet`, så vakten dekker begge — men bevisene er ulike.
//
// ── MUTASJONER KJØRT (9. september 2026) ────────────────────────────────────
// Se nederst i filen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ANNE  = '11111111-1111-1111-1111-111111111111'
const BJORN = '22222222-2222-2222-2222-222222222222'

// Eksplisitt periodevindu i stedet for «nå minus litt»: `period_start` er en
// ekte parameter ruten leser, og den frikobler testen fra klokka helt. Rader
// datert inni vinduet er inne uansett når suiten kjøres — også 1. i måneden
// kl. 00:30, der en «nå minus én time»-fixture ville falt utenfor.
const PERIODE_START = '2020-01-01T00:00:00.000Z'
const STENGT        = '2020-06-01T00:00:00.000Z'

type Rad = Record<string, unknown>

const db: Record<string, Rad[]> = {
  quizzes: [], attempts: [], profiles: [], excluded_members: [], season_scores: [],
}

/** Hvilket ENKELT oppslag som skal feile. Ett om gangen — se kommentaren over. */
let feil: 'ingen' | 'excluded' | 'suspended' = 'ingen'

/** Argumentene siste rpc-kall fikk — brukes av RPC-sti-testene. */
let sisteRpcArgs: Record<string, unknown> | null = null

/** Skal RPC-en svare, eller tvinge JS-fallbacken? */
let rpcSvarer = false

type Op = { fn: string; col: string; val: unknown }

function builder(tabell: string) {
  if (!(tabell in db)) throw new Error(`ukjent tabell i mock: ${tabell}`)
  const ops: Op[] = []

  // Feilen rutes på FILTERET, ikke på tabellnavnet alene: `profiles` leses
  // flere steder i ruten, og bare det ene oppslaget med `.gt('suspended_until')`
  // er suspenderings-oppslaget. En fake som feilet hele `profiles`-tabellen
  // ville felt en helt annen kodesti og gitt et bevis som ikke beviser.
  const skalFeile = () =>
    (feil === 'excluded' && tabell === 'excluded_members') ||
    (feil === 'suspended' && tabell === 'profiles' &&
      ops.some(o => o.fn === 'gt' && o.col === 'suspended_until'))

  const rader = (): Rad[] =>
    db[tabell].filter(r =>
      ops.every(o => {
        const v = r[o.col]
        if (o.fn === 'eq')  return v === o.val
        if (o.fn === 'is')  return o.val === null ? v == null : v === o.val
        if (o.fn === 'in')  return (o.val as readonly unknown[]).includes(v)
        if (o.fn === 'gt')  return v != null && String(v) >  String(o.val)
        if (o.fn === 'gte') return v != null && String(v) >= String(o.val)
        if (o.fn === 'lt')  return v != null && String(v) <  String(o.val)
        // not(col, 'is', null) → kolonnen er ikke null
        return o.val === null ? v != null : v !== o.val
      })
    )

  const b = {
    select() { return b },
    eq(col: string, val: unknown)  { ops.push({ fn: 'eq',  col, val }); return b },
    is(col: string, val: unknown)  { ops.push({ fn: 'is',  col, val }); return b },
    in(col: string, val: readonly unknown[]) { ops.push({ fn: 'in', col, val }); return b },
    gt(col: string, val: unknown)  { ops.push({ fn: 'gt',  col, val }); return b },
    gte(col: string, val: unknown) { ops.push({ fn: 'gte', col, val }); return b },
    lt(col: string, val: unknown)  { ops.push({ fn: 'lt',  col, val }); return b },
    not(col: string, _op: string, val: unknown) { ops.push({ fn: 'not', col, val }); return b },
    order() { return b },
    limit() { return b },
    range() { return b },
    maybeSingle() {
      if (skalFeile()) return Promise.resolve({ data: null, error: { message: '57P01 avbrutt tilkobling' } })
      return Promise.resolve({ data: rader()[0] ?? null, error: null })
    },
    then(resolve: (v: { data: Rad[] | null; error: { message: string } | null }) => void) {
      if (skalFeile()) return resolve({ data: null, error: { message: '57P01 avbrutt tilkobling' } })
      return resolve({ data: rader(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      rpc: (navn: string, args: Record<string, unknown>) => {
        if (navn === 'season_leaderboard_ranked') sisteRpcArgs = args
        return Promise.resolve(
          rpcSvarer
            ? { data: [], error: null }
            : { data: null, error: { message: 'function does not exist' } }
        )
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    },
  },
})

// Utenfor det testen handler om — stubbet slik at ruten kan kjøre.
mock.module('@/lib/globally-blocked-set', {
  namedExports: { getGloballyBlockedSet: async () => new Set<string>() },
})
mock.module('@/lib/premium-check', {
  namedExports: { getUserPremium: async () => ({ ok: true as const, value: false }) },
})

type TopplisteRequest = Parameters<typeof import('@/app/api/toppliste/route')['GET']>[0]
const { GET } = await import('@/app/api/toppliste/route')

type Svar = {
  entries?: { userId: string; rank: number }[]
  error?: string
}

async function hentToppliste(): Promise<{ status: number; body: Svar }> {
  const url =
    'https://quizkanonen.no/api/toppliste?period=month&scope=global' +
    `&period_start=${encodeURIComponent(PERIODE_START)}`
  const res = await GET(new Request(url) as unknown as TopplisteRequest)
  return { status: res.status, body: (await res.json()) as Svar }
}

beforeEach(() => {
  feil = 'ingen'
  rpcSvarer = false
  sisteRpcArgs = null
  db.quizzes = []
  db.attempts = []
  db.excluded_members = []
  db.profiles = [
    { id: ANNE,  display_name: 'Anne',  nickname: null, suspended_until: null },
    { id: BJORN, display_name: 'Bjørn', nickname: null, suspended_until: null },
  ]
  db.season_scores = [
    { user_id: ANNE,  points: 100, quiz_id: 'q1', closes_at: STENGT, scope_type: 'global', scope_id: null },
    { user_id: BJORN, points: 50,  quiz_id: 'q1', closes_at: STENGT, scope_type: 'global', scope_id: null },
  ]
})

// ── Treff: settet brukes faktisk ────────────────────────────────────────────

test('kontroll: uten ekskluderte står begge spillerne på lista', async () => {
  const { status, body } = await hentToppliste()

  assert.equal(status, 200)
  assert.deepEqual(body.entries?.map(e => e.userId), [ANNE, BJORN])
})

test('en ekskludert spiller er borte fra lista', async () => {
  db.excluded_members = [{ user_id: ANNE, scope_type: 'global', scope_id: null }]

  const { status, body } = await hentToppliste()

  assert.equal(status, 200)
  assert.deepEqual(body.entries?.map(e => e.userId), [BJORN],
    'ekskluderingen skal faktisk slå ut — ellers beviser feiltestene under ingenting')
  assert.equal(body.entries?.[0].rank, 1, 'plasseringene regnes på nytt uten den ekskluderte')
})

test('en suspendert spiller er borte fra lista', async () => {
  db.profiles = db.profiles.map(p =>
    p.id === ANNE ? { ...p, suspended_until: '2099-01-01T00:00:00.000Z' } : p
  )

  const { status, body } = await hentToppliste()

  assert.equal(status, 200)
  assert.deepEqual(body.entries?.map(e => e.userId), [BJORN])
})

// ── Null rader: normaltilfellet, og det som feller en for streng vakt ───────

test('null ekskluderte og null suspenderte gir en helt vanlig 200', async () => {
  db.excluded_members = []

  const { status, body } = await hentToppliste()

  assert.equal(status, 200, 'tomt sett er det NORMALE svaret og skal aldri bli 503')
  assert.equal(body.entries?.length, 2)
})

// ── Lesefeil: 503, ingen liste ──────────────────────────────────────────────

test('lesefeil på excluded_members gir 503 og INGEN liste', async () => {
  feil = 'excluded'
  // Anne ER ekskludert i basen — men det er nettopp det vi ikke får vite.
  db.excluded_members = [{ user_id: ANNE, scope_type: 'global', scope_id: null }]

  const { status, body } = await hentToppliste()

  assert.equal(status, 503)
  assert.equal(body.entries, undefined, 'en liste vi ikke vet er riktig skal ikke sendes')
  assert.equal(body.error, 'Kunne ikke hente topplisten akkurat nå. Prøv igjen om litt.')
})

test('lesefeil på suspenderings-oppslaget gir 503 og INGEN liste', async () => {
  feil = 'suspended'
  db.profiles = db.profiles.map(p =>
    p.id === ANNE ? { ...p, suspended_until: '2099-01-01T00:00:00.000Z' } : p
  )

  const { status, body } = await hentToppliste()

  assert.equal(status, 503)
  assert.equal(body.entries, undefined)
  assert.equal(body.error, 'Kunne ikke hente topplisten akkurat nå. Prøv igjen om litt.')
})

// ── RPC-stien bruker samme sett ─────────────────────────────────────────────

test('RPC-stien får de ekskluderte med i p_excluded_ids', async () => {
  rpcSvarer = true
  db.excluded_members = [{ user_id: ANNE, scope_type: 'global', scope_id: null }]

  const { status } = await hentToppliste()

  assert.equal(status, 200)
  assert.deepEqual(sisteRpcArgs?.p_excluded_ids, [ANNE],
    'settet mates til SQL-funksjonen — vakten dekker derfor begge stiene')
})

test('lesefeil stopper ruten FØR RPC-kallet i det hele tatt gjøres', async () => {
  rpcSvarer = true
  feil = 'excluded'

  const { status } = await hentToppliste()

  assert.equal(status, 503)
  assert.equal(sisteRpcArgs, null,
    'ingen spørring skal bygges på et sett vi vet er ufullstendig')
})

// ── MUTASJONER (kjørt 9. september 2026) ────────────────────────────────────
//
//   1. Fjern hele `if (excludedResult.error || suspendedResult.error)`-vakten
//      → begge lesefeil-testene ryker (200 med Anne på lista)
//   2. Behold vakten, men bare for `excludedResult.error`
//      → «lesefeil på suspenderings-oppslaget» ryker
//   3. Behold vakten, men bare for `suspendedResult.error`
//      → «lesefeil på excluded_members» ryker
//   4. Skift vakten til å skille på TOMHET (`excludedSet.size === 0`)
//      → «null ekskluderte … helt vanlig 200» ryker (503 på normaltilfellet)
//   5. Flytt vakten til ETTER rpc-kallet
//      → «lesefeil stopper ruten FØR RPC-kallet» ryker
