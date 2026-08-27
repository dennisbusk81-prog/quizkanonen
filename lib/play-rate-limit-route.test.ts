// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av funn F1 (5. august 2026): rate-limiten på spillestien
// skal nøkles på BRUKER, ikke på IP-adresse.
//
// Feilen testene finnes for: `start-attempt` og `submit` nøklet på
// `x-forwarded-for` alene, 20 per 10 minutter. Så lenge telleren lå per
// serverless-instans var grensen i praksis uendelig; da den ble delt via
// Upstash samme dag, ble den reell — og et kontornett (Elkjøp Nordic, 29
// medlemmer) eller en mobiloperatørs CGNAT-pool deler ÉN adresse. Spiller 21
// og utover fikk hard 429 og så en side som virket ødelagt.
//
// MUTASJONSBEVIS — begge rutene
//   • Sett nøkkelen tilbake til `${route}:${ip}` (den gamle formen), og
//     «29 kolleger bak samme IP …» ryker: kall nr. 21 blir 429.
//   • Flytt rateLimitShared-kallet TILBAKE til før token-oppslaget, og
//     «nøkkelen bærer bruker-id …» ryker: userId er da alltid null og alle
//     havner i anon-bøtta.
//   • Fjern anon-grenen (nøkle alltid på userId, som blir null uten token), og
//     «to anonyme bak samme IP deler kvote» ryker — den flaten ville da hatt
//     ÉN delt bøtte for alle anonyme på tvers av hele internett, som er verre,
//     ikke bedre.
//   • Fjern lag 1 (in-memory-bremsen), og «lag 1 stopper en flom av
//     søppel-tokens …» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Må settes FØR attempt-token brukes: signingKey() leser env ved hvert kall.
process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const Q1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const Q2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const FOR_LENGE_SIDEN = () => new Date(Date.now() - 3 * 60_000).toISOString()
const OM_EN_TIME = () => new Date(Date.now() + 3_600_000).toISOString()
const FOR_EN_TIME_SIDEN = () => new Date(Date.now() - 3_600_000).toISOString()

// ── Delt teller-mock: EKTE telling, så en 429 betyr at grensen faktisk bet ──
const shared: {
  counts: Map<string, number>
  keys: string[]
} = { counts: new Map(), keys: [] }

mock.module('@/lib/rate-limit-shared', {
  namedExports: {
    rateLimitShared: async (key: string, limit: number) => {
      shared.keys.push(key)
      const n = (shared.counts.get(key) ?? 0) + 1
      shared.counts.set(key, n)
      return { success: n <= limit, remaining: Math.max(0, limit - n) }
    },
    SHARED_RATE_LIMIT_TIMEOUT_MS: 1000,
  },
})

// ── Supabase-mock ───────────────────────────────────────────────────────────
// Bruker-id-en utledes av tokenet, slik at hver «kollega» kan ha sitt eget.
// Tokenet 'ugyldig' gir null bruker — samme som et utløpt/forfalsket token.
// `attemptInserts` teller INSERT mot attempts. Statuskoden alene beviser ikke
// at gjeste-veien er stengt — det er fraværet av RADEN som er kravet.
const state: { attemptUserId: string | null; attemptInserts: number } =
  { attemptUserId: null, attemptInserts: 0 }

function attemptsBuilder() {
  const calls = { not: false, is: false, insert: false, update: false }
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    not() { calls.not = true; return b },
    is() { calls.is = true; return b },
    order() { return b },
    limit() { return b },
    insert() { calls.insert = true; state.attemptInserts++; return b },
    update() { calls.update = true; return b },
    async maybeSingle() {
      // start-attempt: replay-sjekk (.not) og gjenopptak-sjekk (.is) → ingen rad.
      if (calls.not || calls.is) return { data: null, error: null }
      // submit: selve attempt-raden.
      return {
        data: {
          id: ATTEMPT, quiz_id: QUIZ, user_id: state.attemptUserId,
          correct_answers: 0, submitted_at: null, completed_at: FOR_LENGE_SIDEN(),
        },
        error: null,
      }
    },
    async single() { return { data: { id: ATTEMPT }, error: null } },
    then(resolve: (v: unknown) => void) {
      // submit sin UPDATE → én oppdatert rad (vinneren av race-vakten).
      if (calls.update) return resolve({ data: [{ id: ATTEMPT }], error: null })
      return resolve({ data: [], error: null })
    },
  }
  return b
}

