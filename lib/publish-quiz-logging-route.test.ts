// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// N-13 (4. september 2026): observerbarheten i cron/publish-quiz.
//
// Ruten logget fra før KUN når noe skjedde. Den vanlige kjøringen var taus, og
// da kan stillhet bety tre ulike ting — kjørte og fant ingenting, kjørte ikke,
// eller logget uten at linja ble fanget. QK_0 ba 23. august om at
// rekjøringsvinduet skulle verifiseres i prod ved å grep-e loggen; det gikk
// ikke. Denne testen feller at de to ubetingede linjene finnes OG at tallene i
// dem faktisk følger utfallet.
//
// TESTEN MÅLER TALLENE, IKKE BARE AT DET LOGGES. En test som kun sjekket at
// «en linje ble skrevet» ville forblitt grønn om alle tellerne sto fast på 0 —
// altså nøyaktig den tilstanden saken handler om.
//
// MUTASJONSBEVIS (kjørt, ikke antatt — se øktrapporten):
//   - fjernes `console.log(... kjorte: ...)` fra request-scope → «linje A
//     fyrer på HVER kjøring» feiler i alle tre tilstandene.
//   - fjernes `.finally(...)`-summeringen → «linje B fyrer selv når det ikke
//     var noe å gjøre» feiler.
//   - endres `.finally()` til at summeringen står sist i kroppen → «linje B
//     fyrer også når resettle-oppslaget feiler» feiler (grenen har `return`).
//   - fjernes `rader += rows` → «gjorde opp: rader teller radene» feiler.
//   - fjernes `skannet = ...` → «skannet skiller evaluert-og-lot-være fra
//     aldri-kjørt» feiler — og det er DEN forskjellen 28. august manglet.
//   - fjernes `rekjort++` → «rekjørte: egen teller, skilt fra førstegangs-
//     oppgjøret» feiler.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

type QuizRow = {
  id: string
  title: string
  is_active: boolean
  is_test: boolean | null
  quiz_type: string
  scheduled_at: string | null
  opens_at: string | null
  closes_at: string | null
  season_points_awarded: boolean
}
type AttemptRow = {
  id: string
  quiz_id: string
  user_id: string | null
  is_team: boolean
  submitted_at: string | null
}

const db: {
  quizzes: QuizRow[]
  attempts: AttemptRow[]
  // Slår på feil i resettle-oppslaget, slik at `return`-grenen kan felles.
  resettleLookupError: boolean
} = { quizzes: [], attempts: [], resettleLookupError: false }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

// Radtallet processQuiz rapporterer tilbake — settes per test.
let processRows = 0
const processQuizMock = mock.fn(async (_quizId: string, _closesAt: string) => ({
  rows: processRows, error: null as string | null,
}))

const pending: Promise<unknown>[] = []

type Row = QuizRow | AttemptRow
type Pred = (r: Row) => boolean

function builder(table: string) {
  assert.ok(table === 'quizzes' || table === 'attempts', `uventet tabell: ${table}`)
  const preds: Pred[] = []
  let updatePatch: Partial<QuizRow> | null = null
  let limitN: number | null = null
  let single = false
  // Kun rekjørings-utvalget spør på season_points_awarded = true; det er den
  // eneste spørringen feilbryteren skal treffe.
  let asksSettled = false

  const val = (r: Row, col: string) => (r as unknown as Record<string, unknown>)[col]

  const rows = (): Row[] => {
    const src: Row[] = table === 'quizzes' ? db.quizzes : db.attempts
    let out = src.filter(r => preds.every(p => p(r)))
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    update(patch: Partial<QuizRow>) { updatePatch = patch; return b },
    select() { return b },
    eq(col: string, v: unknown) {
      if (col === 'season_points_awarded' && v === true) asksSettled = true
      preds.push(r => val(r, col) === v)
      return b
    },
    lte(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) <= v); return b },
    lt(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) < v); return b },
    gt(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) > v); return b },
    gte(col: string, v: string) { preds.push(r => val(r, col) !== null && String(val(r, col)) >= v); return b },
    not(col: string, op: string, v: unknown) {
      assert.equal(op, 'is', 'mocken kjenner kun .not(col, "is", verdi)')
      preds.push(r => val(r, col) !== v)
      return b
    },
    in(col: string, values: readonly unknown[]) {
      preds.push(r => values.includes(val(r, col)))
      return b
    },
    or(expr: string) {
      const parts = expr.split(',').map(p => {
        const [col, op, ...rest] = p.split('.')
        const v = rest.join('.')
        if (op === 'is' && v === 'null') return (r: Row) => val(r, col) === null
        if (op === 'gte') return (r: Row) => val(r, col) !== null && String(val(r, col)) >= v
        throw new Error(`ukjent or-form i mock: ${p}`)
      })
      preds.push(r => parts.some(p => p(r)))
      return b
    },
    order() { return b },
    limit(n: number) { limitN = n; return b },
    maybeSingle() { single = true; return b },
    then(resolve: (v: unknown) => void) {
      if (db.resettleLookupError && table === 'quizzes' && asksSettled && !updatePatch) {
        return resolve({ data: null, error: { message: 'oppslag nede', code: '500' } })
      }
      if (updatePatch) {
        const hit = rows()
        for (const r of hit) Object.assign(r, updatePatch)
        return resolve({ data: hit.map(r => ({ id: (r as QuizRow).id, title: (r as QuizRow).title })), error: null })
      }
      if (single) return resolve({ data: rows()[0] ?? null, error: null })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})
