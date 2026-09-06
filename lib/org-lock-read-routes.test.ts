// Kjøres med:  npm test
//
// ORG-LÅSEN PÅ LESERUTENE (7. september 2026).
//
// Invarianten i lib/org-lock-guard.ts: enhver rute som utleverer det betalte
// bedriftsproduktet kaller requireUnlockedOrg — ETTER medlemsgaten, slik at
// en utenforstående ikke får vite om en slug finnes eller hvilken tilstand
// den står i. 17 ruter under /api/org hadde vakten. FEM org-scopede
// leseruter hadde bare medlemsgate og leverte bedriftens liste til et medlem
// av en LÅST bedrift, mens /org/[slug] viste låst-skjerm og OrgCard skjulte
// lenken. Ikke levende i prod 7. september (null låste), men låsen settes
// automatisk av webhooken når en trial løper ut uten kort.
//
// Fila har to lag:
//   • STRUKTURELT: hver av de fem importerer vakten og kaller den nøyaktig én
//     gang, ETTER medlemsgaten. Én fjernet vakt i én rute blir rød alene —
//     det er testen som gjør at hull nummer seks ikke oppstår.
//   • OPPFØRSEL: /api/arkiv/[id]/plassering kjøres med mockede avhengigheter
//     gjennom de fire tilstandene. De fire andre rutene har egne harnesser
//     (lib/toppliste-scope-gate.test.ts, lib/leaderboard-route-blocked.test.ts)
//     som fikk låst-tilfellene lagt til der.
//
// MUTASJONSBEVIS:
//   • Vakten fjernes fra én rute → «hver rute kaller vakten nøyaktig én gang»
//     ryker for den ruten alene.
//   • Vakten flyttes FORAN medlemsgaten → «vakten står etter medlemsgaten» ryker.
//   • /api/toppliste låser også liga-scope → «kun organization låses» ryker.
//   • Klientens literal 'org_locked' drifter fra serverens → «samme kode» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LAAST_KODE, klassifiserAvvisning } from './leaderboard-avvisning'

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

/** Rute → ankeret som avslutter medlemsgaten. Vakten skal stå ETTER dette. */
const RUTER: ReadonlyArray<[string, string]> = [
  ['app/api/toppliste/route.ts',                  "return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })"],
  ['app/api/toppliste/history/route.ts',          "return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })"],
  ['app/api/leaderboard/[id]/route.ts',           'orgMemberIds = gate.memberIds'],
  ['app/api/leaderboard/[id]/prev-rank/route.ts', 'orgMemberIdSet = new Set(gate.memberIds)'],
  ['app/api/arkiv/[id]/plassering/route.ts',      'orgMemberIds = orgGate.memberIds'],
]

for (const [fil, gate] of RUTER) {
  test(`${fil}: importerer og kaller requireUnlockedOrg nøyaktig én gang, ETTER medlemsgaten`, () => {
    const src = aktivKode(fil)
    assert.match(src, /import \{ requireUnlockedOrg \} from '@\/lib\/org-lock-guard'/, `${fil} importerer ikke vakten`)
    // ALLE kall telles, uansett variabelnavn: en mutasjon som la til et EKSTRA
    // kall foran medlemsgaten (`lock0`) overlevde en telling som bare så etter
    // `const lock =`. Ett kall, og det ene skal stå etter gaten.
    const kall = src.match(/requireUnlockedOrg\(/g) ?? []
    assert.equal(kall.length, 1, `${fil} kaller vakten ${kall.length} ganger, ventet 1`)
    assert.match(src, /const lock = await requireUnlockedOrg\(\{ id: [A-Za-z.]+ \}\)/, `${fil}: kallet har ikke husets form`)
    assert.match(src, /if \(!lock\.ok\) return NextResponse\.json\(lock\.body, \{ status: lock\.status \}\)/,
      `${fil} returnerer ikke vaktens status og kropp (403 org_locked / 404 / 503)`)
    const gateIdx = src.indexOf(gate)
    const lockIdx = src.indexOf('requireUnlockedOrg(')
    assert.notEqual(gateIdx, -1, `${fil}: fant ikke medlemsgaten «${gate}»`)
    assert.ok(lockIdx > gateIdx, `${fil}: vakten står FORAN medlemsgaten — en utenforstående ville fått vite om org-en er låst`)
  })
}

test('/api/toppliste og /history låser kun organization-scope — liga har ingen lås', () => {
  for (const fil of ['app/api/toppliste/route.ts', 'app/api/toppliste/history/route.ts']) {
    const src = aktivKode(fil)
    assert.match(src, /if \(scope === 'organization'\) \{\s*const lock = await requireUnlockedOrg\(\{ id: scopeId \}\)/,
      `${fil}: vakten er ikke betinget på scope === 'organization'`)
  }
})

test('klientens LAAST_KODE er ordrett serverens ORG_LOCKED_CODE', () => {
  // Literalen står i lib/leaderboard-avvisning.ts fordi org-lock-guard
  // importerer supabase-admin (server-only). Drifter de to, leser klienten
  // «ikke medlem» igjen.
  const guard = aktivKode('lib/org-lock-guard.ts')
  const m = guard.match(/export const ORG_LOCKED_CODE = '([^']+)'/)
  assert.ok(m, 'fant ikke ORG_LOCKED_CODE')
  assert.equal(LAAST_KODE, m[1])
  assert.equal(klassifiserAvvisning(403, m[1]), 'laast')
})

// ── Oppførsel: /api/arkiv/[id]/plassering gjennom de fire tilstandene ───────

type Gate = { ok: true; orgId: string; memberIds: string[] } | { ok: false; status: 401 | 403; error: string }
type Lock = { ok: true; org: { id: string; slug: string; name: string; plan: string | null; subscription_status: string | null } }
  | { ok: false; status: 403 | 404 | 503; body: { error: string; code?: string } }

const ULAAST: Lock = { ok: true, org: { id: 'org-1', slug: 'elkjop', name: 'Elkjøp Nordic', plan: 'standard', subscription_status: 'trialing' } }
const LAAST: Lock = { ok: false, status: 403, body: { error: 'Bedriftens abonnement er ikke aktivt.', code: 'org_locked' } }

const state: { gate: Gate; lock: Lock; lockKall: number; authUser: { id: string } | null } = {
  gate: { ok: true, orgId: 'org-1', memberIds: ['u-1'] }, lock: ULAAST, lockKall: 0, authUser: { id: 'u-1' },
}

function thenable<T>(data: T) {
  return { then(resolve: (r: { data: T; error: null }) => unknown) { return Promise.resolve({ data, error: null }).then(resolve) } }
}
function builder(rad: Record<string, unknown> | null = null) {
  const b: Record<string, unknown> = {
    select() { return b }, eq() { return b }, in() { return b }, is() { return b }, not() { return b },
    order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, range() { return b },
    async maybeSingle() { return { data: rad, error: null } },
    async single() { return { data: rad, error: rad ? null : { message: 'ingen rad' } } },
    ...thenable([] as never[]),
  }
  return b
}
mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => state.authUser ? { data: { user: state.authUser }, error: null } : { data: { user: null }, error: { message: 'ugyldig' } } },
      from: (table: string) => {
        if (table === 'quizzes') return builder({ id: KOPI, quiz_type: 'archive', source_quiz_id: ORIG, is_test: false, is_active: true, opens_at: null, closes_at: null }) as never
        if (table === 'attempts') return builder({ id: FORSOK, correct_answers: 10, total_time_ms: 60_000, submitted_at: '2026-09-01T12:00:00Z', is_team: false }) as never
        return builder() as never
      },
      rpc: async () => ({ data: [], error: null }),
    },
  },
})
mock.module('@/lib/org-membership', { namedExports: { resolveOrgMembership: async () => state.gate } })
mock.module('@/lib/org-lock-guard', {
  namedExports: {
    requireUnlockedOrg: async () => { state.lockKall += 1; return state.lock },
    ORG_LOCKED_CODE: 'org_locked',
  },
})
mock.module('@/lib/paginate', { namedExports: { fetchAllRows: async () => [], fetchAllRowsChunked: async () => [] } })
mock.module('@/lib/globally-blocked-set', { namedExports: { getGloballyBlockedSet: async () => new Set() } })
mock.module('@/lib/premium-check', { namedExports: { getUserPremium: async () => ({ ok: true as const, value: true }) } })

