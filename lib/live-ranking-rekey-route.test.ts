// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av re-nøklingen på /api/quiz/live-ranking (22. august 2026):
// grensen skal nøkles på ATTEMPT-TOKEN når det finnes, ellers anon:<ip> —
// ikke lenger på `<ip>:<quizId>` alene. Grensen selv (30/60s, in-memory) er
// uendret; det er hvem som telles sammen som endres.
//
// MUTASJONSBEVIS
//   • Sett nøkkelen tilbake til `live-ranking:${ip}:${quizId}` (den gamle
//     formen), og «to forsøk bak SAMME IP deler ikke bøtte» ryker: kall 31
//     fra forsøk B blir 429 fordi forsøk A brukte opp kvoten.
//   • Fjern token-lesingen fra ruten (server ignorerer headeren), og samme
//     test ryker — alle havner da i anon-bøtta.
//   • Fjern anon-fallbacken (krev token), og «token-løst kall slipper
//     gjennom» ryker — en gammel fane under deploy ville fått 429/400.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Må settes FØR attempt-token brukes: signingKey() leser env ved hvert kall.
process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ATTEMPT_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

// ── Teller-mock: EKTE telling per nøkkel, så en 429 betyr at grensen bet ────
// Ingen vindus-utløp — testene er ferdige lenge før 60 s uansett, og uten
// klokke i bildet er tellingen deterministisk.
const counter: { counts: Map<string, number>; keys: string[] } = {
  counts: new Map(),
  keys: [],
}

mock.module('@/lib/rate-limit', {
  namedExports: {
    rateLimit: (key: string, limit: number) => {
      counter.keys.push(key)
      const n = (counter.counts.get(key) ?? 0) + 1
      counter.counts.set(key, n)
      return { success: n <= limit, remaining: Math.max(0, limit - n) }
    },
  },
})

// ── Snapshot-mock: én ferdig spiller, deterministisk plassering ─────────────
mock.module('@/lib/ranking-snapshot', {
  namedExports: {
    getOrBuildSnapshot: async () => [
      { id: 'ferdig-1', user_id: null, player_name: 'Ferdig', correct_answers: 5, total_time_ms: 60_000 },
    ],
    computePlacement: () => ({ rank: 1, total: 2, low: 1, high: 2, above: null, below: null }),
  },
})

const { GET } = await import('@/app/api/quiz/live-ranking/route')
const { createAttemptToken } = await import('@/lib/attempt-token')
const { LIVE_RANKING_RATE_LIMIT } = await import('@/lib/live-rate-limit')

function call(ip: string, opts: { attemptId?: string; token?: string | null } = {}) {
  const params = new URLSearchParams({
    quiz_id: QUIZ,
    current_correct: '3',
    current_time_ms: '30000',
    answered: '5',
    total: '15',
  })
  if (opts.attemptId) params.set('attemptId', opts.attemptId)
  return GET(new Request(`https://quizkanonen.no/api/quiz/live-ranking?${params}`, {
    headers: {
      'x-forwarded-for': ip,
      ...(opts.token ? { 'x-attempt-token': opts.token } : {}),
    },
  }) as never)
}

function tokenFor(attemptId: string): string {
  const t = createAttemptToken(attemptId, QUIZ)
  assert.ok(t)
  return t
}

beforeEach(() => {
  counter.counts.clear()
  counter.keys = []
})

// ── Krav 2: token-løse kall MÅ fungere (gammel fane under deploy) ───────────

test('token-løst kall faller til anon-nøkkelen og slipper gjennom', async () => {
  const res = await call('198.51.100.1')
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal((await res.json()).userRank, 1)
  assert.deepEqual(counter.keys, ['live-ranking:anon:198.51.100.1'])
})

// ── Kjernen: to forsøk deler ikke bøtte ─────────────────────────────────────

