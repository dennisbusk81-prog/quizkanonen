// Kjøres med:  npm test
//
// Integrasjonstest for timeout- og ukjent-flyten i middleware.ts — den delen
// av F1/F2 unit-testene i lib/middleware-cookie-guard.test.ts IKKE dekker:
// selve kallstedet. Her importeres den EKTE middleware-funksjonen og kjøres
// mot en lokal TCP-server som spiller GoTrue — hengende, feilende eller
// frisk. Ingen håndlagde antakelser om hva biblioteket gjør; det får gjøre
// det selv.
//
// Observasjonspunktet for videresendte request-headere er Nexts egen
// mekanisme: NextResponse.next({ request }) uttrykker dem som
// `x-middleware-request-<navn>`-headere på responsen. Det er samme kanal
// produksjonen bruker — ikke en test-bakdør.
//
// MERK om tid: hang-testen tar ~3 s (det ER fristen den måler). Bevisst
// ikke gatet — den er hele poenget med F1, og 3 s er innenfor det suiten
// tåler. 25-sekunderstesten i middleware-cookie-guard.test.ts er gatet;
// denne skal ikke være det.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { middleware } from '../middleware'

const require = createRequire(import.meta.url)
// CJS-import med createRequire: unngår ESM/CJS-interop-gjettverk om named
// exports fra next/server.js.
const { NextRequest } = require('next/server') as typeof import('next/server')

// FELLE (kostet en feilsøkingsrunde): cookie-navnet er IKKE fritt valgbart.
// supabase-js utleder storageKey av VERTSNAVNET i Supabase-URL-en
// (`sb-${hostname.split('.')[0]}-auth-token`), så mot stubben på 127.0.0.1
// heter cookien `sb-127-auth-token`. Settes den til noe annet, finner
// klienten aldri sesjonen — og alle scenarioene degenererer stille til
// «ingen cookie». Navnet utledes derfor av stub-URL-en i before().
let COOKIE_NAVN = ''

function kodetSesjon(sesjon: unknown): string {
  const json = JSON.stringify(sesjon)
  const b64 = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return 'base64-' + b64
}

function sesjon(utlopt: boolean) {
  return {
    access_token: 'access-token-i-test',
    refresh_token: 'refresh-token-i-test',
    expires_at: Math.floor(Date.now() / 1000) + (utlopt ? -3600 : 3600),
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'bruker-1', aud: 'authenticated', app_metadata: {}, user_metadata: {} },
  }
}

// ── Lokal GoTrue-stub ───────────────────────────────────────────────────────
// `modus` styrer /token-endepunktet per test; /user svarer alltid 200 (det
// er /token-oppførselen som avgjør alle scenarioene). Hengende responser
// spores så de kan besvares i etterkant — IKKE destrueres: et brutalt kutt
// ville fått auth-js til å retry'e mot samme port i opptil 30 s og holdt
// testprosessen i live.
type Modus =
  | { type: 'heng' }
  | { type: 'svar'; status: number; body: unknown }
let modus: Modus = { type: 'heng' }
const ventende: http.ServerResponse[] = []
let server: http.Server
let baseUrl = ''

function svarJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

