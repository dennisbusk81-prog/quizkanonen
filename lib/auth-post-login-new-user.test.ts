// Kjøres med:  npm test
//
// `isNewUser` er signalet HELE velkomstsiden gates på, og det er ikke et
// oppslag — det er en påstand om hvilken gren i ensureProfileForUser som ble
// tatt. Derfor må grenene testes direkte: en påstand om «kun én gang» er verdt
// nøyaktig så mye som beviset for at UPDATE-grenen aldri sier true.
//
// MUTASJONSBEVIS — kjørt 6. august 2026, målt (8 tester i baseline):
//   g) `return { isNewUser: false }` i UPDATE-treff-grenen → `true`
//      → 1 faller: «en returnerende bruker er IKKE ny». Dette er testen som
//        holder velkomstsiden borte fra alle 145 eksisterende profiler.
//   h) `return { isNewUser: false }` i insertError-grenen → `true`
//      → 1 faller: «feilet INSERT gir ikke ny bruker».
//   i) `return { isNewUser: true }` nederst → `false`
//      → 3 faller: hovedtilfellet, den kastende velkomstmailen og brukeren
//        uten e-postadresse.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type State = {
  /** Rader UPDATE skal påstå at den traff. */
  updateHits: { id: string }[] | null
  updateError: { code: string; message: string; details: string } | null
  insertError: { code: string; message: string; details: string } | null
  upserts: Record<string, unknown>[]
  emailsSent: { to: string; subject: string }[]
  emailThrows: boolean
}

const state: State = {
  updateHits: [],
  updateError: null,
  insertError: null,
  upserts: [],
  emailsSent: [],
  emailThrows: false,
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from(table: string) {
        assert.equal(table, 'profiles')
        const b = {
          update() { return b },
          eq() { return b },
          // .select('id') avslutter UPDATE-kjeden og gir { data, error }.
          select() {
            return Promise.resolve({ data: state.updateHits, error: state.updateError })
          },
          upsert(row: Record<string, unknown>) {
            state.upserts.push(row)
            return Promise.resolve({ error: state.insertError })
          },
        }
        return b
      },
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (args: { to: string; subject: string }) => {
      if (state.emailThrows) throw new Error('Resend nede')
      state.emailsSent.push({ to: args.to, subject: args.subject })
    },
  },
})

mock.module('@/lib/email-templates', {
  namedExports: { welcomeFreeEmail: (name: string) => `<p>Hei ${name}</p>` },
})

const { ensureProfileForUser } = await import('@/lib/auth-post-login')

const USER = { id: 'user-1', email: 'ny@example.com', user_metadata: {} }

beforeEach(() => {
  state.updateHits = []
  state.updateError = null
  state.insertError = null
  state.upserts = []
  state.emailsSent = []
  state.emailThrows = false
})

// ── Returnerende bruker ──────────────────────────────────────────────────────

test('en returnerende bruker er IKKE ny — UPDATE traff en rad', async () => {
  state.updateHits = [{ id: 'user-1' }]

  const result = await ensureProfileForUser(USER as never)

  assert.deepEqual(result, { isNewUser: false })
  // Og ingen sideeffekter: ingen INSERT, ingen velkomstmail.
  assert.deepEqual(state.upserts, [])
  assert.deepEqual(state.emailsSent, [])
})

// ── Ny bruker ────────────────────────────────────────────────────────────────

test('en ny bruker er ny — UPDATE traff 0 rader, INSERT gikk gjennom', async () => {
  state.updateHits = []

  const result = await ensureProfileForUser(USER as never)

  assert.deepEqual(result, { isNewUser: true })
  assert.equal(state.upserts.length, 1)
  assert.equal(state.upserts[0].id, 'user-1')
  assert.equal(state.emailsSent.length, 1)
})

test('Google-navnet seedes på INSERT — derfor slipper de fleste navnefeltet', async () => {
  state.updateHits = []

  await ensureProfileForUser({ ...USER, user_metadata: { full_name: 'Ola Nordmann' } } as never)

  assert.equal(state.upserts[0].display_name, 'Ola Nordmann')
})

test('e-postbruker får display_name null — det er dem navnefeltet finnes for', async () => {
  state.updateHits = []

  await ensureProfileForUser(USER as never)

  assert.equal(state.upserts[0].display_name, null)
})

// ── Feilgrenene skal alltid falle til «ikke ny» ──────────────────────────────

test('feilet UPDATE gir ikke ny bruker — vi vet ingenting', async () => {
  state.updateError = { code: '500', message: 'nede', details: '' }

  const result = await ensureProfileForUser(USER as never)

  assert.deepEqual(result, { isNewUser: false })
  assert.deepEqual(state.upserts, [])
})

test('feilet INSERT gir ikke ny bruker — det finnes ingen rad å onboarde mot', async () => {
  state.updateHits = []
  state.insertError = { code: '23505', message: 'konflikt', details: '' }

  const result = await ensureProfileForUser(USER as never)

  assert.deepEqual(result, { isNewUser: false })
  assert.deepEqual(state.emailsSent, [])
})

// ── Velkomstmailen må ikke kunne rive med seg signalet ───────────────────────

test('en kastende velkomstmail endrer IKKE at brukeren er ny', async () => {
  state.updateHits = []
  state.emailThrows = true

  const result = await ensureProfileForUser(USER as never)

  assert.deepEqual(result, { isNewUser: true })
})

test('en bruker uten e-postadresse er fortsatt ny', async () => {
  // Var tidligere `if (!user.email) return` — en tidlig retur som etter
  // endringen ville gitt undefined der kalleren venter et objekt.
  state.updateHits = []

  const result = await ensureProfileForUser({ ...USER, email: undefined } as never)

  assert.deepEqual(result, { isNewUser: true })
  assert.deepEqual(state.emailsSent, [])
})