test('to ulike attemptId-er bak SAMME IP deler ikke bøtte', async () => {
  const IP = '198.51.100.2'
  // Forsøk A bruker opp HELE kvoten sin.
  for (let i = 0; i < LIVE_RANKING_RATE_LIMIT.limit; i++) {
    assert.equal((await call(IP, { attemptId: ATTEMPT_A, token: tokenFor(ATTEMPT_A) })).status, 200)
  }
  assert.equal(
    (await call(IP, { attemptId: ATTEMPT_A, token: tokenFor(ATTEMPT_A) })).status,
    429,
    'forsøk A skal selv være bremset — grensen er uendret og biter fortsatt',
  )

  // Forsøk B fra SAMME IP er upåvirket. Med den gamle IP-nøkkelen: 429.
  const b = await call(IP, { attemptId: ATTEMPT_B, token: tokenFor(ATTEMPT_B) })
  assert.equal(b.status, 200, 'kollegaen bak samme kontornett skal ha egen kvote')
  assert.ok(counter.keys.includes(`live-ranking:attempt:${ATTEMPT_A}`))
  assert.ok(counter.keys.includes(`live-ranking:attempt:${ATTEMPT_B}`))
})

// ── Krav 3: gjester har også token og skal ha egen bøtte ────────────────────

test('gjeste-forsøk med gyldig token får egen bøtte — påvirkes ikke av anon-flom', async () => {
  // Tokenet utstedes likt for gjester og innloggede (det vet ingenting om
  // brukere). Her: anon-bøtta for IP-en er full, men gjestens token-kall går
  // gjennom — beviset på at tokenet, ikke IP-en, er nøkkelen.
  const IP = '198.51.100.3'
  for (let i = 0; i < LIVE_RANKING_RATE_LIMIT.limit + 1; i++) await call(IP)
  assert.equal((await call(IP)).status, 429, 'positiv kontroll: anon-bøtta er full')

  const gjest = await call(IP, { attemptId: ATTEMPT_A, token: tokenFor(ATTEMPT_A) })
  assert.equal(gjest.status, 200, 'gjesten med token skal være upåvirket av anon-bøtta')
  assert.ok(counter.keys.includes(`live-ranking:attempt:${ATTEMPT_A}`))
})

// ── Uverifisert identitet gir ikke egen kvote ───────────────────────────────

test('påstått attemptId med UGYLDIG token havner i anon-bøtta', async () => {
  await call('198.51.100.4', { attemptId: ATTEMPT_A, token: 'ugyldig.token' })
  assert.deepEqual(counter.keys, ['live-ranking:anon:198.51.100.4'])
})

test('attemptId UTEN token havner i anon-bøtta', async () => {
  await call('198.51.100.5', { attemptId: ATTEMPT_A })
  assert.deepEqual(counter.keys, ['live-ranking:anon:198.51.100.5'])
})

// ── Krav 5: 429-loggen skreller det nye nøkkelformatet ──────────────────────

test('et 429 på attempt-nøkkelen logger markøren uten attempt-id og uten IP', async () => {
  const IP = '198.51.100.6'
  const ekteWarn = console.warn
  const linjer: unknown[][] = []
  console.warn = (...a: unknown[]) => { linjer.push(a) }
  try {
    for (let i = 0; i < LIVE_RANKING_RATE_LIMIT.limit + 1; i++) {
      await call(IP, { attemptId: ATTEMPT_A, token: tokenFor(ATTEMPT_A) })
    }
  } finally {
    console.warn = ekteWarn
  }

  const tekst = linjer
    .map(a => a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '))
    .join('\n')

  assert.match(tekst, /\[rate-limit\] TAK TRUFFET/, 'markøren må finnes i loggen')
  assert.match(tekst, /live-ranking/, 'ruten må kunne identifiseres')
  assert.ok(!tekst.includes(ATTEMPT_A), 'attempt-id skal skrelles av — skrellingen må ikke brekke')
  assert.ok(!tekst.includes(IP), 'IP skal aldri havne i loggen')
})
