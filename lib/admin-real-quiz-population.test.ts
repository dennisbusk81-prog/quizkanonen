// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av POPULASJONEN i de tre admin-flatene som telte forsøk uten
// å skille ekte quizer fra kunstige. Søskenrunden etter kartleggingen
// 29. august 2026, som fant at /historikk og /profil var gatet mens admin ikke
// var det — samme feilklasse som f4d4a07 og org-runden i
// lib/org-real-quiz-population.test.ts.
//
//   1. /api/admin/users/[id]  — flisene «Quizer spilt» / «Nåværende streak» /
//                               «Lengste streak». For testkontoen viste
//                               «Nåværende streak» resultatet av en
//                               arkivrunde spilt 29.08, og «Quizer spilt» sa
//                               6 der /historikk sa 3.
//   2. /api/admin/users       — `quiz_count` per rad, som også styrer
//                               sorteringsvalgene «Flest/Færrest quizer spilt».
//   3. /api/admin/stats       — `attempts`-tallet i nyttelasten.
//
// ── HVORFOR EN FAKE SOM FAKTISK FILTRERER ──────────────────────────────────
// Samme begrunnelse som i lib/real-quiz-population.test.ts og
// lib/org-real-quiz-population.test.ts: testene er BEHAVIORAL, ikke
// strukturelle. De sjekker ikke at et kall til `.in(...)` finnes i kilden — en
// slik test passerer på utkommentert kode og fanger ikke et filter skrevet på
// feil kolonne. De sjekker HVILKE tall rutene faktisk svarer med.
//
// Faken evaluerer derfor filtrene på ekte, inkludert de embeddede
// (`quizzes.quiz_type` på en attempts-spørring) og `!inner`-joinen
// attempts→quizzes (many-to-one). Den evaluerer også `count: 'exact'` +
// `head: true`, som er formen /api/admin/stats bruker — et filter som ikke
// binder på en count ville ellers passert ubemerket.
//
// ── HVORFOR EN EGEN TEST FOR AT LOGGEN IKKE FILTRERES ──────────────────────
// /api/admin/users/[id] er BEVISST to spørringer (besluttet 29. august 2026):
// aktivitetsloggen skal vise ALT brukeren har gjort, flisene over den skal
// telle konkurransen alene. Den billigste «forenklingen» noen kan gjøre her er
// å slå dem sammen til én filtrert spørring — og da forsvinner arkivradene fra
// loggen uten at ett eneste tall blir feil. Testen
// «aktivitetsloggen viser arkivrunder …» finnes for å felle nettopp det, og
// den peker motsatt vei av de andre.
//
// ── MUTASJONSBEVIS (kjørt 29. august 2026, hver mutasjon gjenopprettet) ─────
// Fiksen ble STAGET først, deretter én mutasjon om gangen på arbeidstreet.
// `git diff` viser da nøyaktig mutasjonen og ingenting annet, og
// `git checkout --` gjenoppretter fiksen i stedet for å kaste den — første
// forsøk ble kjørt uten staging, og checkout-en tilbakestilte hele filen til
// HEAD. Diffen ble lest før hver kjøring, og substitusjonen har `or die`:
//
//   1. `const statsQuery = onlyRealQuizAttempts(statsBase)` → `= statsBase`
//        → RØD: «flisene teller kun ekte quizer» + «en testquiz merkes …»
//   2. flisene leser `attempts` i stedet for `realAttempts` (begge linjer)
//        → RØD: samme to
//   3. `totalQuizzes: realAttempts?.length ?? 0` → `quizzes.length`
//        → RØD: samme to
//   4. `Promise.all([listQuery, …])` → `[onlyRealQuizAttempts(listQuery), …]`
//        (= «noen kollapset til én filtrert spørring»)
//        → RØD: «aktivitetsloggen viser arkivrunder …» + «en testquiz …»
//   5. `erEkteQuiz(quiz)` → `quiz?.quiz_type !== 'archive'`
//        → RØD: KUN «en testquiz merkes også som ikke-tellende». At den ene
//          testen står alene her er poenget: den er det eneste som skiller
//          husets predikat fra en håndskrevet arkiv-sjekk.
//   6. `return onlyRealQuizAttempts(base)` → `return base` i admin/users
//        → RØD: «users: quiz_count teller kun ekte quizer»
//   7. `onlyRealQuizAttempts(attemptCountBase)` → `attemptCountBase`
//        → RØD: «stats: attempts-tallet teller kun ekte quizer»
//
// Mutasjon 2 ble først forsøkt som ÉN flerlinjes substitusjon og traff ikke
// (linjeskift-form). `or die` stoppet runden i stedet for å la en grønn suite
// se ut som en overlevende mutasjon — den er derfor delt i to substitusjoner
// med hver sin `or die`.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const BRUKER = '2b0f8a4e-1c3d-4e5f-8a6b-9c0d1e2f3a4b'

