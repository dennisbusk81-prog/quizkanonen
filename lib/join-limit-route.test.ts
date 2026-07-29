// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte join-ruten, med vekt på MEDLEMSGRENSEN.
// `mock.module` bytter kun ut supabase-admin og rate-limit, så ruten kjøres
// uendret — inkludert rekkefølgen mellom «allerede medlem»-sjekken og
// grensesjekken, som er hele poenget med at et eksisterende medlem ikke skal
// kunne låses ute av en grense de allerede er innenfor.
//
// MUTASJONSBEVIS (grense-håndhevingen), verifisert:
//   Fjern `if (!capacity.ok) return 403` i join-ruten
//   → «org PÅ grensen avviser nytt medlem» feiler: status 200, og medlemmet
//     blir faktisk satt inn i organization_members.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ORG_ID = '26e5126f-4c40-4588-9646-aa81d0c6a082'
const INVITE_ID = 'inv-1'
const TOKEN = 'abc123'
const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'

const state: {
  plan: string | null
  memberCount: number
  countError: { message: string } | null
  existingMembership: { organization_id: string } | null
  inserted: Record<string, unknown>[]
  inviteUseCount: number
  premiumUpdates: number
} = {
  plan: 'starter',
  memberCount: 10,
  countError: null,
  existingMembership: null,
  inserted: [],
  inviteUseCount: 3,
  premiumUpdates: 0,
}

function builder(table: string) {
  let counting = false
  let updating: Record<string, unknown> | null = null

  const b = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      counting = opts?.count === 'exact'
      return b
    },
    eq() { return b },
    lt() { return b },
    limit() { return b },
    update(patch: Record<string, unknown>) { updating = patch; return b },
    insert(row: Record<string, unknown>) {
      if (table === 'organization_members') state.inserted.push(row)
      return Promise.resolve({ error: null })
    },
    maybeSingle() {
      if (updating) {
        // CAS-oppdateringen av use_count på invitasjonen
        if (table === 'organization_invites') {
          state.inviteUseCount = Number(updating.use_count)
          return Promise.resolve({ data: { id: INVITE_ID }, error: null })
        }
        return Promise.resolve({ data: { id: 'x' }, error: null })
      }
      if (table === 'organization_invites') {
        return Promise.resolve({
          data: {
            id: INVITE_ID, organization_id: ORG_ID, is_active: true,
            expires_at: null, max_uses: null, use_count: state.inviteUseCount,
          },
          error: null,
        })
      }
      if (table === 'organizations') {
        return Promise.resolve({ data: { slug: 'a1b2c3d4', name: 'Elkjøp Nordic', plan: state.plan }, error: null })
      }
      if (table === 'organization_members') {
        return Promise.resolve({ data: state.existingMembership, error: null })
      }
      if (table === 'profiles') {
        return Promise.resolve({ data: { premium_status: false, premium_source: null, stripe_customer_id: null }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then(resolve: (v: unknown) => void) {
      if (counting && table === 'organization_members') {
        if (state.countError) return resolve({ count: null, error: state.countError })
        return resolve({ count: state.memberCount, error: null })
      }
      if (updating && table === 'profiles') {
        state.premiumUpdates++
        return resolve({ error: null })
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

const { POST } = await import('@/app/api/org/join/[token]/route')

function join() {
  const request = new Request(`https://quizkanonen.no/api/org/join/${TOKEN}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  })
  return POST(request as never, { params: Promise.resolve({ token: TOKEN }) })
}

beforeEach(() => {
  state.plan = 'starter'
  state.memberCount = 10
  state.countError = null
  state.existingMembership = null
  state.inserted = []
  state.inviteUseCount = 3
  state.premiumUpdates = 0
})

// ── Grensen ─────────────────────────────────────────────────────────────────

test('under grensen slipper et nytt medlem inn', async () => {
  state.plan = 'starter'
  state.memberCount = 24

  const res = await join()
  assert.equal(res.status, 200)
  assert.equal(state.inserted.length, 1, 'medlemmet skal være satt inn')
})

test('MUTASJONSMÅL: org PÅ grensen avviser nytt medlem', async () => {
  state.plan = 'starter'
  state.memberCount = 25 // nøyaktig på Starter-grensen

  const res = await join()

  assert.equal(res.status, 403)
  const json = await res.json()
  assert.equal(json.code, 'member_limit_reached')
  assert.match(json.error, /Elkjøp Nordic/, 'meldingen skal navngi bedriften')
  assert.match(json.error, /administratoren/, 'den som blir med kan ikke fikse dette selv')
  assert.equal(state.inserted.length, 0, 'ingen medlemsrad skal opprettes')
  assert.equal(state.premiumUpdates, 0, 'ingen premium skal aktiveres')
})

test('org OVER grensen avviser også — men mister ingen eksisterende', async () => {
  state.plan = 'starter'
  state.memberCount = 40 // vokste over grensen før håndhevingen fantes

  const res = await join()
  assert.equal(res.status, 403)
  assert.equal(state.inserted.length, 0)
})

test('Standard rommer 50 — 25 medlemmer er godt innenfor', async () => {
  state.plan = 'standard'
  state.memberCount = 25

  const res = await join()
  assert.equal(res.status, 200)
  assert.equal(state.inserted.length, 1)
})

test('Standard PÅ 50 avviser', async () => {
  state.plan = 'standard'
  state.memberCount = 50

  const res = await join()
  assert.equal(res.status, 403)
})

test('Pro har ingen grense', async () => {
  state.plan = 'pro'
  state.memberCount = 500

  const res = await join()
  assert.equal(res.status, 200)
  assert.equal(state.inserted.length, 1)
})

test('ukjent plan sperrer ingen ute', async () => {
  state.plan = 'gullpakke'
  state.memberCount = 9999

  const res = await join()
  assert.equal(res.status, 200)
})

// ── Rekkefølge og feilveier ─────────────────────────────────────────────────

test('eksisterende medlem i SAMME org låses ikke ute av grensen', async () => {
  // Rekkefølgen er poenget: «allerede medlem» sjekkes FØR grensen. Ellers ville
  // en ansatt som re-klikker sin egen invitasjonslenke fått en feilmelding om
  // at bedriften er full — av en plass de allerede har.
  state.plan = 'starter'
  state.memberCount = 25
  state.existingMembership = { organization_id: ORG_ID }

  const res = await join()
  assert.equal(res.status, 200)
  assert.equal((await res.json()).slug, 'a1b2c3d4')
  assert.equal(state.inserted.length, 0, 'ingen ny rad — de er allerede med')
})

test('medlem av en ANNEN org får fortsatt 409, ikke grense-feilen', async () => {
  state.plan = 'starter'
  state.memberCount = 25
  state.existingMembership = { organization_id: 'en-annen-org' }

  const res = await join()
  assert.equal(res.status, 409)
  assert.equal((await res.json()).code, 'already_in_org')
})

test('feilende telling slipper ingen inn (503, feiler lukket)', async () => {
  state.countError = { message: 'timeout' }

  const res = await join()
  assert.equal(res.status, 503)
  assert.equal(state.inserted.length, 0)
})

test('invitasjonsplassen brennes ikke når grensen avviser', async () => {
  // Grensesjekken ligger FØR CAS-økingen av use_count. Lå den etter, ville hvert
  // avviste forsøk spist en plass på en invitasjon med max_uses.
  state.plan = 'starter'
  state.memberCount = 25
  const before = state.inviteUseCount

  await join()
  assert.equal(state.inviteUseCount, before, 'use_count skal være urørt')
})
