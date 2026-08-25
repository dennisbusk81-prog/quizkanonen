// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av POPULASJONEN i de org-/liga-flatene som leste quizzes og
// attempts uten å skille ekte quizer fra kunstige. Søskenrunden etter f4d4a07,
// som lukket de fire første leserne (lib/real-quiz-population.test.ts).
//
//   1. /api/org/[slug]/my-placement       — «Din plassering», nyeste-10-vinduet
//   2. /api/org/[slug]/dashboard          — bedriftens «Siste quiz»
//   3. /api/org/[slug]/quiz-scores        — «Siste quiz»-tabellen OG ukestreaken
//   4. /api/org/[slug]/members-activity   — AKTIV-merket
//   5. /api/leagues/[id]/members-activity — AKTIV-prikken (samme kode, egen fil)
//   6. /api/org/[slug]/quiz-insights      — «Vanskeligste spørsmål»
//
// ── HVORFOR EN FAKE SOM FAKTISK FILTRERER ──────────────────────────────────
// Samme begrunnelse som i lib/real-quiz-population.test.ts: testene er
// BEHAVIORAL, ikke strukturelle. De sjekker ikke at et kall til `.not(...)`
// finnes i kildekoden — en slik test passerer på utkommentert kode og fanger
// ikke et filter skrevet på feil kolonne. De sjekker HVILKEN quiz som vinner,
// og hvem som blir stående som aktiv.
//
// Faken evaluerer derfor filtrene på ekte, inkludert de embeddede
// (`quizzes.is_test` på en attempts-spørring), og `!inner`-joinene i begge
// retninger: attempts→quizzes (many-to-one) og quizzes→attempts→attempt_answers
// (eksistensfilter).
//
// ── HVORFOR EN EGEN TEST FOR FRAMTIDIGE QUIZER ─────────────────────────────
// Funn 1 har TO problemer, og helperen dekker bare det ene. En planlagt quiz er
// en helt ordinær `weekly`-rad: `onlyRealQuizzes` slipper den glatt gjennom.
// Testen «my-placement: planlagte quizer spiser ikke plasser i nyeste-10» er
// derfor bevisst konstruert slik at gulvet ikke KAN redde den — det finnes
// ikke én kunstig quiz i settet.
//
// ── MUTASJONSBEVIS (kjørt 25. august 2026, hver mutasjon gjenopprettet) ─────
// Hver mutasjon ble gjort på HEAD, testene kjørt, mutasjonen reversert:
//   • fjern `onlyRealQuizzes(...)` i org/my-placement      → feiler
//     «my-placement: testquiz overtar ikke plasseringen»
//   • fjern `.lte('opens_at', nowIso)` i org/my-placement  → feiler
//     «my-placement: planlagte quizer spiser ikke plasser i nyeste-10»
//     — og INGEN andre, som er beviset på at gulvet ikke dekker den
//   • fjern `onlyRealQuizzes(...)` i org/dashboard         → feiler
//     «org/dashboard: siste quiz er siste EKTE quiz»
//   • fjern `onlyRealQuizzes(...)` i org/quiz-scores       → feiler
//     «quiz-scores: is_test=true på en weekly-quiz overtar ikke Siste quiz»
//   • fjern `onlyRealQuizAttempts(...)` fra streakQuery    → feiler
//     «quiz-scores: en testkjøring holder ikke ukestreaken i live»
//   • fjern `onlyRealQuizAttempts(...)` i org/members-activity  → feiler
//     «org: AKTIV-merket teller kun ekte quizer»
//   • fjern `onlyRealQuizAttempts(...)` i liga/members-activity → feiler
//     «liga: AKTIV-prikken teller kun ekte quizer»
//   • fjern `onlyRealQuizzes(...)` i org/quiz-insights     → feiler
//     «quiz-insights: arkivquiz overtar ikke bedriftspanelet»
//   • gjeninnfør `.eq('is_test', false)` i org/quiz-insights I STEDET for
//     helperen                                            → feiler
//     «quiz-insights: arkivquiz overtar ikke bedriftspanelet»
//     (arkivraden har is_test=false — det gamle filteret så den aldri)
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const KALLER  = '11111111-1111-1111-1111-111111111111'
const KOLLEGA = '22222222-2222-2222-2222-222222222222'
const ORG     = 'bbbbbbbb-0000-0000-0000-000000000001'
const LIGA    = 'aaaaaaaa-0000-0000-0000-000000000001'

