// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte notify-subscribers-cronen. `mock.module` bytter
// ut supabase-admin, lib/email og waitUntil — ruten selv kjøres uendret,
// inkludert quiz-vinduet, abonnentfilteret og stemplingen.
//
// INGEN EKTE E-POST: `sendEmail` er mocket bort, så verken Resend eller
// nettverket røres. Mocken teller kall i stedet.
//
// Mocken implementerer `.or(...)`-filteret ekte, ikke bare signaturen. Uten
// det ville testen «allerede varslede hoppes over» bestått også med filteret
// fjernet fra ruten.
//
// MUTASJONSBEVIS (verifisert ved å sette mekanismene tilbake midlertidig):
//   (a) Legges den gamle «er quizen allerede varslet?»-sjekken tilbake øverst
//       i ruten, feiler «delvis varslet quiz: kun restene får e-post» —
//       ruten hopper da over hele kjøringen og de to gjenstående får ALDRI
//       e-posten (stille undersending).
//   (b) Fjernes `.or(...)`-filteret fra abonnenthentingen, feiler samme test
//       motsatt vei: den alt varslede får e-posten på nytt.
//   (c) Fjernes `is_test`/`is_active`-guardene fra quiz-oppslaget, feiler tre
//       tester — blant annet «testquiz stjeler ikke varselet fra den ekte»,
//       som er den formen feilen faktisk tok i produksjon 5. august 2026.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'
process.env.NEXT_PUBLIC_SITE_URL = 'https://www.quizkanonen.no'

const QUIZ_ID = 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e'
const ANNEN_QUIZ = '11111111-2222-3333-4444-555555555555'

type SubRow = { id: string; email: string; notified_at: string | null; notified_quiz_id: string | null }
type QuizRow = {
  id: string; title: string | null; opens_at: string
  is_test: boolean; is_active: boolean
}

type QuestionRow = { id: string; quiz_id: string; question_text: string | null }

const db: {
  quizzes: QuizRow[]
  questions: QuestionRow[]
  subs: SubRow[]
  sentTo: string[]
  sendFailsFor: Set<string>
  updates: { ids: string[]; quizId: string }[]
} = { quizzes: [], questions: [], subs: [], sentTo: [], sendFailsFor: new Set(), updates: [] }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

// ── waitUntil: fang bakgrunnsjobben så testen kan vente på den ──────────────
let pending: Promise<unknown>[] = []
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})
// ── dødsone-deteksjonen: mocket bort her ───────────────────────────────────
// Den er ren lesing og rapportering, har ingen innvirkning på hva denne ruten
// sender, og felles av lib/notify-dead-zone.test.ts — inkludert at alle tre
// rutene faktisk kaller den. Å la den kjøre her ville krevd at den falske
// klienten kjente tabeller ruten selv aldri rører.
mock.module("@/lib/notify-dead-zone", {
  namedExports: {
    detectNotifyDeadZone: async () => ({ kandidater: 0, funn: [], feilet: false }),
  },
})


// ── e-post: ingen ekte utsending ───────────────────────────────────────────
mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to }: { to: string }) => {
      if (db.sendFailsFor.has(to)) throw new Error('Resend sa nei')
      db.sentTo.push(to)
      return { id: 'mock' }
    },
  },
})

