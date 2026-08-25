// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// TESTER for /api/admin/season-scores/reset — skrivestien som sletter
// poengrader. Tre feilklasser felles her:
//
//   1. REKKEFØLGEN: flagget må senkes FØR radene slettes. De to skrivingene er
//      to separate PostgREST-kall og kan ikke bli atomiske — men feilretningene
//      er asymmetriske. Rader borte + flagg=true er PERMANENT (poeng-cronen
//      hopper over quizen for alltid); flagg=false + rader intakt heler seg
//      selv (cronen gjør quizen opp på nytt). Testene asserter på
//      SIDEEFFEKTENE, ikke bare statuskoden.
//   2. UTVALGET i scope 'test': kunstige quizer per definisjon
//      (komplementet av lib/real-quiz-population.ts), ikke ilike på tittel —
//      som traff ekte quizer med «test» i tittelen og bommet på testquizer
//      uten ordet.
//   3. STILLE FEIL: den gamle grenen destrukturerte kun `data` fra
//      quiz-oppslaget, så en feilet spørring ble til «ingen testquizer» og
//      ruten svarte ok.
//
// ── MUTASJONSBEVIS (kjørt 25. august 2026, hver mutasjon gjenopprettet) ─────
//   • bytt rekkefølge i 'all' (slett først, senk flagget etterpå)   → feiler
//     «'all': flagget senkes FØR poengradene slettes» og «'all': feiler
//     slettingen, er flagget allerede senket»
//   • flaggskriving uten onlyRealQuizzes (`.not('id','is',null)`)   → feiler
//     «'all': flagget senkes kun på ekte quizer»
//   • 'test'-utvalg tilbake til ilike('title','%test%')             → feiler
//     «'test': utvalget er kunstige quizer per definisjon, ikke tittel»
//   • gjeninnfør flaggskriving i 'test'-grenen                      → feiler
//     «'test': rører ikke season_points_awarded»
//   • svelg oppslagsfeilen i 'test' (tom liste i stedet for 500)    → feiler
//     «'test': oppslagsfeil gir 500 og sletter ingenting»
//   • fjern chunkingen av delete-listen                             → feiler
//     «'test': delete-listene chunkes under .in()-grensen»
//   • `not.in` → `in` i onlyArtificialQuizzes                       → feiler
//     sannhetstabellen (weekly/bonus havner i begge utvalg)
//   • fjern is_test-operanden fra onlyArtificialQuizzes             → feiler
//     sannhetstabellen (testbryter-quizen havner i ingen av dem)
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type Rad = Record<string, unknown>

const db: Record<string, Rad[]> = { quizzes: [], season_scores: [], admin_actions: [] }

// Operasjonslogg i UTFØRELSES-rekkefølge — det er den rekkefølge-testen leser.
type Op = { tabell: string; type: 'select' | 'update' | 'delete' | 'insert'; inStørrelse?: number }
let opplogg: Op[] = []

// Injisert feil: første operasjon som matcher svarer med error i stedet for å
// utføre noe.
let feilVed: { tabell: string; type: Op['type'] } | null = null

// ── Fake-spørringsbygger med ekte filterevaluering ──────────────────────────
// Som i lib/real-quiz-population.test.ts: behavioral, ikke strukturell — faken
// evaluerer filtrene og muterer db, så testene kan spørre om hvilke rader som
// faktisk overlevde. I tillegg: update/delete/insert, or()-parsing (formene
// helperne bruker) og operasjonslogg.
function parseOrOperand(operand: string): (r: Rad) => boolean {
  let m = /^(\w+)\.is\.true$/.exec(operand)
  if (m) { const c = m[1]; return r => r[c] === true }
  m = /^(\w+)\.not\.in\.\(([^)]*)\)$/.exec(operand)
  if (m) { const c = m[1], vals = m[2].split(','); return r => !vals.includes(String(r[c])) }
  m = /^(\w+)\.in\.\(([^)]*)\)$/.exec(operand)
  if (m) { const c = m[1], vals = m[2].split(','); return r => vals.includes(String(r[c])) }
  throw new Error(`faken kjenner ikke or-operanden: ${operand}`)
}

