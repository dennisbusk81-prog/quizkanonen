// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte /api/org/trial-code/validate-ruten.
//
// MUTASJONSBEVIS
//   • Fjernes throttle-sjekken i ruten, svarer bom nr. 21 med 404 i stedet for
//     429 og grense-testen ryker.
//   • Fjernes insert-en av bom-raden, blir state.logged tom og grense-testen
//     ryker på samme sted.
//   • Endres tellingen til den naive «tell ALLE forsøk», ryker BÅDE
//     «gyldig kode telles aldri» OG «tjue kolleger bak samme NAT-IP». Det er
//     hele begrunnelsen for bom-telling, håndhevet av testen.
//   • Fjernes error-sjekken på kodeoppslaget, blir en DB-feil bokført som bom
//     og «DB-feil på kodeoppslaget bokføres ikke som gjetting» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ORG_TRIAL_CODE_MISS_LIMIT_IP } from './org-trial-code-throttle'

type CodeRow = { code: string; package: string; trial_days: number; used_at: string | null }
type LogRow = { action_type: string; scope_type: string; scope_id: string }

const state: {
  codes: CodeRow[]
  logged: LogRow[]
  countFails: boolean
  lookupFails: boolean
} = { codes: [], logged: [], countFails: false, lookupFails: false }

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

function codesBuilder() {
  let wanted = ''
  const b = {
    select() { return b },
    eq(_col: string, val: string) { wanted = val; return b },
    maybeSingle() {
      if (state.lookupFails) {
        return Promise.resolve({ data: null, error: { message: 'db nede' } })
      }
      return Promise.resolve({
        data: state.codes.find(c => c.code === wanted) ?? null,
        error: null,
      })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'admin_actions') return adminActionsBuilder() as never
        if (table === 'org_trial_codes') return codesBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

const { POST } = await import('@/app/api/org/trial-code/validate/route')

function validate(code: string, ip = '203.0.113.10') {
  const request = new Request('https://quizkanonen.no/api/org/trial-code/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ code }),
  })
  return POST(request as never)
}

beforeEach(() => {
  state.codes = [
    { code: 'K7MPQR2X', package: 'standard', trial_days: 30, used_at: null },
    { code: 'BRUKT123', package: 'starter', trial_days: 14, used_at: '2026-07-01T10:00:00Z' },
  ]
  state.logged = []
  state.countFails = false
  state.lookupFails = false
})

// ── Uendret oppførsel ───────────────────────────────────────────────────────

test('gyldig, ubrukt kode gir pakke og antall prøvedager', async () => {
  const res = await validate('K7MPQR2X')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { valid: true, package: 'standard', trial_days: 30 })
})

test('koden normaliseres til store bokstaver', async () => {
  assert.equal((await validate('k7mpqr2x')).status, 200)
})

test('brukt kode avvises med 409', async () => {
  const res = await validate('BRUKT123')
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /allerede brukt/i)
})

test('ukjent kode avvises med 404', async () => {
  const res = await validate('FINNESIKKE')
  assert.equal(res.status, 404)
})

// ── Bom-telling ─────────────────────────────────────────────────────────────

test('kun bom bokføres — en gyldig kode telles aldri', async () => {
  await validate('K7MPQR2X')
  assert.equal(state.logged.length, 0)
})

test('tjue kolleger bak samme NAT-IP med SAMME gyldige kode bremses aldri', async () => {
  // Dette er hele begrunnelsen for bom-telling i stedet for å telle alle
  // forsøk. Med naiv telling ville forsøk nr. 21 fått 429 — altså ville
  // bremsen truffet nøyaktig den ene B2B-kunden den skulle beskytte.
  for (let i = 0; i < ORG_TRIAL_CODE_MISS_LIMIT_IP + 5; i++) {
    const res = await validate('K7MPQR2X', '198.51.100.7')
    assert.equal(res.status, 200, `ansatt nr. ${i + 1} skal slippe gjennom`)
  }
  assert.equal(state.logged.length, 0)
})

test('«allerede brukt» telles ikke — brukeren låses ikke ute av sin egen kode', async () => {
  // Koden FINNES, så dette er ikke gjetting. Feilmeldingen skal vises hver gang.
  for (let i = 0; i < ORG_TRIAL_CODE_MISS_LIMIT_IP + 5; i++) {
    const res = await validate('BRUKT123')
    assert.equal(res.status, 409)
  }
  assert.equal(state.logged.length, 0)
})

test('grense per IP — 20 bom på en time, så stopper det', async () => {
  for (let i = 0; i < ORG_TRIAL_CODE_MISS_LIMIT_IP; i++) {
    assert.equal((await validate('GJETT' + i)).status, 404, `forsøk ${i + 1}`)
  }
  assert.equal(state.logged.length, ORG_TRIAL_CODE_MISS_LIMIT_IP)

  const blocked = await validate('GJETTMER')
  assert.equal(blocked.status, 429)
  assert.match((await blocked.json()).error, /nettverket/i)

  // Et avvist forsøk skal ikke også bokføres.
  assert.equal(state.logged.length, ORG_TRIAL_CODE_MISS_LIMIT_IP)
})

test('utestengelsen gjelder også den gyldige koden — en gjetter får ikke fortsette', async () => {
  for (let i = 0; i < ORG_TRIAL_CODE_MISS_LIMIT_IP; i++) await validate('GJETT' + i)
  assert.equal((await validate('K7MPQR2X')).status, 429)
})

test('en annen IP har sin egen bøtte — naboen straffes ikke', async () => {
  for (let i = 0; i < ORG_TRIAL_CODE_MISS_LIMIT_IP; i++) {
    await validate('GJETT' + i, '198.51.100.7')
  }
  const other = await validate('K7MPQR2X', '198.51.100.99')
  assert.equal(other.status, 200)
})

test('proxy-kjede endrer ikke bøtta — kun første hopp teller', async () => {
  for (let i = 0; i < ORG_TRIAL_CODE_MISS_LIMIT_IP; i++) {
    await validate('GJETT' + i, '198.51.100.7, 10.0.0.1')
  }
  const blocked = await validate('GJETTMER', '198.51.100.7, 10.0.0.2')
  assert.equal(blocked.status, 429)
})

// ── Feiltilstander ──────────────────────────────────────────────────────────

test('kan ikke telle tidligere forsøk → 503, ingenting bokføres', async () => {
  // Fail closed: en DB-feil skal ikke være omveien rundt grensen.
  state.countFails = true
  const res = await validate('GJETT')
  assert.equal(res.status, 503)
  assert.equal(state.logged.length, 0)
})

test('DB-feil på kodeoppslaget bokføres ikke som gjetting', async () => {
  // Feilen ble tidligere svelget: row=null ble til «Ukjent kode». Med bom-
  // telling ville en ekte kundes GYLDIGE kode da blitt bokført som et bom.
  state.lookupFails = true
  const res = await validate('K7MPQR2X')
  assert.equal(res.status, 503)
  assert.equal(state.logged.length, 0)
})
