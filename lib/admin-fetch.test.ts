// Kjøres med:  npm test
//
// adminFetch sender en 401 til innlogging — ett sted, ikke i 72 catch-blokker.
//
// BAKGRUNN (12. august 2026)
// Ingen av de 72 adminFetch-kallene håndterte 401. Mistet nettleseren
// sessionStorage, fyrte siden kall som alle svarte 401; feilmeldingen forsvant
// etter tre sekunder, og igjen sto en tom liste som så ut som en tom database.
//
// HVA TESTENE VOKTER
//  1. At 401 — og BARE 401 — sender til innlogging. En 403 eller 500 skal vise
//     den ekte feilen, ikke gjemme den bak en irrelevant innloggingsside.
//  2. At du kommer TILBAKE dit du var, ellers er redirecten et tap i seg selv.
//  3. At innloggingssiden ikke sender seg selv videre i en løkke.
//  4. At responsen returneres uendret, slik at kallstedene kan rydde opp.
//
// MUTASJONSBEVIS: se rapporten. Alle kjørt med scripts/mutate.mjs, som leser
// filen tilbake fra disk og avbryter hvis mutasjonen ikke står der.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { decideAdminRedirect, adminFetch } from './admin-fetch'
import { adminLoginPath } from './admin-session'

// ── De to veiene til innlogging skal gi SAMME URL ───────────────────────────
//
// Dette er testen som ville fanget bommen 12. august. `next` ble lagt til her,
// i 401-grenen, mens sidenes egen vakt (`isAdminLoggedIn()` false → naken
// /admin/login) fortsatte uendret på tretten sider. Vei 2 var grønn, vei 1 var
// den man faktisk går, og forskjellen var usynlig fordi ingenting sammenlignet
// dem.
//
// Bygges URL-en to steder igjen, ryker denne.
test('401-veien og sidenes vakt gir IDENTISK URL', () => {
  for (const sti of ['/admin/codes', '/admin/quizzes?fane=arkiv', '/admin/users/abc']) {
    assert.equal(
      decideAdminRedirect(401, sti),
      adminLoginPath(sti),
      `de to veiene spriker for ${sti}`,
    )
  }
})

// ── Den rene regelen ────────────────────────────────────────────────────────

test('401 sender til innlogging, med veien tilbake', () => {
  assert.equal(
    decideAdminRedirect(401, '/admin/codes'),
    '/admin/login?next=%2Fadmin%2Fcodes',
  )
})

test('spørrestrengen blir med tilbake', () => {
  // Uten den lander du på riktig side, men i feil tilstand — og en admin som
  // ble avbrutt midt i noe må finne fram på nytt.
  assert.equal(
    decideAdminRedirect(401, '/admin/quizzes?fane=arkiv'),
    '/admin/login?next=%2Fadmin%2Fquizzes%3Ffane%3Darkiv',
  )
})

test('stien er URL-kodet, ikke limt rått inn', () => {
  const url = decideAdminRedirect(401, '/admin/a?b=1&c=2')
  assert.ok(url!.endsWith('%2Fadmin%2Fa%3Fb%3D1%26c%3D2'), url!)
  // Rå & ville blitt lest som en ny parameter og kuttet stien på midten.
  assert.equal(url!.split('&').length, 1, 'et rått & delte URL-en i to parametere')
})

test('KUN 401 — alt annet lar den ekte feilen stå', () => {
  for (const status of [200, 400, 403, 404, 429, 500, 502, 503]) {
    assert.equal(decideAdminRedirect(status, '/admin/codes'), null, `status ${status} redirectet`)
  }
})

test('ingen løkke fra innloggingssiden selv', () => {
  assert.equal(decideAdminRedirect(401, '/admin/login'), null)
  assert.equal(decideAdminRedirect(401, '/admin/login?next=%2Fadmin'), null)
})

// ── Koblingen i adminFetch ──────────────────────────────────────────────────

const g = globalThis as unknown as Record<string, unknown>
let svarStatus = 200

beforeEach(() => {
  svarStatus = 200
  g.window = { location: { pathname: '/admin/codes', search: '', replace: () => {} } }
  g.sessionStorage = {
    getItem: () => 'token',
    setItem: () => {},
    removeItem: () => {},
  }
  g.fetch = async () => new Response('{}', { status: svarStatus })
})

afterEach(() => {
  delete g.window
  delete g.sessionStorage
  delete g.fetch
})

test('en 401 fra serveren utløser navigeringen', async () => {
  svarStatus = 401
  const besøkt: string[] = []

  await adminFetch('/api/admin/codes', {}, url => besøkt.push(url))

  assert.deepEqual(besøkt, ['/admin/login?next=%2Fadmin%2Fcodes'])
})

test('en vellykket forespørsel navigerer ingen steder', async () => {
  const besøkt: string[] = []
  await adminFetch('/api/admin/codes', {}, url => besøkt.push(url))
  assert.deepEqual(besøkt, [])
})

test('responsen returneres UENDRET, også ved 401', async () => {
  // Kallstedene leser `res.ok` og rydder opp (spinner av, loadError satt) mens
  // navigeringen skjer. Kaster vi i stedet, ville 72 catch-blokker fått en feil
  // de ikke har bedt om.
  svarStatus = 401
  const res = await adminFetch('/api/admin/codes', {}, () => {})

  assert.equal(res.status, 401)
  assert.equal(res.ok, false)
})

test('tokenet sendes som x-admin-token', async () => {
  let sendt: HeadersInit | undefined
  g.fetch = async (_u: string, init: RequestInit) => {
    sendt = init.headers
    return new Response('{}', { status: 200 })
  }

  await adminFetch('/api/admin/codes', {}, () => {})

  assert.equal((sendt as Record<string, string>)['x-admin-token'], 'token')
})
