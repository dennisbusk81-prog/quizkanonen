// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av /api/health — uautentisert helsesjekk for ekstern
// overvåkning. Ruten skal ALDRI kaste ut av handleren (Sentrys
// onRequestError fyrer kun på ukastede feil, og denne detektoren skal ikke
// spise Sentry-budsjettet til den andre feilovervåkningen), og skal ALDRI
// lekke detaljer i responsen (ingen feilmelding, ingen DB-info).
//
// MUTASJONSBEVIS (hva hver test faktisk feller):
//   - fjernes try/catch-backstopen → «synkron feil i DB-oppslaget» kaster ut
//     av handleren i stedet for å svare 503, og testen som mocker limit()
//     til å kaste, ryker.
//   - fjernes Promise.race/timeouten → «DB-kallet henger» venter for alltid
//     og testen tikker forbi fristen uten at handleren noensinne resolver.
//   - fjernes rate-limit-sjekken → 31. kallet svarer noe annet enn 429, og
//     DB-mocken telles opp på det kallet den ikke skal nå.
//   - importeres @sentry/nextjs igjen → den strukturelle sperren nederst
//     ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const state: {
  hang: boolean
  fails: boolean
  throwsSync: boolean
  calls: number
} = { hang: false, fails: false, throwsSync: false, calls: 0 }

function builder() {
  return {
    select() { return this },
    limit() {
      state.calls += 1
      if (state.throwsSync) throw new Error('boom — synkron DB-feil')
      if (state.hang) return new Promise(() => {}) // resolver aldri
      if (state.fails) return Promise.resolve({ data: null, error: { message: 'db nede' } })
      return Promise.resolve({ data: [{ id: 1 }], error: null })
    },
  }
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: { from: (_table: string) => builder() },
  },
})

const { GET } = await import('@/app/api/health/route')

function call(ip: string) {
  return GET(
    new Request('https://quizkanonen.no/api/health', {
      headers: { 'x-forwarded-for': ip },
    }) as never
  )
}

beforeEach(() => {
  state.hang = false
  state.fails = false
  state.throwsSync = false
  state.calls = 0
})

// ── Suksess ──────────────────────────────────────────────────────────────

test('DB svarer OK: 200 {ok:true} + no-store', async () => {
  const res = await call('10.0.0.1')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

// ── DB-feil: kontrollert 503, aldri throw ───────────────────────────────

test('DB-kallet returnerer {error}: 503, ingen detaljer, no-store', async () => {
  state.fails = true
  const res = await call('10.0.0.2')
  assert.equal(res.status, 503)
  const body = await res.json()
  assert.deepEqual(body, { ok: false })
  assert.ok(!JSON.stringify(body).toLowerCase().includes('db nede'), 'feilmelding lekket i responsen')
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

test('DB-kallet kaster synkront: handleren RESOLVER likevel (backstop-try/catch)', async () => {
  // Dette er selve mutasjonsbeviset for backstopen: uten den ytre try/catch-en
  // ville denne kastet ut av handleren og aldri nådd assert — testen ville
  // feilet med en ufanget exception, ikke med en assertion.
  state.throwsSync = true
  const res = await call('10.0.0.3')
  assert.equal(res.status, 503)
  assert.deepEqual(await res.json(), { ok: false })
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

// ── Timeout: 503 innen fristen, ingen throw ─────────────────────────────

test('DB-kallet henger: 503 innen 3000ms-fristen, ingen throw', async (t) => {
  state.hang = true
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const promise = call('10.0.0.4')
  t.mock.timers.tick(3000)
  const res = await promise

  assert.equal(res.status, 503)
  assert.deepEqual(await res.json(), { ok: false })
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

// ── Rate-limit: 30/60s per IP, in-memory ────────────────────────────────

test('31. kall fra samme IP innen vinduet gir 429, og databasen kalles IKKE på det kallet', async () => {
  const ip = '10.0.0.5'
  let last: Response | undefined
  for (let i = 0; i < 31; i++) {
    last = await call(ip)
  }
  assert.ok(last)
  assert.equal(last!.status, 429)
  assert.deepEqual(await last!.json(), { ok: false })
  assert.equal(last!.headers.get('cache-control'), 'no-store')

  // De første 30 kalte DB-en (én gang hver — alle var suksess-mocket), det
  // 31. skal IKKE ha lagt til et 31. DB-kall.
  assert.equal(state.calls, 30, 'DB-mocken ble kalt på det 429-blokkerte kallet')
})

test('rate-limit nøkles på IP — en annen IP er upåvirket av forrige tests 31 kall', async () => {
  const res = await call('10.0.0.6')
  assert.equal(res.status, 200)
})

// ── Strukturell sperre: aldri Sentry i denne filen ──────────────────────

test('ruten importerer aldri @sentry/nextjs, og bruker aldri capture*', () => {
  const rot = join(import.meta.dirname, '..')
  const path = join(rot, 'app', 'api', 'health', 'route.ts')
  const source = readFileSync(path, 'utf8')

  // Anker mot AKTIVE linjer — en utkommentert import skal ikke kunne felle
  // eller redde denne testen.
  const activeLines = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))

  const importLines = activeLines.filter((line) => /^\s*import\b/.test(line))
  for (const line of importLines) {
    assert.ok(!line.includes('@sentry'), `Sentry-import funnet: ${line}`)
  }

  const activeSource = activeLines.join('\n')
  assert.ok(!activeSource.includes('captureException'), 'captureException funnet i aktiv kode')
  assert.ok(!activeSource.includes('captureMessage'), 'captureMessage funnet i aktiv kode')

  // Selve mekanismen: handleren skal RESOLVE (aldri kaste) ved DB-feil — det
  // er dette som gjør «ingen Sentry-import» trygt (onRequestError fyrer kun
  // på ukastede feil). Beviset er testen over («handleren RESOLVER likevel»),
  // denne testen bekrefter kun at kildekoden ikke har fått en Sentry-vei inn.
})

test('kun GET finnes — ruten er lese-only', async () => {
  const mod = (await import('@/app/api/health/route')) as Record<string, unknown>
  for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(mod[verb], undefined, `${verb} skal ikke finnes på denne ruten`)
  }
})
