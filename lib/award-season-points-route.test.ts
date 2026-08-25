// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av quiz-UTVALGET i begge rutene som tildeler sesongpoeng
// på «quiz stengte»-hendelsen:
//   - /api/cron/award-season-points  (hvert 30. minutt)
//   - /api/cron/publish-quiz         (hvert minutt — samme processQuiz, så en
//                                     testquiz ville blitt gjort opp HER før
//                                     30-minutters-cronen i det hele tatt så den)
//
// `mock.module` bytter ut supabase-admin og processQuiz — rutene selv kjøres
// uendret. processQuiz-mocken registrerer hvilke quiz-id-er som faktisk
// behandles; det er hele poenget med testen.
//
// POPULASJONSGULVET er nå den DELTE definisjonen i lib/real-quiz-population.ts
// (`.not('is_test','is',true)` + `.in('quiz_type', ['weekly','bonus'])`) i
// stedet for et inline `.eq('is_test', false)`. Fake-byggeren under
// implementerer begge operatorene KOLONNE-BEVISST — en `in()` som setter sin
// verdi uansett kolonne ville blitt overskrevet av `.in('quiz_type', …)` og
// gjort testene grønne av feil grunn.
//
// MUTASJONSBEVIS (verifisert ved å fjerne mekanismen midlertidig):
//   - fjernes onlyRealQuizzes() i award-season-points, feiler
//     «testquiz som stenges får ikke sesongpoeng», «arkivquiz …» og
//     «quiz_type='test' …»
//   - fjernes onlyRealQuizzes() i publish-quiz, feiler de tre tilsvarende
//     publish-quiz-testene
//   - snevres REAL_QUIZ_TYPES til kun ['weekly'], feiler begge
//     «bonusquiz …»-testene — de er produktvakten, ikke pynt
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

const REAL_QUIZ = 'aaaaaaaa-1111-2222-3333-444444444444'
const TEST_QUIZ = 'cccccccc-1111-2222-3333-444444444444'

type QuizRow = {
  id: string; title: string; closes_at: string
  season_points_awarded: boolean
  // is_test er NULLABLE i basen (DEFAULT false). Det er selve poenget med at
  // gulvet bruker `.not(… is true)` og ikke `.eq(…, false)`.
  is_test: boolean | null
  quiz_type: string
  is_active: boolean
}

// failFor: quiz-id → feilmelding processQuiz skal returnere for den quizen.
// quizError: feil på selve quiz-OPPSLAGET (Supabase nede — 14. august-formen).
const db: {
  quizzes: QuizRow[]
  processed: string[]
  failFor: Map<string, string>
  quizError: string | null
} = { quizzes: [], processed: [], failFor: new Map(), quizError: null }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

let pending: Promise<unknown>[] = []
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})
mock.module('next/cache', {
  namedExports: { revalidateTag: () => {} },
})

// processQuiz mockes bort: testen handler om UTVALGET, ikke poengberegningen
// (den dekkes av lib/award-season-points.pagination.test.ts).
mock.module('@/lib/award-season-points', {
  namedExports: {
    processQuiz: async (quizId: string) => {
      db.processed.push(quizId)
      const failure = db.failFor.get(quizId)
      return failure ? { rows: 0, error: failure } : { rows: 1, error: null }
    },
  },
})

