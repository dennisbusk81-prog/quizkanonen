// Kjøres med:  npm test
//
// INTEGRASJONSTEST av UUID-valideringen i /api/admin/users/[id] (GET + DELETE)
// og /api/admin/users/[id]/suspend (PATCH).
//
// BAKGRUNN
// Rutene tok `id` rått fra URL-stien og sendte den inn i .eq('id', id) mot
// uuid-kolonner. En e-postadresse limt inn i adressefeltet ga
// `22P02 invalid input syntax for type uuid: "dennis.busk@elkjop.no"` i
// prod-loggen 15. august 2026. Søsken-rutene (start-attempt, questions,
// cleanup-orgs) hadde allerede UUID_RE — disse manglet den.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes UUID-sjekken i GET → «GET med e-post som id» ryker: ruten går
//     videre til profiles-oppslaget (fromCalls > 0) og svarer 404, ikke 400.
//   • Fjernes sjekken i DELETE → «DELETE med e-post som id» ryker: getUserById
//     kalles med e-posten og svaret blir 404, ikke 400.
//   • Fjernes sjekken i suspend → «PATCH suspend med e-post som id» ryker:
//     update-spørringen når databasen (fromCalls > 0).
//   • Strammes regexen slik at gyldige UUID-er avvises (f.eks. kun lowercase)
//     → «gyldig uuid passerer» / «uppercase uuid passerer» ryker.
//   • Flyttes sjekken FORAN admin-auth → «uten admin-token: 401 også for
//     ugyldig id» ryker (svaret skal ikke røpe valideringsregler uautentisert).
//
// Mutasjonen «fjern sjekken i GET» er kjørt manuelt og bekreftet rød —
// se commit-meldingen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const state = {
  adminOk: true,
  fromCalls: [] as string[],
  getUserByIdCalls: [] as string[],
}

// Kjedbar spørringsbygger som aldri når en ekte database: alle kjedemetoder
// returnerer byggeren selv, maybeSingle gir «ingen rad», og byggeren er
// thenable (suspend await-er .update().eq().select() direkte) med 0 rader.
function builder() {
  const b: Record<string, unknown> = {}
  const chain = () => b
  for (const m of ['select', 'eq', 'update', 'delete', 'insert', 'order', 'in', 'or', 'is', 'not', 'gt', 'limit']) {
    b[m] = chain
  }
  b.maybeSingle = async () => ({ data: null, error: null })
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve)
  return b
}

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => state.adminOk },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        state.fromCalls.push(table)
        return builder()
      },
      rpc: async () => ({ data: null, error: null }),
      auth: {
        admin: {
          getUserById: async (id: string) => {
            state.getUserByIdCalls.push(id)
            return { data: { user: null }, error: null }
          },
        },
      },
    },
  },
})

const idRoute = await import('@/app/api/admin/users/[id]/route')
const suspendRoute = await import('@/app/api/admin/users/[id]/suspend/route')

const GYLDIG_UUID = '2b0f8a4e-1c3d-4e5f-8a6b-9c0d1e2f3a4b'
const EPOST_ID = 'dennis.busk@elkjop.no'

function req(method: string, body?: unknown) {
  return new Request(`https://quizkanonen.no/api/admin/users/${EPOST_ID}`, {
    method,
    headers: { 'x-admin-token': 'test' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as never
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  state.adminOk = true
  state.fromCalls = []
  state.getUserByIdCalls = []
})

// ── Ugyldig id stoppes FØR databasen ────────────────────────────────────────

test('GET med e-post som id: 400, og databasen røres ikke', async () => {
  const res = await idRoute.GET(req('GET'), params(EPOST_ID))
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'Ugyldig bruker-id' })
  assert.equal(state.fromCalls.length, 0, 'profiles-oppslaget skulle aldri vært kjørt')
  assert.equal(state.getUserByIdCalls.length, 0)
})

test('DELETE med e-post som id: 400, og getUserById kalles ikke', async () => {
  // Gyldig body med vilje: uten UUID-sjekken ville forespørselen passert
  // body-parsingen og nådd getUserById med e-posten — testen skiller altså
  // valideringens 400 fra andre 400-grener i handleren.
  const res = await idRoute.DELETE(req('DELETE', { confirmEmail: 'x@y.no' }), params(EPOST_ID))
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'Ugyldig bruker-id' })
  assert.equal(state.getUserByIdCalls.length, 0)
  assert.equal(state.fromCalls.length, 0)
})

test('PATCH suspend med e-post som id: 400, og databasen røres ikke', async () => {
  const res = await suspendRoute.PATCH(req('PATCH'), params(EPOST_ID))
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'Ugyldig bruker-id' })
  assert.equal(state.fromCalls.length, 0)
})

test('tom og SQL-aktig id avvises også', async () => {
  for (const id of ['', 'abc', "1 OR 1=1", `${GYLDIG_UUID} `]) {
    const res = await idRoute.GET(req('GET'), params(id))
    assert.equal(res.status, 400, `id ${JSON.stringify(id)} skulle gitt 400`)
  }
  assert.equal(state.fromCalls.length, 0)
})

// ── Gyldige UUID-er er upåvirket — ruten går videre til oppslaget ───────────

test('gyldig uuid passerer valideringen og når profiles-oppslaget', async () => {
  const res = await idRoute.GET(req('GET'), params(GYLDIG_UUID))
  // Mocken har ingen rader, så riktig svar ETTER validering er 404 — ikke 400.
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: 'Bruker ikke funnet' })
  assert.deepEqual(state.fromCalls, ['profiles'])
})

test('uppercase uuid passerer (samme case-toleranse som søsken-rutene)', async () => {
  const res = await idRoute.GET(req('GET'), params(GYLDIG_UUID.toUpperCase()))
  assert.equal(res.status, 404)
})

test('gyldig uuid i suspend når update-spørringen', async () => {
  const res = await suspendRoute.PATCH(req('PATCH'), params(GYLDIG_UUID))
  // 0 rader oppdatert → 404, som er rutens etablerte «bruker finnes ikke»-svar.
  assert.equal(res.status, 404)
  assert.deepEqual(state.fromCalls, ['profiles'])
})

test('gyldig uuid i DELETE når getUserById', async () => {
  const res = await idRoute.DELETE(req('DELETE', { confirmEmail: 'x@y.no' }), params(GYLDIG_UUID))
  assert.equal(res.status, 404)
  assert.deepEqual(state.getUserByIdCalls, [GYLDIG_UUID])
})

// ── Rekkefølge: auth først, validering etterpå ──────────────────────────────

test('uten admin-token: 401 også for ugyldig id', async () => {
  state.adminOk = false
  const res = await idRoute.GET(req('GET'), params(EPOST_ID))
  assert.equal(res.status, 401)
  assert.equal(state.fromCalls.length, 0)
})
