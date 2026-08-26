// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av de ekte GET /api/historikk og GET /api/historikk/[attemptId].
// `mock.module` bytter ut supabase-admin og lib/history (datahentingen), slik at
// rutene og lib/premium-check kjøres uendret — karensperiodene testes derfor mot
// den EKTE getUserPremium. Samme mal som lib/leaderboard-premium-gate-route.test.ts.
//
// SAKEN (QK_0 [B-3], fikset 19. august 2026): begge rutene gatet direkte på
// `profiles.premium_status` i stedet for getUserPremium. To feilklasser:
//   1. Ingen karens: en bruker i org- eller personlig karens (premium_status
//      false, karensdato frem i tid) fikk 403 på historikken de betaler for.
//   2. `error` ble aldri lest: en transient DB-feil ga `data: null` → 403
//      «Krever premium» (liste-ruta) eller 404 «Profil ikke funnet»
//      (detalj-ruta) for en betalende kunde, uten logg.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Byttes gaten tilbake til den gamle direkte `premium_status`-spørringen
//     (getUserPremium-kallet fjernes)                  → karens- og 503-testene
//       ryker i begge rutene (8 tester).
//   • Fjernes `personalGraceActive` i lib/premium-check → personlig-karens-
//       testene ryker her (2) + i lib/premium-check.test.ts.
//   • Fjernes `!premium.ok`-grenen (feil behandles som verdi) → 503-testene ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ME = '11111111-1111-4111-8111-111111111111'
const ATTEMPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const OM_TRE_DAGER = () => new Date(Date.now() + 3 * 86_400_000).toISOString()
const FOR_EN_DAG_SIDEN = () => new Date(Date.now() - 86_400_000).toISOString()

// Detalj-ruta foretrekker lokal JWT-verifisering når SUPABASE_JWT_SECRET er
// satt — da nås aldri den mockede getUser. Fjern den så begge rutene
// autentiserer gjennom samme mock.
delete process.env.SUPABASE_JWT_SECRET

type ProfileRow = {
  premium_status: boolean
  org_premium_grace_until: string | null
  personal_grace_until: string | null
}

const state: {
  /** null = ingen profilrad (maybeSingle gir data: null uten feil). */
  profile: ProfileRow | null
  premiumLookupFails: boolean
  /** opts fra siste getPlayerHistory-kall — for scope-gjennomføringen. */
  historyOpts: { scope?: string } | undefined
  statsKall: number
} = { profile: null, premiumLookupFails: false, historyOpts: undefined, statsKall: 0 }

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
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
      auth: {
        getUser: async () => ({ data: { user: { id: ME } }, error: null }),
      },
      // Eneste tabelloppslag som gjenstår i rutene er premium-sjekkens
      // profiles-maybeSingle (datahentingen er mocket via lib/history).
      from: () => ({
        select() { return this },
        eq() { return this },
        maybeSingle: async () =>
          state.premiumLookupFails
            ? { data: null, error: { message: 'simulert DB-feil' } }
            : { data: state.profile, error: null },
      }),
    },
  },
})

mock.module('@/lib/history', {
  namedExports: {
    getPlayerHistory: async (_userId: string, opts?: { scope?: string }) => {
      state.historyOpts = opts
      return { items: [{ id: ATTEMPT }], total: 1 }
    },
    getPlayerStats: async () => { state.statsKall++; return { quizCount: 1 } },
    // Kjent forsøk gir en detalj, ukjent gir null — slik den ekte gjør når
    // forsøket ikke finnes eller tilhører noen andre.
    getAttemptDetail: async (attemptId: string) =>
      attemptId === ATTEMPT ? { id: ATTEMPT } : null,
  },
})

const { GET: hentListe } = await import('@/app/api/historikk/route')
const { GET: hentDetalj } = await import('@/app/api/historikk/[attemptId]/route')

async function liste(medToken = true, query = 'page=0'): Promise<Response> {
  const request = new Request(`https://quizkanonen.no/api/historikk?${query}`, {
    headers: medToken ? { authorization: 'Bearer test-token' } : {},
  })
  return hentListe(request as never)
}

async function detalj(attemptId = ATTEMPT, medToken = true): Promise<Response> {
  const request = new Request(`https://quizkanonen.no/api/historikk/${attemptId}`, {
    headers: medToken ? { authorization: 'Bearer test-token' } : {},
  })
  return hentDetalj(request as never, { params: Promise.resolve({ attemptId }) })
}

beforeEach(() => {
  state.profile = profile()
  state.premiumLookupFails = false
  state.historyOpts = undefined
  state.statsKall = 0
})

// ── Positive kontroller: gaten finnes, og Premium slipper gjennom ───────────

test('LISTE uten token gir 401', async () => {
  assert.equal((await liste(false)).status, 401)
})

test('LISTE: gratis bruker får 403', async () => {
  assert.equal((await liste()).status, 403)
})