type Rad = Record<string, unknown>

const db: Record<string, Rad[]> = {
  quizzes: [], attempts: [], profiles: [], access_codes: [],
  organization_members: [], league_members: [], rivalries: [], admin_actions: [],
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
 * `!inner` gjør en embed til et FILTER i stedet for et valgfritt vedlegg. Kun
 * den ene formen som forekommer i rutene under støttes — en ukjent form skal
 * kaste, ikke stilltiende slippe alt gjennom.
 */
function innerEksisterer(tabell: string, rad: Rad, kjede: string[]): boolean {
  if (tabell === 'attempts' && kjede[0] === 'quizzes') {
    return !!slaaOppRelasjon('attempts', rad, 'quizzes')
  }
  throw new Error(`faken kjenner ikke !inner-kjeden ${tabell}→${kjede.join('→')}`)
}

function builder(tabell: string) {
  if (!(tabell in db)) throw new Error(`ukjent tabell i mock: ${tabell}`)

  const filtre: Array<(r: Rad) => boolean> = []
  let selectCols = '*'
  let orderCol: string | null = null, orderAsc = true
  let rangeFra: number | null = null, rangeTil: number | null = null
  let manyToOneEmbed = false
  // `head: true` betyr «ingen rader, kun telling» — nøyaktig formen
  // /api/admin/stats bruker. Uten den ville en count-spørring returnert rader
  // og testen målt noe annet enn ruten leser.
  let headOnly = false, teller = false

  const V = (r: Rad, c: string) => hentVerdi(tabell, r, c)

  const b = {
    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      if (cols) selectCols = cols
      if (opts?.count) teller = true
      if (opts?.head) headOnly = true
      const kjede = [...selectCols.matchAll(/(\w+)!inner/g)].map(m => m[1])
      if (kjede.length > 0) {
        filtre.push(r => innerEksisterer(tabell, r, kjede))
        if (tabell === 'attempts' && kjede[0] === 'quizzes') manyToOneEmbed = true
      }
      return b
    },
    eq(col: string, val: unknown) { filtre.push(r => V(r, col) === val); return b },
    gte(col: string, val: string) { filtre.push(r => V(r, col) != null && String(V(r, col)) >= val); return b },
    in(col: string, vals: readonly unknown[]) { filtre.push(r => vals.includes(V(r, col))); return b },
    not(col: string, op: string, val: unknown) {
      if (op !== 'is') throw new Error(`faken støtter kun .not(col, 'is', …), fikk '${op}'`)
      // PostgREST: `not.is.true` = NOT (kol IS TRUE) → sant for BÅDE false og
      // NULL. Det er nettopp den semantikken helperen hviler på.
      if (val === null) filtre.push(r => V(r, col) != null)
      else              filtre.push(r => V(r, col) !== val)
      return b
    },
    // Kun formen `kol.eq.verdi,kol.eq.verdi` forekommer (rivalries-oppslaget).
    // Parses på ekte i stedet for å bli et no-op: et filter som stille slipper
    // alt gjennom er den typen fake-hull som gjør en grønn test verdiløs.
    or(uttrykk: string) {
      const ledd = uttrykk.split(',').map(d => {
        const [col, op, val] = d.split('.')
        if (op !== 'eq') throw new Error(`faken støtter kun .or med eq, fikk '${op}'`)
        return (r: Rad) => V(r, col) === val
      })
      filtre.push(r => ledd.some(f => f(r)))
      return b
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col; orderAsc = opts?.ascending !== false; return b
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
    then(resolve: (v: { data: Rad[] | null; count: number | null; error: null }) => void) {
      const rader = b.rader()
      return resolve({
        data: headOnly ? null : rader,
        count: teller ? rader.length : null,
        error: null,
      })
    },
  }
  return b
}

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => true },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      rpc: async (navn: string) => {
        // Verken passord-sjekken eller rangeringen er det denne testen måler.
        if (navn === 'auth_has_password') return { data: false, error: null }
        return { data: [], error: null }
      },
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { id: BRUKER, email: 'test@example.com', user_metadata: {}, app_metadata: {} } },
            error: null,
          }),
          listUsers: async () => ({ data: { users: [] }, error: null }),
        },
      },
    },
  },
})

const dagerSiden = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function quiz(id: string, over: Partial<Rad> = {}): Rad {
  return { id, title: `Quiz ${id}`, opens_at: dagerSiden(30), closes_at: dagerSiden(29),
           created_at: dagerSiden(31), quiz_type: 'weekly', is_test: false,
           is_active: true, season_points_awarded: true, ...over }
}