const KOPI = '11111111-1111-4111-8111-111111111111'
const ORIG = '22222222-2222-4222-8222-222222222222'
const FORSOK = '33333333-3333-4333-8333-333333333333'
const { GET } = await import('@/app/api/arkiv/[id]/plassering/route')
function kall(query: string, token?: string) {
  // Ruten validerer quiz-id og forsøk (UUID) og slår opp quiz + forsøk FØR
  // org-gaten — harnessen må levere alt det for å nå gaten i det hele tatt.
  const qs = `attempt=${FORSOK}${query ? `&${query}` : ''}`
  const request = new Request(`https://quizkanonen.no/api/arkiv/${KOPI}/plassering?${qs}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  return GET(request as never, { params: Promise.resolve({ id: KOPI }) })
}

beforeEach(() => {
  state.gate = { ok: true, orgId: 'org-1', memberIds: ['u-1'] }
  state.lock = ULAAST
  state.lockKall = 0
  state.authUser = { id: 'u-1' }
})

test('plassering: uinnlogget + ?org= → 401, og vakten kalles ikke', async () => {
  state.gate = { ok: false, status: 401, error: 'Ikke innlogget' }
  state.authUser = null
  const res = await kall('org=elkjop')
  assert.equal(res.status, 401)
  assert.equal(state.lockKall, 0, 'vakten ble kalt FØR auth/medlemskap — lekker om org-en er låst')
})

test('plassering: ulåst, ikke-medlem → 403 «Ikke tilgang», vakten kalles ikke', async () => {
  state.gate = { ok: false, status: 403, error: 'Ikke tilgang' }
  const res = await kall('org=elkjop', 'tok')
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, undefined, 'en ikke-medlem skal ikke få vite om org-en er låst')
  assert.equal(state.lockKall, 0)
})

test('plassering: LÅST bedrift, medlem → 403 med code org_locked, ingen plassering i svaret', async () => {
  state.lock = LAAST
  const res = await kall('org=elkjop', 'tok')
  assert.equal(res.status, 403)
  const j = await res.json()
  assert.equal(j.code, 'org_locked')
  assert.equal(j.rank, undefined)
  assert.equal(j.fieldSize, undefined)
  assert.equal(state.lockKall, 1)
})

test('plassering: ulåst bedrift, medlem → ikke avvist, vakten kalt én gang', async () => {
  const res = await kall('org=elkjop', 'tok')
  assert.ok(res.status !== 401 && res.status !== 403, `avvist med ${res.status}`)
  assert.equal(state.lockKall, 1)
})

test('plassering: uten ?org= konsulteres verken medlemsgate eller vakt', async () => {
  const res = await kall('', 'tok')
  assert.ok(res.status !== 403)
  assert.equal(state.lockKall, 0)
})
