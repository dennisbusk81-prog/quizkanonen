// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte POST /api/tilfeldig-quiz. Kun supabase-admin er
// mocket (med en REGISTRERENDE query-builder + rpc) — ruten, lib/premium-check,
// lib/generated-quiz-rules, lib/generated-quiz-pool, lib/archive-create-rules,
// lib/archive-copy og lib/archive-copy-write kjøres uendret. Samme mal som
// lib/arkiv-create-route.test.ts.
//
// KVOTEN ER PENGELOGIKK. De harde kravene er formulert som «hvilke skrivinger
// skjedde, mot hva, i hvilken rekkefølge» — et avslag skal etterlate NULL
// skrivinger, og en godkjenning skal etterlate nøyaktig fem (quiz, spørsmål,
// aktivering, kildebump, ledger) i den rekkefølgen.
//
// MUTASJONSBEVIS (kjørt 8. september 2026 på STAGEDE filer, hver mutasjon
// verifisert med `git diff` FØR testresultatet ble tolket, og revertert):
//   • fjern `if (!decision.allowed) return ...` i ruten
//                                    → kvote-429, kategori-403 og plan-503-testene røde
//   • fjern `used >= quota`-grenen i lib/generated-quiz-rules
//                                    → kvote-429-testene røde (gratis OG premium)
//   • fjern kategorisperren i lib/generated-quiz-rules
//                                    → «gratis med kategori»-testen rød
//   • `!input.premium.ok` → `false` i lib/generated-quiz-rules
//                                    → plan-503-testen rød (og «vet ikke» ble gratis)
//   • ignorer countError i ruten     → telling-503-testen rød
//   • fjern rpc-kallet               → kildebump-testene røde
//   • flytt ledger-insertet FORAN writeArchiveCopy
//                                    → rekkefølge-asserten + «avslått quiz koster
//                                      ikke kule»-testen røde
//   • sett `allowBankRows: false` i ruten → alle 201-testene røde (403 fra gaten)
//   • sett `sourceQuizId: FORELDER`  → source_quiz_id-asserten rød
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

import { osloMonthStartUtcIso } from '@/lib/oslo-time'
import {
  GENERATED_QUIZ_QUESTION_COUNT,
  GENERATED_QUIZ_TITLE,
  GENERATION_QUOTA,
} from '@/lib/generated-quiz-rules'

const ME = '11111111-1111-4111-8111-111111111111'
const NEW_QUIZ = 'ffffffff-9999-4999-8999-ffffffffffff'
const FORELDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/** 15 bank-id-er med distinkte verdier — puljen er nøyaktig stor nok, så
 *  trekningen (Math.random i ruten) alltid gir de samme 15, i tilfeldig
 *  rekkefølge. Da kan testene assert-e på SETTET uten å mocke RNG-en. */
