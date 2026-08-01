// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte avmeldingsruten. `mock.module` bytter kun ut
// supabase-admin — token-verifiseringen (lib/unsubscribe.ts) kjøres ekte, slik
// at testene også låser at tokenet er bundet til (uid, type).
//
// KJERNEN: GET skal ALDRI skrive. E-postskannere og lenke-forhåndshentere
// følger lenker i e-post automatisk; lå tilstandsendringen på GET, ble folk
// meldt av uten å ha klikket. `state.updates` teller hver eneste skriving mot
// profiles, så en framtidig GET-skriving kan ikke smyge seg forbi.
//
// MUTASJONSBEVIS: flytt update-blokken fra POST tilbake til GET
//   → «GET skriver ingenting …»-testene feiler (updates.length blir 1)
//   → «POST melder av …»-testene feiler (updates.length blir 0)
// De to gruppene svikter altså i hver sin retning — de tester ikke det samme.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Settes FØR lib/unsubscribe importeres — HMAC-nøkkelen leses per kall, men vi
// vil ha en deterministisk verdi uansett rekkefølge.
process.env.CRON_SECRET = 'test-cron-secret'

const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'
const OTHER_ID = '26e5126f-4c40-4588-9646-aa81d0c6a082'

type Update = { column: string; value: unknown; uid: string }

const state: {
  updates: Update[]
  updateError: { message: string } | null
} = { updates: [], updateError: null }

function builder(table: string) {
  let pending: Record<string, unknown> | null = null

  const b = {
    update(patch: Record<string, unknown>) {
      pending = patch
      return b
    },
    eq(col: string, val: unknown) {
      if (table === 'profiles' && pending && col === 'id') {
        if (!state.updateError) {
          for (const [column, value] of Object.entries(pending)) {
            state.updates.push({ column, value, uid: String(val) })
          }
        }
      }
      return Promise.resolve({ error: state.updateError })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: { from: (table: string) => builder(table) },
  },
})

const { generateUnsubscribeToken, buildUnsubscribeUrl } = await import('@/lib/unsubscribe')
const { GET, POST } = await import('@/app/api/notifications/unsubscribe/route')

const ENDPOINT = 'https://www.quizkanonen.no/api/notifications/unsubscribe'

function url(params: Record<string, string>): string {
  const q = new URLSearchParams(params)
  return `${ENDPOINT}?${q.toString()}`
}

function get(params: Record<string, string>) {
  return GET(new Request(url(params)))
}

/** POST slik nettleseren sender skjemaet: hidden inputs, ingen query-streng. */
function postForm(params: Record<string, string>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(params)) form.set(k, v)
  return POST(new Request(ENDPOINT, { method: 'POST', body: form }))
}

const validParams = (uid = USER_ID, type: 'reminders' | 'reengagement' | 'duel' = 'reminders') => ({
  token: generateUnsubscribeToken(uid, type),
  type,
  uid,
})

beforeEach(() => {
  state.updates = []
  state.updateError = null
})

// ── GET skriver ingenting ───────────────────────────────────────────────────

test('GET med gyldig lenke skriver INGENTING i databasen', async () => {
  // Selve poenget med endringen. En Outlook Safe Links-skanner gjør nøyaktig
  // dette kallet, uten at brukeren har rørt noe.
  const res = await get(validParams())

  assert.equal(res.status, 200)
  assert.deepEqual(state.updates, [])
})

test('GET skriver ingenting for NOEN av de tre varseltypene', async () => {
  for (const type of ['reminders', 'reengagement', 'duel'] as const) {
    await get(validParams(USER_ID, type))
  }
  assert.deepEqual(state.updates, [])
})

test('GET viser en bekreftelse med et POST-skjema, ikke en fullført avmelding', async () => {
  const res = await get(validParams())
  const html = await res.text()

  assert.match(html, /<form[^>]*method="post"/i)
  assert.match(html, /Vil du melde deg av\?/)
  // Suksessteksten skal IKKE stå på bekreftelsessiden — den hører til POST.
  assert.doesNotMatch(html, /Du er avmeldt/)
})

