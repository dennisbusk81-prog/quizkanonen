// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte POST /api/admin/quizzes/import. Kun
// supabase-admin og admin-auth er mocket — supabase-admin med en
// REGISTRERENDE query-builder som logger hver eneste operasjon, så de harde
// kravene kan formuleres som «hvilke skrivinger skjedde, mot hva, i hvilken
// rekkefølge». Assert på sideeffekter, ikke bare statuskoder (husregel).
// Samme mal som lib/arkiv-create-route.test.ts.
//
// KRAVET ([N-1], 27. august 2026): en feilet import skal ALDRI etterlate en
// spillbar quiz. Ruten setter derfor quiz-raden inn INAKTIV og aktiverer
// SIST, samme form som POST /api/arkiv (c418b64). De tre utfallene som skal
// bevises hver for seg:
//
//   feilet spørsmålsinnsetting → raden står INAKTIV (ikke aktiv-uten-spørsmål,
//                                og ikke avhengig av at oppryddingen lyktes)
//   vellykket import           → nøyaktig samme oppførsel som før endringen
//   feilet aktivering          → raden står INAKTIV
//
// Derfor står det TO is_active-asserter i feil-testene: hva insertet skrev, OG
// om en aktivering i det hele tatt skjedde. Én av dem alene ville ikke skilt
// «aldri aktivert» fra «aktivert likevel».
//
// MUTASJONSBEVIS (alle kjørt 27. august 2026 og revertert):
//   • sett `is_active: true` i quiz-insertet (formen før endringen)
//       → «INAKTIV, men ellers dagens felter» + begge feil-grenene røde
//   • flytt aktiveringen FORAN spørsmåls-insertet
//       → suksess-testens rekkefølge-assert rød + «ingen aktivering
//         skjedde»-asserten i spørsmålsfeil-testen rød
//   • fjern aktiveringssteget helt
//       → suksess-testens rekkefølge-assert rød
//   • ignorer `activateError`
//       → begge aktiveringsfeil-testene røde (200 i stedet for 500)
//   • fjern opprydnings-delete i spørsmåls-feil-grenen
//       → rekkefølge-asserten i spørsmålsfeil-testen rød
//
// MUTASJONSBEVIS for `activate`-flagget (27. august 2026):
//   • fjern `if (skalAktiveres)` (aktiver alltid)
//       → «activate:false … INGEN aktivering» rød
//   • snu defaulten (`activate === true ? true : false`)
//       → «activate utelatt — Excel-importen aktiverer som før» rød
//   • bytt `activate === false` mot `!activate`
//       → «kun et eksplisitt false slår av» rød (null ville blitt til «skjul»)
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const NEW_QUIZ = 'ffffffff-9999-4999-8999-ffffffffffff'

type Op = {
  table: string
  action: 'select' | 'insert' | 'update' | 'delete' | null
  payload?: unknown
  filters: { method: string; args: unknown[] }[]
}

const state = {
  adminOk: true,
  quizInsertFails: false,
  questionsInsertFails: false,
  activateFails: false,
  quizDeleteFails: false,
  questionsDeleteFails: false,
  ops: [] as Op[],
}

function resolveOp(op: Op): Record<string, unknown> {
  if (op.table === 'quizzes' && op.action === 'insert') {
    return state.quizInsertFails
      ? { data: null, error: { message: 'simulert quiz-insert-feil' } }
      : { data: { id: NEW_QUIZ }, error: null }
  }
  if (op.table === 'questions' && op.action === 'insert') {
    return { error: state.questionsInsertFails ? { message: 'simulert insert-feil' } : null }
  }
  if (op.table === 'quizzes' && op.action === 'update') {
    return { error: state.activateFails ? { message: 'simulert aktiveringsfeil' } : null }
  }
  if (op.table === 'quizzes' && op.action === 'delete') {
    return { error: state.quizDeleteFails ? { message: 'simulert slettefeil' } : null }
  }
  if (op.table === 'questions' && op.action === 'delete') {
    return { error: state.questionsDeleteFails ? { message: 'simulert slettefeil' } : null }
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
    single() { return builder },
    then(resolve: (v: unknown) => unknown) {
      state.ops.push(op)
      return resolve(resolveOp(op))
    },
  }
  return builder
}

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => state.adminOk },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: { from: (table: string) => makeBuilder(table) },
  },
})