// ── Supabase ───────────────────────────────────────────────────────────────
function builder(table: string) {
  let lteCol: string | null = null, lteVal: string | null = null
  let gteCol: string | null = null, gteVal: string | null = null
  let orExpr: string | null = null
  let orderCol: string | null = null, orderDesc = false
  let limitN: number | null = null
  let rangeFrom = 0, rangeTo = Number.MAX_SAFE_INTEGER
  let updating: Record<string, string> | null = null
  let inCol: string | null = null, inVals: string[] = []
  // Innholdsvakten (lib/opened-quiz-lookup.ts) filtrerer med
  // `.not('question_text','is',null).neq('question_text','')`. Begge er
  // implementert ekte her — en mock som bare godtar signaturen ville vært like
  // grønn med og uten filtrene, og da måler den ingenting.
  const notNulls: string[] = []
  const neqs: Array<[string, unknown]> = []
  // `.eq` brukes ikke av ruten slik den står nå. Mocken støtter den likevel,
  // slik at mutasjonsbevis (a) — å sette den gamle alt-eller-intet-sjekken
  // tilbake — måler ruten og ikke en manglende mock-metode.
  const eqs: Record<string, unknown> = {}

  /** Speiler PostgREST sitt `.or('a.is.null,a.neq.X')`. */
  const matchesOr = (row: Record<string, unknown>): boolean => {
    if (!orExpr) return true
    return orExpr.split(',').some(clause => {
      const [col, op, val] = clause.split('.')
      const cell = row[col]
      if (op === 'is' && val === 'null') return cell === null || cell === undefined
      if (op === 'neq') return cell !== val
      return false
    })
  }

  const rows = (): Record<string, unknown>[] => {
    const source: Record<string, unknown>[] =
      table === 'quizzes' ? (db.quizzes as unknown as Record<string, unknown>[])
      : table === 'quiz_notifications' ? (db.subs as unknown as Record<string, unknown>[])
      : table === 'questions' ? (db.questions as unknown as Record<string, unknown>[])
      : []

    let out = source.filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (lteCol && lteVal !== null && String(r[lteCol]) > lteVal) return false
      if (gteCol && gteVal !== null && String(r[gteCol]) < gteVal) return false
      for (const col of notNulls) if (r[col] === null || r[col] === undefined) return false
      for (const [col, val] of neqs) if (r[col] === val) return false
      if (!matchesOr(r)) return false
      return true
    })
    // Sorteringen er implementert ekte. Uten den ville «testquiz stjeler ikke
    // varselet» bestått på array-rekkefølge alene, og dermed målt ingenting:
    // hele poenget er at den NYESTE quizen vinner oppslaget.
    if (orderCol === 'opens_at' && orderDesc) {
      out = [...out].sort((a, b) => String(b.opens_at).localeCompare(String(a.opens_at)))
    }
    if (limitN !== null) out = out.slice(0, limitN)
    return out.slice(rangeFrom, rangeTo + 1)
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    update(patch: Record<string, string>) { updating = patch; return b },
    lte(col: string, val: string) { lteCol = col; lteVal = val; return b },
    gte(col: string, val: string) { gteCol = col; gteVal = val; return b },
    or(expr: string) { orExpr = expr; return b },
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) notNulls.push(col)
      return b
    },
    neq(col: string, val: unknown) { neqs.push([col, val]); return b },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col; orderDesc = opts?.ascending === false; return b
    },
    limit(n: number) { limitN = n; return b },
    range(from: number, to: number) { rangeFrom = from; rangeTo = to; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals; return b },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
    then(resolve: (v: unknown) => void) {
      if (updating && table === 'quiz_notifications' && inCol) {
        db.updates.push({ ids: [...inVals], quizId: String(updating.notified_quiz_id) })
        for (const s of db.subs) {
          if (inVals.includes(s.id)) {
            s.notified_at = updating.notified_at
            s.notified_quiz_id = updating.notified_quiz_id
          }
        }
        return resolve({ error: null })
      }
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const routeModule = await import('@/app/api/cron/notify-subscribers/route')
const { GET } = routeModule

async function call(secret = 'test-cron-secret') {
  pending = []
  const request = new Request('https://quizkanonen.no/api/cron/notify-subscribers', {
    headers: { authorization: `Bearer ${secret}` },
  })
  const res = await GET(request as never)
  await Promise.all(pending) // vent på waitUntil-jobben
  return res
}

const sub = (id: string, over: Partial<SubRow> = {}): SubRow => ({
  id,
  email: `${id}@example.com`,
  notified_at: null,
  notified_quiz_id: null,
  ...over,
})

const quiz = (over: Partial<QuizRow> = {}): QuizRow => ({
  id: QUIZ_ID, title: 'Ukens quiz', opens_at: minutesAgo(3),
  is_test: false, is_active: true,
  ...over,
})

/** Ferdige spørsmål med tekst — det normale for en quiz som skal annonseres. */
const spørsmål = (quizId: string, n = 15): QuestionRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${quizId}-q${i}`, quiz_id: quizId, question_text: `Spørsmål ${i}`,
  }))

/** Radene admin-editoren lager på tittel-blur: de FINNES, men er tomme. */
const placeholders = (quizId: string, n = 15): QuestionRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${quizId}-q${i}`, quiz_id: quizId, question_text: '',
  }))

beforeEach(() => {
  db.quizzes = [quiz()]
  db.questions = [...spørsmål(QUIZ_ID), ...spørsmål(ANNEN_QUIZ)]
  db.subs = []
  db.sentTo = []
  db.sendFailsFor = new Set()
  db.updates = []
})

// ── maxDuration ─────────────────────────────────────────────────────────────

test('ruten setter maxDuration eksplisitt', () => {
  // Uten denne arvet ruten standardbudsjettet, mens søsterrutene sto på 60.
  assert.equal((routeModule as { maxDuration?: number }).maxDuration, 60)
})

// ── Grunnflyt ───────────────────────────────────────────────────────────────

