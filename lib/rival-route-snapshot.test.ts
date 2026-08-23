// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av /api/quiz/rival sin ferdig-definisjon (VINDU D,
// 13. august 2026): buildRankingSnapshot og buildSuggestions skal kun regne
// på LEVERTE forsøk (submitted_at IS NOT NULL) — samme definisjon som
// getOrBuildSnapshot i lib/ranking-snapshot.ts og findRival i samme fil.
//
// Bakgrunn: start-attempt oppretter attempts-raden med correct_answers=0 og
// submitted_at=null; submit skriver tallet først ved innsending. Uten
// filteret viste sidepanelet «I tet … 0 riktige» med navnet til en spiller
// som bare hadde STARTET — gjennom hele quizen for en spiller alene, og hver
// fredag kveld før første innlevering.
//
// MUTASJONSBEVIS — mocken håndhever filtrene den får, så:
//   • Fjernes .not('submitted_at','is',null) fra top11-spørringen, blir det
//     uferdige forsøket (9 riktige) leder og «uferdig forsøk kan ikke bli
//     leder» ryker.
//   • Fjernes filteret fra count-spørringen, teller totalPlayers det uferdige
//     forsøket og «tomt felt gir totalPlayers 0» ryker.
//   • Fjernes filteret fra buildSuggestions, dukker den uferdige spilleren
//     opp som duell-forslag og «suggestions inneholder kun leverte» ryker.
//
// UTVIDET 23. august 2026 (P-2): ruten krever nå innlogging, og de tre
// navnestedene (leder, rival, forslag) går gjennom den globale synlighets-
// gaten. Alle testene under kaller derfor autentisert.
//   • Fjernes 401-vakten, og «uten token …» ryker — det var den grenen som
//     serverte lederens navn til hvem som helst (målt mot prod 23. august).
//   • Fjernes blocked-filteret ett av de tre stedene, ryker nøyaktig den ene
//     av «blokkert …»-testene — de er med vilje skilt per sted.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type AttemptRow = {
  id: string
  quiz_id: string
  user_id: string | null
  is_team: boolean
  correct_answers: number
  total_time_ms: number
  submitted_at: string | null
}

type ProfileRow = { id: string; display_name: string | null; nickname: string | null }

const state: {
  attempts: AttemptRow[]
  profiles: ProfileRow[]
  user: { id: string } | null
  blocked: string[]
  blockedCalls: { quizId: string; ids: string[]; awarded: boolean }[]
} = { attempts: [], profiles: [], user: null, blocked: [], blockedCalls: [] }

// Filter-håndhevende attempts-builder: spørringen får nøyaktig de radene
// filtrene den selv oppga tillater. Dermed beviser testene at filteret står i
// ruten — ikke bare at mocken returnerer det testen ønsker seg.
function attemptsBuilder() {
  let rows = [...state.attempts]
  let countMode = false
  const b = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.count === 'exact') countMode = true
      return b
    },
    eq(col: keyof AttemptRow, val: unknown) { rows = rows.filter(r => r[col] === val); return b },
    neq(col: keyof AttemptRow, val: unknown) { rows = rows.filter(r => r[col] !== val); return b },
    gt(col: keyof AttemptRow, val: number) { rows = rows.filter(r => (r[col] as number) > val); return b },
    not(col: keyof AttemptRow, op: string, val: unknown) {
      if (op === 'is' && val === null) rows = rows.filter(r => r[col] !== null)
      return b
    },
    order(col: keyof AttemptRow, opts?: { ascending?: boolean }) {
      const asc = opts?.ascending !== false
      rows = [...rows].sort((a, x) => {
        const av = a[col], xv = x[col]
        // `id` er tekst (stabil siste-tiebreak i buildRankingSnapshot); resten
        // er tall. Uten tekst-grenen ville id-sorteringen gitt NaN og en
        // vilkårlig rekkefølge, altså en test som er grønn av flaks.
        if (typeof av === 'string' || typeof xv === 'string') {
          const c = String(av).localeCompare(String(xv))
          return asc ? c : -c
        }
        return asc ? (av as number) - (xv as number) : (xv as number) - (av as number)
      })
      return b
    },
    limit(n: number) { rows = rows.slice(0, n); return b },
    // fetchAllRows pagineres med .range() — buildRankingSnapshot henter hele
    // det ordnede feltet fordi filtreringen må skje FØR avkortingen.
    range(from: number, to: number) { rows = rows.slice(from, to + 1); return b },
    then(resolve: (r: { data: AttemptRow[] | null; count: number | null }) => unknown) {
      return Promise.resolve(
        countMode ? { data: null, count: rows.length } : { data: rows, count: null }
      ).then(resolve)
    },
  }
  return b
}

