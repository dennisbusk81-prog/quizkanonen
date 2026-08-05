// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Vokter funn F2 (5. august 2026): lib/globally-blocked-set avgjør hvem som
// IKKE skal vises på de offentlige resultatflatene. Settet er løftet vi har
// gitt bedriftskundene om at resultatene deres kan holdes interne — en
// under-blokkering her publiserer navnene deres på den åpne topplisten, og det
// kan ikke angres etter at siden er sett.
//
// TRE FEILKLASSER TESTES, alle av samme type (STILLE under-blokkering):
//   1. DB-feil ga et TOMT sett, som ble lest som «ingen er blokkert».
//   2. Live-grenen gjorde `.in('user_id', alle-som-har-levert)`. Over ~390
//      id-er sprenger URL-en (lib/paginate.ts), feilen ble ikke sjekket, og
//      settet ble tomt. Vanlig vekst utløste altså feilklasse 1.
//   3. Cachen lagret et sett utledet av kallerens liste, men var nøklet på
//      quiz-id alene. Spurte /standings først (kun de som har LEVERT), fikk
//      /leaderboard (alle med et forsøk) et sett som manglet blokkeringer for
//      de ekstra brukerne.
//
// MUTASJONSBEVIS
//   • Bytt `return new Set(attemptUserIds)` i catch-blokken til
//     `return new Set()` (den gamle fail-open-formen), og alle fire
//     FAIL-SAFE-testene ryker.
//   • Bytt live-grenen tilbake til `.in('user_id', attemptUserIds)`, og
//     «live-grenen sender ALDRI spillerlista …» ryker.
//   • Cach det ferdige settet i stedet for faktagrunnlaget, og «cachen
//     under-blokkerer ikke en kaller med LENGRE liste» ryker.
//   • Fjern `.order()/.range()`-pagineringen (bruk ett enkelt select), og
//     «henter ALLE rader over 1000-taket» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type Query = { table: string; filters: Array<{ op: string; col: string; val: unknown }> }

const db: {
  seasonScores: { user_id: string }[]
  organizations: { id: string; allow_global_league: boolean | null }[]
  members: { user_id: string; organization_id: string; global_league_opt_out: boolean | null }[]
  failOn: Set<string>
  queries: Query[]
} = {
  seasonScores: [],
  organizations: [],
  members: [],
  failOn: new Set(),
  queries: [],
}

