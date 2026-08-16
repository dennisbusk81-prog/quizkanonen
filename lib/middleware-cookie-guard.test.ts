// Kjøres med:  npm test
//
// Vokter vakten i middleware.ts sin setAll: en Supabase som svarer 500 eller
// 429 på en token-fornyelse skal IKKE kunne logge ut en innlogget bruker.
//
// HVORFOR DENNE TESTEN DRIVES AV DET EKTE BIBLIOTEKET
// Vi har brent oss på tester skrevet ut fra samme resonnement som koden.
// Vakten hviler på to påstander om @supabase/ssr sine INTERNE detaljer:
//   (1) slettinger kommer som `value: ""` PLUSS `options.maxAge === 0`
//   (2) sesjons-cookien heter `sb-<ref>-auth-token`, chunks `.0`, `.1`, …
// Begge er hentet ut ved å lese node_modules. Ville jeg testet dem mot mine
// egne håndlagde objekter, ville testen bare bekreftet at jeg leste likt to
// ganger. Derfor kjører hoveddelen under en EKTE `createServerClient`, med en
// ekte utløpt sesjons-cookie og en stubbet fetch som svarer 500 — og fanger
// det biblioteket faktisk sender inn i setAll. Endrer biblioteket form ved en
// oppgradering, ryker disse testene, og det er meningen.
//
// MUTASJONSBEVIS — kjørt 16. august 2026, ikke antatt:
//   • Fjern `&& !renewed.has(base)` i filterSessionDeletions → CHUNK-KRYMPING
//     ryker (foreldet chunk blir liggende).
//   • Bytt `cookie.value === '' && cookie.options?.maxAge === 0` til bare
//     `cookie.value === ''` → «fornyelse med tom verdi» ryker.
//   • Bytt `endsWith('-auth-token')` til `includes('-auth-token')` →
//     PKCE-testen og authSessionBaseName-testen ryker.
//
// HVA DISSE TESTENE IKKE DEKKER — les dette før du stoler på dem.
// De feller den rene logikken. De kaller `filterSessionDeletions` direkte og
// vet ingenting om `middleware.ts`. Fjerner noen vakten fra `setAll` og lar
// `cookiesToSet` gå rett gjennom igjen, blir ALLE testene her fortsatt
// grønne. Det er nøyaktig feilklassen «mekanisme til stede ≠ mekanisme
// virker»: koblingen mellom vakten og kallstedet er ikke testdekket, den er
// verifisert empirisk (se `[middleware-cookie-guard]`-linjen i Vercel-loggen
// og fremgangsmåten i rapporten). Flytter noen filteret ut av `setAll`, må
// den verifiseringen gjøres på nytt.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServerClient } from '@supabase/ssr'
import {
  authSessionBaseName,
  filterSessionDeletions,
  type CookieToSet,
} from './middleware-cookie-guard'

const PROSJEKT_REF = 'abcdefghijklmnop'
const COOKIE_NAVN = `sb-${PROSJEKT_REF}-auth-token`
const SUPABASE_URL = `https://${PROSJEKT_REF}.supabase.co`

/** Koder en sesjon slik @supabase/ssr lagrer den i cookie (base64url + prefiks). */
function kodetSesjon(sesjon: unknown): string {
  const json = JSON.stringify(sesjon)
  const b64 = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return 'base64-' + b64
}

/** En sesjon som er UTLØPT, slik at getUser() tvinger en fornyelse. */
function utloptSesjon() {
  return {
    access_token: 'gammelt-access-token',
    refresh_token: 'gammelt-refresh-token',
    // expires_at ligger i fortiden → __loadSession kaller _callRefreshToken.
    expires_at: Math.floor(Date.now() / 1000) - 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'bruker-1', aud: 'authenticated', app_metadata: {}, user_metadata: {} },
  }
}

/**
 * Kjører et ekte getUser() der fornyelses-endepunktet svarer `status`, og
 * returnerer alt biblioteket sendte inn i setAll.
 */