function profilesBuilder() {
  let rows = [...state.profiles]
  const b = {
    select() { return b },
    eq(_col: string, val: string) { rows = rows.filter(r => r.id === val); return b },
    in(_col: string, vals: string[]) { rows = rows.filter(r => vals.includes(r.id)); return b },
    async maybeSingle() { return { data: rows[0] ?? null } },
    then(resolve: (r: { data: ProfileRow[] }) => unknown) {
      return Promise.resolve({ data: rows }).then(resolve)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'attempts') return attemptsBuilder() as never
        if (table === 'profiles') return profilesBuilder() as never
        // season_points_awarded styrer om blokkert-gaten leses historisk eller
        // live. Under spilling — når denne ruten faktisk kalles — er den false.
        if (table === 'quizzes') {
          const q = {
            select() { return q },
            eq() { return q },
            async maybeSingle() { return { data: { season_points_awarded: false } } },
          }
          return q as never
        }
        throw new Error(`uventet tabell i test: ${table}`)
      },
      auth: {
        getUser: async () =>
          state.user
            ? { data: { user: state.user }, error: null }
            : { data: { user: null }, error: { message: 'ugyldig token' } },
      },
    },
  },
})

mock.module('@/lib/globally-blocked-set', {
  namedExports: {
    getGloballyBlockedSet: async (quizId: string, ids: string[], awarded: boolean) => {
      state.blockedCalls.push({ quizId, ids: [...ids], awarded })
      return new Set(state.blocked)
    },
  },
})

const { GET } = await import('@/app/api/quiz/rival/route')

function call(auth = false) {
  const headers = auth ? { Authorization: 'Bearer test-token' } : undefined
  const request = new Request('https://quizkanonen.no/api/quiz/rival?quizId=q-1', { headers })
  return GET(request as never)
}

let nextId = 0
function attempt(over: Partial<AttemptRow>): AttemptRow {
  return {
    id: `a-${String(++nextId).padStart(3, '0')}`,
    quiz_id: 'q-1', user_id: null, is_team: false,
    correct_answers: 0, total_time_ms: 0, submitted_at: null,
    ...over,
  }
}

beforeEach(() => {
  state.attempts = []; state.profiles = []; state.user = null
  state.blocked = []; state.blockedCalls = []
  nextId = 0
})

test('tomt felt (kun startede forsøk) gir totalPlayers 0 — leder-blokken kan skjules', async () => {
  // Ett forsøk som bare er STARTET. correct_answers=7 er syntetisk (reelle
  // uferdige rader står i 0), valgt slik at et manglende filter gir et tall
  // som umulig kan forveksles med tomt felt.
  state.user = { id: 'u-self' }
  state.attempts = [attempt({ user_id: 'u-uferdig', correct_answers: 7, total_time_ms: 60_000 })]

  const res = await call(true)
  const json = await res.json() as { rankingSnapshot: { totalPlayers: number; leaderCorrect: number } }

  assert.equal(json.rankingSnapshot.totalPlayers, 0, 'tomt felt gir totalPlayers 0')
  assert.equal(json.rankingSnapshot.leaderCorrect, 0, 'ingen leder-tall fra et uferdig forsøk')
})

