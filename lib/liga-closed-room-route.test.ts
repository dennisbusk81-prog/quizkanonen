// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// LIGA ER ET LUKKET ROM (23. august 2026). Kjører den EKTE GET /api/toppliste
// for scope=league med et GRATIS medlem, og feller de to symptomene som ble
// MÅLT før fiksen:
//
//   1. Ett svar bar to sannheter om samme person: `entries` inneholdt
//      kallerens egen rad med EKSAKT rank (3), mens `userEntry.rank` for
//      samme bruker var grovmalt til 10-båndets start (1).
//   2. Et gratis ligamedlem utenfor topp 10 fikk `shouldShowPlacementRow`
//      false, og dermed paywall-kortet «Du er utenfor topp 10. Med Premium
//      ser du din nøyaktige plassering» — inne i et lukket rom, rett under en
//      liste som viste alle ANDRES eksakte plassering.
//
// Rutens egen kommentar påsto at gaten «endrer ingenting synlig for
// liga-medlemmer». Målingen motbeviste den; disse testene holder den nede.
//
// MUTASJONSBEVIS (kjørt 23. august 2026, målt — ikke antatt), talt over denne
// filen + lib/season-period-table.test.ts + lib/toppliste-premium-gate-route.test.ts:
//   • isClosedRoom → `scope === 'organization'` (altså tilbake til feilen)
//     → 5 tester ryker.
//   • isClosedRoom → alltid true (global blir også «lukket rom»)
//     → 13 tester ryker (global-regresjonsvaktene her + trappe-testene).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ME = '11111111-1111-4111-8111-111111111111'
const LIGA = '44444444-4444-4444-8444-444444444444'

type RankedRow = {
  user_id: string; display_name: string | null
  points: number; quiz_count: number; rank: number; total_count: number
}

const state: {
  premium: boolean
  medlem: boolean
  rpcRanked: RankedRow[]
  rpcUserStats: { points: number; quiz_count: number; rank: number }[]
} = { premium: false, medlem: true, rpcRanked: [], rpcUserStats: [] }

