// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte POST /api/arkiv. Kun supabase-admin er mocket
// (med en REGISTRERENDE query-builder som logger hver eneste operasjon) —
// ruten, lib/premium-check, lib/archive-create-rules og lib/archive-copy
// kjøres uendret. Premium-gaten testes derfor mot den EKTE getUserPremium,
// samme mal som lib/historikk-premium-gate-route.test.ts.
//
// Registreringen er poenget: de harde kravene til ruten er formulert som
// «hvilke skrivinger skjedde, mot hva, i hvilken rekkefølge» — ikke bare
// statuskoder. Assert på sideeffekter, ikke bare svar (husregel).
//
// FIXTURE-REGELEN er fulgt: hvert felt testene hviler på har DISTINKT verdi
// per rad (id-er, tekster, fasit, kategorier, tidsgrenser, stengetider) — et
// filter på feil felt kan ikke se riktig ut fordi to felter deler verdi.
//
// MUTASJONSBEVIS (alle kjørt 26. august 2026 og revertert):
//   • fjern `if (!premium.value)`-grenen i ruten        → ikke-premium-testen rød
//   • fjern orgGraceActive-leddet i lib/premium-check   → org-karens-testen rød
//     (binder ruten til den EKTE getUserPremium, ikke en rå premium_status-lesing)
//   • flytt kvote-bokføringen FORAN spørsmåls-insertet  → «bokføres først etter»-
//     testen rød + rekkefølge-asserten i suksess-testen rød
//   • gi spørsmålsradene usage_count/last_used_at (import-stil) ELLER legg til
//     classics/copy-style kildebump                     → urørt-kilde-testen rød
//   • fjern decideArchiveSourceEligibility-kallet       → åpen-quiz-testen rød
//   • filtrer bort ukjente id-er før buildArchiveCopy   → ukjent-id-testen rød
//   • sett quiz-raden inn med built.quiz direkte (aktiv fra start)
//                                                       → is_active=false-assertene røde
//   • fjern opprydnings-delete i spørsmåls-feil-grenen  → delvis-opprettelse-testen rød
//   • fjern decideArchiveCreateQuota-avvisningen        → kvote-429-testen rød
//   • ignorer quotaCountError                           → kvote-503-testen rød
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

import { ARCHIVE_CREATE_MAX_PER_DAY } from '@/lib/archive-create-rules'

const ME = '11111111-1111-4111-8111-111111111111'
const NEW_QUIZ = 'ffffffff-9999-4999-8999-ffffffffffff'
const Q1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const Q2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const OM_TRE_DAGER = () => new Date(Date.now() + 3 * 86_400_000).toISOString()

type Op = {
  table: string
  action: 'select' | 'insert' | 'update' | 'delete' | null
  payload?: unknown
  filters: { method: string; args: unknown[] }[]
  maybeSingle?: boolean
}

type ProfileRow = {
  premium_status: boolean
  org_premium_grace_until: string | null
  personal_grace_until: string | null
}

const state = {
  profile: null as ProfileRow | null,
  premiumLookupFails: false,
  authFails: false,
  quotaCount: 0,
  quotaCountFails: false,
  sourceRows: [] as Record<string, unknown>[],
  sourceFails: false,
  questionsInsertFails: false,
  activateFails: false,
  cleanupQuizDeleteFails: false,
  quotaLogFails: false,
  ops: [] as Op[],
}

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    premium_status: false,
    org_premium_grace_until: null,
    personal_grace_until: null,
    ...overrides,
  }
}

/** To kilderader med distinkte verdier i SAMTLIGE felt (fixture-regelen).
 *  Q2 har multi-fasit så begge fasitkolonnene bevises kopiert sammen. */
