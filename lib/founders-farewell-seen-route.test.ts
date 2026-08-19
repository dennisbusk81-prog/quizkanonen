// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte POST /api/profile/founders-farewell-seen —
// ruta som gjør founders-farvel-flaten til en engangsmelding. Kun
// supabase-admin er mocket; ruten kjøres uendret. Samme B-3-mønster som
// lib/premium-status-route.test.ts.
//
// Assertions ligger på SIDEEFFEKTENE (hvilken UPDATE som faktisk sendes),
// ikke bare statuskoden — jf. «mutasjonstest: overlappende sperrer».
//
// MUTASJONSBEVIS (alle kjørt, se rapporten 19. august 2026):
//   • Fjernes `.is('founders_farewell_dismissed_at', null)` → «første stempel
//     bevares»-testen ryker.
//   • Fjernes/tommes update-kallet → «stempler egen rad»-testen ryker.
//   • Byttes `.eq('id', user.id)` bort → samme test ryker (radfilteret).
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ME = '22222222-2222-4222-8222-222222222222'

type Update = {
  values: Record<string, unknown>
  eqs: [string, unknown][]
  isFilters: [string, unknown][]
}

const state: { updates: Update[]; updateFails: boolean } = {
  updates: [],
  updateFails: false,
}

function builder() {
  const call: Update = { values: {}, eqs: [], isFilters: [] }
  const b = {
    update(values: Record<string, unknown>) {
      call.values = values
      state.updates.push(call)
      return b
    },
    eq(col: string, val: unknown) { call.eqs.push([col, val]); return b },
    is(col: string, val: unknown) { call.isFilters.push([col, val]); return b },
    // Supabase-builderen er en thenable — ruta await-er hele kjeden.
    then(resolve: (r: { error: { code: string; message: string } | null }) => void) {
      resolve(state.updateFails
        ? { error: { code: 'XX000', message: 'simulert DB-feil' } }
        : { error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async (token: string) =>
          token === 'gyldig-token'
            ? { data: { user: { id: ME } }, error: null }
            : { data: { user: null }, error: { message: 'invalid JWT' } },
      },
      from: () => builder(),
    },
  },
})

const { POST } = await import('@/app/api/profile/founders-farewell-seen/route')

// Egen IP per forespørsel — rateLimit i ruta er EKTE (20/60s per IP).
let ipTeller = 0

async function send(token: string | null = 'gyldig-token'): Promise<number> {
  ipTeller++
  const headers: Record<string, string> = { 'x-forwarded-for': `10.2.0.${ipTeller}` }
  if (token) headers.authorization = `Bearer ${token}`
  const request = new Request('https://quizkanonen.no/api/profile/founders-farewell-seen', {
    method: 'POST',
    headers,
  })
  const res = await POST(request as never)
  return res.status
}

beforeEach(() => {
  state.updates = []
  state.updateFails = false
})

test('UTEN token: 401, og INGEN skriving skjer', async () => {
  assert.equal(await send(null), 401)
  assert.equal(state.updates.length, 0)
})

test('UGYLDIG token: 401, og INGEN skriving skjer', async () => {
  assert.equal(await send('tull'), 401)
  assert.equal(state.updates.length, 0)
})

test('GYLDIG: stempler egen rad — riktig kolonne, riktig radfilter', async () => {
  assert.equal(await send(), 200)

  assert.equal(state.updates.length, 1, 'nøyaktig én UPDATE')
  const u = state.updates[0]

  const stamped = u.values.founders_farewell_dismissed_at
  assert.equal(typeof stamped, 'string', 'stempelet er et tidspunkt, ikke true/false')
  assert.ok(!Number.isNaN(Date.parse(stamped as string)), 'gyldig ISO-tidspunkt')

  assert.deepEqual(u.eqs, [['id', ME]], 'skriver KUN egen rad — id fra verifisert token')
})

test('FØRSTE STEMPEL BEVARES: update er filtrert på at kolonnen er NULL', async () => {
  // Dette er «vises kun én gang»-garantien på serversiden: et nytt kall fra en
  // annen enhet/fane overskriver ikke tidspunktet, og kan aldri nullstille det.
  assert.equal(await send(), 200)

  const u = state.updates[0]
  assert.deepEqual(
    u.isFilters,
    [['founders_farewell_dismissed_at', null]],
    'uten dette filteret ville hvert kall flyttet stempelet',
  )
})

test('DB-FEIL: 500 — «vet ikke» skal ikke se ut som et vellykket stempel', async () => {
  state.updateFails = true
  assert.equal(await send(), 500)
})
