// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte /api/auth/check-email-ruten.
//
// To ting bevises her:
//   1) at ruten IKKE lenger paginerer gjennom hele auth.users — faken lar
//      listUsers kaste hvis den kalles i det hele tatt
//   2) at oppslagene telles vedvarende per IP, uansett utfall
//
// MUTASJONSBEVIS
//   • Legges pagineringen inn igjen, kaster listUsers og alle oppslagstestene
//     ryker umiddelbart.
//   • Fjernes throttle-sjekken i ruten, svarer oppslag nr. 101 med 200 i stedet
//     for 429 og grense-testen ryker.
//   • Endres tellingen til å telle KUN bom (slik lib/redeem-throttle.ts gjør),
//     ryker «enumerering av eksisterende kontoer bremses også» — det er nettopp
//     treffene en enumerator er ute etter.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { CHECK_EMAIL_LIMIT_IP } from './check-email-throttle'

type AuthUser = { id: string; email: string; providers: string[]; hasPassword: boolean }
type LogRow = { action_type: string; scope_type: string; scope_id: string }

const state: {
  users: AuthUser[]
  logged: LogRow[]
  countFails: boolean
  rpcCalls: number
} = { users: [], logged: [], countFails: false, rpcCalls: 0 }

// admin_actions er både telleren og bokføringen. Faken speiler filtrene ruten
// bruker: action_type + scope_id + created_at. created_at ignoreres — alle
// rader i faken er «nå», altså innenfor vinduet.
function adminActionsBuilder() {
  const filters: Record<string, string> = {}
  const b = {
    select() { return b },
    eq(col: string, val: string) { filters[col] = val; return b },
    gte() { return b },
    insert(row: LogRow) {
      state.logged.push(row)
      return Promise.resolve({ error: null })
    },
    then(resolve: (r: { count: number | null; error: { message: string } | null }) => unknown) {
      if (state.countFails) {
        return Promise.resolve({ count: null, error: { message: 'db nede' } }).then(resolve)
      }
      const count = state.logged.filter(r =>
        Object.entries(filters).every(([col, val]) => r[col as keyof LogRow] === val)
      ).length
      return Promise.resolve({ count, error: null }).then(resolve)
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        admin: {
          listUsers: async () => {
            // Selve poenget med endringen: ingen skal hente hele brukertabellen
            // for å svare på om ÉN e-post finnes.
            throw new Error('paginering gjennom auth.users skal ikke skje lenger')
          },
        },
      },
      from: (table: string) => {
        if (table === 'admin_actions') return adminActionsBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
      // Speiler public.auth_email_lookup i
      // supabase/migrations/20260738000001_auth_email_lookup.sql
      rpc: async (fn: string, params: { p_email: string }) => {
        assert.equal(fn, 'auth_email_lookup')
        state.rpcCalls++
        const treff = state.users.filter(
          u => u.email.toLowerCase() === params.p_email.toLowerCase()
        )
        const forste = treff[0]
        return {
          data: [{
            match_ids: treff.map(u => u.id),
            has_google: forste ? forste.providers.includes('google') : false,
            has_password: forste ? forste.hasPassword : false,
          }],
          error: null,
        }
      },
    },
  },
})

mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

const { POST } = await import('@/app/api/auth/check-email/route')

function check(email: string, phase = 'pre-signup', ip = '203.0.113.10') {
  const request = new Request('https://quizkanonen.no/api/auth/check-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, phase }),
  })
  return POST(request as never)
}

beforeEach(() => {
  state.users = [
    { id: 'u-1', email: 'kari@example.no', providers: ['google'], hasPassword: false },
    { id: 'u-2', email: 'ola@example.no', providers: ['email'], hasPassword: true },
  ]
  state.logged = []
  state.countFails = false
  state.rpcCalls = 0
})

// ── Oppslaget ───────────────────────────────────────────────────────────────

test('eksisterende e-post finnes — uten å hente hele brukertabellen', async () => {
  const res = await check('kari@example.no')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { exists: true, hasPassword: false, hasGoogle: true })
})