test('alle uvarslede abonnenter får e-post og stemples', async () => {
  db.subs = [sub('a'), sub('b'), sub('c')]

  const res = await call()
  assert.equal(res.status, 200)

  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com', 'c@example.com'])
  assert.equal(db.subs.every(s => s.notified_quiz_id === QUIZ_ID), true)
  assert.equal(db.subs.every(s => s.notified_at !== null), true)
})

test('ingen quiz i vinduet → ingen e-post', async () => {
  db.quizzes = [quiz({ title: 'Gammel', opens_at: minutesAgo(120) })]
  db.subs = [sub('a')]

  await call()
  assert.deepEqual(db.sentTo, [])
})

// ── is_test / is_active ─────────────────────────────────────────────────────
//
// Manglet HELT fram til 5. august 2026, og slo til i produksjon samme kveld:
// en etterlatt testquiz åpnet 22:46, og kjøringen 23:00 sendte
// «Ukens quiz er klar — [TEST – ikke ekte] finishQuiz-timeout» til
// påmeldingslisten. Vinduet var utvidet fra 10 til 60 minutter timer i
// forveien (3a27619), noe som gjorde treffet seks ganger mer sannsynlig.

test('testquiz annonseres ikke', async () => {
  db.quizzes = [quiz({ is_test: true, title: '[TEST – ikke ekte] noe' })]
  db.subs = [sub('a')]

  await call()
  assert.deepEqual(db.sentTo, [], 'en testquiz skal aldri nå påmeldingslisten')
  assert.deepEqual(db.updates, [], 'og skal ikke stemple abonnenten heller')
})

test('skjult quiz (is_active=false) annonseres ikke', async () => {
  // «Skjul»-knappen i admin setter is_active=false. En e-post om en quiz
  // publikum ikke får se er verre enn ingen e-post.
  db.quizzes = [quiz({ is_active: false })]
  db.subs = [sub('a')]

  await call()
  assert.deepEqual(db.sentTo, [])
})

test('testquiz stjeler ikke varselet fra den ekte quizen', async () => {
  // MUTASJONSBEVIS. Uten guardene vinner testquizen
  // `order('opens_at', desc)` fordi den åpnet sist. Da annonseres feil quiz,
  // OG abonnenten stemples med testquizens id — så den ekte quizen ville
  // fortsatt blitt sendt senere, men e-posten som gikk ut var feil.
  db.quizzes = [
    quiz({ id: QUIZ_ID, opens_at: minutesAgo(20), title: 'Fredagsquiz' }),
    quiz({ id: ANNEN_QUIZ, opens_at: minutesAgo(1), is_test: true, title: '[TEST – ikke ekte] noe' }),
  ]
  db.subs = [sub('a')]

  await call()

  assert.deepEqual(db.sentTo, ['a@example.com'])
  assert.equal(db.subs[0].notified_quiz_id, QUIZ_ID, 'stemplet med den EKTE quizen')
  assert.equal(db.updates.every(u => u.quizId === QUIZ_ID), true)
})

test('feil hemmelighet gir 401 og sender ingenting', async () => {
  db.subs = [sub('a')]
  const res = await call('feil-hemmelighet')

  assert.equal(res.status, 401)
  assert.deepEqual(db.sentTo, [])
})

// ── Gjenopptakelse: kjernen i F4 ────────────────────────────────────────────

test('delvis varslet quiz: kun restene får e-post, ingen duplikat', async () => {
  // Slik ser verden ut etter en kjøring som ble drept midt i løkken: 'a' er
  // levert OG stemplet, 'b' og 'c' er ikke.
  db.subs = [
    sub('a', { notified_at: minutesAgo(1), notified_quiz_id: QUIZ_ID }),
    sub('b'),
    sub('c'),
  ]

  await call()

  // 'a' skal IKKE få e-posten på nytt ...
  assert.equal(db.sentTo.includes('a@example.com'), false, 'allerede varslet skal ikke få duplikat')
  // ... og 'b'/'c' skal IKKE bli hoppet over.
  assert.deepEqual(db.sentTo.sort(), ['b@example.com', 'c@example.com'])
  assert.equal(db.subs.every(s => s.notified_quiz_id === QUIZ_ID), true)
})

test('en abonnent varslet om en ANNEN quiz får e-post om den nye', async () => {
  db.subs = [
    sub('a', { notified_at: minutesAgo(9000), notified_quiz_id: ANNEN_QUIZ }),
    sub('b'),
  ]

  await call()
  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com'])
})

test('alle alt varslet → ingen e-post og ingen skriving', async () => {
  db.subs = [
    sub('a', { notified_at: minutesAgo(1), notified_quiz_id: QUIZ_ID }),
    sub('b', { notified_at: minutesAgo(1), notified_quiz_id: QUIZ_ID }),
  ]

  await call()
  assert.deepEqual(db.sentTo, [])
  assert.deepEqual(db.updates, [])
})

