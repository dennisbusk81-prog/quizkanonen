// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// BLOKKERT-GATEN på forsidens «Forrige uke — hvem vant?» (lib/home-top3,
// gruppe B2 i kartleggingen 24. august 2026). Spørringen i computeSharedHomeData
// var rå: hardkodet .limit(3) uten getGloballyBlockedSet — en bruker som hadde
// valgt bort offentlig synlighet kunne stå med navn på den mest sette flaten i
// appen, samtidig som /leaderboard/[id] (som kortet lenker til) skjulte samme
// person.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes blokkert-filteret (publicRows = rows), ryker «blokkert vinner …»
//     — Bjørn står da i topp 3.
//   • Gjeninnføres .limit(3) FØR filtrering (slice før gate), ryker samme test
//     på LENGDEN: utvalget ville hatt 2 rader igjen etter filtrering.
//   • Fjernes requireSubmitted, ryker «ulevert forsøk …».
//   • Fjernes dedup (rankQuizAttempts byttes mot rå sortering), ryker
//     «samme spiller …».
//   • Kobles forsiden tilbake til en inline-spørring, ryker den strukturelle
//     testen nederst (computeSharedHomeData skal kalle getLastQuizTop3 og ikke
//     lese attempts selv).
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

type AttemptRow = {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
  submitted_at: string | null
}

function att(
  id: string, userId: string | null, name: string, correct: number, timeMs: number,
  submitted: string | null = '2026-08-21T13:00:00Z',
): AttemptRow {
  return {
    id, user_id: userId, player_name: name,
    correct_answers: correct, total_time_ms: timeMs, correct_streak: 0,
    submitted_at: submitted,
  }
}

const state: {
  attempts: AttemptRow[]
  blocked: string[]
  blockedCalls: { quizId: string; userIds: string[]; awarded: boolean }[]
  profileRows: { id: string; display_name: string | null; nickname: string | null }[]
} = { attempts: [], blocked: [], blockedCalls: [], profileRows: [] }

function thenable<T>(data: T) {
  return {
    then(resolve: (r: { data: T; error: null }) => unknown) {
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
}

function attemptsBuilder() {
  const b = {
    select() { return b },
    eq() { return b },
    // fetchAllRows (paginert) krever .order()/.range(). Fixturene er små
    // (< pageSize), så én side holder og hele settet returneres uavhengig av
    // vinduet.
    order() { return b },
    range() { return b },
    ...thenable(state.attempts),
  }
  return b
}

function profilesBuilder() {
  const b = {
    select() { return b },
    in() { return b },
    ...thenable(state.profileRows),
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'attempts') return attemptsBuilder() as never
        if (table === 'profiles') return profilesBuilder() as never
        throw new Error(`uventet tabell: ${table}`)
      },
    },
  },
})

mock.module('@/lib/globally-blocked-set', {
  namedExports: {
    getGloballyBlockedSet: async (quizId: string, userIds: string[], awarded: boolean) => {
      state.blockedCalls.push({ quizId, userIds, awarded })
      return new Set(state.blocked)
    },
  },
})

const { getLastQuizTop3 } = await import('@/lib/home-top3')

beforeEach(() => {
  state.attempts = [
    att('a-anna', 'u-anna', 'Anna', 12, 60_000),
    att('a-bjorn', 'u-bjorn', 'Bjørn', 11, 65_000),
    att('a-cato', 'u-cato', 'Cato', 10, 70_000),
    att('a-doris', 'u-doris', 'Doris', 9, 75_000),
  ]
  state.blocked = []
  state.blockedCalls = []
  state.profileRows = [
    { id: 'u-anna', display_name: 'Anna Profil', nickname: 'Quizdronningen' },
    { id: 'u-bjorn', display_name: 'Bjørn Profil', nickname: null },
    { id: 'u-cato', display_name: 'Cato Profil', nickname: null },
    { id: 'u-doris', display_name: 'Doris Profil', nickname: null },
  ]
})

test('positiv kontroll: ingen blokkerte gir topp 3 i rangert rekkefølge med profilnavn', async () => {
  const top3 = await getLastQuizTop3('q-1', true)
  assert.deepEqual(
    top3.map(r => [r.player_name, r.correct_answers]),
    [['Anna Profil', 12], ['Bjørn Profil', 11], ['Cato Profil', 10]],
  )
  assert.equal(top3[0].nickname, 'Quizdronningen')
  // Gaten ble faktisk spurt, med hele feltet og riktig gren (persistert vedtak).
  assert.deepEqual(state.blockedCalls, [
    { quizId: 'q-1', userIds: ['u-anna', 'u-bjorn', 'u-cato', 'u-doris'], awarded: true },
  ])
})