let lopenr = 0
function forsok(quizId: string, riktige: number, over: Partial<Rad> = {}): Rad {
  const t = dagerSiden(1)
  return { id: `att-${++lopenr}`, quiz_id: quizId, user_id: BRUKER,
           player_name: 'Spiller', is_team: false, team_size: 1,
           correct_answers: riktige, total_questions: 15, total_time_ms: 60_000,
           correct_streak: riktige, completed_at: t, submitted_at: t, ...over }
}

// De tre formene en «ikke-ekte» quiz kan ha. Alle faller ut av HVER SIN halvdel
// av definisjonen, derfor står de sammen:
//   TEST_TYPE  → oppskriftens testquiz, fanges av hvitelisten på quiz_type
//   TEST_FLAGG → admin-editorens testbryter; quiz_type er fortsatt 'weekly',
//                så KUN is_test stopper den
//   ARKIV      → arkivkopi (lib/archive-copy.ts), fanges av hvitelisten —
//                is_test er false på den, så det filteret ser den ALDRI
const TEST_TYPE  = { quiz_type: 'test',    is_test: true  }
const TEST_FLAGG = { quiz_type: 'weekly',  is_test: true  }
const ARKIV      = { quiz_type: 'archive', is_test: false, opens_at: null, closes_at: null }

/**
 * Situasjonen målt i prod 29. august 2026, på Dennis' egen konto: tre ekte
 * fredagsforsøk og tre arkivrunder spilt samme dag, der arkivrundene har
 * BEDRE score enn alle fredagsquizene. Tallene er valgt slik at ethvert
 * ufiltrert aggregat gir et annet svar enn det filtrerte — 3 ≠ 6 for antall,
 * 3 ≠ 9 for lengste streak, og den nyeste raden er en arkivrunde, så
 * «nåværende streak» skiller også.
 */
function prodSituasjonen() {
  db.profiles = [{
    id: BRUKER, display_name: 'Dennis', nickname: null, avatar_color: null,
    created_at: dagerSiden(120), last_seen_at: dagerSiden(0),
    premium_status: true, premium_source: 'founders', suspended_until: null,
  }]
  db.quizzes = [
    quiz('fredag-0307', { title: 'Fredagsquiz 03.07' }),
    quiz('fredag-1408', { title: 'Fredagsquiz 14.08' }),
    quiz('fredag-2108', { title: 'Fredagsquiz 21.08' }),
    quiz('arkiv-a', { title: 'Arkiv: 21.08', ...ARKIV }),
    quiz('arkiv-b', { title: 'Arkiv: 14.08', ...ARKIV }),
  ]
  db.attempts = [
    forsok('fredag-0307', 3, { completed_at: dagerSiden(57), submitted_at: dagerSiden(57) }),
    forsok('fredag-1408', 0, { completed_at: dagerSiden(15), submitted_at: dagerSiden(15) }),
    forsok('fredag-2108', 3, { completed_at: dagerSiden(8),  submitted_at: dagerSiden(8) }),
    forsok('arkiv-a', 9, { completed_at: dagerSiden(0), submitted_at: dagerSiden(0) }),
    forsok('arkiv-b', 7, { completed_at: dagerSiden(0), submitted_at: dagerSiden(0) }),
  ]
}

beforeEach(() => {
  for (const t of Object.keys(db)) db[t] = []
  lopenr = 0
})

type IdRuteRequest = Parameters<typeof import('@/app/api/admin/users/[id]/route')['GET']>[0]
const req = (url = 'https://quizkanonen.no/api/admin/x') =>
  new Request(url, { headers: { 'x-admin-token': 'ok' } }) as unknown as IdRuteRequest

type Aktivitet = {
  totalQuizzes: number
  currentStreak: number
  longestStreak: number
  quizzes: { title: string; countsInStats: boolean }[]
}

// ════════════════════════════════════════════════════════════════════════════
// Flate 1 — /api/admin/users/[id]
// ════════════════════════════════════════════════════════════════════════════

test('users/[id]: flisene teller kun ekte quizer', async () => {
  const { GET } = await import('@/app/api/admin/users/[id]/route')
  prodSituasjonen()

  const res = await GET(req(), { params: Promise.resolve({ id: BRUKER }) })
  const body = await res.json() as { activity: Aktivitet }

  assert.equal(body.activity.totalQuizzes, 3,
    '«Quizer spilt» skal si det samme som /historikk sier til brukeren selv — 3, ikke 6')
  assert.equal(body.activity.longestStreak, 3,
    '«Lengste streak» skal ikke kunne settes av en treningsrunde (arkivrunden hadde 9)')
  assert.equal(body.activity.currentStreak, 3,
    '«Nåværende streak» skal lese nyeste EKTE forsøk (21.08), ikke arkivrunden fra i dag')
})