const { POST } = await import('@/app/api/admin/quizzes/import/route')

/** To spørsmål med DISTINKTE verdier i samtlige felt (fixture-regelen), så en
 *  mapping på feil felt ikke kan se riktig ut. Q2 har en tidsgrense over taket
 *  (90 → 60) og tom kategori, så begge normaliseringene bevises samtidig. */
function importSporsmal() {
  return [
    {
      question_text: 'Hva heter hovedstaden i Frankrike?',
      option_a: 'Paris',
      option_b: 'Lyon',
      option_c: 'Marseille',
      option_d: 'Nice',
      time_limit_seconds: 20,
      shuffle_options: true,
      category: 'Geografi',
    },
    {
      question_text: 'Hvilket år var det sommer-OL i Paris sist?',
      option_a: '2024',
      option_b: '1924',
      option_c: null,
      option_d: null,
      time_limit_seconds: 90,
      shuffle_options: false,
      category: '',
    },
  ]
}

async function kall(overrides: Record<string, unknown> = {}): Promise<Response> {
  const request = new Request('https://quizkanonen.no/api/admin/quizzes/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Fredagsquiz 28. august',
      questions: importSporsmal(),
      ...overrides,
    }),
  })
  return POST(request as never)
}

/** Alle registrerte SKRIVINGER (insert/update/delete) — aldri lesinger. */
function skrivinger(): Op[] {
  return state.ops.filter((o) => o.action !== 'select')
}

/** Skjedde det en aktivering i det hele tatt? «Quizen står INAKTIV» er ikke at
 *  insertet skrev false — det er at INGEN senere skriving satte den til true. */
function aktiveringer(): Op[] {
  return skrivinger().filter(
    (o) =>
      o.table === 'quizzes' &&
      o.action === 'update' &&
      (o.payload as Record<string, unknown> | undefined)?.is_active === true
  )
}

beforeEach(() => {
  state.adminOk = true
  state.quizInsertFails = false
  state.questionsInsertFails = false
  state.activateFails = false
  state.quizDeleteFails = false
  state.questionsDeleteFails = false
  state.ops = []
})

// ── Vellykket import: uendret oppførsel fra i dag ───────────────────────────

test('suksess: 200 med quizId, og nøyaktig [quiz-insert, spørsmåls-insert, aktivering] i den rekkefølgen', async () => {
  const res = await kall()
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { quizId: NEW_QUIZ, activated: true })

  const w = skrivinger()
  assert.deepEqual(
    w.map((o) => `${o.table}:${o.action}`),
    ['quizzes:insert', 'questions:insert', 'quizzes:update']
  )

  // Aktiveringen skriver KUN is_active, kun på den nye quizen.
  assert.deepEqual(w[2].payload, { is_active: true })
  assert.deepEqual(w[2].filters, [{ method: 'eq', args: ['id', NEW_QUIZ] }])
})

test('suksess: quiz-raden settes inn INAKTIV, men ellers med dagens felter', async () => {
  await kall()
  const payload = skrivinger()[0].payload as Record<string, unknown>

  assert.equal(payload.is_active, false, 'opprettelsen må være inaktiv')
  assert.equal(payload.title, 'Fredagsquiz 28. august')
  assert.equal(payload.description, '')
  assert.equal(payload.num_options, 4)
  assert.equal(payload.show_leaderboard, true)
  assert.equal(payload.hide_leaderboard_until_closed, true)
  assert.equal(payload.show_live_placement, true)
  assert.equal(payload.show_answer_explanation, true)
  assert.equal(payload.randomize_questions, false)
  assert.equal(payload.allow_teams, true)
  assert.equal(payload.requires_access_code, false)
  assert.equal(payload.quiz_type, 'weekly', 'default-typen er uendret')
  assert.equal(payload.is_test, false)
  // Datoene: default er nå + 1 t / nå + 7 d. Sjekker at de er satt og i riktig
  // rekkefølge — ikke den eksakte klokka.
  const opens = Date.parse(payload.opens_at as string)
  const closes = Date.parse(payload.closes_at as string)
  assert.ok(!Number.isNaN(opens) && !Number.isNaN(closes))
  assert.ok(closes > opens)
})