function simpleBuilder(table: string) {
  const b: Record<string, unknown> = {
    select() { return b },
    eq() { return b },
    in() { return b },
    is() { return b },
    order() { return b },
    limit() { return b },
    insert() { return b },
    update() { return b },
    async maybeSingle() {
      if (table === 'profiles') return { data: { suspended_until: null }, error: null }
      if (table === 'quizzes') {
        return {
          data: { id: QUIZ, is_active: true, opens_at: FOR_EN_TIME_SIDEN(), closes_at: OM_EN_TIME(), time_limit_seconds: 30 },
          error: null,
        }
      }
      return { data: null, error: null }
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'questions') {
        return resolve({
          // start-attempt bruker count; submit bruker data (fasiten).
          count: 2,
          data: [
            { id: Q1, correct_answer: 'A', correct_answers: null, time_limit_seconds: 30 },
            { id: Q2, correct_answer: 'B', correct_answers: null, time_limit_seconds: 30 },
          ],
          error: null,
        })
      }
      return resolve({ data: [], error: null, count: 0 })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async (token: string) => (
          token && token !== 'ugyldig'
            ? { data: { user: { id: `user-${token}` } }, error: null }
            : { data: { user: null }, error: { message: 'ugyldig token' } }
        ),
      },
      from: (table: string) => (table === 'attempts' ? attemptsBuilder() : simpleBuilder(table)),
    },
  },
})

const { POST: startAttempt } = await import('@/app/api/quiz/start-attempt/route')
const { POST: submit } = await import('@/app/api/quiz/[id]/submit/route')
const { createAttemptToken } = await import('@/lib/attempt-token')
const { PLAY_RATE_LIMIT, PLAY_PRE_AUTH_BURST } = await import('@/lib/play-rate-limit')

function start(ip: string, token: string | null) {
  return startAttempt(new Request('https://quizkanonen.no/api/quiz/start-attempt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ quizId: QUIZ, playerName: 'Spiller' }),
  }) as never)
}

function send(ip: string, token: string | null) {
  state.attemptUserId = token && token !== 'ugyldig' ? `user-${token}` : null
  return submit(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        'x-attempt-token': createAttemptToken(ATTEMPT, QUIZ) ?? '',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        attemptId: ATTEMPT,
        answers: [
          { questionId: Q1, selectedAnswer: 'A', timeMs: 5000 },
          { questionId: Q2, selectedAnswer: 'C', timeMs: 5000 },
        ],
      }),
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  )
}

beforeEach(() => {
  shared.counts.clear()
  shared.keys = []
  state.attemptUserId = null
  state.attemptInserts = 0
})

// ── Positiv kontroll: rutene virker i det hele tatt i denne riggen ──────────

test('positiv kontroll: en innlogget spiller kommer gjennom begge rutene', async () => {
  const s = await start('198.51.100.1', 'anna')
  assert.equal(s.status, 200, await s.clone().text())
  assert.equal((await s.json()).attemptId, ATTEMPT)

  const r = await send('198.51.100.1', 'anna')
  assert.equal(r.status, 200, await r.clone().text())
  assert.equal((await r.json()).correctAnswers, 1, 'A er riktig på Q1, C er feil på Q2')
})

// ── KJERNEN I F1 ────────────────────────────────────────────────────────────

test('29 kolleger bak SAMME IP kan alle starte — ingen spiser hverandres kvote', async () => {
  // Elkjøp Nordic. Med den gamle IP-nøkkelen ville nr. 21 fått 429.
  const IP = '198.51.100.20'
  for (let i = 1; i <= 29; i++) {
    const res = await start(IP, `kollega-${i}`)
    assert.equal(res.status, 200, `kollega ${i} ble avvist (status ${res.status})`)
  }
  assert.equal(new Set(shared.keys).size, 29, 'hver kollega skal ha sin egen bøtte')
})

test('29 kolleger bak SAMME IP kan alle levere — samme regel på submit', async () => {
  const IP = '198.51.100.21'
  for (let i = 1; i <= 29; i++) {
    const res = await send(IP, `kollega-${i}`)
    assert.equal(res.status, 200, `kollega ${i} ble avvist (status ${res.status})`)
  }
  assert.equal(new Set(shared.keys).size, 29)
})

test('nøkkelen bærer bruker-id, ikke IP, når tokenet er gyldig', async () => {
  await start('198.51.100.30', 'anna')
  await send('198.51.100.30', 'anna')

  assert.deepEqual(shared.keys, ['start-attempt:user:user-anna', 'submit:user:user-anna'])
  for (const k of shared.keys) {
    assert.ok(!k.includes('198.51.100.30'), 'IP skal ikke være med når vi har en bruker')
  }
})

// ── Grensen bíter fortsatt der den skal ─────────────────────────────────────

test('ÉN bruker som maler mot start-attempt blir fortsatt stoppet på grensen', async () => {
  const IP = '198.51.100.40'
  for (let i = 0; i < PLAY_RATE_LIMIT.limit; i++) {
    assert.equal((await start(IP, 'anna')).status, 200, `kall ${i + 1} skulle gått gjennom`)
  }
  const over = await start(IP, 'anna')
  assert.equal(over.status, 429, 'kall nr. 21 fra SAMME bruker skal avvises')
})

test('ÉN bruker som maler mot submit blir fortsatt stoppet på grensen', async () => {
  const IP = '198.51.100.41'
  for (let i = 0; i < PLAY_RATE_LIMIT.limit; i++) {
    assert.equal((await send(IP, 'anna')).status, 200)
  }
  assert.equal((await send(IP, 'anna')).status, 429)
})