let envFor: { url?: string; key?: string } = {}

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.includes('/user')) {
      svarJson(res, 200, sesjon(false).user)
      return
    }
    if (modus.type === 'svar') {
      svarJson(res, modus.status, modus.body)
    } else {
      ventende.push(res) // heng: forespørselen er lest, svar kommer aldri
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const adr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${adr.port}`
  COOKIE_NAVN = `sb-${new URL(baseUrl).hostname.split('.')[0]}-auth-token`

  envFor = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = baseUrl
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-i-test'
})

after(async () => {
  // Svar de hengende forespørslene med en ikke-retryable feil så auth-js gir
  // seg umiddelbart og event-loopen kan tømmes — i stedet for å kutte
  // socketen og utløse 30 s med retries mot en død port.
  for (const res of ventende) {
    try {
      svarJson(res, 400, { error: 'invalid_grant' })
    } catch {
      /* allerede lukket */
    }
  }
  // La de sene kodestiene (inkl. et eventuelt setAll-forsøk mot forseglet
  // respons) få kjøre ferdig før serveren lukkes.
  await new Promise((r) => setTimeout(r, 400))
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
  if (envFor.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = envFor.url
  if (envFor.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = envFor.key
})

function lagRequest(opts: { utlopt: boolean; ekstraHeadere?: Record<string, string> }) {
  return new NextRequest('https://www.quizkanonen.no/', {
    headers: new Headers({
      cookie: `${COOKIE_NAVN}=${kodetSesjon(sesjon(opts.utlopt))}`,
      ...opts.ekstraHeadere,
    }),
  })
}

function videresendtHeader(res: Response, navn: string): string | null {
  return res.headers.get(`x-middleware-request-${navn}`)
}

// ── 1. Heng: fristen griper, ukjent settes, cookies urørt ───────────────────

test('HENG: middleware svarer innen fristen med x-qk-auth: unknown og urørte cookies', async () => {
  modus = { type: 'heng' }
  const t0 = Date.now()
  const res = await middleware(lagRequest({ utlopt: true }))
  const brukt = Date.now() - t0

  assert.ok(brukt >= 2500, `svarte etter ${brukt} ms — fristen (3000) skal ha grepet, ikke noe raskere`)
  assert.ok(brukt < 10000, `svarte etter ${brukt} ms — skal være fristen + slingring, ikke plattformens 25 s`)
  assert.equal(videresendtHeader(res, 'x-qk-auth'), 'unknown')
  assert.equal(res.headers.get('set-cookie'), null, 'ingen cookie skal skrives — verken sletting eller fornyelse')
})

// ── 2. Rask 500: vakten blokkerer, og utfallet er UKJENT, ikke gjest ────────

test('RASK 500: sletting blokkeres OG render får unknown-headeren', async () => {
  modus = { type: 'svar', status: 500, body: { error: 'server_error' } }
  const t0 = Date.now()
  const res = await middleware(lagRequest({ utlopt: true }))
  const brukt = Date.now() - t0

  assert.ok(brukt < 2500, `en rask 500 skal ikke vente på fristen (tok ${brukt} ms)`)
  assert.equal(
    videresendtHeader(res, 'x-qk-auth'),
    'unknown',
    'uten denne ville render sett tomt resultat fra getSession() og vist GJEST — løgnen fra D2'
  )
  const setCookie = res.headers.get('set-cookie') ?? ''
  assert.ok(!setCookie.includes('Max-Age=0'), 'slettingen skal være blokkert av vakten')
})

// ── 3. Frisk GoTrue: fornyelsen går som før, ingen unknown ──────────────────

test('FRISK: fornyelse skriver ny cookie og setter IKKE unknown', async () => {
  modus = { type: 'svar', status: 200, body: sesjon(false) }
  const res = await middleware(lagRequest({ utlopt: true }))

  assert.notEqual(videresendtHeader(res, 'x-qk-auth'), 'unknown')
  const setCookie = res.headers.get('set-cookie') ?? ''
  assert.ok(
    setCookie.includes(COOKIE_NAVN),
    'over-blokkerer vakten fornyelser, mister brukeren det roterte tokenet — da skal denne bli rød'
  )
})

// ── 4. Stripping: innkommende x-qk-auth kan ikke nå render ──────────────────

test('STRIPPING: x-qk-auth sendt utenfra videresendes ALDRI', async () => {
  modus = { type: 'svar', status: 200, body: sesjon(false) }
  const res = await middleware(
    lagRequest({ utlopt: false, ekstraHeadere: { 'x-qk-auth': 'unknown' } })
  )

  assert.notEqual(
    videresendtHeader(res, 'x-qk-auth'),
    'unknown',
    'en klient skal ikke kunne sette vårt interne signal'
  )
})