test('suksess: klientens quiz_type/is_test/datoer går uendret gjennom', async () => {
  await kall({
    quiz_type: 'bonus',
    is_test: true,
    opens_at: '2026-09-04T17:00:00.000Z',
    closes_at: '2026-09-05T20:00:00.000Z',
  })
  const payload = skrivinger()[0].payload as Record<string, unknown>
  assert.equal(payload.quiz_type, 'bonus')
  assert.equal(payload.is_test, true)
  assert.equal(payload.opens_at, '2026-09-04T17:00:00.000Z')
  assert.equal(payload.closes_at, '2026-09-05T20:00:00.000Z')
  assert.equal(payload.is_active, false)
})

test('suksess: spørsmålsradene er uendret — fasit A, order_index 1..N, klemt tidsgrense', async () => {
  await kall()
  const rader = skrivinger()[1].payload as Record<string, unknown>[]
  assert.equal(rader.length, 2)

  const [r1, r2] = rader
  assert.equal(r1.quiz_id, NEW_QUIZ)
  assert.equal(r1.question_text, 'Hva heter hovedstaden i Frankrike?')
  assert.equal(r1.option_a, 'Paris')
  assert.equal(r1.option_d, 'Nice')
  assert.equal(r1.correct_answer, 'A', 'kolonne B i Excel er alltid riktig')
  assert.equal(r1.time_limit_seconds, 20)
  assert.equal(r1.shuffle_options, true)
  assert.equal(r1.category, 'Geografi')
  assert.equal(r1.order_index, 1)
  assert.equal(r1.usage_count, 1)
  assert.ok(typeof r1.last_used_at === 'string')

  assert.equal(r2.order_index, 2)
  assert.equal(r2.time_limit_seconds, 60, '90 s klemmes ned til taket')
  assert.equal(r2.option_c, null)
  assert.equal(r2.category, null, 'tom kategori blir NULL')
})

// ── Feilet spørsmålsinnsetting: raden står INAKTIV ──────────────────────────

test('feilet spørsmålsinnsetting: 500, ingen aktivering skjedde, og quizen ryddes', async () => {
  state.questionsInsertFails = true
  const res = await kall()
  assert.equal(res.status, 500)

  const w = skrivinger()
  assert.deepEqual(
    w.map((o) => `${o.table}:${o.action}`),
    ['quizzes:insert', 'questions:insert', 'quizzes:delete']
  )
  // Kjernen: raden ble satt inn inaktiv OG ingen senere skriving aktiverte den.
  assert.equal((w[0].payload as Record<string, unknown>).is_active, false)
  assert.deepEqual(aktiveringer(), [])
  assert.deepEqual(w[2].filters, [{ method: 'eq', args: ['id', NEW_QUIZ] }])
})

test('feilet spørsmålsinnsetting OG feilet opprydding: quizen står igjen INAKTIV, ikke aktiv-uten-spørsmål', async () => {
  state.questionsInsertFails = true
  state.quizDeleteFails = true
  const res = await kall()
  assert.equal(res.status, 500)

  // Dobbel feil — nøyaktig scenariet [N-1] beskriver. Raden BLIR stående, men
  // den ble aldri aktivert, så den er hverken synlig eller spillbar.
  const w = skrivinger()
  assert.equal((w[0].payload as Record<string, unknown>).is_active, false)
  assert.deepEqual(aktiveringer(), [])
})

// ── Feilet aktivering: raden står INAKTIV ───────────────────────────────────

test('feilet aktivering: 500, og begge radsettene forsøkes ryddet', async () => {
  state.activateFails = true
  const res = await kall()
  assert.equal(res.status, 500)

  const w = skrivinger()
  assert.deepEqual(
    w.map((o) => `${o.table}:${o.action}`),
    ['quizzes:insert', 'questions:insert', 'quizzes:update', 'questions:delete', 'quizzes:delete']
  )
  assert.deepEqual(w[3].filters, [{ method: 'eq', args: ['quiz_id', NEW_QUIZ] }])
  assert.deepEqual(w[4].filters, [{ method: 'eq', args: ['id', NEW_QUIZ] }])
})