function kildeRader() {
  return [
    {
      id: Q1_ID,
      question_text: 'Hva heter hovedstaden i Frankrike?',
      option_a: 'Paris',
      option_b: 'Lyon',
      option_c: 'Marseille',
      option_d: 'Nice',
      correct_answer: 'A',
      correct_answers: null,
      explanation: 'Paris har vært hovedstad siden 987.',
      category: 'Geografi',
      time_limit_seconds: 20,
      shuffle_options: true,
      quiz: { closes_at: '2026-08-14T20:00:00Z', is_test: false },
    },
    {
      id: Q2_ID,
      question_text: 'Hvilke år var det sommer-OL i Paris?',
      option_a: '1900',
      option_b: '1924',
      option_c: '2024',
      option_d: '1936',
      correct_answer: 'B',
      correct_answers: ['B', 'C'],
      explanation: 'Både 1924 og 2024 — og 1900.',
      category: 'Sport',
      time_limit_seconds: 30,
      shuffle_options: false,
      quiz: { closes_at: '2026-08-21T19:00:00Z', is_test: false },
    },
  ]
}

function resolveOp(op: Op): Record<string, unknown> {
  if (op.table === 'profiles') {
    return state.premiumLookupFails
      ? { data: null, error: { message: 'simulert DB-feil' } }
      : { data: state.profile, error: null }
  }
  if (op.table === 'admin_actions' && op.action === 'select') {
    return state.quotaCountFails
      ? { count: null, error: { message: 'simulert tellefeil' } }
      : { count: state.quotaCount, error: null }
  }
  if (op.table === 'admin_actions' && op.action === 'insert') {
    return { error: state.quotaLogFails ? { message: 'simulert bokføringsfeil' } : null }
  }
  if (op.table === 'questions' && op.action === 'select') {
    return state.sourceFails
      ? { data: null, error: { message: 'simulert lesefeil' } }
      : { data: state.sourceRows, error: null }
  }
  if (op.table === 'quizzes' && op.action === 'insert') {
    return { data: { id: NEW_QUIZ }, error: null }
  }
  if (op.table === 'questions' && op.action === 'insert') {
    return { error: state.questionsInsertFails ? { message: 'simulert insert-feil' } : null }
  }
  if (op.table === 'quizzes' && op.action === 'update') {
    return { error: state.activateFails ? { message: 'simulert aktiveringsfeil' } : null }
  }
  if (op.table === 'quizzes' && op.action === 'delete') {
    return { error: state.cleanupQuizDeleteFails ? { message: 'simulert slettefeil' } : null }
  }
  if (op.table === 'questions' && op.action === 'delete') {
    return { error: null }
  }
  throw new Error(`uventet operasjon i test: ${op.table} ${op.action}`)
}

function makeBuilder(table: string) {
  const op: Op = { table, action: null, filters: [] }
  const builder: Record<string, unknown> = {
    select(_columns?: string) {
      if (op.action === null) op.action = 'select'
      return builder
    },
    insert(payload: unknown) { op.action = 'insert'; op.payload = payload; return builder },
    update(payload: unknown) { op.action = 'update'; op.payload = payload; return builder },
    delete() { op.action = 'delete'; return builder },
    eq(...args: unknown[]) { op.filters.push({ method: 'eq', args }); return builder },
    gte(...args: unknown[]) { op.filters.push({ method: 'gte', args }); return builder },
    in(...args: unknown[]) { op.filters.push({ method: 'in', args }); return builder },
    single() { return builder },
    maybeSingle() { op.maybeSingle = true; return builder },
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
    },
  },
})

const { POST } = await import('@/app/api/arkiv/route')

// Unik IP per kall som standard, så den EKTE in-memory-rate-limiten (som også
// kjører uendret) ikke smitter mellom tester. Rate-limit-testen setter egen ip.
let ipTeller = 0