test('ukjent e-post gir exists=false, ikke feil', async () => {
  const res = await check('finnesikke@example.no')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { exists: false, hasPassword: false, hasGoogle: false })
})

test('passordkonto rapporteres med hasPassword, ikke hasGoogle', async () => {
  const res = await check('ola@example.no', 'lookup')
  assert.deepEqual(await res.json(), { exists: true, hasPassword: true, hasGoogle: false })
})

test('e-post normaliseres — store bokstaver treffer samme konto', async () => {
  const res = await check('  KARI@Example.NO  ')
  assert.equal((await res.json()).exists, true)
})

test('ett oppslag koster nøyaktig én spørring mot databasen', async () => {
  // Hele grunnen til endringen: kostnaden per kall skal ikke vokse med
  // brukertallet. Blir dette flere kall igjen, er vi tilbake der vi startet.
  await check('kari@example.no')
  assert.equal(state.rpcCalls, 1)
})

test('ingen id-er lekkes til klienten', async () => {
  const res = await check('kari@example.no')
  const json = await res.json()
  assert.deepEqual(Object.keys(json).sort(), ['exists', 'hasGoogle', 'hasPassword'])
  assert.ok(!JSON.stringify(json).includes('u-1'))
})

// ── Bremsing av enumerering ─────────────────────────────────────────────────

test('grense per IP — 100 oppslag på en time, så stopper det', async () => {
  for (let i = 0; i < CHECK_EMAIL_LIMIT_IP; i++) {
    assert.equal((await check(`person${i}@example.no`)).status, 200, `oppslag ${i + 1}`)
  }
  assert.equal(state.logged.length, CHECK_EMAIL_LIMIT_IP)

  const blocked = await check('person999@example.no')
  assert.equal(blocked.status, 429)
  assert.match((await blocked.json()).error, /nettverket/i)
})

test('et avvist oppslag bokføres ikke — utestengelsen forlenger seg ikke selv', async () => {
  for (let i = 0; i < CHECK_EMAIL_LIMIT_IP; i++) await check(`person${i}@example.no`)
  await check('mer@example.no')
  await check('enda-mer@example.no')
  assert.equal(state.logged.length, CHECK_EMAIL_LIMIT_IP)
})

test('enumerering av EKSISTERENDE kontoer bremses også', async () => {
  // Dette er testen som skiller denne ruten fra lib/redeem-throttle.ts. Talte
  // vi kun «bom», ville en angriper som slår opp adresser som faktisk FINNES
  // — altså nøyaktig det de er ute etter — aldri blitt bremset.
  for (let i = 0; i < CHECK_EMAIL_LIMIT_IP; i++) {
    assert.equal((await check('kari@example.no')).status, 200)
  }
  const blocked = await check('kari@example.no')
  assert.equal(blocked.status, 429)
})

test('en annen IP har sin egen bøtte — naboen straffes ikke', async () => {
  for (let i = 0; i < CHECK_EMAIL_LIMIT_IP; i++) {
    await check(`person${i}@example.no`, 'pre-signup', '198.51.100.7')
  }
  const other = await check('uskyldig@example.no', 'pre-signup', '198.51.100.99')
  assert.equal(other.status, 200)
})

test('proxy-kjede endrer ikke bøtta — kun første hopp teller', async () => {
  for (let i = 0; i < CHECK_EMAIL_LIMIT_IP; i++) {
    await check(`person${i}@example.no`, 'pre-signup', '198.51.100.7, 10.0.0.1')
  }
  const blocked = await check('mer@example.no', 'pre-signup', '198.51.100.7, 10.0.0.2')
  assert.equal(blocked.status, 429)
})

test('DB-feil på telleren stopper ikke registrering — vi feiler åpent her', async () => {
  // Bevisst forskjell fra /api/codes/redeem. Kan vi ikke lese admin_actions, er
  // databasen nede, og oppslaget ville uansett feilet. Å feile lukket ville kun
  // byttet feilmelding — og blokkert all registrering ved en forbigående hikke.
  state.countFails = true
  const res = await check('kari@example.no')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).exists, true)
  assert.equal(state.logged.length, 0, 'ingenting bokføres når telleren er nede')
})
