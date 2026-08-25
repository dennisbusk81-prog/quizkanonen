// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/org/[slug]/dashboard mot en fake som
// oppfører seg som PostgREST på begge de målte takene (1000-radskutt +
// «Bad Request» for .in()-lister over 390 nøkler).
//
// Dette er det ENESTE av paginerings-funnene 18. august 2026 med en annen
// feilretning enn «for lavt tall»: quiz_id-lesningen hadde ingen order, så et
// kutt ved 1000 kunne la en GAMMEL quiz vinne som «siste». Datasettet er
// konstruert deretter — den nyeste quizen finnes KUN i rad 1100+.
//
// MUTASJONSBEVIS: byttes fetchAllRowsChunked ut med ett rått kall, ryker
// quiz-asserten (q-ny er usynlig i de 1000 første radene → q-gammel velges),
// og med 401 medlemmer i én URL feiler kallet i det hele tatt.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const PG_ROW_CAP = 1000
const URL_CAP = 390

const state: {
  memberIds: string[]
  quizIdRows: { quiz_id: string }[]
  latestAttempts: Record<string, unknown>[]
  quizCreatedAt: Record<string, string>
  chunkSizes: number[]
  quizzesInList: string[]
} = { memberIds: [], quizIdRows: [], latestAttempts: [], quizCreatedAt: {}, chunkSizes: [], quizzesInList: [] }

function organizationsBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() {
      return { data: { id: 'org-1', name: 'Testorg', plan: 'standard' }, error: null }
    },
  }
  return b
}

function orgMembersBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    async maybeSingle() { return { data: { role: 'admin' }, error: null } },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve({
        data: state.memberIds.map(id => ({ user_id: id })),
        error: null,
      }).then(res, rej)
    },
  }
  return b
}

// To attempts-lesninger skilles på select-kolonnene: steg 1 ber KUN om
// quiz_id, steg 3 om hele resultatraden for den valgte quizen.
function attemptsBuilder() {
  let selectCols = ''
  let chunk: string[] = []
  let from = 0
  let to = PG_ROW_CAP - 1
  const b = {
    select(cols: string) { selectCols = cols; return b },
    eq() { return b },
    order() { return b },
    in(_col: string, keys: string[]) { chunk = keys; return b },
    range(f: number, t: number) { from = f; to = t; return b },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      state.chunkSizes.push(chunk.length)
      if (chunk.length > URL_CAP) {
        return Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
      }
      const rows = selectCols === 'quiz_id'
        ? (chunk.includes('u-000') ? state.quizIdRows : [])
        : state.latestAttempts.filter(a => chunk.includes(a.user_id as string))
      const window = rows.slice(from, to + 1).slice(0, PG_ROW_CAP)
      return Promise.resolve({ data: window, error: null }).then(res, rej)
    },
  }
  return b
}