mock.module('next/cache', {
  namedExports: { revalidateTag: () => {} },
})
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})
mock.module('@/lib/award-season-points', {
  namedExports: { processQuiz: processQuizMock },
})

const { GET } = await import('@/app/api/cron/publish-quiz/route')

// Fanger console.log for den ene kjøringen. console.error slippes gjennom til
// den ekte kanalen — testene her måler INFO-sporet, og en skjult error ville
// gjort en feilende test vanskeligere å lese.
const logged: string[] = []
const call = async () => {
  const ekte = console.log
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  try {
    const res = await GET(new Request('https://quizkanonen.no/api/cron/publish-quiz', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }) as never)
    await Promise.all(pending.splice(0))
    return res
  } finally {
    console.log = ekte
  }
}

// Plukker ut ÉN linje som inneholder ankeret. Feiler høylytt på 0 og på >1:
// to summeringslinjer per kjøring ville gjort tallene tvetydige.
const linje = (anker: string): string => {
  const treff = logged.filter(l => l.includes(anker))
  assert.equal(treff.length, 1,
    `forventet nøyaktig én linje med «${anker}», fikk ${treff.length}:\n${logged.join('\n')}`)
  return treff[0]
}

const felt = (anker: string, nokkel: string): number => {
  const m = new RegExp(`${nokkel}=(\\d+)`).exec(linje(anker))
  assert.ok(m, `fant ikke «${nokkel}=» i linja: ${linje(anker)}`)
  return Number(m[1])
}

const settledQuiz = (min: number): QuizRow => ({
  id: 'q1', title: 'Fredagsquiz', is_active: true, is_test: false, quiz_type: 'weekly',
  scheduled_at: null, opens_at: minutesAgo(min + 240), closes_at: minutesAgo(min),
  season_points_awarded: true,
})
const lateAttempt = (quiz: QuizRow, minAfterClose: number, over: Partial<AttemptRow> = {}): AttemptRow => ({
  id: 'a1', quiz_id: quiz.id, user_id: 'u1', is_team: false,
  submitted_at: new Date(Date.parse(quiz.closes_at!) + minAfterClose * 60_000).toISOString(),
  ...over,
})

beforeEach(() => {
  db.quizzes = []
  db.attempts = []
  db.resettleLookupError = false
  processRows = 0
  processQuizMock.mock.resetCalls()
  logged.length = 0
})

// ── Linje A: beviser at ruten kjørte i det hele tatt ────────────────────────

test('linje A fyrer på HVER kjøring — også når det ikke var noe å gjøre', async () => {
  await call()
  assert.equal(felt('kjorte:', 'publisert'), 0)
  assert.equal(felt('kjorte:', 'kandidater'), 0)
})

test('linje A teller kandidatene til førstegangs-oppgjør', async () => {
  db.quizzes = [{ ...settledQuiz(3), season_points_awarded: false }]
  await call()
  assert.equal(felt('kjorte:', 'kandidater'), 1)
})

// ── Linje B: de tre tilstandene ────────────────────────────────────────────

test('TILSTAND 1 — ingenting å gjøre: linje B fyrer likevel, med rene nuller', async () => {
  await call()
  // Hele poenget med saken: et nulltall som er SKREVET, ikke et fravær som må
  // tolkes. Uten denne linja er «ingen treff» og «ruten kjørte ikke» samme
  // observasjon.
  assert.equal(felt('oppgjor:', 'gjort_opp'), 0)
  assert.equal(felt('oppgjor:', 'rader'), 0)
  assert.equal(felt('oppgjor:', 'skannet'), 0)
  assert.equal(felt('oppgjor:', 'rekjort'), 0)
  assert.equal(felt('oppgjor:', 'feil'), 0)
})

