// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// EN LESEFEIL ER IKKE «DU HAR IKKE SPILT NOEN QUIZER» (punkt 4,
// 9. september 2026)
//
// ── FEILEN ──────────────────────────────────────────────────────────────────
// getPlayerHistory sa `if (error || !data) return { items: [], total: 0 }`, og
// count-spørringens `error` ble ikke lest i det hele tatt. En forbigående
// DB-feil ble dermed 200 med tom historikk.
//
// Konsekvensen er mildere enn punkt 6, men varer LENGER: app/historikk/page.tsx
// skriver et vellykket svar til sessionStorage i fem minutter. Brukeren ser
// «du har ikke spilt noen quizer», og å laste siden på nytt — det eneste de
// kan gjøre — hjelper ikke, fordi feilen ligger lagret som et faktum.
//
// ── HVA TESTEN FELLER ───────────────────────────────────────────────────────
// Den kjører den EKTE ruten mot den EKTE getPlayerHistory, med en fake som kan
// feile ÉN spørring om gangen. Per oppslag:
//
//   lesefeil    → 503, ingen `history` i kroppen
//   null rader  → 200 med tom liste (uendret — en ny bruker HAR ingen
//                 historikk, og det er ikke en feil)
//   treff       → 200 med radene
//
// Count-spørringen har egne tester fordi den er SØSKENET i samme funksjon:
// `count ?? 0` ga total = 0 sammen med en full side rader, og klienten regner
// hasMore av nettopp total.
//
// Den siste testen holder klientenden av løftet: feilsvaret skal ikke havne i
// femminutterscachen. Den er STRUKTURELL (den leser kildefila), fordi
// caching-beslutningen bor i en React-komponent uten en egen ren funksjon å
// felle. Kommentarer strippes først, slik at utkommentert kode ikke kan
// oppfylle ankeret.
//
// ── MUTASJONER KJØRT (9. september 2026) ────────────────────────────────────
// Se nederst i filen.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const ME = '00000000-0000-0000-0000-0000000000aa'

type Rad = Record<string, unknown>

const state: { attempts: Rad[] } = { attempts: [] }

/**
 * Hvilken ENKELT spørring som skal feile.
 *
 * Rutet på SELECT-LISTA, ikke på tabellnavnet: `attempts` leses av
 * getPlayerHistory (data + count), getPlayerStats, fetchFieldStats og
 * deltakelsesrekken. En fake som feilet hele tabellen ville felt en helt annen
 * kodesti, og beviset ville ikke bevist noe om vakten vi tester.
 */
let feil: 'ingen' | 'data' | 'count' = 'ingen'

const DATA_SELECT = 'quizzes!inner(title, quiz_type)'

function builder(tabell: string) {
  const filtre: Array<(r: Rad) => boolean> = []
  let selected = ''
  let head = false
  let wantCount = false
  let fra: number | null = null
  let til: number | null = null

  const verdi = (rad: Rad, kol: string): unknown => {
    let v: unknown = rad
    for (const del of kol.split('.')) {
      if (v == null || typeof v !== 'object') return undefined
      v = (v as Rad)[del]
    }
    return v
  }

  const skalFeile = () =>
    (feil === 'data' && selected.includes(DATA_SELECT) && !head) ||
    (feil === 'count' && head && wantCount)

  const rader = (): Rad[] => {
    const alle = tabell === 'attempts' ? state.attempts : []
    let ut = alle.filter(r => filtre.every(f => f(r)))
    if (fra !== null && til !== null) ut = ut.slice(fra, til + 1)
    return ut
  }

  const svar = () => {
    if (skalFeile()) return { data: null, error: { message: '57P01 avbrutt tilkobling' }, count: null }
    const treff = tabell === 'attempts'
      ? state.attempts.filter(r => filtre.every(f => f(r)))
      : []
    if (head) return { data: null, error: null, count: wantCount ? treff.length : null }
    return { data: rader(), error: null, count: wantCount ? treff.length : null }
  }

  const b = {
    select(sel?: string, opts?: { count?: string; head?: boolean }) {
      selected = sel ?? ''
      head = opts?.head === true
      wantCount = opts?.count === 'exact'
      return b
    },
    eq(kol: string, val: unknown) { filtre.push(r => verdi(r, kol) === val); return b },
    is(kol: string, val: unknown) { filtre.push(r => (val === null ? verdi(r, kol) == null : verdi(r, kol) === val)); return b },
    in(kol: string, vals: readonly unknown[]) { filtre.push(r => vals.includes(verdi(r, kol))); return b },
    not(kol: string, _op: string, val: unknown) {
      filtre.push(r => !(verdi(r, kol) === val)); return b
    },
    gt() { return b },
    gte() { return b },
    lt() { return b },
    lte() { return b },
    limit() { return b },
    order() { return b },
    range(f: number, t: number) { fra = f; til = t; return b },
    maybeSingle() {
      const r = svar()
      return Promise.resolve({ data: (r.data ?? [])[0] ?? null, error: r.error })
    },
    then(resolve: (v: ReturnType<typeof svar>) => void) { return resolve(svar()) },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
    },
  },
})

// Premium-gaten er ikke det denne testen handler om.
mock.module('@/lib/premium-check', {
  namedExports: { getUserPremium: async () => ({ ok: true as const, value: true }) },
})

const { GET } = await import('@/app/api/historikk/route')

type Svar = { history?: unknown[]; total?: number; error?: string }

async function hent(query = 'page=0'): Promise<{ status: number; body: Svar }> {
  const res = await GET(
    new Request(`https://quizkanonen.no/api/historikk?${query}`, {
      headers: { Authorization: 'Bearer token' },
    }) as unknown as Parameters<typeof GET>[0]
  )
  return { status: res.status, body: (await res.json()) as Svar }
}