function builder(tabell: string) {
  if (!(tabell in db)) throw new Error(`ukjent tabell i mock: ${tabell}`)

  const filtre: Array<(r: Rad) => boolean> = []
  let type: Op['type'] = 'select'
  let updateVerdier: Rad | null = null
  let orderCol: string | null = null, orderAsc = true
  let rangeFra: number | null = null, rangeTil: number | null = null
  let sisteInStørrelse: number | undefined

  const b = {
    select(_cols?: string) { return b },
    update(verdier: Rad) { type = 'update'; updateVerdier = verdier; return b },
    delete(_opts?: { count?: string }) { type = 'delete'; return b },
    insert(rad: Rad) {
      type = 'insert'
      return {
        then(resolve: (v: { error: null }) => void) {
          opplogg.push({ tabell, type: 'insert' })
          db[tabell].push(rad)
          return resolve({ error: null })
        },
      }
    },
    eq(col: string, val: unknown) { filtre.push(r => r[col] === val); return b },
    // Støttes for at ilike-mutasjonen (gammel tittelbasert seleksjon) skal
    // felles SEMANTISK — på hvilke rader den treffer — ikke fordi faken
    // mangler metoden.
    ilike(col: string, mønster: string) {
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp('^' + mønster.split('%').map(esc).join('.*') + '$', 'i')
      filtre.push(r => re.test(String(r[col] ?? '')))
      return b
    },
    in(col: string, vals: readonly unknown[]) {
      sisteInStørrelse = vals.length
      filtre.push(r => vals.includes(r[col]))
      return b
    },
    not(col: string, op: string, val: unknown) {
      if (op !== 'is') throw new Error(`faken støtter kun .not(col, 'is', …), fikk '${op}'`)
      // PostgREST: `not.is.true` = NOT (kol IS TRUE) → sant for false OG NULL.
      if (val === null) filtre.push(r => r[col] != null)
      else              filtre.push(r => r[col] !== val)
      return b
    },
    or(uttrykk: string) {
      // Splitt på komma KUN på dybde 0 — verdilister som `in.(weekly,bonus)`
      // har komma inni parentesene.
      const deler: string[] = []
      let dybde = 0, start = 0
      for (let i = 0; i < uttrykk.length; i++) {
        const c = uttrykk[i]
        if (c === '(') dybde++
        else if (c === ')') dybde--
        else if (c === ',' && dybde === 0) { deler.push(uttrykk.slice(start, i)); start = i + 1 }
      }
      deler.push(uttrykk.slice(start))
      const operander = deler.map(parseOrOperand)
      filtre.push(r => operander.some(f => f(r)))
      return b
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col; orderAsc = opts?.ascending !== false; return b
    },
    range(fra: number, til: number) { rangeFra = fra; rangeTil = til; return b },

    then(resolve: (v: { data: Rad[] | null; count: number | null; error: { message: string } | null }) => void) {
      opplogg.push({ tabell, type, inStørrelse: sisteInStørrelse })

      if (feilVed && feilVed.tabell === tabell && feilVed.type === type) {
        feilVed = null
        return resolve({ data: null, count: null, error: { message: 'injisert feil' } })
      }

      const treff = db[tabell].filter(r => filtre.every(f => f(r)))

      if (type === 'update') {
        for (const r of treff) Object.assign(r, updateVerdier)
        return resolve({ data: null, count: null, error: null })
      }
      if (type === 'delete') {
        db[tabell] = db[tabell].filter(r => !treff.includes(r))
        return resolve({ data: null, count: treff.length, error: null })
      }

      let ut = treff
      if (orderCol) {
        const c = orderCol
        ut = [...ut].sort((x, y) => {
          const a = String(x[c] ?? ''), z = String(y[c] ?? '')
          return orderAsc ? a.localeCompare(z) : z.localeCompare(a)
        })
      }
      if (rangeFra !== null && rangeTil !== null) ut = ut.slice(rangeFra, rangeTil + 1)
      return resolve({ data: ut, count: null, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})
mock.module('@/lib/admin-auth', { namedExports: { verifyAdminRequest: () => true } })

function quiz(id: string, over: Partial<Rad> = {}): Rad {
  return { id, title: `Quiz ${id}`, quiz_type: 'weekly', is_test: false,
           season_points_awarded: true, ...over }
}

function poengrad(quizId: string, over: Partial<Rad> = {}): Rad {
  return { id: `ss-${quizId}-${db.season_scores.length}`, quiz_id: quizId,
           scope_type: 'global', scope_id: null, ...over }
}

// Samme tre kunstige former som i lib/real-quiz-population.test.ts — hver
// faller ut av sin egen halvdel av definisjonen.
const TEST_TYPE  = { quiz_type: 'test',    is_test: true  }
const TEST_FLAGG = { quiz_type: 'weekly',  is_test: true  }
const ARKIV      = { quiz_type: 'archive', is_test: false }

function post(scope: string) {
  return import('@/app/api/admin/season-scores/reset/route').then(({ POST }) =>
    POST(new Request('http://x/api/admin/season-scores/reset', {
      method: 'POST',
      body: JSON.stringify({ scope }),
    }) as never)
  )
}

beforeEach(() => {
  for (const t of Object.keys(db)) db[t] = []
  opplogg = []
  feilVed = null
})

// ════════════════════════════════════════════════════════════════════════════
// Helperne: komplement-egenskapen
// ════════════════════════════════════════════════════════════════════════════

test('sannhetstabell: hver quiz matcher nøyaktig én av onlyRealQuizzes/onlyArtificialQuizzes', async () => {
  const { onlyRealQuizzes, onlyArtificialQuizzes, REAL_QUIZ_TYPES } =
    await import('@/lib/real-quiz-population')

  for (const isTest of [true, false, null]) {
    for (const quizType of ['weekly', 'bonus', 'test', 'archive', 'duell-2027']) {
      db.quizzes = [quiz('q1', { is_test: isTest, quiz_type: quizType })]

      const { data: ekte } = await onlyRealQuizzes(builder('quizzes').select('id'))
      const { data: kunstig } = await onlyArtificialQuizzes(builder('quizzes').select('id'))

      const kombo = `is_test=${String(isTest)}, quiz_type=${quizType}`
      assert.equal((ekte?.length ?? 0) + (kunstig?.length ?? 0), 1,
        `${kombo}: raden skal matche nøyaktig én av de to — komplementet må være eksakt`)

      const skalVæreEkte = isTest !== true && (REAL_QUIZ_TYPES as readonly string[]).includes(quizType)
      assert.equal(ekte?.length ?? 0, skalVæreEkte ? 1 : 0,
        `${kombo}: havnet på feil side av definisjonen`)
    }
  }
})

// ════════════════════════════════════════════════════════════════════════════
// Scope 'all'
// ════════════════════════════════════════════════════════════════════════════

test("'all': flagget senkes FØR poengradene slettes", async () => {
  db.quizzes = [quiz('ekte')]
  db.season_scores = [poengrad('ekte')]

  const res = await post('all')
  assert.equal(res.status, 200)

  const flaggIdx = opplogg.findIndex(o => o.tabell === 'quizzes' && o.type === 'update')
  const slettIdx = opplogg.findIndex(o => o.tabell === 'season_scores' && o.type === 'delete')
  assert.ok(flaggIdx !== -1, 'flagget må skrives')
  assert.ok(slettIdx !== -1, 'radene må slettes')
  assert.ok(flaggIdx < slettIdx,
    'flagget må senkes FØR slettingen: feiler flaggskrivingen ETTER en vellykket sletting, ' +
    'står quizen igjen som «gjort opp» uten én poengrad — permanent, cronen hopper over den')

  assert.equal(db.quizzes[0].season_points_awarded, false)
  assert.equal(db.season_scores.length, 0)
  const body = await res.json() as { deletedRows: number }
  assert.equal(body.deletedRows, 1)
})

test("'all': feiler slettingen, er flagget allerede senket — cronen kan hele tilstanden", async () => {
  db.quizzes = [quiz('ekte')]
  db.season_scores = [poengrad('ekte')]
  feilVed = { tabell: 'season_scores', type: 'delete' }

  const res = await post('all')

  assert.equal(res.status, 500, 'feilen skal være synlig for admin, ikke svelges')
  // Sideeffektene er poenget, ikke statuskoden: flagg=false + rader intakt er
  // den selvhelende retningen (cronen gjør quizen opp på nytt). Motsatt
  // rekkefølge ville etterlatt rader borte + flagg=true — permanent.
  assert.equal(db.quizzes[0].season_points_awarded, false,
    'flagget skal allerede være senket når slettingen feiler')
  assert.equal(db.season_scores.length, 1, 'radene står urørt — ingenting er halvslettet')
})

test("'all': flagget senkes kun på ekte quizer — kunstige beholder sitt", async () => {
  db.quizzes = [
    quiz('ekte'),
    quiz('null-flagg', { is_test: null }),   // NULL regnes som ekte (nullable kolonne)
    quiz('t-type',  TEST_TYPE),
    quiz('t-flagg', TEST_FLAGG),
    quiz('arkiv',   ARKIV),
  ]
  db.season_scores = [poengrad('ekte'), poengrad('t-type'), poengrad('arkiv')]

  const res = await post('all')
  assert.equal(res.status, 200)

  const flagg = Object.fromEntries(db.quizzes.map(q => [q.id, q.season_points_awarded]))
  assert.equal(flagg['ekte'], false)
  assert.equal(flagg['null-flagg'], false, 'is_test=NULL er en ekte quiz og skal senkes')
  // For kunstige quizer betyr flagg=true «stengt og gjort opp» for leserne, og
  // cronen vil ALDRI heve det igjen (hvitelisten) — senkes det her, er det
  // permanent. Oppskriftens testquiz setter det bevisst.
  assert.equal(flagg['t-type'], true, 'testtype-quizen skal beholde flagget')
  assert.equal(flagg['t-flagg'], true, 'testbryter-quizen skal beholde flagget')
  assert.equal(flagg['arkiv'], true, 'arkivquizen skal beholde flagget')

  assert.equal(db.season_scores.length, 0,
    'slettingen tar derimot ALLE poengrader — også etterlatte rader fra kunstige quizer')
})

// ════════════════════════════════════════════════════════════════════════════
// Scope 'test'
// ════════════════════════════════════════════════════════════════════════════

test("'test': utvalget er kunstige quizer per definisjon, ikke tittel", async () => {
  db.quizzes = [
    // Ekte quiz med «test» i tittelen — ilike-utvalget ville slettet poengene
    // til alle som spilte den.
    quiz('ekte-med-test-i-tittel', { title: 'Kunnskapstest uke 34' }),
    // Kunstige quizer UTEN «test» i tittelen — ilike-utvalget ville latt
    // radene deres bli liggende.
    quiz('arkiv',   { ...ARKIV,      title: 'Arkiv januar 2025' }),
    quiz('t-flagg', { ...TEST_FLAGG, title: 'Fredagsquiz generalprøve' }),
    // Oppskriftens testquiz — fanges av begge utvalgene, med i settet for å
    // vise at den fortsatt ryddes.
    quiz('t-type',  { ...TEST_TYPE,  title: 'TESTQUIZ verifisering' }),
  ]
  db.season_scores = [
    poengrad('ekte-med-test-i-tittel'),
    poengrad('arkiv'),
    poengrad('t-flagg'),
    poengrad('t-type'),
  ]

  const res = await post('test')
  assert.equal(res.status, 200)

  const gjenlevende = db.season_scores.map(r => r.quiz_id).sort()
  assert.deepEqual(gjenlevende, ['ekte-med-test-i-tittel'],
    'kun den ekte quizens rader skal overleve: tittelsøket bommet i BEGGE retninger')
  const body = await res.json() as { deletedRows: number }
  assert.equal(body.deletedRows, 3)
})

test("'test': rører ikke season_points_awarded", async () => {
  db.quizzes = [quiz('ekte'), quiz('t-type', TEST_TYPE)]
  db.season_scores = [poengrad('t-type')]

  const res = await post('test')
  assert.equal(res.status, 200)

  // Cronen gjør aldri opp kunstige quizer, så et senket flagg her ville vært
  // permanent — og oppskriftens normaltilstand er nettopp flagg=true + null
  // rader. Slett radene, la flagget stå.
  assert.equal(db.quizzes.find(q => q.id === 't-type')!.season_points_awarded, true)
  assert.equal(db.quizzes.find(q => q.id === 'ekte')!.season_points_awarded, true)
  assert.ok(!opplogg.some(o => o.tabell === 'quizzes' && o.type === 'update'),
    "'test'-grenen skal ikke skrive til quizzes i det hele tatt")
})

test("'test': oppslagsfeil gir 500 og sletter ingenting", async () => {
  db.quizzes = [quiz('t-type', TEST_TYPE)]
  db.season_scores = [poengrad('t-type')]
  feilVed = { tabell: 'quizzes', type: 'select' }

  const res = await post('test')

  // Den gamle grenen destrukturerte kun `data`: en feilet spørring ble stille
  // til «ingen testquizer», og ruten svarte ok uten å ha gjort noe.
  assert.equal(res.status, 500, 'en feilet spørring skal være en feil, ikke et tomt utvalg')
  assert.equal(db.season_scores.length, 1, 'ingenting skal slettes på et utvalg vi ikke fikk')
})

test("'test': delete-listene chunkes under .in()-grensen", async () => {
  // 250 kunstige quizer med én poengrad hver + én ekte: .in()-lister sprekker
  // målt rundt 390 id-er (lib/paginate.ts), så én samlet liste er en
  // tidsinnstilt feil — den virker helt til antallet vokser forbi grensen.
  db.quizzes = [quiz('ekte')]
  db.season_scores = [poengrad('ekte')]
  for (let i = 0; i < 250; i++) {
    const id = `kunstig-${String(i).padStart(3, '0')}`
    db.quizzes.push(quiz(id, TEST_TYPE))
    db.season_scores.push(poengrad(id))
  }

  const res = await post('test')
  assert.equal(res.status, 200)

  const sletteOps = opplogg.filter(o => o.tabell === 'season_scores' && o.type === 'delete')
  assert.ok(sletteOps.length >= 2, 'med 250 id-er og chunk på 200 må det bli minst to delete-kall')
  for (const op of sletteOps) {
    assert.ok((op.inStørrelse ?? 0) <= 200, `.in()-listen må holdes under grensen, var ${op.inStørrelse}`)
  }

  assert.deepEqual(db.season_scores.map(r => r.quiz_id), ['ekte'],
    'alle 250 kunstige rader skal være slettet — chunkingen skal ikke miste noen')
  const body = await res.json() as { deletedRows: number }
  assert.equal(body.deletedRows, 250)
})
