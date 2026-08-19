// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte POST /api/leagues/join, med vekt på at
// MEDLEMSGRENSEN (maks 6) ikke skal kunne omgås av en DB-feil.
//
// SAKEN (19. august 2026): begge count-spørringene leste `count` uten å lese
// `error`. Feilet spørringen ga PostgREST `count: null`, og `(memberCount ?? 0)`
// gjorde «vet ikke» om til «0 medlemmer» — taket var passert uten spor. Den
// etterfølgende TOCTOU-re-sjekken har nøyaktig samme form og falt derfor
// samtidig, så en full liga kunne vokse fritt så lenge feilen varte.
//
// MUTASJONSBEVIS (begge kjørt):
//   • Fjernes `if (memberCountError) return 503` → «pre-sjekken» får 200 og
//     raden ligger igjen i league_members.
//   • Fjernes `if (postCountError) …` → «post-sjekken» får 200 og raden blir
//     stående i stedet for å rulles tilbake.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const LEAGUE_ID = 'f0c1f6c6-2b52-4c3f-8f0f-2f8d4bdc1111'
const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'
const TOKEN = 'invitasjon-123'

const state: {
  memberCount: number
  /** Hvilket count-oppslag (1 = pre-sjekk, 2 = post-insert-re-sjekk) som feiler. */
  failCount: 1 | 2 | null
  countCalls: number
  members: Array<{ league_id: string; user_id: string }>
  /** true = «er du allerede medlem?»-oppslaget feiler. */
  membershipCheckFails: boolean
} = { memberCount: 2, failCount: null, countCalls: 0, members: [], membershipCheckFails: false }

function builder(table: string) {
  let counting = false
  const filters: Record<string, string> = {}

  const b: Record<string, unknown> = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      counting = opts?.count === 'exact'
      return b
    },
    eq(col: string, val: string) { filters[col] = val; return b },
    insert(row: { league_id: string; user_id: string }) {
      state.members.push(row)
      return Promise.resolve({ error: null })
    },
    delete() {
      return {
        eq(col: string, val: string) {
          const inner = {
            eq(col2: string, val2: string) {
              state.members = state.members.filter(
                m => !(m[col as 'league_id'] === val && m[col2 as 'user_id'] === val2)
              )
              return Promise.resolve({ error: null })
            },
          }
          return inner
        },
      }
    },
    maybeSingle() {
      if (table === 'leagues') {
        return Promise.resolve({ data: { id: LEAGUE_ID, name: 'Kontorligaen', slug: 'kontorligaen' }, error: null })
      }
      // league_members: «er du allerede medlem?»
      if (state.membershipCheckFails) {
        return Promise.resolve({ data: null, error: { message: 'simulert DB-feil' } })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then(resolve: (v: unknown) => void) {
      if (counting && table === 'league_members') {
        state.countCalls++
        if (state.failCount === state.countCalls) {
          return resolve({ count: null, error: { message: 'simulert DB-feil' } })
        }
        // Etter innsettingen teller tabellen én til — samme som i basen.
        return resolve({ count: state.memberCount + state.members.length, error: null })
      }
      return resolve({ data: null, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: (table: string) => builder(table),
    },
  },
})

mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => ({ success: true, remaining: 99 }) },
})

const { POST } = await import('@/app/api/leagues/join/route')

function bliMed() {
  const request = new Request('https://quizkanonen.no/api/leagues/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ invite_token: TOKEN }),
  })
  return POST(request as never)
}

beforeEach(() => {
  state.memberCount = 2
  state.failCount = null
  state.countCalls = 0
  state.members = []
  state.membershipCheckFails = false
})

test('normaltilfellet er uendret: plass i ligaen → 200 og medlemskap opprettet', async () => {
  const res = await bliMed()

  assert.equal(res.status, 200)
  assert.equal(state.members.length, 1, 'medlemmet skal være satt inn')
})

test('full liga avvises fortsatt med 403 — vakten endrer ikke normalveien', async () => {
  state.memberCount = 6

  const res = await bliMed()

  assert.equal(res.status, 403)
  assert.equal(state.members.length, 0, 'ingen innsetting når ligaen er full')
})

test('FAIL CLOSED: pre-sjekken kan ikke telles → 503, ingen innmelding', async () => {
  state.failCount = 1

  const res = await bliMed()

  assert.equal(res.status, 503, 'en DB-feil skal ikke være omveien rundt grensen')
  assert.equal(state.members.length, 0, '«vet ikke» skal ikke leses som «tom liga»')
})

test('FAIL CLOSED: post-insert-re-sjekken kan ikke telles → raden rulles tilbake', async () => {
  state.failCount = 2

  const res = await bliMed()

  assert.equal(res.status, 503)
  assert.equal(state.members.length, 0, 'et ubekreftet medlemskap skal ikke bli stående')
})

test('FAIL CLOSED: medlemskaps-sjekken kan ikke leses → 503, ingen innmelding', async () => {
  // Samme klasse som count-sjekkene: «vet ikke» ble til «ikke medlem», og
  // innmeldingen gikk videre til en INSERT som i beste fall avvises av
  // unik-indeksen — da med en 500 i stedet for den ærlige 409-en.
  state.membershipCheckFails = true

  const res = await bliMed()

  assert.equal(res.status, 503)
  assert.equal(state.members.length, 0)
})
