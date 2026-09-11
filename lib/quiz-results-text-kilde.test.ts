// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Delingsteksten skal LESE DET SYNLIGE FELTET — ikke telle selv.
//
// BAKGRUNN (11. september 2026)
// `/api/admin/quiz-results-text` talte og rangerte rått på `attempts`:
// `.eq('is_team', false)`, ingen dedup, ingen submitted-filter, og — det som
// betyr noe — ingen global blokkerings-gate. Teksten limes rett inn på
// Facebook, så konsekvensen var at spillere som har meldt seg ut av den åpne
// konkurransen ble publisert med navn og plassering.
//
// Målt på Fredagsquiz 11.09.2026: teksten sa 67 der bildet og den offentlige
// lista sa 64. De tre var medlemmer av samme bedrift med
// `organization_members.global_league_opt_out = true` — verifisert mot prod,
// ikke antatt. Én av dem sto på 7. plass i teksten.
//
// Dette er et SAMTYKKEPROBLEM, ikke en visningsfeil, og testene under er
// skrevet deretter.
//
// ── TO LAG, MED VILJE ──────────────────────────────────────────────────────
// 1. INTEGRASJON: den ekte POST-handleren kjøres med `mock.module`. Supabase-
//    mocken KASTER hvis ruten så mye som rører `attempts`. Det er selve
//    beviset: teksten kan ikke ha en egen populasjon, for den har ingen vei
//    til rådataene i det hele tatt.
// 2. STRUKTUR: fila leses som tekst og må importere + kalle
//    `getPublicSnapshot`, uten et eget `from('attempts')` igjen. Fanger en
//    framtidig kopi som integrasjonstesten ikke ville nådd (f.eks. bak en
//    gren som mocken ikke utløser).
//
// Kommentarer strippes før strukturtesten. Uten det ville rutens EGEN
// kommentar — som siterer `.eq('is_team', false)` for å forklare historikken —
// holdt fraværstesten grønn med spørringen tilbake i koden.
//
// MUTASJONSBEVIS. Hver mutasjon faktisk skrevet til route.ts, forekomstene
// talt før og etter, testene kjørt, deretter rullet tilbake. Baseline 14/14
// grønne både før og etter. Antall FEILENDE tester per mutasjon:
//   • et eget `attempts`-tellende oppslag lagt tilbake inn      → 11
//   • `kallenavn || profil?.display_name` → bare display_name   → 1
//   • lokal sekund-formatter i stedet for lib/resultat-tid      → 2
//   • `spillere.slice(0, 10)` → `slice(0, 11)`                  → 1
//
// Den første er den viktigste: 11 av 14 faller straks ruten skaffer seg en
// egen populasjon, fordi supabase-mocken nekter å svare på `attempts` i det
// hele tatt.

import { test, mock, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const QUIZ_ID = 'quiz-1'

// Feltet slik `getPublicSnapshot` leverer det: ALLEREDE filtrert (de utmeldte
// er borte) og ALLEREDE rangert, med posisjonell rank 1..N uten hull.
type Snapshot = {
  id: string
  user_id: string | null
  player_name: string
  rank: number
  correct_answers: number
  total_time_ms: number
  correct_streak: number
}

const state: {
  publicSnapshot: Snapshot[]
  profiles: { id: string; display_name: string | null; nickname: string | null }[]
  seasonPointsAwarded: boolean | null
} = { publicSnapshot: [], profiles: [], seasonPointsAwarded: true }

// Den utmeldte. Han ligger ALDRI i `publicSnapshot` — det er nettopp jobben
// gaten gjør — og testen nedenfor krever at navnet hans ikke finnes i teksten.
const UTMELDT_NAVN = 'Nils Martin Øyo'

function spiller(n: number, over: Partial<Snapshot> = {}): Snapshot {
  return {
    id: `a${n}`,
    user_id: `u${n}`,
    player_name: `Spiller ${n}`,
    rank: n,
    correct_answers: 20 - n,
    total_time_ms: 60_000 + n * 1000,
    correct_streak: 5,
    ...over,
  }
}

mock.module('@/lib/admin-auth', {
  namedExports: { verifyAdminRequest: () => true },
})

mock.module('@/lib/public-snapshot', {
  namedExports: {
    getPublicSnapshot: async (quizId: string) => {
      assert.equal(quizId, QUIZ_ID, 'ruten spurte om feil quiz')
      return {
        snapshot: state.publicSnapshot,
        publicSnapshot: state.publicSnapshot,
        blocked: new Set<string>(),
      }
    },
  },
})

// Spørsmålsstatistikken er ikke det som testes her; den slås av ved å svare
// med et tomt kart, slik at «letteste/vanskeligste» utelates fra teksten.
mock.module('@/lib/attempt-answer-stats', {
  namedExports: { getQuestionStatsByAttempts: async () => new Map() },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from(table: string) {
        // ── KJERNEN I TESTEN ────────────────────────────────────────────────
        // Ruten har ingen lovlig grunn til å røre `attempts`. Gjør den det,
        // har den skaffet seg en egen populasjon igjen, og da skal denne
        // testen falle — ikke bli grønn fordi tallene tilfeldigvis stemte.
        assert.notEqual(
          table, 'attempts',
          'delingsteksten leste `attempts` direkte — populasjonen skal komme fra getPublicSnapshot',
        )
        assert.ok(
          table === 'quizzes' || table === 'profiles',
          `uventet tabell i delingsteksten: ${table}`,
        )
        const b = {
          select() { return b },
          eq() { return b },
          in() { return b },
          order() { return b },
          range() {
            return Promise.resolve({ data: state.profiles, error: null })
          },
          single() {
            return Promise.resolve({
              data: {
                id: QUIZ_ID,
                title: 'Fredagsquiz 11.09.2026',
                closes_at: '2026-09-11T20:00:00Z',
                season_points_awarded: state.seasonPointsAwarded,
              },
              error: null,
            })
          },
        }
        return b
      },
    },
  },
})