test('TILSTAND 2 — gjorde opp: gjort_opp og rader følger utfallet', async () => {
  db.quizzes = [{ ...settledQuiz(3), season_points_awarded: false }]
  processRows = 42
  await call()
  assert.deepEqual(processQuizMock.mock.calls.map(c => c.arguments[0]), ['q1'],
    'forutsetningen for testen: oppgjøret skal faktisk ha kjørt')
  assert.equal(felt('oppgjor:', 'gjort_opp'), 1)
  assert.equal(felt('oppgjor:', 'rader'), 42)
  assert.equal(felt('oppgjor:', 'rekjort'), 0, 'et førstegangs-oppgjør er ikke en rekjøring')
})

test('TILSTAND 3 — rekjørte og etterjusterte: egen teller, skilt fra oppgjøret', async () => {
  const quiz = settledQuiz(3)
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2)]
  processRows = 7
  await call()
  assert.deepEqual(processQuizMock.mock.calls.map(c => c.arguments[0]), ['q1'],
    'forutsetningen for testen: rekjøringen skal faktisk ha kjørt')
  assert.equal(felt('oppgjor:', 'rekjort'), 1)
  assert.equal(felt('oppgjor:', 'rader_rekjort'), 7)
  assert.equal(felt('oppgjor:', 'gjort_opp'), 0,
    'rekjøring skal ikke kunne forveksles med et førstegangs-oppgjør i loggen')
})

// ── Den negative kontrollen som manglet 28. august ─────────────────────────

test('skannet skiller «evaluert og lot være» fra «utvalget kjørte aldri»', async () => {
  const quiz = settledQuiz(3)
  db.quizzes = [quiz]
  // Innsending FØR stengetid: vinduet SKAL avstå fra å rekjøre.
  db.attempts = [lateAttempt(quiz, -30)]
  await call()
  assert.equal(felt('oppgjor:', 'rekjort'), 0)
  assert.equal(felt('oppgjor:', 'skannet'), 1,
    'uten skannet>0 er «rekjort=0» ikke til å skille fra at utvalget aldri kjørte — ' +
    'det er nøyaktig tvetydigheten som gjorde at 28. august trengte en positiv kontroll')
})

test('utenfor skannevinduet: skannet=0 — vinduet så ingen kandidat', async () => {
  const quiz = settledQuiz(14 * 24 * 60)
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2)]
  await call()
  assert.equal(felt('oppgjor:', 'skannet'), 0)
  assert.equal(felt('oppgjor:', 'rekjort'), 0)
})

// ── Feilstien: summeringen må overleve `return` ────────────────────────────

test('linje B fyrer også når resettle-oppslaget feiler og grenen returnerer', async () => {
  db.resettleLookupError = true
  await call()
  // Står summeringen sist i kroppen i stedet for i .finally(), forsvinner den
  // her — i den ene kjøringen der man mest trenger å vite hva som skjedde.
  assert.equal(felt('oppgjor:', 'feil'), 1)
  assert.equal(felt('oppgjor:', 'skannet'), 0)
})

// ── Personvern ─────────────────────────────────────────────────────────────

test('de to ubetingede linjene bærer kun tall — ingen navn, ingen id-er', async () => {
  const quiz = settledQuiz(3)
  db.quizzes = [quiz]
  db.attempts = [lateAttempt(quiz, 2)]
  processRows = 3
  await call()
  for (const anker of ['kjorte:', 'oppgjor:']) {
    const l = linje(anker)
    assert.ok(!l.includes('u1'), `bruker-id lekket i «${anker}»: ${l}`)
    assert.ok(!l.includes('a1'), `attempt-id lekket i «${anker}»: ${l}`)
    assert.ok(!l.includes('Fredagsquiz'), `quiztittel i «${anker}»: ${l}`)
  }
})

// ── Grep-kontrakten ────────────────────────────────────────────────────────

test('ankrene er ren ASCII — grep skal ikke kreve æøå', async () => {
  await call()
  for (const anker of ['kjorte:', 'oppgjor:']) {
    assert.ok(/^[\x00-\x7F]*$/.test(anker), `ankeret er ikke ASCII: ${anker}`)
    assert.equal(logged.filter(l => l.includes(anker)).length, 1)
  }
})