async function fangSetAll(status: number): Promise<CookieToSet[]> {
  const mottatt: CookieToSet[] = []

  const klient = createServerClient(SUPABASE_URL, 'anon-key-for-test', {
    cookies: {
      getAll() {
        return [{ name: COOKIE_NAVN, value: kodetSesjon(utloptSesjon()) }]
      },
      setAll(cookiesToSet) {
        mottatt.push(...(cookiesToSet as CookieToSet[]))
      },
    },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/token')) {
          return new Response(JSON.stringify({ error: 'server_error' }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({}), { status: 200 })
      },
    },
  })

  await klient.auth.getUser()
  return mottatt
}

// ── 1. Biblioteket sletter faktisk cookien ved 500 (premisset for vakten) ────

test('EKTE BIBLIOTEK: 500 på fornyelse får @supabase/ssr til å sende slette-cookie', async () => {
  const mottatt = await fangSetAll(500)

  const slettinger = mottatt.filter(
    (c) => c.value === '' && c.options?.maxAge === 0
  )
  assert.ok(
    slettinger.length > 0,
    'Premisset for hele vakten: en 500 skal utløse en sletting. Skjer ikke ' +
      'dette lenger, har biblioteket endret atferd — les vakten på nytt ' +
      'framfor å myke opp testen.'
  )
  assert.ok(
    slettinger.some((c) => authSessionBaseName(c.name) === COOKIE_NAVN),
    'Slettingen skal gjelde selve sesjons-cookien'
  )
})

test('VAKTEN: sletting ved 500 blir droppet, ingenting skrives', async () => {
  const mottatt = await fangSetAll(500)
  const { kept, dropped } = filterSessionDeletions(mottatt)

  assert.ok(dropped.length > 0, 'vakten skal ha blokkert minst én sletting')
  assert.equal(
    kept.filter((c) => authSessionBaseName(c.name) !== null).length,
    0,
    'ingen sesjons-cookie skal bli skrevet — verken til request eller respons'
  )
})

test('VAKTEN: sletting ved 429 blir droppet (ikke-retryable i ALLE auth-js-versjoner)', async () => {
  const mottatt = await fangSetAll(429)
  const { dropped } = filterSessionDeletions(mottatt)

  assert.ok(
    dropped.length > 0,
    '429 er den grunnen en oppgradering IKKE fikser — vakten må ta den'
  )
})

// GATET BAK QK_SLOW_TESTS: denne ene testen tar ~25 sekunder, fordi 503 er
// retryable og auth-js da kjører HELE sin ekte backoff-løkke (budsjettet er
// AUTO_REFRESH_TICK_DURATION_MS = 30 s) før den gir opp. Det er ikke en treg
// test — det er selve målingen av bibliotekets retry-budsjett. Men 25 s på
// hver `npm test` ville endt med at noen kommenterer den ut, og en utkommentert
// test er verre enn ingen. Derfor: hopper over med synlig grunn i vanlig kjøring.
//
// SKAL kjøres ved hver oppgradering av @supabase/ssr / supabase-js
// (se regelen i CLAUDE.md):
//   Git Bash:    QK_SLOW_TESTS=1 npm test
//   PowerShell:  $env:QK_SLOW_TESTS = '1'; npm test
const kjorTrege = process.env.QK_SLOW_TESTS === '1'

test(
  'KONTROLL: 503 er infrastruktur, biblioteket sletter ikke, vakten har ingenting å gjøre',
  { skip: kjorTrege ? false : 'tar ~25 s (ekte auth-js-backoff) — kjør med QK_SLOW_TESTS=1' },
  async () => {
  const mottatt = await fangSetAll(503)
  const { dropped } = filterSessionDeletions(mottatt)

  assert.equal(
    dropped.length,
    0,
    'En retryable status skal ikke engang produsere en sletting. Griper ' +
      'vakten her, betyr det at NETWORK_ERROR_CODES har endret seg.'
  )
  }
)