const BANK_IDS = Array.from(
  { length: GENERATED_QUIZ_QUESTION_COUNT },
  (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`
)

type Op = {
  table: string
  action: 'select' | 'insert' | 'update' | 'delete' | null
  payload?: unknown
  filters: { method: string; args: unknown[] }[]
}
type RpcCall = { fn: string; args: unknown }

type ProfileRow = {
  premium_status: boolean
  org_premium_grace_until: string | null
  personal_grace_until: string | null
}

const state = {
  profile: null as ProfileRow | null,
  premiumLookupFails: false,
  authFails: false,
  generationCount: 0,
  countFails: false,
  bankIds: [] as string[],
  poolFails: false,
  sourceRows: [] as Record<string, unknown>[],
  questionsInsertFails: false,
  bumpFails: false,
  ledgerFails: false,
  ops: [] as Op[],
  rpcs: [] as RpcCall[],
}

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    premium_status: false,
    org_premium_grace_until: null,
    personal_grace_until: null,
    ...overrides,
  }
}

/** Kilderad per bank-id — biblioteksform: quiz_id NULL, quiz NULL (embed). */
function bankRad(id: string, i: number): Record<string, unknown> {
  return {
    id,
    quiz_id: null,
    question_text: `Spørsmål nr. ${i}?`,
    option_a: `A${i}`,
    option_b: `B${i}`,
    // Annenhver rad er et to-alternativ-spørsmål (58 av bankradene er det).
    option_c: i % 2 === 0 ? `C${i}` : null,
    option_d: i % 2 === 0 ? `D${i}` : null,
    correct_answer: 'A',
    correct_answers: null,
    explanation: null,
    category: 'Sport',
    time_limit_seconds: null,
    shuffle_options: true,
    quiz: null,
  }
}

function resolveOp(op: Op): Record<string, unknown> {
  if (op.table === 'profiles') {
    return state.premiumLookupFails
      ? { data: null, error: { message: 'simulert DB-feil' } }
      : { data: state.profile, error: null }
  }
  if (op.table === 'quiz_generations' && op.action === 'select') {
    return state.countFails
      ? { count: null, error: { message: 'simulert tellefeil' } }
      : { count: state.generationCount, error: null }
  }
  if (op.table === 'quiz_generations' && op.action === 'insert') {
    return { error: state.ledgerFails ? { message: 'simulert ledgerfeil' } : null }
  }
  if (op.table === 'quizzes' && op.action === 'select') {
    // Puljens quizzes-spørring: ingen stengte quizer i fixturen — puljen er
    // biblioteket alene (playedOps tom), så id-settet er forutsigbart.
    return state.poolFails
      ? { data: null, error: { message: 'simulert lesefeil' } }
      : { data: [], error: null }
  }
  if (op.table === 'questions' && op.action === 'select') {
    const erBank = op.filters.some((f) => f.method === 'is' && f.args[0] === 'quiz_id')
    if (erBank) {
      return state.poolFails
        ? { data: null, error: { message: 'simulert lesefeil' } }
        : { data: state.bankIds.map((id) => ({ id })), error: null }
    }
    // Kildelesingen: .in('id', <trukne id-er>) — svar kun med de bestilte.
    const inFilter = op.filters.find((f) => f.method === 'in' && f.args[0] === 'id')
    const bestilt = new Set((inFilter?.args[1] as string[]) ?? [])
    return { data: state.sourceRows.filter((r) => bestilt.has(r.id as string)), error: null }
  }
  if (op.table === 'quizzes' && op.action === 'insert') return { data: { id: NEW_QUIZ }, error: null }
  if (op.table === 'questions' && op.action === 'insert') {
    return { error: state.questionsInsertFails ? { message: 'simulert insert-feil' } : null }
  }
  if (op.table === 'quizzes' && op.action === 'update') return { error: null }
  if (op.table === 'quizzes' && op.action === 'delete') return { error: null }
  if (op.table === 'questions' && op.action === 'delete') return { error: null }
  throw new Error(`uventet operasjon i test: ${op.table} ${op.action}`)
}

function makeBuilder(table: string) {
  const op: Op = { table, action: null, filters: [] }
  const push = (method: string) => (...args: unknown[]) => {
    op.filters.push({ method, args })
    return builder
  }
  const builder: Record<string, unknown> = {
    select() { if (op.action === null) op.action = 'select'; return builder },
    insert(payload: unknown) { op.action = 'insert'; op.payload = payload; return builder },
    update(payload: unknown) { op.action = 'update'; op.payload = payload; return builder },
    delete() { op.action = 'delete'; return builder },
    eq: push('eq'), gte: push('gte'), in: push('in'), is: push('is'), lte: push('lte'),
    not: push('not'), order: push('order'), range: push('range'),
    single() { return builder },
    maybeSingle() { return builder },
    then(resolve: (v: unknown) => unknown) {
      state.ops.push(op)
      return resolve(resolveOp(op))
    },
  }
  return builder
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () =>
          state.authFails
            ? { data: { user: null }, error: { message: 'ugyldig token' } }
            : { data: { user: { id: ME } }, error: null },
      },
      from: (table: string) => makeBuilder(table),
      rpc: async (fn: string, args: unknown) => {
        state.rpcs.push({ fn, args })
        // Bumpen registreres også i ops-strømmen så REKKEFØLGEN kan bevises.
        state.ops.push({ table: `rpc:${fn}`, action: 'update', payload: args, filters: [] })
        return { data: 15, error: state.bumpFails ? { message: 'simulert bumpfeil' } : null }
      },
    },
  },
})

const { POST } = await import('@/app/api/tilfeldig-quiz/route')

let ipTeller = 0

async function kall(overrides: { category?: unknown; medToken?: boolean; ip?: string; rawBody?: string } = {}) {
  const request = new Request('https://quizkanonen.no/api/tilfeldig-quiz', {
    method: 'POST',
    headers: {
      ...(overrides.medToken === false ? {} : { authorization: 'Bearer test-token' }),
      'x-forwarded-for': overrides.ip ?? `test-ip-${++ipTeller}`,
      'content-type': 'application/json',
    },
    body: overrides.rawBody ?? JSON.stringify(
      overrides.category === undefined ? {} : { category: overrides.category }
    ),
  })
  return POST(request as never)
}

/** Alle registrerte SKRIVINGER (insert/update/delete + rpc) — aldri lesinger. */
const skrivinger = () => state.ops.filter((o) => o.action !== 'select')
const lesinger = () => state.ops.filter((o) => o.action === 'select')

beforeEach(() => {
  state.profile = profile()
  state.premiumLookupFails = false
  state.authFails = false
  state.generationCount = 0
  state.countFails = false
  state.bankIds = [...BANK_IDS]
  state.poolFails = false
  state.sourceRows = BANK_IDS.map(bankRad)
  state.questionsInsertFails = false
  state.bumpFails = false
  state.ledgerFails = false
  state.ops = []
  state.rpcs = []
})

// ── Inngang ─────────────────────────────────────────────────────────────────

test('uten token → 401, ingen oppslag i det hele tatt', async () => {
  const res = await kall({ medToken: false })
  assert.equal(res.status, 401)
  assert.equal(state.ops.length, 0)
})

test('ugyldig sesjon → 401', async () => {
  state.authFails = true
  const res = await kall()
  assert.equal(res.status, 401)
  assert.equal(state.ops.length, 0)
})

test('ukjent kategori → 400 FØR noe oppslag (inngangshygiene, ikke rettighet)', async () => {
  state.profile = profile({ premium_status: true })
  const res = await kall({ category: 'Kryptozoologi' })
  assert.equal(res.status, 400)
  assert.equal(state.ops.length, 0)
})

test('kategori som ikke er streng → 400', async () => {
  const res = await kall({ category: 42 })
  assert.equal(res.status, 400)
})

test('ugyldig JSON → 400', async () => {
  const res = await kall({ rawBody: '{ikke json' })
  assert.equal(res.status, 400)
})

// ── 1. Planen — «vet ikke» er 503 ───────────────────────────────────────────

test('plan-oppslag feiler → 503, ingen pulje-lesing, ingen skriving', async () => {
  state.premiumLookupFails = true
  const res = await kall()
  assert.equal(res.status, 503)
  assert.deepEqual(skrivinger(), [])
  assert.ok(!lesinger().some((o) => o.table === 'quizzes'), 'puljen ble lest tross ukjent plan')
})

test('plan-oppslag feiler for en bruker med 0 brukt og ingen kategori → fortsatt 503 (ikke gratis-fallback)', async () => {
  state.premiumLookupFails = true
  state.generationCount = 0
  const res = await kall()
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.match(body.error, /Prøv igjen/)
})

// ── 2. Tellingen ────────────────────────────────────────────────────────────

test('tellingen filtrerer på bruker og norsk månedsstart', async () => {
  await kall()
  const telling = lesinger().find((o) => o.table === 'quiz_generations')
  assert.ok(telling, 'ingen telling mot ledgeren')
  assert.ok(telling.filters.some((f) => f.method === 'eq' && f.args[0] === 'user_id' && f.args[1] === ME))
  const gte = telling.filters.find((f) => f.method === 'gte' && f.args[0] === 'created_at')
  assert.ok(gte, 'mangler månedsgrense')
  assert.equal(gte.args[1], osloMonthStartUtcIso(Date.now()))
})

test('tellingen feiler → 503, ingen skriving', async () => {
  state.countFails = true
  const res = await kall()
  assert.equal(res.status, 503)
  assert.deepEqual(skrivinger(), [])
})

// ── 3. Kvoten — pengelogikk ─────────────────────────────────────────────────

test('gratis med 2 brukt → 429, INGEN skriving og ingen pulje-lesing', async () => {
  state.generationCount = GENERATION_QUOTA.free
  const res = await kall()
  assert.equal(res.status, 429)
  assert.deepEqual(skrivinger(), [])
  assert.ok(!lesinger().some((o) => o.table === 'quizzes'))
})

test('gratis med 1 brukt → 201 (siste kule), remaining 0', async () => {
  state.generationCount = 1
  const res = await kall()
  assert.equal(res.status, 201)
  assert.deepEqual(await res.json(), { quizId: NEW_QUIZ, remaining: 0 })
})

test('premium med 30 brukt → 429', async () => {
  state.profile = profile({ premium_status: true })
  state.generationCount = GENERATION_QUOTA.premium
  const res = await kall()
  assert.equal(res.status, 429)
  assert.deepEqual(skrivinger(), [])
})

test('premium med 5 brukt → 201 (gratis-taket gjelder ikke premium)', async () => {
  state.profile = profile({ premium_status: true })
  state.generationCount = 5
  const res = await kall()
  assert.equal(res.status, 201)
})

test('org-karens teller som premium (binder ruten til den EKTE getUserPremium)', async () => {
  state.profile = profile({ org_premium_grace_until: new Date(Date.now() + 3 * 86_400_000).toISOString() })
  state.generationCount = 5
  const res = await kall({ category: 'Sport' })
  assert.equal(res.status, 201)
})

// ── 4. Kategorisperren ──────────────────────────────────────────────────────

test('gratis med kategori → 403, INGEN skriving', async () => {
  const res = await kall({ category: 'Sport' })
  assert.equal(res.status, 403)
  assert.deepEqual(skrivinger(), [])
  assert.ok(!lesinger().some((o) => o.table === 'quizzes'))
})

test('gratis TOM for kuler som velger kategori → 429 (kvoten avgjøres før kategorien)', async () => {
  state.generationCount = GENERATION_QUOTA.free
  const res = await kall({ category: 'Sport' })
  assert.equal(res.status, 429)
})

test('premium med kategori → 201, kategorien når puljen og ledgeren', async () => {
  state.profile = profile({ premium_status: true })
  const res = await kall({ category: 'Sport' })
  assert.equal(res.status, 201)
  const bank = lesinger().find((o) => o.table === 'questions' && o.filters.some((f) => f.method === 'is'))
  assert.ok(bank && bank.filters.some((f) => f.method === 'eq' && f.args[0] === 'category' && f.args[1] === 'Sport'))
  const ledger = skrivinger().find((o) => o.table === 'quiz_generations')
  assert.ok(ledger)
  assert.deepEqual(ledger.payload, { user_id: ME, category: 'Sport', quiz_id: NEW_QUIZ, plan: 'premium' })
})

// ── 5. Puljen ───────────────────────────────────────────────────────────────

test('puljen kan ikke leses → 503, ingen skriving', async () => {
  state.poolFails = true
  const res = await kall()
  assert.equal(res.status, 503)
  assert.deepEqual(skrivinger(), [])
})

test('for få spørsmål i puljen → 409, ingen skriving (ingen kule brukt)', async () => {
  state.bankIds = BANK_IDS.slice(0, GENERATED_QUIZ_QUESTION_COUNT - 1)
  const res = await kall()
  assert.equal(res.status, 409)
  assert.deepEqual(skrivinger(), [])
})

// ── 6–8. Suksess: hva som ble skrevet, mot hva, i hvilken rekkefølge ────────

test('suksess: nøyaktig fem skrivinger i rekkefølgen quiz → spørsmål → aktiver → kildebump → ledger', async () => {
  const res = await kall()
  assert.equal(res.status, 201)
  assert.deepEqual(
    skrivinger().map((o) => `${o.table}:${o.action}`),
    [
      'quizzes:insert',
      'questions:insert',
      'quizzes:update',
      'rpc:bump_question_usage:update',
      'quiz_generations:insert',
    ]
  )
})

test('suksess: quiz-raden er archive, INAKTIV ved insert, tittel «Tilfeldig quiz», source_quiz_id NULL', async () => {
  await kall()
  const quiz = skrivinger().find((o) => o.table === 'quizzes' && o.action === 'insert')!
  const payload = quiz.payload as Record<string, unknown>
  assert.equal(payload.quiz_type, 'archive')
  assert.equal(payload.is_active, false)
  assert.equal(payload.title, GENERATED_QUIZ_TITLE)
  assert.equal(payload.source_quiz_id, null)
  assert.equal(payload.opens_at, null)
  assert.equal(payload.closes_at, null)
  assert.equal(payload.hide_leaderboard_until_closed, false)
  assert.equal(payload.is_test, false)
  const aktiver = skrivinger().find((o) => o.table === 'quizzes' && o.action === 'update')!
  assert.deepEqual(aktiver.payload, { is_active: true })
  assert.ok(aktiver.filters.some((f) => f.method === 'eq' && f.args[0] === 'id' && f.args[1] === NEW_QUIZ))
})

test('suksess: 15 spørsmålsrader, alle DISTINKTE kilder, alle med quiz_id=ny quiz, order_index 1..15', async () => {
  await kall()
  const q = skrivinger().find((o) => o.table === 'questions' && o.action === 'insert')!
  const rader = q.payload as Record<string, unknown>[]
  assert.equal(rader.length, GENERATED_QUIZ_QUESTION_COUNT)
  assert.equal(new Set(rader.map((r) => r.question_text)).size, GENERATED_QUIZ_QUESTION_COUNT)
  assert.ok(rader.every((r) => r.quiz_id === NEW_QUIZ))
  assert.deepEqual(rader.map((r) => r.order_index), Array.from({ length: 15 }, (_, i) => i + 1))
  // To-alternativ-spørsmål kopieres med option_c/option_d = null — ikke fylt ut.
  assert.ok(rader.some((r) => r.option_c === null && r.option_d === null))
})

test('suksess: spørsmålsradene bærer INGEN bruksdata (usage_count/last_used_at/is_classic/id)', async () => {
  await kall()
  const q = skrivinger().find((o) => o.table === 'questions' && o.action === 'insert')!
  for (const r of q.payload as Record<string, unknown>[]) {
    assert.ok(!('usage_count' in r) && !('last_used_at' in r) && !('is_classic' in r) && !('id' in r))
  }
})

test('suksess: kildebumpen er ÉN rpc med nøyaktig de 15 trukne id-ene', async () => {
  await kall()
  assert.equal(state.rpcs.length, 1)
  assert.equal(state.rpcs[0].fn, 'bump_question_usage')
  const ids = (state.rpcs[0].args as { p_ids: string[] }).p_ids
  assert.deepEqual([...ids].sort(), [...BANK_IDS].sort())
})

test('suksess: kildegaten fikk allowBankRows — bankradene (quiz_id null) slapp gjennom', async () => {
  // Alle 15 kilderader er biblioteksrader. Med default (false) hadde ruten
  // svart 403 fra gaten; 201 beviser den eksplisitte grenen.
  const res = await kall()
  assert.equal(res.status, 201)
})

test('suksess: ledgeren får user_id, category null (blandet), quiz_id og plan free', async () => {
  const res = await kall()
  assert.equal(res.status, 201)
  const ledger = skrivinger().find((o) => o.table === 'quiz_generations')!
  assert.deepEqual(ledger.payload, { user_id: ME, category: null, quiz_id: NEW_QUIZ, plan: 'free' })
})

test('suksess: svaret er quizId + remaining', async () => {
  state.profile = profile({ premium_status: true })
  state.generationCount = 10
  const res = await kall()
  assert.deepEqual(await res.json(), { quizId: NEW_QUIZ, remaining: GENERATION_QUOTA.premium - 10 - 1 })
})

// ── Feil underveis: ingen kule uten quiz, ingen quiz uten opprydding ────────

test('spørsmåls-insert feiler → 500, quizen ryddes, INGEN bump og INGEN ledger-rad (avslått quiz koster ikke kule)', async () => {
  state.questionsInsertFails = true
  const res = await kall()
  assert.equal(res.status, 500)
  assert.deepEqual(
    skrivinger().map((o) => `${o.table}:${o.action}`),
    ['quizzes:insert', 'questions:insert', 'quizzes:delete']
  )
  assert.equal(state.rpcs.length, 0)
})

test('kildebump feiler → 201 likevel, ledgeren skrives fortsatt (bumpen velter ikke opprettelsen)', async () => {
  state.bumpFails = true
  const res = await kall()
  assert.equal(res.status, 201)
  assert.ok(skrivinger().some((o) => o.table === 'quiz_generations'))
})

test('ledger-skriving feiler → 201 likevel (quizen ER opprettet), men det logges', async () => {
  state.ledgerFails = true
  const logget: string[] = []
  const orig = console.error
  console.error = (...args: unknown[]) => { logget.push(String(args[0])) }
  try {
    const res = await kall()
    assert.equal(res.status, 201)
  } finally {
    console.error = orig
  }
  assert.ok(logget.some((l) => l.includes('LEDGER-SKRIVING FEILET')))
})

// ── Backstop: kildegaten feller en pulje-rad som ikke skulle vært der ───────

test('kilderad med quiz_id satt og ÅPEN forelder → 500, ingen skriving (gaten er backstop, ikke pynt)', async () => {
  const orig = console.error
  console.error = () => {}
  try {
    state.sourceRows = BANK_IDS.map((id, i) =>
      i === 3
        ? { ...bankRad(id, i), quiz_id: FORELDER, quiz: { closes_at: new Date(Date.now() + 86_400_000).toISOString(), is_test: false } }
        : bankRad(id, i)
    )
    const res = await kall()
    assert.equal(res.status, 500)
    assert.deepEqual(skrivinger(), [])
  } finally {
    console.error = orig
  }
})

// ── Lag 1: in-memory IP-brems ───────────────────────────────────────────────

test('sjette kall fra samme IP innen ett minutt → 429 før auth', async () => {
  const ip = 'brems-ip'
  for (let i = 0; i < 5; i++) await kall({ ip })
  state.ops = []
  const res = await kall({ ip })
  assert.equal(res.status, 429)
  assert.equal(state.ops.length, 0)
})
