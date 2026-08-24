// Kjøres med:  npm test
//
// A16-lukkingen i quiz-BYGGEREN (app/admin/quizzes/new/page.tsx) — flaten
// Dennis faktisk lager fredagsquizen i. Oversiktssiden fikk /reorder-fiksen
// 31. juli (baf36f8); byggeren beholdt begge feilformene:
//
//   A16-2: flytting = to PATCH-kall med absolutte order_index-verdier, som
//          ALDRI kan lykkes under UNIQUE (quiz_id, order_index) — og det
//          lokale byttet ble stående etter feilen.
//   A16-1: refreshQuestionIds resynket id-arrayen ALENE mot DB-rekkefølgen
//          mens innholdsarrayen sto i lokal (byttet) rekkefølge → innhold
//          pekte på feil rad → neste lagring overskrev en annen rads innhold
//          med 200 OK og «Lagret!».
//
// Tre lag her: (1) modelltester som feller DESIGNVALGENE (sekvensiell
// renummerering, tilbakerulling, id-fra-POST-svaret), (2) integrasjonstest av
// at POST-ruten faktisk returnerer den nye radens id, (3) koblingstester som
// binder sidefilen til designet — målt mot AKTIVE linjer (kommentarer
// strippet), jf. «strukturtester trenger linje-anker».
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Sekvensiell renummerering byttes tilbake til Promise.all → «renummerering
//    etter sletting er sekvensiell» ryker (for-anker borte, Promise.all(reqs)
//    tilbake) — og modelltesten viser HVORFOR parallell aldri var trygt.
//   • Tilbakerullingen i moveQuestion fjernes → «nøyaktig tre swapLocal-kall»
//     ryker (2 ≠ 3).
//   • ok-sjekken i moveQuestion fjernes (byttet «lykkes» alltid) → «feilet
//     bytte oppdages» ryker.
//   • refreshQuestionIds gjeninnføres på en aktiv linje → «id-listen resynkes
//     aldri alene» ryker.
//   • saveQuestion slutter å bruke id-en fra POST-svaret → «ny rads id kommer
//     fra POST-svaret» ryker.
//   • POST-ruten slutter å returnere id → integrasjonstesten ryker (og
//     klientens fallback-gren er da eneste vei — den er også ankret).
//   • ok-sjekken i AI-generer-alle-løkken fjernes → «generer-alle utleder
//     kvitteringen» ryker.
//   • 409-redningens re-PATCH kvitteres blindt igjen → «409-redningen utleder
//     kvitteringen» ryker.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Modell: UNIQUE (quiz_id, order_index) som vanlig, ikke-deferrable indeks ─
// Samme modell som lib/question-order-swap.test.ts: hver enkelt skriving
// avvises umiddelbart hvis en annen levende rad har verdien.

type Row = { id: string; orderIndex: number }

class UniqueIndexedTable {
  rows: Row[]

  constructor(rows: Row[]) {
    this.rows = rows
  }

  update(id: string, orderIndex: number): void {
    const row = this.rows.find(r => r.id === id)
    if (!row) throw new Error(`ukjent rad ${id}`)
    const clash = this.rows.find(r => r.id !== id && r.orderIndex === orderIndex)
    if (clash) {
      throw new Error('duplicate key value violates unique constraint "questions_quiz_order_index_unique"')
    }
    row.orderIndex = orderIndex
  }

  indexes(): number[] {
    return this.rows.map(r => r.orderIndex).sort((a, b) => a - b)
  }
}

/** Radene som gjenstår etter at posisjon `deleted` er slettet fra 1..n. */
function afterDelete(n: number, deleted: number): Row[] {
  const rows: Row[] = []
  for (let v = 1; v <= n; v++) {
    if (v !== deleted) rows.push({ id: `rad-${v}`, orderIndex: v })
  }
  return rows
}

test('MUTASJONSBEVIS: parallell renummerering etter sletting kan kollidere med seg selv', () => {
  // Slett spørsmål 1 i en 13-spørsmåls quiz: 12 gjenværende rader (orden
  // 2..13) skal bli 1..12. Parallelle kall har ingen garantert rekkefølge —
  // her en fullt lovlig ankomstrekkefølge (synkende) der nesten hver
  // skriving treffer en verdi som fortsatt er opptatt.
  const t = new UniqueIndexedTable(afterDelete(13, 1))
  const plan = t.rows
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((r, p) => ({ id: r.id, to: p + 1 }))

  assert.throws(() => {
    for (const step of plan.slice().reverse()) t.update(step.id, step.to)
  }, /questions_quiz_order_index_unique/)
})