function forsok(id: string, quizType: string): Rad {
  return {
    id, quiz_id: `q-${id}`, user_id: ME,
    correct_answers: 10, total_questions: 15, total_time_ms: 60_000,
    correct_streak: 4, completed_at: '2026-08-01T20:00:00Z',
    quizzes: { id: `q-${id}`, title: `Quiz ${id}`, quiz_type: quizType, is_test: false },
  }
}

beforeEach(() => {
  feil = 'ingen'
  state.attempts = [forsok('a1', 'weekly'), forsok('a2', 'bonus')]
})

// ── Treff og tomt: begge er 200, og de skal ikke kunne forveksles ───────────

test('treff: 200 med radene, og total fra count-spørringen', async () => {
  const { status, body } = await hent()

  assert.equal(status, 200)
  assert.equal(body.history?.length, 2)
  assert.equal(body.total, 2, 'total kommer fra count — den skal være enig med lista')
})

test('null rader: 200 med tom historikk — en ny bruker er ikke en feil', async () => {
  state.attempts = []

  const { status, body } = await hent()

  assert.equal(status, 200, 'tom historikk er et gyldig svar og skal aldri bli 503')
  assert.deepEqual(body.history, [])
  assert.equal(body.total, 0)
})

// ── Lesefeil: 503, og ingen historikk i kroppen ────────────────────────────

test('lesefeil på data-spørringen gir 503 og INGEN historikk', async () => {
  feil = 'data'

  const { status, body } = await hent()

  assert.equal(status, 503)
  assert.equal(body.history, undefined,
    'en tom liste her ville blitt cachet i fem minutter som «du har ikke spilt»')
  assert.equal(body.error, 'Kunne ikke hente historikken akkurat nå. Prøv igjen om litt.')
})

test('lesefeil på COUNT-spørringen gir 503 — søskenet i samme funksjon', async () => {
  feil = 'count'

  const { status, body } = await hent()

  assert.equal(status, 503,
    'count-feilen ble ikke lest i det hele tatt før punkt 4: total ble 0 med full liste')
  assert.equal(body.history, undefined)
  assert.equal(body.error, 'Kunne ikke hente historikken akkurat nå. Prøv igjen om litt.')
})

// ── Arkiv-scopet er et EGET kallsted i ruten ───────────────────────────────

test('scope=archive: treff gir 200', async () => {
  state.attempts = [forsok('a-ark', 'archive')]

  const { status, body } = await hent('scope=archive&page=0')

  assert.equal(status, 200)
  assert.equal(body.history?.length, 1)
})

test('scope=archive: lesefeil gir 503 — ikke bare hovedgrenen er dekket', async () => {
  feil = 'data'
  state.attempts = [forsok('a-ark', 'archive')]

  const { status, body } = await hent('scope=archive&page=0')

  assert.equal(status, 503)
  assert.equal(body.history, undefined)
  assert.equal(body.error, 'Kunne ikke hente historikken akkurat nå. Prøv igjen om litt.')
})

// ── Klientenden: feilsvaret skal ikke inn i femminutterscachen ─────────────

test('app/historikk/page.tsx returnerer på !res.ok FØR den skriver til sessionStorage', () => {
  const raa = fs.readFileSync('app/historikk/page.tsx', 'utf8')
  // Kommentarer strippes: uten dette kan en utkommentert linje — eller denne
  // testens egen forklaring inne i kildefila — oppfylle ankeret.
  const kode = raa
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')

  const cacheSkriv = [...kode.matchAll(/sessionStorage\.setItem\(\s*\n?\s*CACHE_KEY/g)]
  assert.equal(cacheSkriv.length, 1, 'nøyaktig ett sted skriver historikk-cachen')

  const okVakt = kode.match(/if \(!res\.ok\) \{[^}]*setLoadState\('error'\)[^}]*return \}/)
  assert.ok(okVakt, 'vakten «ikke-ok → feilskjerm, og returner» skal stå i load()')

  assert.ok(
    kode.indexOf(okVakt[0]) < cacheSkriv[0].index!,
    'et ikke-ok svar (503-en over) må returnere FØR cachen skrives — ellers ' +
    'lagres feilen som «ingen historikk» i fem minutter'
  )

  // Arkivsvaret har ingen egen retur: det degraderes til «vet ikke», og da
  // skrives cachen ikke i det hele tatt. Ankeret sikrer at gaten fortsatt står.
  assert.match(kode, /if \(arkivJson\) \{\s*\n\s*sessionStorage\.setItem\(/,
    'cachen skrives kun når BEGGE hentingene lyktes')

  assert.match(kode, /const CACHE_TTL = 5 \* 60 \* 1000/,
    'testen handler om nettopp femminutterscachen — anker konstanten')
})

// ── MUTASJONER (kjørt 9. september 2026) ────────────────────────────────────
//
//   1. Sett `return { ok: true, value: { items: [], total: 0 } }` i stedet for
//      `{ ok: false }` i getPlayerHistory
//      → begge lesefeil-testene ryker (200 med tom liste)
//   2. Fjern `countError` fra vaktens betingelse
//      → «lesefeil på COUNT-spørringen» ryker
//   3. Fjern `!historikk.ok`-sjekken i rutens hovedgren (les value uansett)
//      → «lesefeil på data-spørringen» ryker (tsc feller den også)
//   4. Fjern `!arkiv.ok`-sjekken i rutens arkivgren
//      → «scope=archive: lesefeil gir 503» ryker
//   5. Endre vakten til å slå ut på tomt resultat (`data.length === 0`)
//      → «null rader: 200 med tom historikk» ryker
//   6. Flytt sessionStorage.setItem i page.tsx over `if (!res.ok)`-returen
//      → strukturtesten ryker
