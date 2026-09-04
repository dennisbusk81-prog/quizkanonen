// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// N-14 (5. september 2026): observerbarheten i cron/award-season-points.
//
// Ruten logget kun når noe skjedde. Normalveien («ingenting å gjøre») var
// taus, og da kan stillhet bety tre ting — kjørte og fant ingenting, kjørte
// ikke, eller logget uten å bli fanget. Og det var denne ruta som faktisk
// gjorde opp 4. september 22:00:36 UTC, ikke publish-quiz. Denne testen
// feller at den ubetingede linja finnes fra BEGGE utgangene, og at tallene i
// den faktisk følger utfallet.
//
// TESTEN MÅLER TALLENE, IKKE BARE AT DET LOGGES. En test som kun sjekket «en
// linje ble skrevet» ville forblitt grønn om alle tellerne sto på 0 — nøyaktig
// tilstanden saken handler om.
//
// MUTASJONSBEVIS (kjørt, ikke antatt — se øktrapporten):
//   - fjernes loggOppgjor(0, 0, 0) fra tom-grenen → «ingenting å gjøre» ryker.
//   - fjernes loggOppgjor(...) før den siste returen → «gjorde opp» og
//     «feil» ryker.
//   - fryses rader= til 0 i malen → «gjorde opp: rader teller radene» ryker.
//   - fryses quizer= til 0 → «gjorde opp» og «feil» ryker.
//   - fryses feil= til 0 → «feil telles» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

type QuizRow = {
  id: string; title: string; closes_at: string
  season_points_awarded: boolean
  is_test: boolean | null
  quiz_type: string
  is_active: boolean
}

// rowsFor: quiz-id → radtall processQuiz skal rapportere. failFor: quiz-id →
// feilmelding. quizError: feil på selve oppslaget.
const db: {
  quizzes: QuizRow[]
  rowsFor: Map<string, number>
  failFor: Map<string, string>
  quizError: string | null
} = { quizzes: [], rowsFor: new Map(), failFor: new Map(), quizError: null }

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

mock.module('@/lib/award-season-points', {
  namedExports: {
    processQuiz: async (quizId: string) => {
      const failure = db.failFor.get(quizId)
      return failure
        ? { rows: 0, error: failure }
        : { rows: db.rowsFor.get(quizId) ?? 1, error: null }
    },
  },
})

function builder(table: string) {
  if (table !== 'quizzes') throw new Error(`ukjent tabell i mock: ${table}`)
  const eqs: Record<string, unknown> = {}
  let ltCol: string | null = null, ltVal: string | null = null
  let limitN: number | null = null
  const preds: ((q: QuizRow) => boolean)[] = []
  const val = (q: QuizRow, col: string) => (q as unknown as Record<string, unknown>)[col]

  const rows = (): QuizRow[] => {
    let out = db.quizzes.filter(q => {
      for (const [k, v] of Object.entries(eqs)) if (val(q, k) !== v) return false
      if (ltCol && ltVal !== null && String(val(q, ltCol)) >= ltVal) return false
      return preds.every(p => p(q))
    })
    out = [...out].sort((a, b) => a.closes_at.localeCompare(b.closes_at))
    if (limitN !== null) out = out.slice(0, limitN)
    return out
  }

  const b = {
    select() { return b },
    eq(col: string, v: unknown) { eqs[col] = v; return b },
    lt(col: string, v: string) { ltCol = col; ltVal = v; return b },
    not(col: string, op: string, v: unknown) {
      assert.equal(op, 'is', 'mocken kjenner kun .not(col, "is", verdi)')
      preds.push(q => val(q, col) !== v)
      return b
    },
    in(col: string, values: readonly unknown[]) { preds.push(q => values.includes(val(q, col))); return b },
    order() { return b },
    limit(n: number) { limitN = n; return b },
    then(resolve: (v: unknown) => void) {
      if (db.quizError) return resolve({ data: null, error: { message: db.quizError } })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (t: string) => builder(t) } },
})

const { GET } = await import('@/app/api/cron/award-season-points/route')

// Fanger console.log for den ene kjøringen. console.error slippes gjennom —
// testene måler INFO-sporet.
const logged: string[] = []
const call = async () => {
  const ekte = console.log
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  try {
    return await GET(new Request('https://quizkanonen.no/api/cron/award-season-points', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }) as never)
  } finally {
    console.log = ekte
  }
}