type Rad = Record<string, unknown>

const db: Record<string, Rad[]> = {
  quizzes: [], attempts: [], attempt_answers: [], questions: [], profiles: [],
  organizations: [], organization_members: [], excluded_members: [],
  season_scores: [], leagues: [], league_members: [],
}

// ── Fake-spørringsbygger med ekte filterevaluering ──────────────────────────
function slaaOppRelasjon(tabell: string, rad: Rad, relasjon: string): Rad | undefined {
  // attempts→quizzes er many-to-one: én quiz-rad per attempt, aldri en liste.
  // Det speiler prod, der `quizzes!inner(id)` målt IKKE multipliserte radsettet.
  if (tabell === 'attempts' && relasjon === 'quizzes') {
    return db.quizzes.find(q => q.id === rad.quiz_id)
  }
  throw new Error(`faken kjenner ikke relasjonen ${tabell}→${relasjon}`)
}

function hentVerdi(tabell: string, rad: Rad, kolonne: string): unknown {
  if (!kolonne.includes('.')) return rad[kolonne]
  const [relasjon, felt] = kolonne.split('.')
  const relatert = slaaOppRelasjon(tabell, rad, relasjon)
  return relatert?.[felt]
}

/**
 * `!inner` gjør en embed til et FILTER i stedet for et valgfritt vedlegg.
 * Kun de tre formene som faktisk forekommer i rutene under støttes — en ukjent
 * form skal kaste, ikke stilltiende slippe alt gjennom.
 */
function innerEksisterer(tabell: string, rad: Rad, kjede: string[]): boolean {
  if (tabell === 'attempts' && kjede[0] === 'quizzes') {
    return !!slaaOppRelasjon('attempts', rad, 'quizzes')
  }
  if (tabell === 'quizzes' && kjede[0] === 'attempts') {
    const forsokene = db.attempts.filter(a => a.quiz_id === rad.id)
    if (kjede.length === 1) return forsokene.length > 0
    if (kjede[1] === 'attempt_answers') {
      return forsokene.some(a => db.attempt_answers.some(sv => sv.attempt_id === a.id))
    }
  }
  throw new Error(`faken kjenner ikke !inner-kjeden ${tabell}→${kjede.join('→')}`)
}