test('sekvensiell renummerering i stigende rekkefølge kolliderer aldri', () => {
  // Egenskapen koden lener seg på: har radene unike, stigende verdier, er
  // verdien på posisjon j alltid ≥ j+1. Da er målverdien j+1 enten radens
  // egen eller ledig — posisjonene før er alt flyttet til ≤ j, og radene
  // etter holder ≥ j+2. Prøv alle slettinger i en 13-spørsmåls quiz.
  for (let deleted = 1; deleted <= 13; deleted++) {
    const t = new UniqueIndexedTable(afterDelete(13, deleted))
    const plan = t.rows
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((r, p) => ({ id: r.id, to: p + 1 }))

    assert.doesNotThrow(() => {
      for (const step of plan) t.update(step.id, step.to)
    }, `sletting av posisjon ${deleted} skulle renummerere uten kollisjon`)
    assert.deepEqual(t.indexes(), plan.map((_, p) => p + 1))
  }
})

test('sekvensiell renummerering heler også en tilstand med hull', () => {
  // Nøyaktig formen prod-anomalien på Fredagsquiz 07.08.2026 har: [1..14,16].
  const rows: Row[] = []
  for (let v = 1; v <= 14; v++) rows.push({ id: `rad-${v}`, orderIndex: v })
  rows.push({ id: 'rad-16', orderIndex: 16 })
  const t = new UniqueIndexedTable(rows)

  const plan = t.rows
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((r, p) => ({ id: r.id, to: p + 1 }))

  assert.doesNotThrow(() => {
    for (const step of plan) t.update(step.id, step.to)
  })
  assert.deepEqual(t.indexes(), plan.map((_, p) => p + 1))
})

test('A16-1-kjeden: id-resync alene peker innhold på feil rad — tilbakerulling gjør ikke', () => {
  // DB har rad X (orden 1) og rad Y (orden 2). Admin flytter lokalt, byttet
  // feiler i databasen (23505 under det gamle mønsteret).
  const dbOrder = ['id-X', 'id-Y'] // GET, sortert på order_index — uendret
  const localContent = ['innhold-Y', 'innhold-X'] // lokalt bytte, aldri rullet tilbake

  // GAMMEL form: refreshQuestionIds setter id-listen posisjonelt fra DB.
  // Innholdet på lokal indeks 0 er Y — men id-en på indeks 0 er rad X.
  // En retting av en skrivefeil i Y PATCHes nå til rad X: innhold overskrevet.
  const gammelIds = dbOrder
  assert.equal(localContent[0], 'innhold-Y')
  assert.equal(gammelIds[0], 'id-X') // ← feil rad. Dette ER A16-1.

  // NY form: det feilede byttet rulles tilbake i BEGGE arrayene, så
  // koblingen innhold ↔ id består uansett hva databasen rakk å gjøre.
  const rulletTilbakeContent = [localContent[1], localContent[0]]
  assert.equal(rulletTilbakeContent[0], 'innhold-X')
  assert.equal(gammelIds[0], 'id-X') // samme posisjon → riktig rad
})

// ── Integrasjon: POST /api/admin/quizzes/[id]/questions returnerer radens id ─

const state = {
  authed: true,
  insertFails: false,
  inserted: [] as Array<Record<string, unknown>>,
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (_table: string) => ({
        insert: (row: Record<string, unknown>) => {
          state.inserted.push(row)
          return {
            select: (_cols: string) => ({
              single: async () =>
                state.insertFails
                  ? { data: null, error: { message: 'insert feilet' } }
                  : { data: { id: 'ny-rad-id' }, error: null },
            }),
          }
        },
      }),
    },
  },
})

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => state.authed },
})

const routeModule = await import('@/app/api/admin/quizzes/[id]/questions/route')
const { POST } = routeModule

function callPost(body: Record<string, unknown>) {
  return POST(
    new Request('https://quizkanonen.no/api/admin/quizzes/q1/questions', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: 'q1' }) },
  )
}

test('POST returnerer den nye radens id — det som lar editoren slippe id-resync', async () => {
  state.authed = true
  state.insertFails = false
  state.inserted = []
  const res = await callPost({ question_text: 'Hva heter hovedstaden i Norge?', order_index: 3 })
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.ok, true)
  assert.equal(json.id, 'ny-rad-id', 'uten id i svaret må klienten tilbake til posisjonell resync (A16-1)')
  assert.equal(state.inserted.length, 1)
  assert.equal(state.inserted[0].quiz_id, 'q1')
  assert.equal(state.inserted[0].usage_count, 1)
})