test('blokkert vinner fjernes — og listen har LIKEVEL tre navn (utvalget er større enn 3)', async () => {
  state.blocked = ['u-bjorn']
  const top3 = await getLastQuizTop3('q-1', true)
  // Bjørn (plass 2 i det rå feltet) er ute; Doris rykker inn som nr. 3. Med en
  // .limit(3) før gaten hadde denne listen hatt to navn.
  assert.deepEqual(
    top3.map(r => r.player_name),
    ['Anna Profil', 'Cato Profil', 'Doris Profil'],
  )
  assert.ok(!top3.some(r => r.player_name.includes('Bjørn')), 'blokkert bruker skal ikke vises på forsiden')
})

test('gjester (user_id null) berøres aldri av gaten', async () => {
  state.attempts.push(att('a-gjest', null, 'Gjest Gjestesen', 12, 50_000))
  state.blocked = ['u-anna']
  const top3 = await getLastQuizTop3('q-1', true)
  assert.deepEqual(
    top3.map(r => r.player_name),
    ['Gjest Gjestesen', 'Bjørn Profil', 'Cato Profil'],
  )
  // Gjesten sto ikke i listen gaten ble spurt om.
  assert.ok(!state.blockedCalls[0].userIds.includes(null as never))
})

test('ulevert forsøk teller ikke — samme submitted-filter som leaderboard-siden kortet lenker til', async () => {
  state.attempts.push(att('a-egil', 'u-egil', 'Egil', 15, 40_000, null))
  const top3 = await getLastQuizTop3('q-1', false)
  assert.ok(!top3.some(r => r.player_name === 'Egil'), 'ulevert forsøk skal ikke vinne uka')
  assert.equal(top3[0].player_name, 'Anna Profil')
})

test('samme spiller vises aldri to ganger — beste forsøk teller', async () => {
  state.attempts.push(att('a-anna2', 'u-anna', 'Anna', 11, 55_000))
  const top3 = await getLastQuizTop3('q-1', true)
  assert.deepEqual(
    top3.map(r => r.player_name),
    ['Anna Profil', 'Bjørn Profil', 'Cato Profil'],
  )
})

test('profiloppslag som feiler degraderer til player_name — aldri til feil UTVALG', async () => {
  state.profileRows = null as never // thenable leverer { data: null, error: null } — mangler profiler
  state.blocked = ['u-bjorn']
  const top3 = await getLastQuizTop3('q-1', true)
  assert.deepEqual(top3.map(r => r.player_name), ['Anna', 'Cato', 'Doris'])
})

// ── Strukturell kobling: forsiden BRUKER faktisk gaten ───────────────────────
// Mekanisme til stede ≠ mekanisme virker: lib-funksjonen over kan være perfekt
// og likevel død kode hvis computeSharedHomeData går tilbake til en inline-
// spørring. Kommentarer strippes før matching (strukturtester trenger aktive
// linje-anker).

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature)
  assert.notEqual(start, -1, `fant ikke «${signature}» i app/page.tsx`)
  const open = src.indexOf('{', start + signature.length)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i) }
  }
  throw new Error('ubalanserte klammer')
}

test('computeSharedHomeData henter topp 3 via getLastQuizTop3 og leser aldri attempts selv', () => {
  const src = stripComments(readFileSync('app/page.tsx', 'utf8'))
  const body = functionBody(src, 'async function computeSharedHomeData')
  assert.ok(body.includes('getLastQuizTop3('), 'forsiden kaller ikke lenger den gatede topp-3-helperen')
  assert.ok(
    !body.includes(".from('attempts')"),
    'computeSharedHomeData leser attempts direkte igjen — det var formen den ugatede .limit(3)-lekkasjen hadde',
  )
  // Positiv kontroll: attempts-lesing finnes andre steder i fila (den
  // personaliserte grenen), så fraværet over måler faktisk noe.
  assert.ok(src.includes(".from('attempts')"), 'positiv kontroll: ingen attempts-lesing i fila i det hele tatt')
})