const ANKER = '[cron/award-season-points] oppgjor:'

// Nøyaktig ÉN linje per kjøring: to summeringer ville gjort tallene tvetydige,
// null er hullet saken handler om.
const linje = (): string => {
  const treff = logged.filter(l => l.includes(ANKER))
  assert.equal(treff.length, 1,
    `forventet nøyaktig én linje med «${ANKER}», fikk ${treff.length}:\n${logged.join('\n')}`)
  return treff[0]
}
const felt = (nokkel: string): number => {
  const m = new RegExp(`\\b${nokkel}=(\\d+)`).exec(linje())
  assert.ok(m, `fant ikke «${nokkel}=» i linja: ${linje()}`)
  return Number(m[1])
}

const quiz = (over: Partial<QuizRow> = {}): QuizRow => ({
  id: 'q1', title: 'Fredagsquiz', closes_at: minutesAgo(30),
  season_points_awarded: false, is_test: false, quiz_type: 'weekly', is_active: true,
  ...over,
})

beforeEach(() => {
  db.quizzes = []
  db.rowsFor = new Map()
  db.failFor = new Map()
  db.quizError = null
  logged.length = 0
})

test('ingenting å gjøre: linja fyrer likevel, med rene nuller', async () => {
  // Hele poenget: et nulltall som er SKREVET, ikke et fravær som må tolkes.
  const res = await call()
  assert.equal(res.status, 200)
  assert.equal(felt('quizer'), 0)
  assert.equal(felt('rader'), 0)
  assert.equal(felt('feil'), 0)
})

test('gjorde opp: quizer og rader teller det som faktisk ble skrevet', async () => {
  db.quizzes = [quiz(), quiz({ id: 'q2', closes_at: minutesAgo(10) })]
  db.rowsFor.set('q1', 42)
  db.rowsFor.set('q2', 18)
  const res = await call()
  assert.equal(res.status, 200)
  assert.equal(felt('quizer'), 2)
  assert.equal(felt('rader'), 60, 'rader skal være SUMMEN over batchen, ikke siste quiz')
  assert.equal(felt('feil'), 0)
})

test('feil telles — og quizer teller den feilede som forsøkt', async () => {
  db.quizzes = [quiz(), quiz({ id: 'q2', closes_at: minutesAgo(10) })]
  db.rowsFor.set('q1', 7)
  db.failFor.set('q2', 'upstream request timeout')
  const res = await call()
  assert.equal(res.status, 503, 'forutsetning: en feilet quiz gir 503 (uendret oppførsel)')
  assert.equal(felt('quizer'), 2)
  assert.equal(felt('rader'), 7)
  assert.equal(felt('feil'), 1)
})

test('feil på selve oppslaget: ingen oppgjor-linje — error-linja er signalet', async () => {
  // En «oppgjor: quizer=0» her ville sett ut som en frisk kjøring med
  // ingenting å gjøre. Grenen har sin egen console.error og svarer 503.
  db.quizError = '521: Web server is down'
  const res = await call()
  assert.equal(res.status, 503)
  assert.equal(logged.filter(l => l.includes(ANKER)).length, 0)
})

test('linja bærer kun tall — ingen titler, ingen id-er', async () => {
  db.quizzes = [quiz({ id: 'deadbeef-0000-1111-2222-333333333333', title: 'Fredagsquiz uke 36' })]
  await call()
  const l = linje()
  assert.ok(!l.includes('Fredagsquiz'), `quiztittel i linja: ${l}`)
  assert.ok(!l.includes('deadbeef'), `quiz-id i linja: ${l}`)
})

test('prefiks og nøkler er ASCII og deler form med publish-quiz', async () => {
  await call()
  const l = linje()
  assert.ok(/^\[cron\/award-season-points\] oppgjor: /.test(l), `uventet prefiks: ${l}`)
  assert.ok(/^[\x00-\x7F]*$/.test(l), `linja er ikke ren ASCII: ${l}`)
  // Samme anker som publish-quiz (32a7c7b): `grep "oppgjor:"` treffer begge.
  assert.ok(l.includes(' oppgjor: '))
})