// Minimal PostgREST-etterligning MED ekte range()-oppførsel, slik at
// pagineringen i fetchAllRows faktisk blir utøvd og ikke bare kalt.
function builder(table: string) {
  const q: Query = { table, filters: [] }
  db.queries.push(q)
  let from = 0
  let to = 999

  const rows = (): Record<string, unknown>[] => {
    const source: Record<string, unknown>[] =
      table === 'season_scores' ? db.seasonScores
      : table === 'organizations' ? db.organizations
      : table === 'organization_members' ? db.members
      : []
    let out = source
    for (const f of q.filters) {
      // Filtre på kolonner fixturen ikke bærer (quiz_id, scope_type, scope_id)
      // er no-ops — fixturen ER allerede «radene for denne quizen». At
      // spørringen har riktig FORM sikres i stedet av «live-grenen sender
      // ALDRI spillerlista …», som inspiserer q.filters direkte.
      if (!source.some(r => f.col in r)) continue
      if (f.op === 'eq') out = out.filter(r => r[f.col] === f.val)
      if (f.op === 'is') out = out.filter(r => r[f.col] == null)
      if (f.op === 'in') out = out.filter(r => (f.val as unknown[]).includes(r[f.col]))
    }
    return out
  }

  const b: Record<string, unknown> = {
    select() { return b },
    eq(col: string, val: unknown) { q.filters.push({ op: 'eq', col, val }); return b },
    is(col: string, val: unknown) { q.filters.push({ op: 'is', col, val }); return b },
    in(col: string, val: unknown[]) { q.filters.push({ op: 'in', col, val: [...val] }); return b },
    order() { return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(resolve: (v: unknown) => void) {
      if (db.failOn.has(table)) {
        return resolve({ data: null, error: { message: `simulert feil mot ${table}` } })
      }
      return resolve({ data: rows().slice(from, to + 1), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (table: string) => builder(table) } },
})

const { getGloballyBlockedSet } = await import('@/lib/globally-blocked-set')

// Cachen er modul-privat og lever i 30s. Hver test bruker sin EGEN quiz-id, så
// ingen test arver en annen sin cache-rad.
let n = 0
const nyQuiz = () => `quiz-${++n}`

beforeEach(() => {
  db.seasonScores = []
  db.organizations = []
  db.members = []
  db.failOn = new Set()
  db.queries = []
})

// ── Positive kontroller FØRST: gaten gjør noe i det hele tatt ────────────────

test('positiv kontroll (gjort opp): den som mangler global-rad er blokkert', async () => {
  db.seasonScores = [{ user_id: 'u1' }, { user_id: 'u3' }]

  const blocked = await getGloballyBlockedSet(nyQuiz(), ['u1', 'u2', 'u3'], true)

  assert.deepEqual([...blocked], ['u2'])
})

test('positiv kontroll (live): org-restriksjon og eget opt-out blokkerer begge', async () => {
  db.organizations = [{ id: 'org-lukket', allow_global_league: false }]
  db.members = [
    { user_id: 'u1', organization_id: 'org-lukket', global_league_opt_out: false },
    { user_id: 'u2', organization_id: 'org-apen', global_league_opt_out: true },
    { user_id: 'u3', organization_id: 'org-apen', global_league_opt_out: false },
  ]

  const blocked = await getGloballyBlockedSet(nyQuiz(), ['u1', 'u2', 'u3', 'u4'], false)

  assert.ok(blocked.has('u1'), 'medlem av org med allow_global_league=false')
  assert.ok(blocked.has('u2'), 'eget global_league_opt_out')
  assert.ok(!blocked.has('u3'), 'vanlig org-medlem uten opt-out')
  assert.ok(!blocked.has('u4'), 'ikke medlem noe sted')
})

test('NULL i allow_global_league regnes som TILLATT, ikke som blokkert', async () => {
  // Samme tolkning som /api/org/my-orgs (`allow_global_league !== false`).
  // Kun et eksplisitt false blokkerer — spørringen er .eq(..., false).
  db.organizations = [{ id: 'org-null', allow_global_league: null }]
  db.members = [{ user_id: 'u1', organization_id: 'org-null', global_league_opt_out: null }]

  const blocked = await getGloballyBlockedSet(nyQuiz(), ['u1'], false)

  assert.equal(blocked.size, 0)
})

// ── FEILKLASSE 1: fail-safe STENGT, ikke åpent ──────────────────────────────

test('FAIL-SAFE (gjort opp): en DB-feil skjuler ALLE — den gir ALDRI et tomt sett', async () => {
  db.seasonScores = [{ user_id: 'u1' }]
  db.failOn = new Set(['season_scores'])

  const blocked = await getGloballyBlockedSet(nyQuiz(), ['u1', 'u2', 'u3'], true)

  assert.equal(blocked.size, 3, 'et feilet oppslag skal skjule alle, ikke publisere alle')
  for (const u of ['u1', 'u2', 'u3']) assert.ok(blocked.has(u))
})

test('FAIL-SAFE (live): feil mot organizations skjuler ALLE', async () => {
  db.failOn = new Set(['organizations'])

  const blocked = await getGloballyBlockedSet(nyQuiz(), ['u1', 'u2'], false)

  assert.equal(blocked.size, 2)
})

test('FAIL-SAFE (live): feil mot organization_members skjuler ALLE', async () => {
  // Organisasjons-oppslaget lykkes, medlems-oppslaget feiler. Delvis suksess
  // er fortsatt ikke nok til å avgjøre hvem som er blokkert.
  db.organizations = [{ id: 'org-lukket', allow_global_league: false }]
  db.failOn = new Set(['organization_members'])

  const blocked = await getGloballyBlockedSet(nyQuiz(), ['u1', 'u2'], false)

  assert.equal(blocked.size, 2)
})

test('FAIL-SAFE caches ALDRI — neste kall får et ekte forsøk', async () => {
  const quiz = nyQuiz()
  db.seasonScores = [{ user_id: 'u1' }, { user_id: 'u2' }]
  db.failOn = new Set(['season_scores'])

  const forste = await getGloballyBlockedSet(quiz, ['u1', 'u2'], true)
  assert.equal(forste.size, 2, 'første kall feiler → alle skjult')

  db.failOn = new Set()
  const andre = await getGloballyBlockedSet(quiz, ['u1', 'u2'], true)
  assert.equal(andre.size, 0, 'et feilsvar skal ikke bli liggende i cachen i 30 sekunder')
})

// ── FEILKLASSE 2: .in()-taket på ~390 id-er ─────────────────────────────────

test('live-grenen sender ALDRI spillerlista inn i en spørring', async () => {
  // Selve fiksen: spørringen er snudd til å gå per ORGANISASJON. Antall
  // spillere kan da ikke påvirke URL-lengden, uansett hvor mange som spiller.
  db.organizations = [{ id: 'org-lukket', allow_global_league: false }]
  db.members = [{ user_id: 'u-5', organization_id: 'org-lukket', global_league_opt_out: false }]

  const femHundre = Array.from({ length: 500 }, (_, i) => `u-${i}`)
  const blocked = await getGloballyBlockedSet(nyQuiz(), femHundre, false)

  assert.ok(blocked.has('u-5'), 'gaten virker fortsatt ved 500 spillere')

  for (const q of db.queries) {
    for (const f of q.filters) {
      assert.notEqual(
        f.col, 'user_id',
        `spørring mot ${q.table} filtrerte på user_id — da er ~390-taket tilbake`,
      )
      if (f.op === 'in') {
        assert.ok(
          (f.val as unknown[]).length < 390,
          `.in() mot ${q.table}.${f.col} hadde ${(f.val as unknown[]).length} verdier`,
        )
      }
    }
  }
})

test('1000+ spillere gir korrekt svar — pagineringen henter alt', async () => {
  // PostgREST kutter stille ved 1000 rader. Uten fetchAllRows ville spiller
  // 1001 og utover manglet i fasiten og blitt feilaktig blokkert.
  const alle = Array.from({ length: 1500 }, (_, i) => `u-${i}`)
  db.seasonScores = alle.map(user_id => ({ user_id }))

  const blocked = await getGloballyBlockedSet(nyQuiz(), alle, true)

  assert.equal(blocked.size, 0, 'alle 1500 fikk global-rad → ingen skal skjules')
})

test('1000+ org-medlemmer blokkeres alle — pagineringen gjelder også live-grenen', async () => {
  db.organizations = [{ id: 'org-lukket', allow_global_league: false }]
  db.members = Array.from({ length: 1200 }, (_, i) => ({
    user_id: `u-${i}`, organization_id: 'org-lukket', global_league_opt_out: false,
  }))

  const spillere = Array.from({ length: 1200 }, (_, i) => `u-${i}`)
  const blocked = await getGloballyBlockedSet(nyQuiz(), spillere, false)

  assert.equal(blocked.size, 1200)
})

// ── FEILKLASSE 3: cachen lagrer fakta, ikke et ferdig sett ──────────────────

test('cachen under-blokkerer ikke en kaller med LENGRE liste enn den som fylte den', async () => {
  // /standings spør med kun de som har LEVERT; /leaderboard med alle som har
  // et forsøk. Vinner den korteste lista cachen, må den lengste likevel få
  // riktig svar for sine ekstra brukere.
  const quiz = nyQuiz()
  db.seasonScores = [{ user_id: 'u1' }]

  const kort = await getGloballyBlockedSet(quiz, ['u1'], true)
  assert.equal(kort.size, 0, 'u1 fikk global-rad → ikke blokkert')

  // Samme quiz, innenfor TTL — treffer cachen.
  const lang = await getGloballyBlockedSet(quiz, ['u1', 'u2', 'u3'], true)
  assert.deepEqual([...lang].sort(), ['u2', 'u3'], 'u2/u3 mangler global-rad og MÅ skjules')
})

test('cachen brukes faktisk — det andre kallet gjør ingen nye spørringer', async () => {
  // Positiv kontroll for testen over: uten denne kunne «riktig svar» skyldes
  // at cachen aldri traff, og da ville feilklasse 3 vært utestet.
  const quiz = nyQuiz()
  db.seasonScores = [{ user_id: 'u1' }]

  await getGloballyBlockedSet(quiz, ['u1'], true)
  const etterForste = db.queries.length
  await getGloballyBlockedSet(quiz, ['u1', 'u2'], true)

  assert.equal(db.queries.length, etterForste, 'andre kall skal serveres fra cachen')
})

// ── Grensetilfelle ──────────────────────────────────────────────────────────

test('tom spillerliste gir tomt sett uten et eneste oppslag', async () => {
  const blocked = await getGloballyBlockedSet(nyQuiz(), [], false)

  assert.equal(blocked.size, 0)
  assert.equal(db.queries.length, 0, 'ingen å svare om → ingen grunn til å spørre DB')
})