test('POST ved insert-feil: 500 og ingen id', async () => {
  state.authed = true
  state.insertFails = true
  const res = await callPost({ question_text: 'x' })
  assert.equal(res.status, 500)
  assert.equal((await res.json()).id, undefined)
  state.insertFails = false
})

test('POST uten gyldig admin-token: 401 og ingen insert', async () => {
  state.authed = false
  state.inserted = []
  const res = await callPost({ question_text: 'x' })
  assert.equal(res.status, 401)
  assert.equal(state.inserted.length, 0)
  state.authed = true
})

// ── Kobling: sidefilen bruker faktisk designet over ─────────────────────────

function activeLines(relPath: string): string[] {
  const raw = readFileSync(join(process.cwd(), relPath), 'utf8')
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('{/*'))
}

const BYGGER = 'app/admin/quizzes/new/page.tsx'

test('flytting går via /reorder, ikke absolutte order_index-PATCHer', () => {
  const lines = activeLines(BYGGER)
  assert.ok(
    lines.some(l => l.includes('/questions/reorder')),
    'moveQuestion må bruke reorder-ruten (swap_question_order) — to PATCH-kall kan aldri lykkes under UNIQUE-indeksen',
  )
  assert.ok(
    lines.some(l => l.includes('questionA: idA')),
    'reorder-kallet må sende de to radenes id-er — det er «bytt disse to», ikke absolutte tall',
  )
  assert.ok(
    !lines.some(l => l.includes('order_index: target + 1')),
    'den gamle absolutt-PATCHen for flytting er tilbake — den taper alltid mot UNIQUE (quiz_id, order_index)',
  )
})

test('feilet bytte oppdages og rulles tilbake: nøyaktig tre swapLocal-kall', () => {
  const lines = activeLines(BYGGER)
  assert.ok(
    lines.some(l => l.includes('if (!res.ok) throw new Error(`reorder HTTP')),
    'moveQuestion må behandle et ikke-ok reorder-svar som feil — ellers består det lokale byttet uten dekning i DB (A16-1 trinn 1)',
  )
  const swapCalls = lines.filter(l => l.includes('swapLocal(i, target)')).length
  assert.equal(
    swapCalls,
    3,
    'nøyaktig tre swapLocal(i, target): optimistisk bytte, TILBAKERULLING ved feil, og lokalt bytte før quizen finnes — faller rullbacken ut, står arrayene byttet uten dekning i DB',
  )
})

test('id-listen resynkes aldri alene', () => {
  const lines = activeLines(BYGGER)
  assert.ok(
    !lines.some(l => l.includes('refreshQuestionIds')),
    'refreshQuestionIds er gjeninnført — id-arrayen resynket alene mot DB-rekkefølgen er selve A16-1-inngangen',
  )
})

test('ny rads id kommer fra POST-svaret, med full relast som eneste fallback', () => {
  const lines = activeLines(BYGGER)
  assert.ok(
    lines.some(l => l.includes('upd[idx] = created.id')),
    'saveQuestion må skrive id-en fra POST-svaret inn på samme indeks som innholdet',
  )
  assert.ok(
    lines.some(l => l.includes('await refreshQuestionsFull(qId)')),
    'fallbacken uten id må være FULL relast (begge arrayene samlet), aldri id-listen alene',
  )
})

test('renummerering etter sletting er sekvensiell og utleder kvitteringen', () => {
  const lines = activeLines(BYGGER)
  assert.ok(
    lines.some(l => l.includes('for (let p = 0; p < newIds.length; p++)')),
    'renummereringen må gå sekvensielt i stigende rekkefølge — parallelle kall kolliderer innbyrdes (se modelltesten øverst)',
  )
  assert.ok(
    !lines.some(l => l.includes('Promise.all(reqs)')),
    'parallell utsending av order_index-PATCHer er tilbake i byggeren',
  )
})

test('AI-generer-alle utleder kvitteringen av svarene', () => {
  const lines = activeLines(BYGGER)
  assert.ok(
    lines.some(l => l.includes('Lagringen stoppet på spørsmål')),
    'generer-alle-løkken må stoppe og si fra ved første ikke-ok svar — før endte en serie 500-er som «Lagret!»',
  )
})

test('409-redningen utleder kvitteringen av re-PATCH-svaret', () => {
  const lines = activeLines(BYGGER)
  assert.ok(
    lines.some(l => l.includes('textRescued = retry.ok')),
    're-PATCHen som redder admins tekstendringer må sjekkes — feiler den, er ingenting lagret',
  )
})