function builder(tabell: string) {
  if (!(tabell in db)) throw new Error(`ukjent tabell i mock: ${tabell}`)

  const filtre: Array<(r: Rad) => boolean> = []
  let selectCols = '*'
  let orderCol: string | null = null, orderAsc = true
  let limitN: number | null = null
  let rangeFra: number | null = null, rangeTil: number | null = null
  let manyToOneEmbed = false

  const V = (r: Rad, c: string) => hentVerdi(tabell, r, c)

  const b = {
    select(cols?: string) {
      if (cols) selectCols = cols
      const kjede = [...selectCols.matchAll(/(\w+)!inner/g)].map(m => m[1])
      if (kjede.length > 0) {
        filtre.push(r => innerEksisterer(tabell, r, kjede))
        if (tabell === 'attempts' && kjede[0] === 'quizzes') manyToOneEmbed = true
      }
      return b
    },
    eq(col: string, val: unknown) { filtre.push(r => V(r, col) === val); return b },
    gte(col: string, val: string) { filtre.push(r => V(r, col) != null && String(V(r, col)) >= val); return b },
    lt(col: string, val: string)  { filtre.push(r => V(r, col) != null && String(V(r, col)) <  val); return b },
    lte(col: string, val: string) { filtre.push(r => V(r, col) != null && String(V(r, col)) <= val); return b },
    in(col: string, vals: readonly unknown[]) { filtre.push(r => vals.includes(V(r, col))); return b },
    not(col: string, op: string, val: unknown) {
      if (op !== 'is') throw new Error(`faken støtter kun .not(col, 'is', …), fikk '${op}'`)
      // PostgREST: `not.is.true` = NOT (kol IS TRUE) → sant for BÅDE false og
      // NULL. Det er nettopp den semantikken helperen hviler på.
      if (val === null) filtre.push(r => V(r, col) != null)
      else              filtre.push(r => V(r, col) !== val)
      return b
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col; orderAsc = opts?.ascending !== false; return b
    },
    limit(n: number, opts?: { referencedTable?: string }) {
      // limit på en REFERERT tabell begrenser embeden, ikke radsettet — den er
      // et rent EXISTS-triks i rutene, og skal ikke kutte quiz-listen her.
      if (!opts?.referencedTable) limitN = n
      return b
    },
    range(fra: number, til: number) { rangeFra = fra; rangeTil = til; return b },

    rader(): Rad[] {
      let ut = db[tabell].filter(r => filtre.every(f => f(r)))
      if (orderCol) {
        const c = orderCol
        ut = [...ut].sort((x, y) => {
          const a = String(V(x, c) ?? ''), z = String(V(y, c) ?? '')
          return orderAsc ? a.localeCompare(z) : z.localeCompare(a)
        })
      }
      if (limitN !== null) ut = ut.slice(0, limitN)
      if (rangeFra !== null && rangeTil !== null) ut = ut.slice(rangeFra, rangeTil + 1)
      // Embeden gjengis som ETT objekt (many-to-one), ikke en liste.
      if (manyToOneEmbed) {
        ut = ut.map(r => ({ ...r, quizzes: { id: slaaOppRelasjon(tabell, r, 'quizzes')!.id } }))
      }
      return ut
    },
    maybeSingle() { return Promise.resolve({ data: b.rader()[0] ?? null, error: null }) },
    single()      { return Promise.resolve({ data: b.rader()[0] ?? null, error: null }) },
    // Typet resolve-parameter: det er den som gir `await` sin type, så uten den
    // blir hvert oppslag i testene `unknown` og tsc rødt.
    then(resolve: (v: { data: Rad[] | null; error: null }) => void) {
      return resolve({ data: b.rader(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      auth: {
        getUser: (token?: string) =>
          Promise.resolve(
            token ? { data: { user: { id: KALLER } }, error: null }
                  : { data: { user: null }, error: { message: 'ingen token' } }
          ),
      },
    },
  },
})

// Utenfor det testen handler om — stubbet slik at rutene kan kjøre.
mock.module('@/lib/org-lock-guard', {
  namedExports: { requireUnlockedOrg: async () => ({ ok: true as const }) },
})
// Statistikken selv er ikke det testen måler; POPULASJONEN som velger quizen
// er. To spørsmål med ulik skår, så `qualified.length >= 2` holder.
mock.module('@/lib/attempt-answer-stats', {
  namedExports: {
    getQuestionStatsByAttempts: async () => new Map([
      ['sp-1', { total: 4, correct: 4 }],
      ['sp-2', { total: 4, correct: 1 }],
    ]),
  },
})

const dagerSiden = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const dagerFram  = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

function quiz(id: string, over: Partial<Rad> = {}): Rad {
  return { id, title: `Quiz ${id}`, opens_at: dagerSiden(30), closes_at: dagerSiden(29),
           created_at: dagerSiden(31), quiz_type: 'weekly', is_test: false,
           is_active: true, season_points_awarded: true, ...over }
}

let lopenr = 0
function forsok(quizId: string, userId: string, riktige = 8, over: Partial<Rad> = {}): Rad {
  const t = dagerSiden(1)
  return { id: `att-${++lopenr}`, quiz_id: quizId, user_id: userId,
           player_name: 'Spiller', is_team: false, team_size: 1,
           correct_answers: riktige, total_questions: 10, total_time_ms: 60_000,
           correct_streak: riktige, completed_at: t, submitted_at: t, ...over }
}

// De tre formene en «ikke-ekte» quiz kan ha. Alle faller ut av HVER SIN halvdel
// av definisjonen, derfor står de sammen der plassen tillater det:
//   TEST_TYPE  → oppskriftens testquiz, fanges av hvitelisten på quiz_type
//   TEST_FLAGG → admin-editorens testbryter; quiz_type er fortsatt 'weekly',
//                så KUN is_test stopper den
//   ARKIV      → framtidig arkivforsøk, fanges av hvitelisten (ikke av is_test)
const TEST_TYPE  = { quiz_type: 'test',    is_test: true  }
const TEST_FLAGG = { quiz_type: 'weekly',  is_test: true  }
const ARKIV      = { quiz_type: 'archive', is_test: false }

type RuteRequest = Parameters<typeof import('@/app/api/org/[slug]/dashboard/route')['GET']>[0]

const req = (url = 'https://quizkanonen.no/api/x') =>
  new Request(url, { headers: { authorization: 'Bearer ok' } }) as unknown as RuteRequest

function orgMedTo() {
  db.organizations = [{ id: ORG, slug: 'elkjop', name: 'Elkjøp Nordic', plan: 'standard' }]
  db.organization_members = [
    { organization_id: ORG, user_id: KALLER,  role: 'admin',  joined_at: dagerSiden(90) },
    { organization_id: ORG, user_id: KOLLEGA, role: 'member', joined_at: dagerSiden(90) },
  ]
  db.profiles = [
    { id: KALLER,  display_name: 'Kaller',  last_seen_at: dagerSiden(1) },
    { id: KOLLEGA, display_name: 'Kollega', last_seen_at: dagerSiden(1) },
  ]
}

beforeEach(() => {
  for (const t of Object.keys(db)) db[t] = []
  lopenr = 0
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 1 — /api/org/[slug]/my-placement
// ════════════════════════════════════════════════════════════════════════════

test('my-placement: testquiz overtar ikke plasseringen', async () => {
  const { GET } = await import('@/app/api/org/[slug]/my-placement/route')
  orgMedTo()

  // Testquizene er FERSKEST og vinner derfor `order('created_at', desc)`.
  db.quizzes = [
    quiz('ekte', { created_at: dagerSiden(7), title: 'Fredagsquiz uke 34' }),
    quiz('testkjoring', { created_at: dagerSiden(1), title: '[TEST – ikke ekte]', ...TEST_TYPE }),
    quiz('adminbryter', { created_at: dagerSiden(2), title: '[TEST via bryter]', ...TEST_FLAGG }),
  ]
  db.attempts = [
    forsok('ekte', KALLER, 9), forsok('ekte', KOLLEGA, 5),
    forsok('testkjoring', KALLER, 1), forsok('testkjoring', KOLLEGA, 1),
    forsok('adminbryter', KALLER, 1),
  ]

  const res = await GET(req(), { params: Promise.resolve({ slug: 'elkjop' }) })
  const body = await res.json() as { placement: { rank: number; total: number; quizTitle: string } }

  assert.equal(body.placement.quizTitle, 'Fredagsquiz uke 34',
    'en testquiz et medlem har spilt skal ikke kunne bli «din plassering»')
  assert.equal(body.placement.rank, 1)
  assert.equal(body.placement.total, 2, 'deltakertallet skal komme fra den ekte quizen')
})

test('my-placement: planlagte quizer spiser ikke plasser i nyeste-10', async () => {
  const { GET } = await import('@/app/api/org/[slug]/my-placement/route')
  orgMedTo()

  // INGEN kunstige quizer i settet — gulvet (onlyRealQuizzes) kan altså ikke
  // redde denne testen. Det er hele poenget: en planlagt quiz er en helt
  // ordinær `weekly`-rad, og passerer hvitelisten uten videre.
  //
  // Ti planlagte quizer, alle opprettet ETTER den ekte. De kan ikke ha forsøk
  // (start-attempt svarer 403 før opens_at), så løkken hopper over hver av dem
  // med `continue` — men da har de allerede spist hele limit(10)-vinduet, og
  // den ekte plasseringen faller utenfor. Utfallet er `placement: null`: ingen
  // feilmelding, flaten viser bare ingenting.
  db.quizzes = [
    quiz('ekte', { created_at: dagerSiden(20), title: 'Fredagsquiz uke 33' }),
    ...Array.from({ length: 10 }, (_, i) =>
      quiz(`planlagt-${i}`, {
        created_at: dagerSiden(10 - i * 0.5),
        opens_at: dagerFram(i + 1),
        closes_at: dagerFram(i + 2),
        title: `Planlagt uke ${35 + i}`,
        season_points_awarded: false,
      })),
  ]
  db.attempts = [forsok('ekte', KALLER, 7), forsok('ekte', KOLLEGA, 4)]

  const res = await GET(req(), { params: Promise.resolve({ slug: 'elkjop' }) })
  const body = await res.json() as { placement: { rank: number; quizTitle: string } | null }

  assert.notEqual(body.placement, null,
    'planlagte quizer skal ikke kunne skyve en ekte plassering ut av nyeste-10-vinduet')
  assert.equal(body.placement!.quizTitle, 'Fredagsquiz uke 33')
  assert.equal(body.placement!.rank, 1)
})

test('my-placement: en åpen quiz teller fortsatt — filteret er «har åpnet», ikke «er stengt»', async () => {
  const { GET } = await import('@/app/api/org/[slug]/my-placement/route')
  orgMedTo()

  // Motprøven til testen over: `.lte('opens_at', now)` må ikke smugle inn en
  // «kun stengte quizer»-regel. Kveldens PÅGÅENDE quiz er åpnet og spilt, og
  // plasseringen i den er nettopp den mest interessante.
  db.quizzes = [quiz('paagaaende', {
    opens_at: dagerSiden(0.1), closes_at: dagerFram(0.1),
    created_at: dagerSiden(3), title: 'Fredagsquiz i kveld', season_points_awarded: false,
  })]
  db.attempts = [forsok('paagaaende', KALLER, 6), forsok('paagaaende', KOLLEGA, 9)]

  const res = await GET(req(), { params: Promise.resolve({ slug: 'elkjop' }) })
  const body = await res.json() as { placement: { rank: number; quizTitle: string } | null }

  assert.equal(body.placement?.quizTitle, 'Fredagsquiz i kveld')
  assert.equal(body.placement?.rank, 2)
})

// ════════════════════════════════════════════════════════════════════════════
// Funn 2 — /api/org/[slug]/dashboard
// ════════════════════════════════════════════════════════════════════════════

test('org/dashboard: siste quiz er siste EKTE quiz', async () => {
  const { GET } = await import('@/app/api/org/[slug]/dashboard/route')
  orgMedTo()

  db.quizzes = [
    quiz('ekte', { created_at: dagerSiden(7), title: 'Fredagsquiz uke 34' }),
    quiz('testkjoring', { created_at: dagerSiden(1), title: '[TEST – ikke ekte]', ...TEST_TYPE }),
    quiz('arkiv', { created_at: dagerSiden(2), title: 'Arkiv: 2024-runden', ...ARKIV }),
  ]
  db.attempts = [
    forsok('ekte', KALLER, 9), forsok('ekte', KOLLEGA, 5),
    forsok('testkjoring', KALLER, 1),
    forsok('arkiv', KOLLEGA, 3),
  ]

  const res = await GET(req(), { params: Promise.resolve({ slug: 'elkjop' }) })
  const body = await res.json() as { quiz: { title: string } | null; attempts: unknown[] }

  assert.equal(body.quiz?.title, 'Fredagsquiz uke 34',
    'bedriftens «Siste quiz» skal ikke kunne bli en testquiz eller en arkivrad')
  assert.equal(body.attempts.length, 2, 'tabellen skal vise den ekte quizens forsøk')
})

// ════════════════════════════════════════════════════════════════════════════
// Søsken — /api/org/[slug]/quiz-scores (to hull i samme fil)
// ════════════════════════════════════════════════════════════════════════════

test('quiz-scores: is_test=true på en weekly-quiz overtar ikke Siste quiz', async () => {
  const { GET } = await import('@/app/api/org/[slug]/quiz-scores/route')
  orgMedTo()

  // Ruten hadde `.eq('quiz_type','weekly')` fra før, men INGEN is_test-vakt.
  // Admin-editorens testbryter setter nettopp `is_test = true` mens nedtrekket
  // blir stående på 'weekly' — hvitelisten alene ser altså ikke denne raden.
  db.quizzes = [
    quiz('ekte', { closes_at: dagerSiden(7), title: 'Fredagsquiz uke 34' }),
    quiz('adminbryter', { closes_at: dagerSiden(1), title: '[TEST via bryter]', ...TEST_FLAGG }),
  ]
  db.attempts = [
    forsok('ekte', KALLER, 9), forsok('ekte', KOLLEGA, 5),
    forsok('adminbryter', KALLER, 1),
  ]

  const res = await GET(req(), { params: Promise.resolve({ slug: ORG }) })
  const body = await res.json() as { quizTitle: string; entries: unknown[] }

  assert.equal(body.quizTitle, 'Fredagsquiz uke 34')
  assert.equal(body.entries.length, 2)
})

test('quiz-scores: en testkjøring holder ikke ukestreaken i live', async () => {
  const { GET } = await import('@/app/api/org/[slug]/quiz-scores/route')
  orgMedTo()

  // Kaller spilte for 7 og 21 dager siden — altså med ett HULL i uka imellom,
  // som bryter rekken ved 1. Testkjøringen for 14 dager siden fyller hullet og
  // gjør rekken til 3 uker. Uten quiz-avgrensning ser org-admin en rekke
  // bedriften ikke har.
  db.quizzes = [
    quiz('uke-a', { closes_at: dagerSiden(21) }),
    quiz('testkjoring', { closes_at: dagerSiden(14), ...TEST_TYPE }),
    quiz('uke-c', { closes_at: dagerSiden(7) }),
  ]
  db.attempts = [
    forsok('uke-c', KALLER, 9, { completed_at: dagerSiden(7),  submitted_at: dagerSiden(7) }),
    forsok('testkjoring', KALLER, 1, { completed_at: dagerSiden(14), submitted_at: dagerSiden(14) }),
    forsok('uke-a', KALLER, 8, { completed_at: dagerSiden(21), submitted_at: dagerSiden(21) }),
  ]

  const res = await GET(req(), { params: Promise.resolve({ slug: ORG }) })
  const body = await res.json() as { streaks: Record<string, number> }

  assert.equal(body.streaks[KALLER], 1,
    'en testkjøring skal ikke kunne fylle hullet mellom to ekte fredagsquizer')
})

// ════════════════════════════════════════════════════════════════════════════
// Søsken — AKTIV-merket/-prikken, org og liga (samme kode, to filer)
// ════════════════════════════════════════════════════════════════════════════

test('org: AKTIV-merket teller kun ekte quizer', async () => {
  const { GET } = await import('@/app/api/org/[slug]/members-activity/route')
  orgMedTo()

  db.quizzes = [
    quiz('ekte', { closes_at: dagerSiden(5) }),
    quiz('testkjoring', { closes_at: dagerSiden(2), ...TEST_TYPE }),
  ]
  // Kollega har KUN spilt testquizen — hen skal ikke stå som aktiv.
  db.attempts = [
    forsok('ekte', KALLER, 9, { submitted_at: dagerSiden(5) }),
    forsok('testkjoring', KOLLEGA, 1, { submitted_at: dagerSiden(2) }),
  ]

  const res = await GET(req('https://quizkanonen.no/api/x?period=month'),
    { params: Promise.resolve({ slug: ORG }) })
  const body = await res.json() as { members: { userId: string; activeLast30Days: boolean }[] }
  const merke = new Map(body.members.map(m => [m.userId, m.activeLast30Days]))

  assert.equal(merke.get(KALLER), true)
  assert.equal(merke.get(KOLLEGA), false,
    'en testkjøring skal ikke holde et medlem «aktiv» på flaten som finnes nettopp for å se hvem som har falt av')
})

test('liga: AKTIV-prikken teller kun ekte quizer', async () => {
  const { GET } = await import('@/app/api/leagues/[id]/members-activity/route')

  db.leagues = [{ id: LIGA, owner_id: KALLER, name: 'Kontoret' }]
  db.league_members = [
    { league_id: LIGA, user_id: KALLER,  joined_at: dagerSiden(90) },
    { league_id: LIGA, user_id: KOLLEGA, joined_at: dagerSiden(90) },
  ]
  db.profiles = [
    { id: KALLER,  display_name: 'Kaller',  last_seen_at: dagerSiden(1) },
    { id: KOLLEGA, display_name: 'Kollega', last_seen_at: dagerSiden(1) },
  ]
  db.quizzes = [
    quiz('ekte', { closes_at: dagerSiden(5) }),
    quiz('arkiv', { closes_at: dagerSiden(2), ...ARKIV }),
  ]
  db.attempts = [
    forsok('ekte', KALLER, 9, { submitted_at: dagerSiden(5) }),
    forsok('arkiv', KOLLEGA, 3, { submitted_at: dagerSiden(2) }),
  ]

  const res = await GET(req('https://quizkanonen.no/api/x?period=month'),
    { params: Promise.resolve({ id: LIGA }) })
  const body = await res.json() as { members: { userId: string; activeLast30Days: boolean }[] }
  const prikk = new Map(body.members.map(m => [m.userId, m.activeLast30Days]))

  assert.equal(prikk.get(KALLER), true)
  assert.equal(prikk.get(KOLLEGA), false,
    'søsteren i org-ruten ble rettet i samme runde — denne skal ikke stå igjen med hullet')
})

// ════════════════════════════════════════════════════════════════════════════
// Søsken — /api/org/[slug]/quiz-insights (halvt gulv: is_test uten quiz_type)
// ════════════════════════════════════════════════════════════════════════════

test('quiz-insights: arkivquiz overtar ikke bedriftspanelet', async () => {
  const { GET } = await import('@/app/api/org/[slug]/quiz-insights/route')
  orgMedTo()

  // Arkivraden har `is_test = false` — det gamle `.eq('is_test', false)`-
  // filteret så den altså ikke i det hele tatt, og den stenger ferskest.
  db.quizzes = [
    quiz('ekte', { closes_at: dagerSiden(7), title: 'Fredagsquiz uke 34' }),
    quiz('arkiv', { closes_at: dagerSiden(1), title: 'Arkiv: 2024-runden', ...ARKIV }),
  ]
  db.attempts = [
    forsok('ekte', KALLER), forsok('ekte', KOLLEGA),
    forsok('arkiv', KALLER), forsok('arkiv', KOLLEGA),
  ]
  db.attempt_answers = db.attempts.map((a, i) => ({ id: `sv-${i}`, attempt_id: a.id }))
  db.questions = [
    { id: 'sp-1', question_text: 'Lett spørsmål' },
    { id: 'sp-2', question_text: 'Vanskelig spørsmål' },
  ]

  const res = await GET(req(), { params: Promise.resolve({ slug: ORG }) })
  const body = await res.json() as { quizTitle: string }

  assert.equal(body.quizTitle, 'Fredagsquiz uke 34',
    'et arkivforsøk stenger ferskest og ville vunnet order(closes_at, desc)')
})

test('quiz-insights: is_test = NULL regnes fortsatt som ekte quiz', async () => {
  const { GET } = await import('@/app/api/org/[slug]/quiz-insights/route')
  orgMedTo()

  // Motprøve mot en for STRENG erstatning: kolonnen er nullable, og
  // `.eq('is_test', false)` ville droppet denne raden stille. Helperens
  // `.not('is_test','is',true)` skal slippe den gjennom.
  db.quizzes = [quiz('ekte', { closes_at: dagerSiden(7), title: 'Fredagsquiz uke 34', is_test: null })]
  db.attempts = [forsok('ekte', KALLER), forsok('ekte', KOLLEGA)]
  db.attempt_answers = db.attempts.map((a, i) => ({ id: `sv-${i}`, attempt_id: a.id }))
  db.questions = [
    { id: 'sp-1', question_text: 'Lett spørsmål' },
    { id: 'sp-2', question_text: 'Vanskelig spørsmål' },
  ]

  const res = await GET(req(), { params: Promise.resolve({ slug: ORG }) })
  const body = await res.json() as { quizTitle?: string; error?: string }

  assert.equal(body.quizTitle, 'Fredagsquiz uke 34')
})
