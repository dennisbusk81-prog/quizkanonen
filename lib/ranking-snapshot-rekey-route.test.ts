// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av grensen på /api/quiz/[id]/ranking-snapshot (steg 3,
// 22. august 2026) — rutens FØRSTE rate-limit. Nøklet på attempt-token via
// liveRateLimitKey, ellers anon:<ip>. 60/60s, delt teller fra steg 4
// (rateLimitShared) — dimensjoneringen står forklart over
// RANKING_SNAPSHOT_RATE_LIMIT i lib/live-rate-limit.ts.
//
// MUTASJONSBEVIS
//   • Fjern rateLimit-blokken fra ruten, og «kall 61 fra samme forsøk blir
//     429» ryker — ruten er da tilbake i før-tilstanden uten grense.
//   • Nøkle på IP i stedet for token, og «to attemptId-er bak SAMME IP deler
//     ikke bøtte» ryker.
//   • Fjern anon-fallbacken, og «token-løst kall slipper gjennom» ryker —
//     en gammel fane under deploy ville mistet rank-pillen.
//   • Fjern logRateLimitHit-kallet, og loggtesten ryker — da er en for lav
//     grense usynlig, som er nettopp feilklassen loggen finnes for.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Må settes FØR attempt-token brukes: signingKey() leser env ved hvert kall.
process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ATTEMPT_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

// ── Teller-mock: EKTE telling per nøkkel, så en 429 betyr at grensen bet ────
// Mocket på rate-limit-SHARED etter steg 4 (delt teller): ruten kaller nå
// rateLimitShared, og nøklene som havner her er nøyaktig de som ville gått
// til Upstash.
const counter: { counts: Map<string, number>; keys: string[] } = {
  counts: new Map(),
  keys: [],
}

mock.module('@/lib/rate-limit-shared', {
  namedExports: {
    rateLimitShared: async (key: string, limit: number) => {
      counter.keys.push(key)
      const n = (counter.counts.get(key) ?? 0) + 1
      counter.counts.set(key, n)
      return { success: n <= limit, remaining: Math.max(0, limit - n) }
    },
    SHARED_RATE_LIMIT_TIMEOUT_MS: 1000,
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

// ── Nye avhengigheter etter premium-/blokkert-gaten (P-2, 23. august 2026) ──
// Ruten slår opp quizzes.season_points_awarded (til blokkert-gaten) og kaller
// filterSnapshotToPublic. Begge mockes bort her: denne filen beviser
// RATE-LIMIT-nøklingen, ikke gatene — de har egne testfiler.
mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: () => {
        const b = {
          select() { return b },
          eq() { return b },
          async maybeSingle() { return { data: { season_points_awarded: false } } },
        }
        return b
      },
    },
  },
})

mock.module('@/lib/public-snapshot', {
  namedExports: {
    // Gjennomslipp: ingen blokkerte i denne filen.
    filterSnapshotToPublic: async (_quizId: string, snapshot: unknown[]) => ({
      snapshot, publicSnapshot: snapshot, blocked: new Set(),
    }),
  },
})

const { GET } = await import('@/app/api/quiz/[id]/ranking-snapshot/route')
const { createAttemptToken } = await import('@/lib/attempt-token')
const { RANKING_SNAPSHOT_RATE_LIMIT } = await import('@/lib/live-rate-limit')