// «Nyeste quiz» velges av databasen (order created_at desc, limit 1) — faken
// gjør det samme over id-ene den faktisk fikk i .in(). Får den bare de 1000
// første radenes id-er, vinner q-gammel; det er selve mutasjonsbeviset.
function quizzesBuilder() {
  let inList: string[] = []
  const b = {
    select() { return b },
    // Populasjonsfilteret (onlyRealQuizzes, 25. august 2026) legger .not() og
    // en ANDRE .in() på samme spørring. Denne faken modellerer radtaket i
    // steg 1, ikke hvilke quizer som er ekte — den ser derfor bort fra begge,
    // men MÅ skille dem fra id-lista: uten kolonnesjekken under ville
    // .in('quiz_type', ['weekly','bonus']) overskrevet `inList` med to
    // strenger, og «nyeste quiz» blitt valgt fra feil sett.
    // Populasjonen er dekket av lib/org-real-quiz-population.test.ts.
    not() { return b },
    in(col: string, ids: string[]) { if (col === 'id') inList = ids; return b },
    order() { return b },
    limit() { return b },
    async maybeSingle() {
      state.quizzesInList = inList
      const newest = [...inList].sort(
        (a, z) => (state.quizCreatedAt[z] ?? '').localeCompare(state.quizCreatedAt[a] ?? ''),
      )[0]
      if (!newest) return { data: null, error: null }
      return {
        data: { id: newest, title: `Tittel ${newest}`, is_active: true, created_at: state.quizCreatedAt[newest] },
        error: null,
      }
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-000' } }, error: null }) },
      from: (table: string) => {
        if (table === 'organizations') return organizationsBuilder() as never
        if (table === 'organization_members') return orgMembersBuilder() as never
        if (table === 'attempts') return attemptsBuilder() as never
        if (table === 'quizzes') return quizzesBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

mock.module('@/lib/org-lock-guard', {
  namedExports: { requireUnlockedOrg: async () => ({ ok: true }) },
})

const { GET } = await import('@/app/api/org/[slug]/dashboard/route')

function call() {
  const request = new Request('https://quizkanonen.no/api/org/testorg/dashboard', {
    headers: { authorization: 'Bearer tok' },
  })
  return GET(request as never, { params: Promise.resolve({ slug: 'testorg' }) })
}

beforeEach(() => {
  // 401 medlemmer (> URL-taket i én liste) → 3 chunks à maks 200.
  state.memberIds = Array.from({ length: 401 }, (_, i) => `u-${String(i).padStart(3, '0')}`)
  // 1500 quiz_id-rader: de 1100 første peker på q-gammel, resten på q-ny.
  // q-ny er dermed USYNLIG for et enkeltkall som kuttes ved 1000.
  state.quizIdRows = [
    ...Array.from({ length: 1100 }, () => ({ quiz_id: 'q-gammel' })),
    ...Array.from({ length: 400 }, () => ({ quiz_id: 'q-ny' })),
  ]
  state.quizCreatedAt = {
    'q-gammel': '2026-07-01T10:00:00.000Z',
    'q-ny': '2026-08-14T10:00:00.000Z',
  }
  state.latestAttempts = [
    {
      id: 'a-1', player_name: 'Astrid', correct_answers: 12, total_questions: 15,
      total_time_ms: 60_000, correct_streak: 4, user_id: 'u-000',
      completed_at: '2026-08-14T19:00:00.000Z', is_team: false, team_size: 1,
    },
    {
      id: 'a-2', player_name: 'Bendik', correct_answers: 10, total_questions: 15,
      total_time_ms: 70_000, correct_streak: 2, user_id: 'u-200',
      completed_at: '2026-08-14T19:05:00.000Z', is_team: false, team_size: 1,
    },
  ]
  state.chunkSizes = []
  state.quizzesInList = []
})

test('«siste quiz» velges fra ALLE quiz-id-radene — ikke et kuttet radsett', async () => {
  const res = await call()
  assert.equal(res.status, 200)
  const j = await res.json()

  assert.equal(j.quiz.id, 'q-ny',
    'q-ny finnes kun i rad 1100+ — et kutt ved 1000 hadde valgt q-gammel')
  assert.ok(state.quizzesInList.includes('q-ny'), 'q-ny nådde aldri quiz-oppslaget')

  // Medlems-attempts for den valgte quizen kom gjennom den chunkede lesningen
  // (u-000 i chunk 1, u-200 i chunk 2) og er rangert.
  assert.deepEqual(
    j.attempts.map((a: { player_name: string; rank: number }) => [a.player_name, a.rank]),
    [['Astrid', 1], ['Bendik', 2]],
  )

  assert.ok(state.chunkSizes.every(n => n <= URL_CAP),
    `en .in()-liste oversteg URL-taket: ${JSON.stringify(state.chunkSizes)}`)
})

test('kontroll: de 1000 første radene inneholder KUN q-gammel', () => {
  const kuttet = [
    ...Array.from({ length: 1100 }, () => ({ quiz_id: 'q-gammel' })),
    ...Array.from({ length: 400 }, () => ({ quiz_id: 'q-ny' })),
  ].slice(0, PG_ROW_CAP)
  assert.deepEqual([...new Set(kuttet.map(r => r.quiz_id))], ['q-gammel'],
    'datasettet må gjøre q-ny usynlig for et kuttet kall — ellers beviser testen ingenting')
})