test('en stoppet bruker stopper IKKE naboen på samme nett', async () => {
  const IP = '198.51.100.42'
  for (let i = 0; i < PLAY_RATE_LIMIT.limit + 1; i++) await start(IP, 'anna')

  const nabo = await start(IP, 'bjorn')
  assert.equal(nabo.status, 200, 'Bjørn skal være upåvirket av at Anna er bremset')
})

// ── Anon-flaten: STENGT 24. august 2026 ─────────────────────────────────────
//
// Her sto tidligere to tester som slo fast at anonyme kall til start-attempt
// gikk gjennom (200) og delte en IP-bøtte. Gjeste-veien er nå stengt, og
// vakten står FØR lag 2 — så påstanden er ikke bare «annen statuskode», den
// er en annen form: kallet når aldri den delte telleren.

test('en uinnlogget kaller avvises med 401 — og oppretter ingen attempt-rad', async () => {
  // Selve bestillingen. En gjeste-rad (user_id NULL) står utenfor BÅDE
  // replay-sperren og unik-indeksen, altså de to vernene som gjelder alle
  // andre. Statuskoden alene beviser ingenting; det er FRAVÆRET av raden som
  // er kravet, derfor asserter vi på sideeffekten.
  const res = await start('198.51.100.50', null)
  assert.equal(res.status, 401, await res.clone().text())
  const body = await res.json()
  assert.equal(body.needsLogin, true, 'klienten skiller 401 fra andre feil på dette feltet')
  assert.equal(state.attemptInserts, 0, 'ingen rad skal opprettes for en uinnlogget')
})

test('en uinnlogget spiser IKKE av den delte kvoten til de innloggede', async () => {
  // Vakten står foran lag 2 med vilje. To grunner, begge reelle:
  // pengene (en forespørsel vi alltid avviser skal ikke koste en
  // Upstash-rundtur) og rettferdigheten — anon-bøtta er nøklet på IP, og
  // 29 Elkjøp-kolleger deler én. Sto vakten BAK telleren, kunne uinnlogget
  // støy låst ute et helt kontor. Lag 1 (in-memory, 120/min per IP) demper
  // flommen i stedet.
  const IP = '198.51.100.55'
  for (let i = 0; i < PLAY_RATE_LIMIT.limit + 1; i++) {
    assert.equal((await start(IP, null)).status, 401)
  }
  assert.deepEqual(shared.keys, [], 'anonyme kall skal aldri nå den delte telleren')
})

test('et UGYLDIG token avvises som uinnlogget — ingen bruker-bøtte, ingen anon-bøtte', async () => {
  // Poenget som består: en angriper skal ikke kunne rotere PÅSTÅTTE bruker-id-er
  // for uendelig kvote. Svaret var tidligere «ugyldig token havner i anon-bøtta»;
  // nå er det sterkere — kallet slipper aldri forbi innloggingsvakten.
  const res = await start('198.51.100.51', 'ugyldig')
  assert.equal(res.status, 401)
  assert.deepEqual(shared.keys, [])
  assert.equal(state.attemptInserts, 0)
})

// ── Lag 1: burst-bremsen foran token-oppslaget ──────────────────────────────

// ── 429 skal etterlate et SPOR (5. august 2026) ─────────────────────────────

test('et 429 fra ruten logger den søkbare markøren — uten IP og uten bruker-id', async () => {
  // Ikke nok at lib/rate-limit-log virker isolert: her bevises at rutene
  // faktisk KALLER den. Et 429 var tidligere helt sporløst — ingen
  // Sentry-hendelse (en returnert 429 er ikke et kast) og ingen logglinje.
  const IP = '198.51.100.70'
  const ekteWarn = console.warn
  const linjer: unknown[][] = []
  console.warn = (...a: unknown[]) => { linjer.push(a) }
  try {
    for (let i = 0; i < PLAY_RATE_LIMIT.limit + 1; i++) await start(IP, 'anna')
  } finally {
    console.warn = ekteWarn
  }

  const tekst = linjer
    .map(a => a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '))
    .join('\n')

  assert.match(tekst, /\[rate-limit\] TAK TRUFFET/, 'markøren må finnes i loggen')
  assert.match(tekst, /start-attempt/, 'ruten må kunne identifiseres')
  assert.match(tekst, /"innlogget":true/, 'en avvist INNLOGGET spiller er det alarmerende tilfellet')
  assert.ok(!tekst.includes(IP), 'IP skal aldri havne i loggen')
  assert.ok(!tekst.includes('user-anna'), 'bruker-id skal aldri havne i loggen')
})

test('lag 1 stopper en flom av søppel-tokens før den når den delte telleren', async () => {
  // Lag 1 er in-memory og teller ALLE forespørsler fra IP-en, også de som
  // aldri får en gyldig bruker. Uten det ville hvert søppel-token kostet et
  // GoTrue-oppslag helt ubremset.
  const IP = '198.51.100.60'
  let seen429 = false
  for (let i = 0; i < PLAY_PRE_AUTH_BURST.limit + 5; i++) {
    const res = await start(IP, 'ugyldig')
    if (res.status === 429) { seen429 = true; break }
  }
  assert.ok(seen429, 'lag 1 skal bite selv om lag 2 aldri nås')
})