function builder(table: string) {
  // Rekjøringsvinduets vaktspørring (publish-quiz) leser attempts. Testene her
  // seeder aldri sene innsendinger, så den svarer alltid tomt — rekjøringen er
  // dekket av lib/publish-quiz-resettle-route.test.ts.
  if (table === 'attempts') {
    const a = {
      select() { return a }, eq() { return a }, gt() { return a }, not() { return a },
      limit() { return a },
      maybeSingle() { return Promise.resolve({ data: null, error: null }) },
    }
    return a
  }
  if (table !== 'quizzes') throw new Error(`ukjent tabell i mock: ${table}`)
  const eqs: Record<string, unknown> = {}
  let ltCol: string | null = null, ltVal: string | null = null
  let gteCol: string | null = null, gteVal: string | null = null
  let limitN: number | null = null
  let orderAsc = true
  let updating = false
  // not()/in() samles som predikater, ikke som ett felt per operator: begge kan
  // forekomme flere ganger i samme kjede, og de MÅ huske hvilken KOLONNE de
  // gjaldt.
  const preds: ((q: QuizRow) => boolean)[] = []

  const rows = (): QuizRow[] => {
    let out = db.quizzes.filter(q => {
      for (const [k, v] of Object.entries(eqs)) if ((q as unknown as Record<string, unknown>)[k] !== v) return false
      if (ltCol && ltVal !== null && String((q as unknown as Record<string, unknown>)[ltCol]) >= ltVal) return false
      if (gteCol && gteVal !== null && String((q as unknown as Record<string, unknown>)[gteCol]) < gteVal) return false
      if (!preds.every(p => p(q))) return false
      return true
    })
    out = [...out].sort((a, b) => orderAsc
      ? a.closes_at.localeCompare(b.closes_at)
      : b.closes_at.localeCompare(a.closes_at))
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    select() { return b },
    update() { updating = true; return b },
    eq(col: string, val: unknown) { if (!updating) eqs[col] = val; return b },
    lt(col: string, val: string) { ltCol = col; ltVal = val; return b },
    gte(col: string, val: string) { gteCol = col; gteVal = val; return b },
    lte() { return b },
    // PostgREST-semantikk: raden slipper gjennom når NOT (col IS value).
    // `.not('is_test','is',true)` slipper altså BÅDE false og NULL — det er
    // hele forskjellen fra `.eq('is_test', false)`, som slipper kun false.
    not(col: string, op: string, v: unknown) {
      if (updating) return b   // publish-quiz sin .not('scheduled_at','is',null) på UPDATE-en
      assert.equal(op, 'is', 'mocken kjenner kun .not(col, "is", verdi)')
      preds.push(q => (q as unknown as Record<string, unknown>)[col] !== v)
      return b
    },
    in(col: string, values: readonly unknown[]) {
      if (updating) return b
      preds.push(q => values.includes((q as unknown as Record<string, unknown>)[col]))
      return b
    },
    or() { return b },
    order(_col: string, opts?: { ascending?: boolean }) { orderAsc = opts?.ascending !== false; return b },
    limit(n: number) { limitN = n; return b },
    then(resolve: (v: unknown) => void) {
      // publish-quiz sin publiserings-UPDATE (scheduled_at) er ikke tema her —
      // den svarer alltid tomt.
      if (updating) return resolve({ data: [], error: null })
      if (db.quizError) return resolve({ data: null, error: { message: db.quizError } })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { GET: awardGET } = await import('@/app/api/cron/award-season-points/route')
const { GET: publishGET } = await import('@/app/api/cron/publish-quiz/route')

async function call(handler: (req: never) => Promise<Response>, secret = 'test-cron-secret') {
  pending = []
  const request = new Request('https://quizkanonen.no/api/cron/x', {
    headers: { authorization: `Bearer ${secret}` },
  })
  const res = await handler(request as never)
  await Promise.all(pending)
  return res
}

const quiz = (over: Partial<QuizRow> = {}): QuizRow => ({
  id: REAL_QUIZ, title: 'Fredagsquiz', closes_at: minutesAgo(30),
  season_points_awarded: false, is_test: false, quiz_type: 'weekly', is_active: true,
  ...over,
})

beforeEach(() => {
  db.quizzes = []
  db.processed = []
  db.failFor = new Map()
  db.quizError = null
})

// ── Rammeverk ───────────────────────────────────────────────────────────────

test('feil hemmelighet gir 401 og behandler ingenting (begge rutene)', async () => {
  db.quizzes = [quiz()]
  assert.equal((await call(awardGET, 'feil')).status, 401)
  assert.equal((await call(publishGET, 'feil')).status, 401)
  assert.deepEqual(db.processed, [])
})

// ── award-season-points ─────────────────────────────────────────────────────

test('testquiz som stenges får ikke sesongpoeng', async () => {
  // MUTASJONSBEVIS: uten .eq('is_test', false) behandles TEST_QUIZ og
  // fixture-brukerne får season_scores-rader i global scope.
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: '[TEST – ikke ekte]', is_test: true, closes_at: minutesAgo(10) }),
  ]

  const res = await call(awardGET)
  assert.equal(res.status, 200)
  assert.deepEqual(db.processed, [REAL_QUIZ])

  const body = await res.json() as { processed: number }
  assert.equal(body.processed, 1)
})