function call(ip: string, opts: { attemptId?: string; token?: string | null } = {}) {
  const params = new URLSearchParams({
    question: '4',
    correct: '3',
    time: '30000',
    answered: '5',
    total: '15',
  })
  if (opts.attemptId) params.set('attemptId', opts.attemptId)
  return GET(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ}/ranking-snapshot?${params}`, {
      headers: {
        'x-forwarded-for': ip,
        ...(opts.token ? { 'x-attempt-token': opts.token } : {}),
      },
    }) as never,
    { params: Promise.resolve({ id: QUIZ }) } as never,
  )
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

// ── Krav 3: token-løse kall MÅ fungere (gammel fane under deploy) ───────────

test('token-løst kall slipper gjennom på anon-nøkkelen — med spenn, uten eksakt rank', async () => {
  const res = await call('198.51.100.1')
  assert.equal(res.status, 200, await res.clone().text())
  const j = await res.json()
  // Uten token finnes ingen premium-påstand å tro på, så `rank` er gatet bort
  // (P-2, 23. august 2026). Det er ikke et avslag: spennet kommer som før, og
  // rank-pillen tegner «#1–2» i stedet for «#1».
  assert.equal(j.rank, null)
  assert.equal(j.low, 1)
  assert.equal(j.high, 2)
  assert.equal(j.total, 2)
  assert.deepEqual(counter.keys, ['ranking-snapshot:anon:198.51.100.1'])
})

// ── Kjernen: to forsøk deler ikke bøtte ─────────────────────────────────────

test('to ulike attemptId-er bak SAMME IP deler ikke bøtte', async () => {
  const IP = '198.51.100.2'
  // Forsøk A bruker opp HELE kvoten sin.
  for (let i = 0; i < RANKING_SNAPSHOT_RATE_LIMIT.limit; i++) {
    assert.equal((await call(IP, { attemptId: ATTEMPT_A, token: tokenFor(ATTEMPT_A) })).status, 200)
  }
  assert.equal(
    (await call(IP, { attemptId: ATTEMPT_A, token: tokenFor(ATTEMPT_A) })).status,
    429,
    'kall 61 fra samme forsøk skal avvises — grensen finnes faktisk',
  )

  // Forsøk B fra SAMME IP er upåvirket.
  const b = await call(IP, { attemptId: ATTEMPT_B, token: tokenFor(ATTEMPT_B) })
  assert.equal(b.status, 200, 'kollegaen bak samme kontornett skal ha egen kvote')
  assert.ok(counter.keys.includes(`ranking-snapshot:attempt:${ATTEMPT_A}`))
  assert.ok(counter.keys.includes(`ranking-snapshot:attempt:${ATTEMPT_B}`))
})

// ── Krav 4: gjester har også token og skal ha egen bøtte ────────────────────

test('gjeste-token får egen bøtte — påvirkes ikke av full anon-bøtte', async () => {
  // fetchLiveRank har ingen login-sjekk: gjester kaller denne ruten etter
  // hvert svar, og tokenet deres utstedes likt med innloggedes.
  const IP = '198.51.100.3'
  for (let i = 0; i < RANKING_SNAPSHOT_RATE_LIMIT.limit + 1; i++) await call(IP)
  assert.equal((await call(IP)).status, 429, 'positiv kontroll: anon-bøtta er full')

  const gjest = await call(IP, { attemptId: ATTEMPT_A, token: tokenFor(ATTEMPT_A) })
  assert.equal(gjest.status, 200, 'gjesten med token skal være upåvirket av anon-bøtta')
  assert.ok(counter.keys.includes(`ranking-snapshot:attempt:${ATTEMPT_A}`))
})

// ── Uverifisert identitet gir ikke egen kvote ───────────────────────────────

test('påstått attemptId med UGYLDIG token havner i anon-bøtta', async () => {
  await call('198.51.100.4', { attemptId: ATTEMPT_A, token: 'ugyldig.token' })
  assert.deepEqual(counter.keys, ['ranking-snapshot:anon:198.51.100.4'])
})

// ── Krav 5: 429 logger markøren, uten attempt-id og uten IP ─────────────────

test('et 429 logger TAK TRUFFET uten attempt-id og uten IP', async () => {
  const IP = '198.51.100.5'
  const ekteWarn = console.warn
  const linjer: unknown[][] = []
  console.warn = (...a: unknown[]) => { linjer.push(a) }
  try {
    for (let i = 0; i < RANKING_SNAPSHOT_RATE_LIMIT.limit + 1; i++) {
      await call(IP, { attemptId: ATTEMPT_A, token: tokenFor(ATTEMPT_A) })
    }
  } finally {
    console.warn = ekteWarn
  }

  const tekst = linjer
    .map(a => a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '))
    .join('\n')

  assert.match(tekst, /\[rate-limit\] TAK TRUFFET/, 'markøren må finnes i loggen')
  assert.match(tekst, /ranking-snapshot/, 'ruten må kunne identifiseres')
  assert.ok(!tekst.includes(ATTEMPT_A), 'attempt-id skal skrelles av')
  assert.ok(!tekst.includes(IP), 'IP skal aldri havne i loggen')
})

// ── Grensen er den vedtatte: 60 per 60 sekunder ─────────────────────────────

test('grensen er 60 per 60 sekunder — vedtatt fra målingen 21. aug, ikke gjettet', async () => {
  assert.equal(RANKING_SNAPSHOT_RATE_LIMIT.limit, 60)
  assert.equal(RANKING_SNAPSHOT_RATE_LIMIT.windowMs, 60_000)
})