// ── 2. Fornyelse skal gå uendret gjennom ────────────────────────────────────

test('fornyelse: en vanlig set-oppføring slipper gjennom urørt', () => {
  const batch: CookieToSet[] = [
    { name: COOKIE_NAVN, value: 'base64-nytt', options: { maxAge: 34560000 } },
  ]
  const { kept, dropped } = filterSessionDeletions(batch)

  assert.equal(dropped.length, 0)
  assert.deepEqual(kept, batch)
})

test('CHUNK-KRYMPING: sletting av foreldet chunk slipper gjennom når samme batch fornyer', () => {
  // Nytt token er kortere enn det gamle: `.0` skrives på nytt, `.1` faller
  // bort og MÅ slettes. Blokkerer vi den, blir en utdatert chunk liggende og
  // cookien settes sammen feil ved neste lesing.
  const batch: CookieToSet[] = [
    { name: `${COOKIE_NAVN}.1`, value: '', options: { maxAge: 0 } },
    { name: `${COOKIE_NAVN}.0`, value: 'base64-nytt', options: { maxAge: 34560000 } },
  ]
  const { kept, dropped } = filterSessionDeletions(batch)

  assert.equal(dropped.length, 0, 'chunk-slettingen er del av en fornyelse, ikke en utlogging')
  assert.equal(kept.length, 2)
})

test('uten fornyelse i samme batch blir chunk-slettingen blokkert', () => {
  const batch: CookieToSet[] = [
    { name: `${COOKIE_NAVN}.0`, value: '', options: { maxAge: 0 } },
    { name: `${COOKIE_NAVN}.1`, value: '', options: { maxAge: 0 } },
  ]
  const { kept, dropped } = filterSessionDeletions(batch)

  assert.equal(dropped.length, 2)
  assert.equal(kept.length, 0)
})

// ── 3. Avgrensning: hva vakten IKKE skal røre ───────────────────────────────

test('PKCE: code-verifier skal fortsatt kunne slettes', () => {
  const batch: CookieToSet[] = [
    { name: `${COOKIE_NAVN}-code-verifier`, value: '', options: { maxAge: 0 } },
  ]
  const { kept, dropped } = filterSessionDeletions(batch)

  assert.equal(dropped.length, 0, 'exchangeCodeForSession er avhengig av dette')
  assert.equal(kept.length, 1)
})

test('fremmede cookies røres ikke', () => {
  const batch: CookieToSet[] = [
    { name: 'qk_consent', value: '', options: { maxAge: 0 } },
    { name: 'sb-annet-prosjekt-noe', value: '', options: { maxAge: 0 } },
  ]
  const { dropped } = filterSessionDeletions(batch)

  assert.equal(dropped.length, 0)
})

test('fornyelse med tom verdi men uten maxAge:0 er ikke en sletting', () => {
  // Begge signalene kreves. Med bare `value === ''` ville en slik oppføring
  // blitt feiltolket som utlogging og blokkert.
  const batch: CookieToSet[] = [
    { name: COOKIE_NAVN, value: '', options: { maxAge: 34560000 } },
  ]
  const { dropped } = filterSessionDeletions(batch)

  assert.equal(dropped.length, 0)
})

test('authSessionBaseName kjenner igjen chunks og avviser nabonøkler', () => {
  assert.equal(authSessionBaseName(COOKIE_NAVN), COOKIE_NAVN)
  assert.equal(authSessionBaseName(`${COOKIE_NAVN}.0`), COOKIE_NAVN)
  assert.equal(authSessionBaseName(`${COOKIE_NAVN}.12`), COOKIE_NAVN)
  assert.equal(authSessionBaseName(`${COOKIE_NAVN}-code-verifier`), null)
  assert.equal(authSessionBaseName(`${COOKIE_NAVN}-user`), null)
  assert.equal(authSessionBaseName('qk_consent'), null)
})