test('ekte stengt quiz gjøres fortsatt opp — filteret låser ikke ute noe legitimt', async () => {
  db.quizzes = [quiz()]

  const res = await call(awardGET)
  assert.equal(res.status, 200)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('skjult ekte quiz (is_active=false) gjøres FORTSATT opp', async () => {
  // Bevisst asymmetri mot varslingsrutene: «Skjul» i admin skal ikke frata
  // spillerne poengene for en quiz de allerede har spilt.
  db.quizzes = [quiz({ is_active: false })]

  await call(awardGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('allerede oppgjort quiz behandles ikke på nytt', async () => {
  db.quizzes = [quiz({ season_points_awarded: true })]

  await call(awardGET)
  assert.deepEqual(db.processed, [])
})

// ── Statuskoden må kunne varsles på ─────────────────────────────────────────
// Dennis slår på feilvarsling i cron-job.org for denne ruten. Varslingen er
// verdiløs hvis en kjøring der ingenting ble gjort opp svarer 200.
//
// MUTASJONSBEVIS (verifisert): byttes `status: failed > 0 ? 503 : 200` tilbake
// til en ubetinget 200, feiler de tre 503-testene under. Byttes terskelen til
// «alle feilet» (failed === results.length), feiler «delvis feil gir OGSÅ 503».

test('quiz som feiler gir 503, ikke 200', async () => {
  db.quizzes = [quiz()]
  db.failFor.set(REAL_QUIZ, 'upstream request timeout')

  const res = await call(awardGET)
  assert.equal(res.status, 503)

  const body = await res.json() as { processed: number; failed: number }
  assert.equal(body.processed, 1)
  assert.equal(body.failed, 1)
})

test('delvis feil gir OGSÅ 503 — en quiz som lyktes skjuler ikke en som ikke gjorde det', async () => {
  // Terskelen er «minst én feilet», ikke «alle feilet». Med «alle» ville denne
  // kjøringen svart 200 mens TEST_QUIZ-raden sto uoppgjort.
  db.quizzes = [quiz(), quiz({ id: TEST_QUIZ, closes_at: minutesAgo(10) })]
  db.failFor.set(TEST_QUIZ, 'Ingen rader funnet i season_scores etter upsert')

  const res = await call(awardGET)
  assert.equal(res.status, 503)

  const body = await res.json() as { processed: number; failed: number }
  assert.equal(body.processed, 2)
  assert.equal(body.failed, 1)
  // Begge ble faktisk forsøkt — 503-en er ikke en tidlig retur.
  assert.deepEqual([...db.processed].sort(), [REAL_QUIZ, TEST_QUIZ].sort())
})

test('feil på selve quiz-oppslaget gir 503 (Supabase nede)', async () => {
  db.quizzes = [quiz()]
  db.quizError = '<!DOCTYPE html><html>521: Web server is down</html>'

  const res = await call(awardGET)
  assert.equal(res.status, 503)
  assert.deepEqual(db.processed, [])
})

test('ingenting å gjøre gir 200 — normaltilstanden skal ALDRI varsle', async () => {
  // Dette er svaret nesten hver eneste kjøring (målt: 0 ubehandlede quizer).
  // Blir denne 503, får Dennis et varsel hvert 30. minutt for godt vær.
  db.quizzes = []

  const res = await call(awardGET)
  assert.equal(res.status, 200)

  const body = await res.json() as { processed: number; totalRows: number }
  assert.equal(body.processed, 0)
  assert.equal(body.totalRows, 0)
})

test('alle quizer OK gir 200 med failed=0', async () => {
  db.quizzes = [quiz(), quiz({ id: TEST_QUIZ, closes_at: minutesAgo(10) })]

  const res = await call(awardGET)
  assert.equal(res.status, 200)

  const body = await res.json() as { failed: number; processed: number }
  assert.equal(body.failed, 0)
  assert.equal(body.processed, 2)
})

test('maxDuration er satt — ruten arver ikke lenger 300 s-defaulten', async () => {
  // Ankeret er den ekte eksporten, ikke en regex mot filen: en utkommentert
  // linje ville ikke bestått denne.
  const mod = await import('@/app/api/cron/award-season-points/route')
  assert.equal((mod as { maxDuration?: number }).maxDuration, 60)
})

// ── Populasjonsgulvet: quiz_type-hvitelisten (25. august 2026) ──────────────
// Fram til nå gatet BEGGE skrivestiene på `.eq('is_test', false)` alene, uten
// noen `quiz_type`-vakt. Testene under er de som feller det.
//
// HVORFOR DETTE ER ALVORLIGERE ENN DE TILSVARENDE LESE-FIKSENE: en leser som
// tar feil skjuler noe og retter seg selv i det koden rettes. Radene disse to
// rutene skriver havner i `season_scores` og må ryddes MANUELT — og de renner
// derfra inn i HVER eneste leser, som alle er trygge i dag kun fordi skriveren
// holder kunstige quizer ute.

test('arkivquiz (quiz_type=archive) får ikke sesongpoeng', async () => {
  // Den kommende arkivfunksjonen: `quiz_type='archive'` med `is_test=false`.
  // Under det gamle filteret var dette en helt ordinær rad — den ville fått
  // poeng i global scope og dukket opp på topplisten, forsidens topp 3 og
  // hver eneste org-/ligatoppliste.
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: 'Arkiv: uke 12', quiz_type: 'archive', closes_at: minutesAgo(10) }),
  ]

  await call(awardGET)
  assert.deepEqual(db.processed, [REAL_QUIZ],
    'arkivquizer skal aldri kunne skrive season_scores-rader')
})

test('quiz_type=test får ikke sesongpoeng selv når is_test ikke er satt', async () => {
  // Oppskriftens testquiz (.claude/QK_TESTQUIZ_OPPSKRIFT.md) bærer BEGGE
  // markørene. Her er is_test bevisst utelatt (false) for å måle at det er
  // hvitelisten — ikke is_test — som stopper raden.
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: '[TEST] Browserverifisering', quiz_type: 'test', is_test: false, closes_at: minutesAgo(10) }),
  ]

  await call(awardGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('bonusquiz får FORTSATT sesongpoeng — hvitelisten er ingen produktendring', async () => {
  // PRODUKTVAKT, ikke pynt. `bonus` er den ene andre typen admin-editoren kan
  // lage (app/admin/quizzes/new/page.tsx:2122), og under det gamle
  // is_test-filteret fikk den sesongpoeng. Snevres REAL_QUIZ_TYPES til kun
  // ['weekly'], mister bonusquizer poengene sine STILLE — ingen feilmelding,
  // quizen faller bare ut av utvalget. Denne testen er det som sier fra.
  db.quizzes = [quiz({ quiz_type: 'bonus' })]

  await call(awardGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('ekte quiz med is_test = NULL gjøres opp (NULL er ikke en testquiz)', async () => {
  // Retningen her er MOTSATT av de tre over: `.eq('is_test', false)` matchet
  // ikke NULL, så en helt ordinær ukesquiz med `is_test IS NULL` ville aldri
  // blitt gjort opp — spillerne mistet poengene, `season_points_awarded` ble
  // stående false, og cronen plukket den opp igjen hvert 30. minutt uten å
  // gjøre noe. Stille under-tildeling. `.not('is_test','is',true)` slipper
  // både false og NULL gjennom, mens hvitelisten fortsatt fanger en
  // hand-innsatt testrad (den bærer quiz_type='test').
  db.quizzes = [quiz({ is_test: null })]

  await call(awardGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('testquiz med is_test = true stoppes fortsatt, uansett quiz_type', async () => {
  // Admin-editorens testbryter setter is_test=true mens nedtrekket blir
  // stående på 'weekly' (page.tsx:1062) — den raden passerer hvitelisten, og
  // is_test-vakten er det ENESTE som stopper den. Begge filtrene trengs.
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: 'Testkjøring', is_test: true, quiz_type: 'weekly', closes_at: minutesAgo(10) }),
  ]

  await call(awardGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

// ── publish-quiz (samme hendelse, kjører hvert minutt) ──────────────────────

test('publish-quiz gjør ikke opp en testquiz', async () => {
  // MUTASJONSBEVIS: uten .eq('is_test', false) her er award-fiksen verdiløs —
  // denne ruten kjører hvert minutt og ville rukket testquizen først.
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: '[TEST – ikke ekte]', is_test: true, closes_at: minutesAgo(10) }),
  ]

  const res = await call(publishGET)
  assert.equal(res.status, 200)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('publish-quiz gjør opp ekte stengt quiz umiddelbart', async () => {
  db.quizzes = [quiz()]

  await call(publishGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('publish-quiz gjør ikke opp en arkivquiz', async () => {
  // Søsteren til award-testen over. publish-quiz kjører hvert MINUTT, så uten
  // gulvet her ville arkivquizen blitt gjort opp lenge før 30-minutters-cronen
  // i det hele tatt så den — å fikse bare den ene ruten hadde vært et hull som
  // ser lukket ut i rapporten.
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: 'Arkiv: uke 12', quiz_type: 'archive', closes_at: minutesAgo(10) }),
  ]

  await call(publishGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('publish-quiz gjør ikke opp quiz_type=test', async () => {
  db.quizzes = [
    quiz(),
    quiz({ id: TEST_QUIZ, title: '[TEST] Browserverifisering', quiz_type: 'test', is_test: false, closes_at: minutesAgo(10) }),
  ]

  await call(publishGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('publish-quiz gjør FORTSATT opp en bonusquiz', async () => {
  db.quizzes = [quiz({ quiz_type: 'bonus' })]

  await call(publishGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

test('publish-quiz gjør opp ekte quiz med is_test = NULL', async () => {
  db.quizzes = [quiz({ is_test: null })]

  await call(publishGET)
  assert.deepEqual(db.processed, [REAL_QUIZ])
})