function builder(table: string) {
  let selectCols = ''
  const b: Record<string, unknown> = {
    select(c: string) { selectCols = c; return b },
    eq() { return b }, is() { return b }, in() { return b }, not() { return b },
    gt() { return b }, gte() { return b }, lt() { return b },
    order() { return b }, limit() { return b }, range() { return b },
    maybeSingle() {
      // Scope-gatens medlemskapssjekk — samme svar for liga og org.
      if (table === 'league_members' || table === 'organization_members') {
        return Promise.resolve({ data: state.medlem ? { user_id: ME } : null, error: null })
      }
      if (table === 'profiles' && selectCols.includes('premium_status')) {
        return Promise.resolve({
          data: { premium_status: state.premium, org_premium_grace_until: null, personal_grace_until: null },
          error: null,
        })
      }
      if (table === 'profiles') {
        return Promise.resolve({ data: { display_name: 'Meg Megsen', nickname: null }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then(resolve: (v: unknown) => void) { return resolve({ data: [], error: null }) },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
      from: (t: string) => builder(t),
      rpc: (fn: string) => {
        if (fn === 'season_leaderboard_ranked') return Promise.resolve({ data: state.rpcRanked, error: null })
        if (fn === 'season_leaderboard_user_stats') return Promise.resolve({ data: state.rpcUserStats, error: null })
        return Promise.resolve({ data: [], error: null })
      },
    },
  },
})

const { GET } = await import('@/app/api/toppliste/route')
const { shouldShowPlacementRow } = await import('@/lib/season-period-table')
const { isClosedRoom } = await import('@/lib/leaderboard-scope')

/** Rom med `antall` medlemmer der ME ligger på plass `minPlass`. */
function rom(antall: number, minPlass: number) {
  state.rpcRanked = Array.from({ length: Math.min(antall, 10) }, (_, i) => ({
    user_id: i + 1 === minPlass ? ME : `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`,
    display_name: `Spiller ${i + 1}`, points: 100 - i, quiz_count: 4,
    rank: i + 1, total_count: antall,
  }))
  state.rpcUserStats = [{ points: 100 - (minPlass - 1), quiz_count: 4, rank: minPlass }]
}

type Svar = {
  entries: { rank: number; userId: string }[]
  userEntry: { rank: number } | null
  userRank: number | null
  userIsPremium: boolean
  totalCount: number
  page: number
}

async function hent(scope: 'league' | 'organization' | 'global', ekstra = ''): Promise<Svar> {
  const scopeQS = scope === 'global' ? '' : `&scope_id=${LIGA}`
  const req = new Request(
    `https://quizkanonen.no/api/toppliste?period=month&scope=${scope}${scopeQS}${ekstra}`,
    { headers: { authorization: 'Bearer tok' } },
  )
  return await (await GET(req as never)).json() as Svar
}

beforeEach(() => { state.premium = false; state.medlem = true })

// ── SYMPTOM 1: ett svar, to sannheter om samme person ────────────────────────

test('LIGA: userEntry.rank er IDENTISK med kallerens egen rad i entries', async () => {
  rom(5, 3)
  const s = await hent('league')

  const minRadIListen = s.entries.find(e => e.userId === ME)
  assert.equal(minRadIListen?.rank, 3, 'forutsetning: listen viser meg som nr. 3')
  assert.equal(s.userEntry?.rank, 3, 'samme svar skal ikke også påstå at jeg er nr. 1')
  assert.equal(s.userEntry?.rank, minRadIListen?.rank, 'ett svar, én sannhet')
})

test('LIGA: userRank leveres eksakt (var utelatt helt)', async () => {
  rom(14, 12)
  const s = await hent('league')

  assert.equal(s.userIsPremium, false, 'forutsetning: kalleren er GRATIS')
  assert.equal(s.userRank, 12)
  assert.equal(s.userEntry?.rank, 12, 'ikke 11 — banding hører ikke hjemme i et lukket rom')
})

// ── SYMPTOM 2: paywall-kortet inne i et lukket rom ───────────────────────────

test('LIGA: gratis medlem utenfor topp 10 får plasseringsRADEN, ikke paywall-kortet', async () => {
  rom(14, 12)
  const s = await hent('league')

  // shouldShowPlacementRow true ⇒ raden tegnes. Er den false, faller
  // renderUserSection til «Med Premium ser du din nøyaktige plassering».
  assert.equal(shouldShowPlacementRow({
    userVisible: s.entries.some(e => e.userId === ME),
    userEntryRank: s.userEntry?.rank ?? null,
    isPremium: s.userIsPremium,
    scope: 'league',
    userBlockedFromGlobal: false,
  }), true)
})

test('LIGA: bla og søk virker for et gratis medlem (S2-unntaket gjelder lukkede rom)', async () => {
  rom(14, 12)
  const s = await hent('league', '&page=2')

  assert.equal(s.page, 2, '?page= skal ikke nulles ut i et lukket rom')
})

// ── ORG uendret — den fungerte allerede ──────────────────────────────────────

test('ORG: uendret oppførsel (eksakt rank for gratis medlem)', async () => {
  rom(14, 12)
  const s = await hent('organization')

  assert.equal(s.userRank, 12)
  assert.equal(s.userEntry?.rank, 12)
})

// ── GLOBAL uendret — regresjonsvakt mot en for bred isClosedRoom ─────────────

test('GLOBAL: gratis bruker får FORTSATT bandet rank og ingen userRank', async () => {
  rom(14, 12)
  const s = await hent('global')

  assert.equal(s.userEntry?.rank, 11, '10-båndets start — den åpne konkurransen er uendret')
  assert.equal(s.userRank, null)
})

test('GLOBAL: ?page= ignoreres fortsatt for gratis', async () => {
  rom(14, 12)
  const s = await hent('global', '&page=2')

  assert.equal(s.page, 1)
})

// ── Selve begrepet ───────────────────────────────────────────────────────────

test('isClosedRoom: liga og org er lukkede rom, global er ikke', () => {
  assert.equal(isClosedRoom('league'), true)
  assert.equal(isClosedRoom('organization'), true)
  assert.equal(isClosedRoom('global'), false)
})

// ── Ingen gjenglemte søsken ──────────────────────────────────────────────────
// Feilen var at privilegie-skillet lå spredt som `scope === 'organization'` på
// fem steder og liga var glemt på alle fem. Denne vakten feller en sjette.
//
// Merk at filene LEGITIMT inneholder `scope === 'organization'` andre steder —
// scope-gaten (hvem slipper inn), tekstvalg («i bedriften») og lenkebygging.
// Vakten er derfor snever: den forbyr kun de tre PRIVILEGIE-formene, og leser
// bare aktive linjer, siden en regex ellers ville passert utkommentert kode.
test('VAKT: ingen privilegie-sjekk bruker org alene i stedet for isClosedRoom', () => {
  const forbudt: [string, RegExp][] = [
    ['isPremium || scope === \'organization\'', /isPremium\s*\|\|\s*scope\s*===\s*'organization'/],
    ['!isPremium && scope !== \'organization\'', /!\s*isPremium\s*&&\s*scope\s*!==\s*'organization'/],
    ['!data.userIsPremium && scope !== \'organization\'', /!\s*data\.userIsPremium\s*&&\s*scope\s*!==\s*'organization'/],
    ['state.isPremium || state.scope === \'organization\'', /state\.isPremium\s*\|\|\s*state\.scope\s*===\s*'organization'/],
  ]
  for (const fil of ['components/SeasonLeaderboard.tsx', 'lib/season-period-table.ts', 'app/api/toppliste/route.ts']) {
    const aktiveLinjer = readFileSync(fil, 'utf8')
      .split('\n')
      .filter(l => {
        const t = l.trim()
        return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
      })
      .join('\n')
    for (const [navn, re] of forbudt) {
      assert.equal(re.test(aktiveLinjer), false, `${fil} har fortsatt «${navn}» — bruk isClosedRoom()`)
    }
  }
})