test('users/[id]: aktivitetsloggen viser arkivrunder, merket som ikke-tellende', async () => {
  const { GET } = await import('@/app/api/admin/users/[id]/route')
  prodSituasjonen()

  const res = await GET(req(), { params: Promise.resolve({ id: BRUKER }) })
  const body = await res.json() as { activity: Aktivitet }

  // Peker MOTSATT vei av testen over, med vilje: loggen er admins innsyn i hva
  // brukeren faktisk har gjort. Slås de to spørringene sammen til én filtrert,
  // forsvinner arkivradene herfra uten at ett eneste tall blir feil.
  assert.equal(body.activity.quizzes.length, 5,
    'loggen skal vise ALLE forsøk, arkivrundene inkludert')
  const arkivrader = body.activity.quizzes.filter(q => q.title.startsWith('Arkiv:'))
  assert.equal(arkivrader.length, 2, 'begge arkivrundene skal stå i loggen')
  assert.ok(arkivrader.every(q => q.countsInStats === false),
    'arkivrader skal være merket som ikke-tellende, ellers ser 3 over 5 rader ut som en feil')

  const ekte = body.activity.quizzes.filter(q => q.title.startsWith('Fredagsquiz'))
  assert.equal(ekte.length, 3)
  assert.ok(ekte.every(q => q.countsInStats === true),
    'fredagsquizene skal IKKE merkes — markøren må skille, ikke stå på alt')
})

test('users/[id]: en testquiz merkes også som ikke-tellende', async () => {
  const { GET } = await import('@/app/api/admin/users/[id]/route')
  db.profiles = [{ id: BRUKER, display_name: 'Dennis', premium_source: null }]
  // Begge formene for testquiz, som faller ut av HVER SIN halvdel av
  // definisjonen. En markør skrevet som `quiz_type !== 'archive'` ville
  // sluppet begge gjennom som «tellende», mens flisene ikke teller dem — og da
  // stemmer ikke lenger differansen markøren skal forklare.
  db.quizzes = [
    quiz('ekte', { title: 'Fredagsquiz uke 34' }),
    quiz('testtype', { title: '[TEST – ikke ekte]', ...TEST_TYPE }),
    quiz('testbryter', { title: '[TEST via bryter]', ...TEST_FLAGG }),
  ]
  db.attempts = [
    forsok('ekte', 8, { completed_at: dagerSiden(3), submitted_at: dagerSiden(3) }),
    forsok('testtype', 15, { completed_at: dagerSiden(2), submitted_at: dagerSiden(2) }),
    forsok('testbryter', 14, { completed_at: dagerSiden(1), submitted_at: dagerSiden(1) }),
  ]

  const res = await GET(req(), { params: Promise.resolve({ id: BRUKER }) })
  const body = await res.json() as { activity: Aktivitet }

  assert.equal(body.activity.totalQuizzes, 1)
  assert.equal(body.activity.longestStreak, 8, 'en 15-poengs testkjøring er ikke en rekord')
  const merket = body.activity.quizzes.filter(q => !q.countsInStats).map(q => q.title).sort()
  assert.deepEqual(merket, ['[TEST via bryter]', '[TEST – ikke ekte]'],
    'BEGGE testformene skal merkes — is_test alene fanger ikke quiz_type, og omvendt')
})

// ════════════════════════════════════════════════════════════════════════════
// Flate 2 — /api/admin/users (lista)
// ════════════════════════════════════════════════════════════════════════════

test('users: quiz_count teller kun ekte quizer', async () => {
  const { GET } = await import('@/app/api/admin/users/route')
  prodSituasjonen()

  const res = await GET(req())
  const body = await res.json() as { users: { id: string; quiz_count: number }[] }

  const rad = body.users.find(u => u.id === BRUKER)
  assert.ok(rad, 'brukeren skal finnes i lista')
  assert.equal(rad.quiz_count, 3,
    'kolonnen «N quizer» og sorteringen «Flest quizer spilt» skal ikke veie en treningsrunde likt med en fredagsquiz')
})

// ════════════════════════════════════════════════════════════════════════════
// Flate 3 — /api/admin/stats
// ════════════════════════════════════════════════════════════════════════════

test('stats: attempts-tallet teller kun ekte quizer', async () => {
  const { GET } = await import('@/app/api/admin/stats/route')
  prodSituasjonen()

  const res = await GET(req())
  const body = await res.json() as { attempts: number }

  // Formen er `select(embed, {count:'exact', head:true})` — et filter som ikke
  // binder på en count ville gitt 5 her uten at noe annet så galt ut.
  assert.equal(body.attempts, 3,
    'totaltallet skal telle spilte quizer, ikke treningsrunder')
})