test('uferdig forsøk kan ikke bli leder — leverte vinner uansett tall', async () => {
  state.attempts = [
    attempt({ user_id: 'u-ferdig', correct_answers: 5, total_time_ms: 90_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-uferdig', correct_answers: 9, total_time_ms: 10_000 }),
  ]
  state.profiles = [{ id: 'u-ferdig', display_name: 'Kari', nickname: null }]
  state.user = { id: 'u-self' }

  const res = await call(true)
  const json = await res.json() as {
    rankingSnapshot: { totalPlayers: number; leaderName: string; leaderCorrect: number }
  }

  assert.equal(json.rankingSnapshot.leaderCorrect, 5, 'lederen er beste LEVERTE forsøk')
  assert.equal(json.rankingSnapshot.leaderName, 'Kari')
  assert.equal(json.rankingSnapshot.totalPlayers, 1, 'kun leverte telles')
})

test('suggestions inneholder kun leverte — en som bare har startet foreslås ikke', async () => {
  state.user = { id: 'u-self' }
  state.attempts = [
    attempt({ user_id: 'u-ferdig', correct_answers: 8, total_time_ms: 80_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-uferdig', correct_answers: 3, total_time_ms: 30_000 }),
  ]
  state.profiles = [
    { id: 'u-ferdig', display_name: 'Kari', nickname: null },
    { id: 'u-uferdig', display_name: 'Starta Bare', nickname: null },
  ]

  const res = await call(true)
  const json = await res.json() as { suggestions?: { userId: string }[] }

  const ids = (json.suggestions ?? []).map(s => s.userId)
  assert.ok(!ids.includes('u-uferdig'), 'uferdig spiller skal ikke foreslås')
  assert.ok(ids.includes('u-ferdig'), 'levert spiller kan foreslås')
})

// ═══════════════════════════════════════════════════════════════════════════
// P-2 (23. august 2026): innlogging kreves, og de tre navnestedene er gatet
// ═══════════════════════════════════════════════════════════════════════════

// ── Den anonyme veien, som var åpen og som SVARTE ──────────────────────────

test('uten token: 401 — lederens navn forlater ikke ruten', async () => {
  state.attempts = [
    attempt({ user_id: 'u-topp', correct_answers: 15, total_time_ms: 60_000, submitted_at: '2026-08-13T18:00:00Z' }),
  ]
  state.profiles = [{ id: 'u-topp', display_name: 'Jørgen', nickname: null }]

  const res = await call()
  assert.equal(res.status, 401)
  const json = await res.json()
  assert.equal(json.needsLogin, true)
  // Ikke bare «feil status»: selve nyttelasten skal være borte. Fram til nå
  // svarte denne grenen 200 med rankingSnapshot, og et curl mot prod ga
  // leaderName + leaderCorrect + top10MinCorrect uten noen form for auth.
  assert.equal(json.rankingSnapshot, undefined)
  assert.ok(!JSON.stringify(json).includes('Jørgen'))
})

test('ugyldig token: 401, samme som uten token', async () => {
  state.user = null // getUser-mocken svarer med feil når user er null
  state.attempts = [
    attempt({ user_id: 'u-topp', correct_answers: 15, total_time_ms: 60_000, submitted_at: '2026-08-13T18:00:00Z' }),
  ]
  const res = await call(true)
  assert.equal(res.status, 401)
  assert.equal((await res.json()).rankingSnapshot, undefined)
})

// ── Blokkert-gaten, ett sted av gangen ─────────────────────────────────────

test('positiv kontroll: uten blokkerte er lederen den beste, og gaten ble spurt riktig', async () => {
  state.user = { id: 'u-self' }
  state.attempts = [
    attempt({ user_id: 'u-topp', correct_answers: 15, total_time_ms: 60_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-self', correct_answers: 5, total_time_ms: 90_000, submitted_at: '2026-08-13T18:00:00Z' }),
  ]
  state.profiles = [
    { id: 'u-topp', display_name: 'Jørgen', nickname: null },
    { id: 'u-self', display_name: 'Meg', nickname: null },
  ]

  const json = await (await call(true)).json()
  assert.equal(json.rankingSnapshot.leaderName, 'Jørgen')
  assert.equal(json.rankingSnapshot.leaderCorrect, 15)
  assert.equal(json.rankingSnapshot.totalPlayers, 2)
  // Gaten er koblet på — ikke bare tom. Ett oppslag per forespørsel, delt av
  // alle tre byggerne (se kommentaren i ruten).
  assert.equal(state.blockedCalls.length, 1, 'ett gate-oppslag per forespørsel, ikke ett per bygger')
  assert.equal(state.blockedCalls[0].quizId, 'q-1')
  assert.deepEqual([...state.blockedCalls[0].ids].sort(), ['u-self', 'u-topp'])
  assert.equal(state.blockedCalls[0].awarded, false)
})

test('blokkert spiller kan ikke være LEDER — og telles ikke i totalPlayers', async () => {
  state.user = { id: 'u-self' }
  state.blocked = ['u-topp']
  state.attempts = [
    attempt({ user_id: 'u-topp', correct_answers: 15, total_time_ms: 60_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-self', correct_answers: 5, total_time_ms: 90_000, submitted_at: '2026-08-13T18:00:00Z' }),
  ]
  state.profiles = [
    { id: 'u-topp', display_name: 'Jørgen', nickname: null },
    { id: 'u-self', display_name: 'Meg', nickname: null },
  ]

  const json = await (await call(true)).json()
  assert.notEqual(json.rankingSnapshot.leaderName, 'Jørgen', 'en blokkert spiller skal ikke vises som «I tet»')
  assert.equal(json.rankingSnapshot.leaderCorrect, 5, 'lederen er beste SYNLIGE spiller')
  assert.equal(json.rankingSnapshot.totalPlayers, 1, 'blokkerte telles ikke med i feltet')
  assert.ok(!JSON.stringify(json).includes('Jørgen'))
})

test('blokkert spiller foreslås ikke som DUELL-motstander', async () => {
  state.user = { id: 'u-self' }
  state.blocked = ['u-blokkert']
  state.attempts = [
    attempt({ user_id: 'u-blokkert', correct_answers: 8, total_time_ms: 80_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-apen', correct_answers: 7, total_time_ms: 85_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-self', correct_answers: 5, total_time_ms: 90_000, submitted_at: '2026-08-13T18:00:00Z' }),
  ]
  state.profiles = [
    { id: 'u-blokkert', display_name: 'Skjult Person', nickname: null },
    { id: 'u-apen', display_name: 'Åpen Person', nickname: null },
    { id: 'u-self', display_name: 'Meg', nickname: null },
  ]

  const json = await (await call(true)).json()
  const ids = (json.suggestions ?? []).map((x: { userId: string }) => x.userId)
  assert.ok(!ids.includes('u-blokkert'), 'forslaget er en navnepille — nettopp det gaten finnes for')
  assert.ok(ids.includes('u-apen'), 'positiv kontroll: den åpne spilleren foreslås fortsatt')
})

test('blokkert spiller velges ikke som RIVAL — naboen hoppes over, ikke feltet', async () => {
  // Rangert: u-topp (10) · u-mellom (8, BLOKKERT) · u-self (5).
  // Uten gaten er rivalen u-mellom (raden rett over). Med gaten faller
  // u-mellom ut FØR posisjonene regnes, og rivalen blir u-topp.
  state.user = { id: 'u-self' }
  state.blocked = ['u-mellom']
  state.attempts = [
    attempt({ user_id: 'u-topp', correct_answers: 10, total_time_ms: 60_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-mellom', correct_answers: 8, total_time_ms: 70_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-self', correct_answers: 5, total_time_ms: 90_000, submitted_at: '2026-08-13T18:00:00Z' }),
  ]
  state.profiles = [
    { id: 'u-topp', display_name: 'Toppen', nickname: null },
    { id: 'u-mellom', display_name: 'Mellom Person', nickname: null },
    { id: 'u-self', display_name: 'Meg', nickname: null },
  ]

  const json = await (await call(true)).json()
  assert.equal(json.rival?.name, 'Toppen')
  assert.ok(!JSON.stringify(json).includes('Mellom Person'))
})

test('en blokkert KALLER finner fortsatt sin egen posisjon i lista', async () => {
  // Kalleren beholdes bevisst i rangeringen selv om hen er blokkert: findRival
  // slår opp brukerens EGEN indeks for å finne naboen over. Filtreres kalleren
  // bort, faller hen til median-grenen og får en tilfeldig rival i stedet for
  // den rett over seg. «Egne tall skjules aldri for en selv» — samme prinsipp
  // som /standings sin callerBlocked-fallback.
  state.user = { id: 'u-self' }
  state.blocked = ['u-self']
  state.attempts = [
    attempt({ user_id: 'u-topp', correct_answers: 10, total_time_ms: 60_000, submitted_at: '2026-08-13T18:00:00Z' }),
    attempt({ user_id: 'u-self', correct_answers: 5, total_time_ms: 90_000, submitted_at: '2026-08-13T18:00:00Z' }),
  ]
  state.profiles = [
    { id: 'u-topp', display_name: 'Toppen', nickname: null },
    { id: 'u-self', display_name: 'Meg', nickname: null },
  ]

  const json = await (await call(true)).json()
  assert.equal(json.rival?.name, 'Toppen', 'rivalen er den rett over — ikke en median-gjetning')
})