test('feilet aktivering OG feilet opprydding: quizen står igjen INAKTIV', async () => {
  state.activateFails = true
  state.questionsDeleteFails = true
  const res = await kall()
  assert.equal(res.status, 500)

  const w = skrivinger()
  assert.equal((w[0].payload as Record<string, unknown>).is_active, false)
  // Aktiveringen ble FORSØKT, men feilet — is_active ble aldri true i basen.
  // Feiler også oppryddingen (her: spørsmålene), hoppes slettingen av
  // quiz-raden over, og en komplett men INAKTIV quiz står igjen.
  assert.equal(
    w.filter((o) => o.table === 'quizzes' && o.action === 'delete').length,
    0,
    'quiz-slettingen hoppes over når spørsmålsslettingen feilet'
  )
})

// ── Tidligere avvisninger: ingenting skrives ────────────────────────────────

test('feilet quiz-insert: 500, og ingen spørsmål settes inn', async () => {
  state.quizInsertFails = true
  const res = await kall()
  assert.equal(res.status, 500)
  assert.deepEqual(skrivinger().map((o) => `${o.table}:${o.action}`), ['quizzes:insert'])
})

test('uten admin-token: 401 og ingen skrivinger', async () => {
  state.adminOk = false
  const res = await kall()
  assert.equal(res.status, 401)
  assert.deepEqual(state.ops, [])
})

test('tom spørsmålsliste: 400 og ingen skrivinger', async () => {
  const res = await kall({ questions: [] })
  assert.equal(res.status, 400)
  assert.deepEqual(state.ops, [])
})

// ── `activate: false` — kalleren tar over publiseringen (27. august 2026) ────
//
// Veiviseren (app/admin/quizzes/new/page.tsx) kaller ruten på TITTEL-BLUR, før
// et eneste spørsmål er skrevet. Fikk den en aktiv quiz tilbake, sto en tom
// quiz publisert gjennom hele byggeperioden. Den publiserer nå selv, som siste
// steg i «Lagre og publiser».
//
// Merk hva som IKKE endres av flagget: opprettelsen var allerede inaktiv ([N-1]
// over). Flagget styrer utelukkende om det SISTE steget kjører.

test('activate:false — quizen står INAKTIV, og INGEN aktivering skjer', async () => {
  const res = await kall({ activate: false })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { quizId: NEW_QUIZ, activated: false })

  // Spørsmålene skal fortsatt inn — det er bare publiseringen som utsettes.
  assert.deepEqual(
    skrivinger().map((o) => `${o.table}:${o.action}`),
    ['quizzes:insert', 'questions:insert'],
    'ingen quizzes:update skal forekomme når kalleren eier publiseringen'
  )
  assert.equal((skrivinger()[0].payload as Record<string, unknown>).is_active, false)
  // Den harde asserten: «står inaktiv» er ikke at insertet skrev false, men at
  // ingen senere skriving satte den til true.
  assert.deepEqual(aktiveringer(), [])
})

test('activate utelatt — Excel-importen aktiverer som før (defaulten er true)', async () => {
  // app/admin/quizzes/page.tsx sender kun { title, questions }. Snus defaulten,
  // ville den kalleren stille begynt å lage skjulte quizer.
  const res = await kall()
  assert.equal(res.status, 200)
  assert.equal((await res.json()).activated, true)
  assert.equal(aktiveringer().length, 1, 'en utelatt activate skal aktivere')
})

test('activate:true eksplisitt — aktiverer', async () => {
  const res = await kall({ activate: true })
  assert.equal(res.status, 200)
  assert.equal(aktiveringer().length, 1)
})

test('kun et eksplisitt false slår av — activate:null aktiverer', async () => {
  // Vakten er `activate === false`, ikke `!activate`. Et slurvete falsy-uttrykk
  // ville gjort null/0/'' til «ikke publiser», altså skjulte quizer fra en
  // kaller som bare sendte noe rart.
  const res = await kall({ activate: null })
  assert.equal(res.status, 200)
  assert.equal(aktiveringer().length, 1)
})

test('activate:false + feilet spørsmålsinnsetting: 500, og quizen ryddes likevel', async () => {
  // Oppryddingen henger på spørsmålsfeilen, ikke på aktiveringssteget — den
  // skal stå uendret når publiseringen er utsatt.
  state.questionsInsertFails = true
  const res = await kall({ activate: false })
  assert.equal(res.status, 500)
  assert.deepEqual(
    skrivinger().map((o) => `${o.table}:${o.action}`),
    ['quizzes:insert', 'questions:insert', 'quizzes:delete']
  )
  assert.deepEqual(aktiveringer(), [])
})