test('LISTE: Premium får 200 med historikken', async () => {
  state.profile = profile({ premium_status: true })

  const res = await liste()

  assert.equal(res.status, 200)
  const json = await res.json() as { history: unknown[]; total: number }
  assert.equal(json.history.length, 1, 'positiv kontroll: dataene ER hentbare med denne fixturen')
  assert.equal(json.total, 1)
})

test('DETALJ: gratis bruker får 403', async () => {
  assert.equal((await detalj()).status, 403)
})

test('DETALJ: Premium får 200 med detaljen', async () => {
  state.profile = profile({ premium_status: true })

  const res = await detalj()

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { id: ATTEMPT })
})

// ── scope-parameteren (arkivseksjonen, 26. august 2026) ─────────────────────

test('LISTE: scope=archive sendes videre, og svaret er UTEN stats', async () => {
  state.profile = profile({ premium_status: true })

  const res = await liste(true, 'scope=archive&page=0')

  assert.equal(res.status, 200)
  assert.equal(state.historyOpts?.scope, 'archive', 'scope skal nå getPlayerHistory')
  const json = await res.json() as { history: unknown[]; stats?: unknown; total: number }
  assert.equal(json.history.length, 1)
  assert.equal(json.stats, undefined, 'arkiv-svaret skal ikke bære stats')
  assert.equal(state.statsKall, 0,
    'getPlayerStats skal ikke regnes for arkiv-hentingen — den er alltid real-only og dyr')
})

test('LISTE: ukjent scope faller til real — aldri en tredje populasjon', async () => {
  state.profile = profile({ premium_status: true })

  const res = await liste(true, 'scope=whatever&page=0')

  assert.equal(res.status, 200)
  assert.equal(state.historyOpts?.scope, 'real')
  const json = await res.json() as { stats?: unknown }
  assert.ok(json.stats, 'real-svaret bærer stats som før')
  assert.equal(state.statsKall, 1)
})

test('LISTE: scope=archive er fortsatt bak premium-gaten', async () => {
  assert.equal((await liste(true, 'scope=archive&page=0')).status, 403)
})

// ── Karens teller som Premium (feilklasse 1) ─────────────────────────────────

test('LISTE: ORG-karens gir 200 — ikke paywall på historikken de betaler for', async () => {
  state.profile = profile({ org_premium_grace_until: OM_TRE_DAGER() })
  assert.equal((await liste()).status, 200)
})

test('LISTE: PERSONLIG karens (midt i dunning) gir 200', async () => {
  state.profile = profile({ personal_grace_until: OM_TRE_DAGER() })
  assert.equal((await liste()).status, 200)
})

test('LISTE: UTLØPT karens gir 403 — karensen er tidsbegrenset', async () => {
  state.profile = profile({
    org_premium_grace_until: FOR_EN_DAG_SIDEN(),
    personal_grace_until: FOR_EN_DAG_SIDEN(),
  })
  assert.equal((await liste()).status, 403)
})

test('DETALJ: ORG-karens gir 200', async () => {
  state.profile = profile({ org_premium_grace_until: OM_TRE_DAGER() })
  assert.equal((await detalj()).status, 200)
})

test('DETALJ: PERSONLIG karens gir 200', async () => {
  state.profile = profile({ personal_grace_until: OM_TRE_DAGER() })
  assert.equal((await detalj()).status, 200)
})

test('DETALJ: UTLØPT karens gir 403', async () => {
  state.profile = profile({ org_premium_grace_until: FOR_EN_DAG_SIDEN() })
  assert.equal((await detalj()).status, 403)
})

// ── «Vet ikke» er ikke «ikke Premium» (feilklasse 2) ─────────────────────────

test('LISTE: FEILET premium-oppslag gir 503 — ikke 403 til en betalende kunde', async () => {
  state.profile = profile({ premium_status: true })
  state.premiumLookupFails = true

  const res = await liste()

  assert.equal(res.status, 503, 'et forbigående svar, ikke en dom')
  const json = await res.json() as { history?: unknown[]; error?: string }
  assert.equal(json.history, undefined, 'ingen data skal sendes ut i feiltilstand')
  assert.ok(json.error, 'feilen skal være synlig for klienten')
})

test('DETALJ: FEILET premium-oppslag gir 503 — hverken 403 eller den gamle 404-en', async () => {
  state.profile = profile({ premium_status: true })
  state.premiumLookupFails = true

  const res = await detalj()

  assert.equal(res.status, 503)
  assert.notEqual(res.status, 404, 'DB-feil skal ikke lenger forkles som «Profil ikke funnet»')
})

// ── Bevisste grensedragninger ────────────────────────────────────────────────

test('DETALJ: manglende profilrad gir 403, ikke 404 (godkjent endring 19. aug 2026)', async () => {
  // Før: `data: null` → 404 «Profil ikke funnet». Nå behandles en manglende rad
  // som enhver annen ikke-Premium — profil-eksistens skal ikke avsløres her.
  state.profile = null
  assert.equal((await detalj()).status, 403)
})

test('DETALJ: ukjent forsøk gir fortsatt 404 for Premium — den 404-en lever videre', async () => {
  state.profile = profile({ premium_status: true })
  assert.equal((await detalj('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).status, 404)
})
