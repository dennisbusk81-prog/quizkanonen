// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// ENHETSTEST av den ekte getUserPremium — kun supabase-admin er mocket.
// Route-bindingen (at gatene faktisk KALLER den) felles av integrasjonstestene
// lib/leaderboard-premium-gate-route.test.ts, lib/historikk-premium-gate-route.test.ts
// og lib/leagues-premium-gate-route.test.ts; denne filen feller selve
// dekningsregelen.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Fjernes `orgGraceActive` fra OR-et            → org-karens-testen ryker.
//   • Fjernes `personalGraceActive` fra OR-et       → personlig-karens-testen
//     ryker her OG i begge route-testfilene som setter personal_grace_until.
//   • Ignoreres `error` (gammel isUserPremium-form) → «vet ikke»-testen ryker.
//   • Byttes OR til en `!==`-kjede (XOR)            → KUN begge-karenser-testen
//     ryker (9 av 10 grønne) — den er altså eneste forsvar mot den mutasjonen.
//   • Byttes `> now` til `>= now` fanges ikke — bevisst: et millisekund-eksakt
//     «akkurat nå» har ingen observerbar konsekvens å asserte på.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const BRUKER = '11111111-1111-4111-8111-111111111111'

const OM_TRE_DAGER = () => new Date(Date.now() + 3 * 86_400_000).toISOString()
const FOR_EN_DAG_SIDEN = () => new Date(Date.now() - 86_400_000).toISOString()

type ProfileRow = {
  premium_status: boolean
  org_premium_grace_until: string | null
  personal_grace_until: string | null
}

const state: {
  /** null = ingen profilrad (maybeSingle gir data: null uten feil). */
  row: ProfileRow | null
  lookupFails: boolean
} = { row: null, lookupFails: false }

function row(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    premium_status: false,
    org_premium_grace_until: null,
    personal_grace_until: null,
    ...overrides,
  }
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: () => ({
        select() { return this },
        eq() { return this },
        maybeSingle: async () =>
          state.lookupFails
            ? { data: null, error: { message: 'simulert DB-feil' } }
            : { data: state.row, error: null },
      }),
    },
  },
})

const { getUserPremium } = await import('@/lib/premium-check')

beforeEach(() => {
  state.row = row()
  state.lookupFails = false
})

test('betalt Premium (cache true) gir Premium', async () => {
  state.row = row({ premium_status: true })
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: true })
})

test('ingen dekning gir ikke Premium', async () => {
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: false })
})

test('ORG-karens teller som Premium selv når cachen står false', async () => {
  state.row = row({ org_premium_grace_until: OM_TRE_DAGER() })
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: true })
})

test('UTLØPT org-karens gir ikke Premium', async () => {
  state.row = row({ org_premium_grace_until: FOR_EN_DAG_SIDEN() })
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: false })
})

// I normal drift står cachen true under personlig karens (syncPremiumCache
// regner karensen som dekning). Tilstanden under er feil-kanten: en recalc som
// traff en transient lesefeil i getPersonalGrace skrev false mens karensdatoen
// fortsatt gjelder. Da skal svaret fortsatt være Premium — brukeren står midt
// i Stripes dunning-vindu og har fått e-post om at tilgangen består.
test('PERSONLIG karens teller som Premium selv når cachen står false', async () => {
  state.row = row({ personal_grace_until: OM_TRE_DAGER() })
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: true })
})

test('UTLØPT personlig karens gir ikke Premium', async () => {
  state.row = row({ personal_grace_until: FOR_EN_DAG_SIDEN() })
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: false })
})

// Begge karensene samtidig er nåbart (f.eks. en eldre kunde uten backfillet
// personal_stripe_subscription_id som fjernes fra en org mens personlig karens
// løper). Enkelt-karens-testene over feller ikke et OR byttet til XOR
// (`!==`-kjede) — den mutasjonen gir riktig svar for én aktiv kilde og feil
// for to. Denne gjør det.
test('BEGGE karensene aktive samtidig gir Premium — OR, ikke XOR', async () => {
  state.row = row({
    org_premium_grace_until: OM_TRE_DAGER(),
    personal_grace_until: OM_TRE_DAGER(),
  })
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: true })
})

test('betalt Premium med utløpte karenser er fortsatt Premium (OR, ikke AND)', async () => {
  state.row = row({
    premium_status: true,
    org_premium_grace_until: FOR_EN_DAG_SIDEN(),
    personal_grace_until: FOR_EN_DAG_SIDEN(),
  })
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: true })
})

test('manglende profilrad er et svar («ikke Premium»), ikke en feil', async () => {
  state.row = null
  assert.deepEqual(await getUserPremium(BRUKER), { ok: true, value: false })
})

test('lesefeil er «vet ikke» — aldri en verdi', async () => {
  state.row = row({ premium_status: true })
  state.lookupFails = true
  assert.deepEqual(await getUserPremium(BRUKER), { ok: false })
})
