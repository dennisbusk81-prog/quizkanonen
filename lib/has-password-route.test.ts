// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte /api/profile/has-password-ruten, pluss to
// strukturelle sperrer mot at den gamle sårbarheten kommer tilbake.
//
// BAKGRUNN
// profiles.has_password ble satt av POST /api/auth/mark-password, som tok
// `userId` fra request-body uten en eneste auth-sjekk. Feltet er nå avledet fra
// auth.users.encrypted_password (public.auth_has_password), og skriveruten er
// slettet.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes token-sjekken → «uten token» og «ugyldig token» svarer 200 og ryker.
//   • Leses bruker-id fra query/body i stedet for tokenet (nøyaktig den gamle
//     bugen) → «id-en kommer fra tokenet, aldri fra kalleren» ryker: RPC-en får
//     offer-id-en i stedet for innloggerens.
//   • Byttes `data === true` til `data !== false` e.l. → «ukjent svar tolkes
//     ikke som passord» ryker.
//   • Feiler RPC-en åpent (returnerer hasPassword: true ved feil) → «RPC-feil
//     påstår ikke at kontoen har passord» ryker.
//   • Legges det til en POST/PATCH-handler → «ruten er lese-only» ryker.
//   • Gjenopprettes /api/auth/mark-password, eller et kall til den → de to
//     strukturelle testene nederst ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

type RpcCall = { fn: string; params: { p_user_id: string } }

const state: {
  // token → bruker-id. Alt annet er ugyldig sesjon.
  sessions: Record<string, string>
  // bruker-id → har passord i auth.users
  passwords: Record<string, boolean>
  rpcCalls: RpcCall[]
  rpcFails: boolean
  rpcNull: boolean
} = { sessions: {}, passwords: {}, rpcCalls: [], rpcFails: false, rpcNull: false }

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async (token: string) => {
          const id = state.sessions[token]
          if (!id) return { data: { user: null }, error: { message: 'bad jwt' } }
          return { data: { user: { id } }, error: null }
        },
      },
      // Speiler public.auth_has_password i
      // supabase/migrations/20260804000000_derive_has_password.sql
      rpc: async (fn: string, params: { p_user_id: string }) => {
        state.rpcCalls.push({ fn, params })
        if (state.rpcFails) return { data: null, error: { message: 'funksjon mangler' } }
        // SQL-funksjonen har coalesce(..., false) og skal ALDRI gi null. rpcNull
        // simulerer at den coalescen en dag forsvinner — se testen nederst for
        // hvorfor ruten må tåle det på egen hånd.
        if (state.rpcNull) return { data: null, error: null }
        return { data: state.passwords[params.p_user_id] === true, error: null }
      },
    },
  },
})

mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

const routeModule = await import('@/app/api/profile/has-password/route')
const { GET } = routeModule

function call(token: string | null, url = 'https://quizkanonen.no/api/profile/has-password') {
  const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.10' }
  if (token) headers.authorization = `Bearer ${token}`
  return GET(new Request(url, { method: 'GET', headers }) as never)
}

beforeEach(() => {
  state.sessions = { 'tok-ola': 'u-ola', 'tok-kari': 'u-kari' }
  // Ola har registrert seg med passord, Kari kun med Google.
  state.passwords = { 'u-ola': true, 'u-kari': false }
  state.rpcCalls = []
  state.rpcFails = false
  state.rpcNull = false
})

// ── Avledningen ─────────────────────────────────────────────────────────────

test('passordkonto rapporteres som hasPassword', async () => {
  const res = await call('tok-ola')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { hasPassword: true })
})

test('Google-konto uten passord rapporteres som false', async () => {
  const res = await call('tok-kari')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { hasPassword: false })
})

test('svaret leses fra auth.users, ikke fra profiles', async () => {
  // Hele poenget med endringen: det finnes ingen kolonne å lyve i lenger.
  await call('tok-ola')
  assert.equal(state.rpcCalls.length, 1)
  assert.equal(state.rpcCalls[0].fn, 'auth_has_password')
})

// ── Auth ────────────────────────────────────────────────────────────────────

test('uten token: 401, og databasen røres ikke', async () => {
  const res = await call(null)
  assert.equal(res.status, 401)
  assert.equal(state.rpcCalls.length, 0)
})