async function kall(overrides: {
  title?: unknown
  question_ids?: unknown
  medToken?: boolean
  ip?: string
} = {}): Promise<Response> {
  const request = new Request('https://quizkanonen.no/api/arkiv', {
    method: 'POST',
    headers: {
      ...(overrides.medToken === false ? {} : { authorization: 'Bearer test-token' }),
      'x-forwarded-for': overrides.ip ?? `test-ip-${++ipTeller}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: overrides.title ?? 'Arkiv: Fredagsquiz 14. august',
      question_ids: overrides.question_ids ?? [Q1_ID, Q2_ID],
    }),
  })
  return POST(request as never)
}

/** Alle registrerte SKRIVINGER (insert/update/delete) — aldri lesinger. */
function skrivinger(): Op[] {
  return state.ops.filter((o) => o.action !== 'select')
}

beforeEach(() => {
  state.profile = profile({ premium_status: true })
  state.premiumLookupFails = false
  state.authFails = false
  state.quotaCount = 0
  state.quotaCountFails = false
  state.sourceRows = kildeRader()
  state.sourceFails = false
  state.questionsInsertFails = false
  state.activateFails = false
  state.cleanupQuizDeleteFails = false
  state.quotaLogFails = false
  state.ops = []
})

// ── Suksess-stien: nøyaktig fire skrivinger, i riktig rekkefølge ────────────

test('suksess: 201 med quizId, og nøyaktig [quiz-insert, spørsmåls-insert, aktivering, bokføring]', async () => {
  const res = await kall()
  assert.equal(res.status, 201)
  assert.deepEqual(await res.json(), { quizId: NEW_QUIZ })

  const w = skrivinger()
  assert.deepEqual(
    w.map((o) => `${o.table}:${o.action}`),
    ['quizzes:insert', 'questions:insert', 'quizzes:update', 'admin_actions:insert']
  )

  // Quiz-raden settes inn INAKTIV (aktiver-sist), men ellers nøyaktig slik
  // buildArchiveCopy bestemte — ingen klientstyrte ekstra felter.
  assert.deepEqual(w[0].payload, {
    title: 'Arkiv: Fredagsquiz 14. august',
    quiz_type: 'archive',
    opens_at: null,
    closes_at: null,
    hide_leaderboard_until_closed: false,
    is_test: false,
    is_active: false,
  })

  // Aktiveringen skriver KUN is_active, kun på den nye quizen, og verdien er
  // buildArchiveCopy sin (true).
  assert.deepEqual(w[2].payload, { is_active: true })
  assert.deepEqual(w[2].filters, [{ method: 'eq', args: ['id', NEW_QUIZ] }])

  // Bokføringen er duel-kvote-formen, nøklet på bruker + ny quiz.
  assert.deepEqual(w[3].payload, {
    action_type: 'archive_quiz_created',
    scope_type: 'quiz',
    scope_id: NEW_QUIZ,
    user_id: ME,
  })
})

test('suksess: spørsmålsradene er buildArchiveCopy sine, med quiz_id lagt på — og UTEN bruksdata', async () => {
  await kall()
  const rader = skrivinger()[1].payload as Record<string, unknown>[]
  assert.equal(rader.length, 2)

  const [r1, r2] = rader
  assert.equal(r1.question_text, 'Hva heter hovedstaden i Frankrike?')
  assert.equal(r1.order_index, 1)
  assert.equal(r1.quiz_id, NEW_QUIZ)
  // Multi-fasit: BEGGE fasitkolonnene følger med, sammen (fasit-regelen).
  assert.equal(r2.correct_answer, 'B')
  assert.deepEqual(r2.correct_answers, ['B', 'C'])
  assert.equal(r2.order_index, 2)

  for (const rad of rader) {
    // Bruksdata og identitet skal IKKE finnes i radene — DB-default (0/NULL)
    // er meningen: en avspillingskopi er ikke et «bruk» i bank-forstand.
    assert.ok(!('usage_count' in rad), 'usage_count skal ikke skrives')
    assert.ok(!('last_used_at' in rad), 'last_used_at skal ikke skrives')
    assert.ok(!('id' in rad), 'kilde-id skal ikke arves')
    assert.ok(!('is_classic' in rad), 'is_classic skal ikke arves')
    assert.ok(!('quiz' in rad), 'embed-objektet skal ikke lekke inn i insert')
  }
})

test('id-listens rekkefølge styrer order_index — ikke kilderadenes rekkefølge', async () => {
  const res = await kall({ question_ids: [Q2_ID, Q1_ID] })
  assert.equal(res.status, 201)
  const rader = skrivinger()[1].payload as Record<string, unknown>[]
  assert.equal(rader[0].question_text, 'Hvilke år var det sommer-OL i Paris?')
  assert.equal(rader[0].order_index, 1)
  assert.equal(rader[1].question_text, 'Hva heter hovedstaden i Frankrike?')
  assert.equal(rader[1].order_index, 2)
})

// ── Invarianten: kildequiz og kildespørsmål er URØRLIGE ─────────────────────

test('ingen skriving refererer kilde-id-er, oppdaterer questions, eller bærer bruksdata', async () => {
  await kall()
  for (const op of skrivinger()) {
    const serialisert = JSON.stringify(op)
    assert.ok(!serialisert.includes(Q1_ID), `skriving refererer kildespørsmål: ${serialisert}`)
    assert.ok(!serialisert.includes(Q2_ID), `skriving refererer kildespørsmål: ${serialisert}`)
    assert.ok(!serialisert.includes('usage_count'), `skriving bærer usage_count: ${serialisert}`)
    assert.ok(!serialisert.includes('last_used_at'), `skriving bærer last_used_at: ${serialisert}`)
    assert.ok(
      !(op.table === 'questions' && (op.action === 'update' || op.action === 'delete')),
      'suksess-stien skal aldri oppdatere eller slette i questions'
    )
  }
})

// ── Premium-gaten (den EKTE getUserPremium kjøres) ──────────────────────────

test('ikke-premium får 403, og ingenting skrives', async () => {
  state.profile = profile({ premium_status: false })
  const res = await kall()
  assert.equal(res.status, 403)
  assert.deepEqual(skrivinger(), [])
})

test('org-karens alene gir tilgang — ruten rir på getUserPremium, ikke en rå premium_status-lesing', async () => {
  // Aktivt org-medlemskap uttrykkes som premium_status=true i cachen (skrives
  // ved innmelding, org/join) og dekkes av suksess-testene. Karens-leddet er
  // det som SKILLER getUserPremium fra en direkte kolonnelesing.
  state.profile = profile({ premium_status: false, org_premium_grace_until: OM_TRE_DAGER() })
  const res = await kall()
  assert.equal(res.status, 201)
})

test('premium-oppslag feiler → 503, aldri en dom — og ingenting skrives', async () => {
  state.premiumLookupFails = true
  const res = await kall()
  assert.equal(res.status, 503)
  assert.deepEqual(skrivinger(), [])
})

test('uten token → 401; ugyldig sesjon → 401 — ingenting skrives', async () => {
  assert.equal((await kall({ medToken: false })).status, 401)
  state.authFails = true
  assert.equal((await kall()).status, 401)
  assert.deepEqual(skrivinger(), [])
})

// ── Kvoten: håndheves før, bokføres først ETTER bekreftet opprettelse ───────

test('kvote: nøyaktig taket → 429, og ingenting skrives', async () => {
  state.quotaCount = ARCHIVE_CREATE_MAX_PER_DAY
  const res = await kall()
  assert.equal(res.status, 429)
  assert.deepEqual(skrivinger(), [])
})

test('kvote: telling feiler → 503 fail-closed, ingenting skrives', async () => {
  state.quotaCountFails = true
  const res = await kall()
  assert.equal(res.status, 503)
  assert.deepEqual(skrivinger(), [])
})

test('kvote bokføres IKKE når opprettelsen rulles tilbake', async () => {
  state.questionsInsertFails = true
  await kall()
  assert.ok(
    !state.ops.some((o) => o.table === 'admin_actions' && o.action === 'insert'),
    'et rullet-tilbake forsøk skal ikke koste kvote'
  )
})

// ── Kildegaten og ukjente id-er: avvist FØR noe skrives ─────────────────────

test('kildegate: spørsmål fra en quiz som ikke er stengt → 403, ingenting skrives', async () => {
  const rader = kildeRader()
  ;(rader[1].quiz as { closes_at: string }).closes_at = '2027-01-01T20:00:00Z'
  state.sourceRows = rader
  const res = await kall()
  assert.equal(res.status, 403)
  assert.deepEqual(skrivinger(), [])
})

test('ukjent spørsmåls-id → 400 FØR noe skrives (buildArchiveCopy sin ukjent-id)', async () => {
  state.sourceRows = [kildeRader()[0]] // Q2 bestilt, men finnes ikke
  const res = await kall()
  assert.equal(res.status, 400)
  assert.deepEqual(skrivinger(), [])
})

test('duplikat i id-listen → 400 før noe skrives', async () => {
  const res = await kall({ question_ids: [Q1_ID, Q1_ID] })
  assert.equal(res.status, 400)
  assert.deepEqual(skrivinger(), [])
})

test('tom (kun mellomrom) tittel → 400 via buildArchiveCopy', async () => {
  const res = await kall({ title: '   ' })
  assert.equal(res.status, 400)
  assert.deepEqual(skrivinger(), [])
})

// ── Delvis opprettelse er forbudt ───────────────────────────────────────────

test('spørsmåls-insert feiler → 500, quiz-raden slettes, og quizen ble ALDRI aktivert', async () => {
  state.questionsInsertFails = true
  const res = await kall()
  assert.equal(res.status, 500)

  const w = skrivinger()
  // Quiz-raden gikk inn inaktiv …
  assert.equal((w[0].payload as { is_active: boolean }).is_active, false)
  // … ble forsøkt slettet …
  assert.ok(
    w.some(
      (o) =>
        o.table === 'quizzes' &&
        o.action === 'delete' &&
        o.filters.some((f) => f.method === 'eq' && f.args[0] === 'id' && f.args[1] === NEW_QUIZ)
    ),
    'opprydnings-delete av den nye quiz-raden mangler'
  )
  // … og ingen aktivering skjedde: en tom quiz kan aldri ha vært spillbar.
  assert.ok(!w.some((o) => o.table === 'quizzes' && o.action === 'update'))
})

test('spørsmåls-insert OG opprydding feiler → resten står INAKTIVT, aldri aktivert', async () => {
  state.questionsInsertFails = true
  state.cleanupQuizDeleteFails = true
  const res = await kall()
  assert.equal(res.status, 500)
  const w = skrivinger()
  assert.equal((w[0].payload as { is_active: boolean }).is_active, false)
  assert.ok(!w.some((o) => o.table === 'quizzes' && o.action === 'update'))
})

test('aktivering feiler → 500 og begge de NYE radsettene ryddes (nøklet på ny quiz-id)', async () => {
  state.activateFails = true
  const res = await kall()
  assert.equal(res.status, 500)
  const w = skrivinger()
  assert.ok(
    w.some(
      (o) =>
        o.table === 'questions' &&
        o.action === 'delete' &&
        o.filters.some((f) => f.args[0] === 'quiz_id' && f.args[1] === NEW_QUIZ)
    ),
    'de nye spørsmålsradene ryddes ikke'
  )
  assert.ok(
    w.some(
      (o) =>
        o.table === 'quizzes' &&
        o.action === 'delete' &&
        o.filters.some((f) => f.args[0] === 'id' && f.args[1] === NEW_QUIZ)
    ),
    'den nye quiz-raden ryddes ikke'
  )
})

// ── Inngangsvalidering og rate-limit ────────────────────────────────────────

test('for mange id-er → 400, ingenting skrives', async () => {
  const mange = Array.from({ length: 51 }, (_, i) =>
    `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`
  )
  const res = await kall({ question_ids: mange })
  assert.equal(res.status, 400)
  assert.deepEqual(skrivinger(), [])
})

test('ikke-UUID i id-listen → 400', async () => {
  const res = await kall({ question_ids: [Q1_ID, 'ikke-en-uuid'] })
  assert.equal(res.status, 400)
  assert.deepEqual(skrivinger(), [])
})

test('for lang tittel → 400', async () => {
  const res = await kall({ title: 'a'.repeat(121) })
  assert.equal(res.status, 400)
  assert.deepEqual(skrivinger(), [])
})

test('rate-limit: 6. kall fra samme IP får 429 (in-memory-førstelaget)', async () => {
  const ip = 'rate-limit-test-ip'
  for (let i = 0; i < 5; i++) {
    assert.equal((await kall({ medToken: false, ip })).status, 401)
  }
  assert.equal((await kall({ medToken: false, ip })).status, 429)
})