test('skjemaet bærer med seg det samme tokenet lenken kom med', async () => {
  const p = validParams()
  const html = await (await get(p)).text()

  assert.match(html, new RegExp(`name="token" value="${p.token}"`))
  assert.match(html, /name="type" value="reminders"/)
  assert.match(html, new RegExp(`name="uid" value="${USER_ID}"`))
})

test('GET med ugyldig token skriver ingenting og sier fra', async () => {
  const res = await get({ token: 'deadbeef', type: 'reminders', uid: USER_ID })
  const html = await res.text()

  assert.deepEqual(state.updates, [])
  assert.match(html, /Ugyldig lenke/)
  assert.doesNotMatch(html, /<form/i)
})

test('GET uten parametere skriver ingenting', async () => {
  await GET(new Request(ENDPOINT))
  assert.deepEqual(state.updates, [])
})

// ── Bakoverkompatibilitet ───────────────────────────────────────────────────

test('en URL fra buildUnsubscribeUrl — formatet i allerede utsendte e-poster — godtas av GET', async () => {
  // Lenkeformatet er uendret. Knekker denne, har eksisterende e-poster på
  // avveie sluttet å virke.
  const res = await GET(new Request(buildUnsubscribeUrl(USER_ID, 'duel')))
  const html = await res.text()

  assert.equal(res.status, 200)
  assert.match(html, /<form[^>]*method="post"/i)
  assert.doesNotMatch(html, /Ugyldig lenke/)
  assert.deepEqual(state.updates, [])
})

// ── POST er den eneste som endrer noe ───────────────────────────────────────

test('POST melder brukeren av og skriver riktig kolonne på riktig konto', async () => {
  const res = await postForm(validParams())
  const html = await res.text()

  assert.deepEqual(state.updates, [
    { column: 'email_reminders', value: false, uid: USER_ID },
  ])
  assert.match(html, /Du er avmeldt/)
})

test('hver varseltype treffer sin egen kolonne', async () => {
  // Bommer kartet, melder man brukeren av noe annet enn det de ba om.
  const cases = [
    ['reminders', 'email_reminders'],
    ['reengagement', 'email_reengagement'],
    ['duel', 'email_duel_notifications'],
  ] as const

  for (const [type, column] of cases) {
    state.updates = []
    await postForm(validParams(USER_ID, type))
    assert.deepEqual(state.updates, [{ column, value: false, uid: USER_ID }])
  }
})

test('POST med ugyldig token skriver ingenting', async () => {
  const res = await postForm({ token: 'deadbeef', type: 'reminders', uid: USER_ID })

  assert.deepEqual(state.updates, [])
  assert.match(await res.text(), /Ugyldig lenke/)
})

test('et token signert for en ANNEN konto kan ikke melde av min', async () => {
  await postForm({
    token: generateUnsubscribeToken(OTHER_ID, 'reminders'),
    type: 'reminders',
    uid: USER_ID,
  })
  assert.deepEqual(state.updates, [])
})

test('et token signert for en ANNEN varseltype kan ikke gjenbrukes', async () => {
  // Tokenet dekker (uid, type). Uten typen i signaturen kunne én duell-lenke
  // slått av fredagspåminnelsene også.
  await postForm({
    token: generateUnsubscribeToken(USER_ID, 'duel'),
    type: 'reminders',
    uid: USER_ID,
  })
  assert.deepEqual(state.updates, [])
})

test('ukjent type avvises selv med et token som matcher den', async () => {
  await postForm({
    token: generateUnsubscribeToken(USER_ID, 'alt' as never),
    type: 'alt',
    uid: USER_ID,
  })
  assert.deepEqual(state.updates, [])
})

test('POST rett mot lenke-URL-en, uten skjema-body, virker også', async () => {
  // Reserven i postParams: query-strengen brukes når skjemafeltene mangler.
  const res = await POST(new Request(url(validParams()), { method: 'POST' }))

  assert.deepEqual(state.updates, [
    { column: 'email_reminders', value: false, uid: USER_ID },
  ])
  assert.match(await res.text(), /Du er avmeldt/)
})

test('en databasefeil gir feilside, ikke en falsk «du er avmeldt»', async () => {
  state.updateError = { message: 'kaboom' }
  const html = await (await postForm(validParams())).text()

  assert.match(html, /Noe gikk galt/)
  assert.doesNotMatch(html, /Du er avmeldt/)
})