test('ugyldig token: 401, og databasen røres ikke', async () => {
  const res = await call('tok-forfalsket')
  assert.equal(res.status, 401)
  assert.equal(state.rpcCalls.length, 0)
})

// ── Kjernen: kalleren kan ikke peke svaret mot noen andre ───────────────────

test('id-en kommer fra tokenet, aldri fra kalleren', async () => {
  // Dette ER den gamle sårbarheten, i motsatt retning. Sender vi Karis id på
  // alle måter en kaller kan finne på, skal svaret fortsatt gjelde Ola.
  const res = await call(
    'tok-ola',
    'https://quizkanonen.no/api/profile/has-password?userId=u-kari&p_user_id=u-kari&id=u-kari'
  )
  assert.equal(res.status, 200)
  assert.equal(state.rpcCalls.length, 1)
  assert.equal(
    state.rpcCalls[0].params.p_user_id,
    'u-ola',
    'ruten slo opp id-en fra query i stedet for fra det verifiserte tokenet'
  )
  assert.deepEqual(await res.json(), { hasPassword: true })
})

test('ingen bruker-id lekkes i svaret', async () => {
  const res = await call('tok-ola')
  const json = await res.json()
  assert.deepEqual(Object.keys(json), ['hasPassword'])
  assert.ok(!JSON.stringify(json).includes('u-ola'))
})

// ── Feilhåndtering ──────────────────────────────────────────────────────────

test('RPC-feil påstår ikke at kontoen har passord', async () => {
  // Feiler vi åpent her, forteller /profil en Google-bruker at de har passord —
  // altså nøyaktig symptomet vi fjernet.
  state.rpcFails = true
  const res = await call('tok-ola')
  assert.equal(res.status, 500)
  assert.equal((await res.json()).hasPassword, undefined)
})

test('bruker som ikke finnes i auth.users gir false', async () => {
  state.sessions['tok-slettet'] = 'u-finnes-ikke'
  const res = await call('tok-slettet')
  assert.deepEqual(await res.json(), { hasPassword: false })
})

test('NULL fra databasen tolkes ikke som passord', async () => {
  // To sperrer dekker samme invariant: coalesce(..., false) i SQL-funksjonen OG
  // `data === true` i ruten. Så lenge coalescen står, kan de maskere hverandre —
  // en oppmykning til `data !== false` ville sett grønn ut i alle andre tester.
  // Her fjernes den ene sperren med vilje, slik at den andre må bære alene.
  state.rpcNull = true
  const res = await call('tok-ola')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { hasPassword: false })
})

// ── Strukturelle sperrer mot gjenoppståelse ─────────────────────────────────

test('ruten er lese-only — ingen skrivehandler finnes', async () => {
  const mod = routeModule as Record<string, unknown>
  for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(mod[verb], undefined, `${verb} skal ikke finnes på denne ruten`)
  }
})

test('den uautentiserte skriveruten finnes ikke, og ingen kaller den', async () => {
  const rot = join(import.meta.dirname, '..')

  assert.ok(
    !existsSync(join(rot, 'app', 'api', 'auth', 'mark-password')),
    '/api/auth/mark-password er gjenopprettet — den satte has_password på en ' +
    'vilkårlig bruker-id uten auth-sjekk'
  )

  // Et gjenglemt kall er like ille som ruten selv: det ville feilet stille i
  // prod og latt noen tro at markeringen fortsatt skjer.
  //
  // Krever at stien står i en streng-literal. Et ekte kall må skrive den slik;
  // kommentarene som forklarer HVORFOR ruten er borte nevner den uten hermetegn,
  // og de skal ikke felle testen — det ville presset fram at forklaringen
  // fjernes, altså akkurat den konteksten neste leser trenger.
  const kallMonster = /['"`]\/api\/auth\/mark-password/
  const treff: string[] = []
  const hoppOver = new Set(['node_modules', '.next', '.git', 'archive'])
  const skann = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (hoppOver.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) skann(full)
      else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts')) {
        if (kallMonster.test(readFileSync(full, 'utf8'))) treff.push(full)
      }
    }
  }
  for (const mappe of ['app', 'components', 'lib']) skann(join(rot, mappe))

  assert.deepEqual(treff, [], 'kall til den slettede mark-password-ruten står igjen')
})