test('to kjøringer på rad gir nøyaktig én e-post per abonnent', async () => {
  db.subs = [sub('a'), sub('b'), sub('c')]

  await call()
  await call()

  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com', 'c@example.com'])
})

// ── Feilede sendinger ───────────────────────────────────────────────────────

test('en feilet sending stemples ikke og forsøkes på nytt neste kjøring', async () => {
  db.subs = [sub('a'), sub('b')]
  db.sendFailsFor = new Set(['b@example.com'])

  await call()
  assert.deepEqual(db.sentTo, ['a@example.com'])
  assert.equal(db.subs.find(s => s.id === 'b')!.notified_quiz_id, null, 'feilet skal stå ustemplet')

  // Neste kjøring, nå uten feil: kun 'b' forsøkes igjen.
  db.sendFailsFor = new Set()
  db.sentTo = []
  await call()

  assert.deepEqual(db.sentTo, ['b@example.com'])
  assert.equal(db.subs.find(s => s.id === 'b')!.notified_quiz_id, QUIZ_ID)
})

// ── Stemplingen skjer per batch, også gjennom ruten ─────────────────────────

test('stemplingen skrives per batch, ikke som én skriving til slutt', async () => {
  // 20 abonnenter = 3 batcher (8/8/4) → 3 separate UPDATE-kall.
  db.subs = Array.from({ length: 20 }, (_, i) => sub(`s${i}`))

  await call()

  assert.equal(db.updates.length, 3, 'én skriving per batch')
  assert.deepEqual(db.updates.map(u => u.ids.length), [8, 8, 4])
  assert.equal(db.updates.every(u => u.quizId === QUIZ_ID), true)
  assert.equal(db.sentTo.length, 20)
})

// ── Quiz uten spørsmål ──────────────────────────────────────────────────────
//
// Vakten bor i lib/opened-quiz-lookup.ts og er enhetstestet der. Testene under
// binder den til DETTE kallstedet: fjernes `findOpenedQuizToNotify` herfra til
// fordel for et inlinet oppslag, er lib-testene fortsatt grønne mens ruten
// annonserer en tom quiz.
//
// MUTASJONSBEVIS (16. august 2026): hele ruten rullet tilbake til versjonen på
// `main` (altså det inlinede oppslaget uten innholdssjekk) → «quiz med bare
// placeholder-spørsmål annonseres ikke» og «tom quiz rapporteres ikke som ingen
// quiz i vinduet» ryker, sammen med de to strukturelle testene i
// lib/opened-quiz-lookup.test.ts.

test('quiz med bare placeholder-spørsmål annonseres ikke', async () => {
  // Admin har skrevet tittelen og fått quiz-raden opprettet (is_active=true,
  // opens_at satt), men ikke fylt inn spørsmålene. Radene FINNES — en
  // count-vakt ville sluppet denne gjennom til hele påmeldingslisten.
  db.questions = placeholders(QUIZ_ID)
  db.subs = [sub('a'), sub('b')]

  const res = await call()
  const body = await res.json() as { skipped?: boolean; reason?: string; quizId?: string }

  assert.deepEqual(db.sentTo, [], 'ingen skal få e-post om en tom quiz')
  assert.deepEqual(db.updates, [], 'og ingen skal stemples som varslet')
  assert.equal(body.skipped, true)
  assert.equal(body.quizId, QUIZ_ID)
})

test('«tom quiz» rapporteres ikke som «ingen quiz i vinduet»', async () => {
  // De to tilstandene må være synlig forskjellige i svaret. «Ingen quiz åpnet i
  // vinduet» er normalmeldingen nesten hele tiden — gjemmer vi funnet bak den,
  // er det stille undersending forkledd som normaldrift.
  db.questions = placeholders(QUIZ_ID)
  db.subs = [sub('a')]
  const tom = await (await call()).json() as { reason?: string }

  db.quizzes = []
  const ingen = await (await call()).json() as { reason?: string }

  assert.notEqual(tom.reason, ingen.reason)
  assert.match(String(tom.reason), /spørsmål/i)
})

test('ett ekte spørsmål blant placeholders → quizen annonseres', async () => {
  // Vakten krever ikke en ferdig quiz, bare at den ikke er helt tom.
  db.questions = [
    ...placeholders(QUIZ_ID, 14),
    { id: 'ekte', quiz_id: QUIZ_ID, question_text: 'Hva heter Norges høyeste fjell?' },
  ]
  db.subs = [sub('a')]

  await call()

  assert.deepEqual(db.sentTo, ['a@example.com'])
})