// AI-intro/outro gjør et ekte `fetch` mot api.anthropic.com. Testen skal ikke
// ut på nettet; ruten har en fallback som brukes når kallet feiler.
const ekteFetch = globalThis.fetch
globalThis.fetch = (async () => { throw new Error('ingen nett i test') }) as typeof fetch

const { POST } = await import('../app/api/admin/quiz-results-text/route')

async function hentTekst(): Promise<string> {
  const req = new Request('http://test/api/admin/quiz-results-text', {
    method: 'POST',
    body: JSON.stringify({ quizId: QUIZ_ID }),
  })
  const res = await POST(req as never)
  assert.equal(res.status, 200, `uventet status: ${res.status}`)
  const json = await res.json() as { text: string }
  return json.text
}

beforeEach(() => {
  state.publicSnapshot = Array.from({ length: 12 }, (_, i) => spiller(i + 1))
  state.profiles = []
  state.seasonPointsAwarded = true
})

// ── Populasjonen ────────────────────────────────────────────────────────────

test('deltakertallet er feltets lengde — ikke et eget råtelt antall', () => {
  // Mocken ville kastet om ruten talte selv, men tallet må også VÆRE riktig.
  return hentTekst().then(t => {
    assert.match(t, /12 deltakere var med i dag!/)
  })
})

test('en utmeldt spiller står ikke i teksten — verken i topp 10 eller midten', async () => {
  // Feltet er 12; den utmeldte finnes IKKE i det, fordi blokkerings-gaten
  // allerede har fjernet ham. Teksten skal derfor ikke kunne nevne ham —
  // og den skal heller ikke gå bak feltet for å finne ham.
  state.profiles = [{ id: 'u-utmeldt', display_name: UTMELDT_NAVN, nickname: null }]
  const t = await hentTekst()
  assert.ok(
    !t.includes(UTMELDT_NAVN),
    `teksten publiserte en utmeldt spiller:\n${t}`,
  )
  assert.match(t, /12 deltakere/)
})

test('midtmannen plukkes fra det SAMME feltet, ikke fra en ny spørring', async () => {
  // 12 deltakere → floor(12/2)+1 = 7. Raden med rank 7 i feltet.
  const t = await hentTekst()
  assert.match(t, /Midt på treet: Spiller 7 på 7\. plass/)
})

test('feltet under tre gir ingen midtmann-linje', async () => {
  state.publicSnapshot = [spiller(1), spiller(2)]
  const t = await hentTekst()
  assert.ok(!t.includes('Midt på treet'), t)
})

// ── Navn ────────────────────────────────────────────────────────────────────

test('kallenavn vinner over display_name — teksten oppgir ikke navnet bak', async () => {
  // Nøyaktig tilfellet fra 11.09: vinneren har kallenavnet «Team Domino's»
  // og heter «Simen Sundt». Bildet viste kallenavnet, teksten det ekte navnet.
  state.profiles = [{ id: 'u1', display_name: 'Simen Sundt', nickname: "Team Domino's" }]
  const t = await hentTekst()
  assert.ok(t.includes("Team Domino's"), `kallenavnet manglet:\n${t}`)
  assert.ok(!t.includes('Simen Sundt'), `teksten avslørte navnet bak kallenavnet:\n${t}`)
})

test('uten kallenavn brukes display_name', async () => {
  state.profiles = [{ id: 'u1', display_name: 'Simen Sundt', nickname: null }]
  const t = await hentTekst()
  assert.ok(t.includes('Simen Sundt'), t)
})

test('blankt kallenavn teller ikke som kallenavn', async () => {
  state.profiles = [{ id: 'u1', display_name: 'Simen Sundt', nickname: '   ' }]
  const t = await hentTekst()
  assert.ok(t.includes('Simen Sundt'), t)
})

test('uten profilrad faller navnet tilbake på player_name', async () => {
  state.profiles = []
  const t = await hentTekst()
  assert.ok(t.includes('Spiller 1'), t)
})

// ── Overskrift og tegnsetting ───────────────────────────────────────────────

test('datoen står én gang — tittelen bærer den allerede', async () => {
  const t = await hentTekst()
  assert.match(t, /^Resultat Fredagsquiz 11\.09\.2026$/m)
  assert.ok(
    !/Fredagsquiz 11\.09\.2026 \d{2}\.\d{2}\.\d{4}/.test(t),
    `datoen står to ganger:\n${t.split('\n')[0]}`,
  )
})

test('midt-på-treet-linja bruker samme tegnsetting som lista', async () => {
  // Lista skriver «navn — X riktige · Y». Midtlinja skrev «plass - X riktige»
  // med bindestrek. Samme innhold, to tegnsett i samme innlegg.
  const t = await hentTekst()
  assert.match(t, /Midt på treet: .+ på \d+\. plass — \d+ riktige · /)
  assert.ok(!/plass - /.test(t), `bindestrek igjen i midtlinja:\n${t}`)
})

// ── Tid ─────────────────────────────────────────────────────────────────────

test('tiden skrives som på bildet: 61.0s, ikke 1:01', async () => {
  const t = await hentTekst()
  assert.ok(t.includes('61.0s'), `fant ikke 61.0s:\n${t}`)
  assert.ok(!/·\s*\d+:\d\d/.test(t), `teksten bruker fortsatt m:ss:\n${t}`)
})

// ── Topp 10 ─────────────────────────────────────────────────────────────────

test('lista er de ti øverste, med plassering fra raden', async () => {
  const t = await hentTekst()
  assert.match(t, /🥇 Spiller 1 /)
  assert.match(t, /🥈 Spiller 2 /)
  assert.match(t, /🥉 Spiller 3 /)
  assert.match(t, /^10\. Spiller 10 /m)
  assert.ok(!/^11\. /m.test(t), `lista gikk forbi ti:\n${t}`)
})

// ── Strukturell binding ─────────────────────────────────────────────────────

function utenKommentarer(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const RUTE = utenKommentarer(
  readFileSync(new URL('../app/api/admin/quiz-results-text/route.ts', import.meta.url), 'utf8')
)

test('ruten importerer og kaller getPublicSnapshot', () => {
  assert.match(
    RUTE,
    /import\s*\{[^}]*getPublicSnapshot[^}]*\}\s*from\s*['"]@\/lib\/public-snapshot['"]/,
  )
  assert.ok(RUTE.includes('getPublicSnapshot('), 'kaller ikke getPublicSnapshot')
})

test('ruten har ingen egen attempts-spørring igjen', () => {
  const treff = RUTE.match(/\.from\(\s*['"]attempts['"]\s*\)/)
  assert.equal(
    treff, null,
    `delingsteksten har fått tilbake sitt eget attempts-oppslag: ${treff?.[0]}`,
  )
})

test('ruten har ingen egen tidsformatering igjen', () => {
  assert.equal(
    RUTE.match(/function\s+formatTime/), null,
    'lokal formatTime er tilbake — tiden skal komme fra lib/resultat-tid.ts',
  )
  assert.match(
    RUTE,
    /import\s*\{[^}]*formatTid[^}]*\}\s*from\s*['"]@\/lib\/resultat-tid['"]/,
  )
})

test('fraværstestene ville faktisk fanget de gamle formene', () => {
  // En fraværstest som aldri kan slå ut ser like grønn ut som en som virker.
  assert.match(`  .from('attempts')`, /\.from\(\s*['"]attempts['"]\s*\)/)
  assert.match('function formatTime(ms: number): string {', /function\s+formatTime/)
})

after(() => { globalThis.fetch = ekteFetch })
