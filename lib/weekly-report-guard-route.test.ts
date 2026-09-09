// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Duplikatvakten i cron/weekly-report: for after_quiz-orger skal den billige
// sjekken mot sist stengte quiz skje FØR computeWeeklySummary (som spør mot
// attempts — en av systemets største tabeller) kalles i det hele tatt.
// computeWeeklySummary og getLatestClosedQuiz er mocket, så testene måler
// direkte OM og HVOR MANGE ganger de kalles — ikke bare hva som sendes.
//
// MUTASJONSBEVIS:
//   - flyttes vakten tilbake ETTER beregningen (gammel rekkefølge), feiler
//     «rapport alt sendt → computeWeeklySummary kalles ikke».
//   - fjernes sending-stien ved et uhell, feiler «ikke sendt ennå → rapport
//     sendes og stemples» — B2B-ukesrapporten må ikke slutte å gå ut.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

const ORG_A = 'aaaaaaaa-1111-2222-3333-444444444444'
const ORG_B = 'bbbbbbbb-1111-2222-3333-444444444444'
const QUIZ = 'cccccccc-1111-2222-3333-444444444444'

type OrgRow = {
  id: string; name: string
  weekly_report_timing: string | null
  weekly_report_sent_at: string | null
  stripe_subscription_id: string | null
  plan: string
}

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()

const ADMIN_A = 'admin-a'
const ADMIN_B = 'admin-b'

const state: {
  orgs: OrgRow[]
  latestClosed: { id: string; title: string; closes_at: string } | null
  stamps: Array<{ id: string; sent_at: string }>
  sentTo: string[]
  headers: (Record<string, string> | undefined)[]
  htmls: string[]
  /** Org-admins og deres avmeldingsstatus (profiles.email_weekly_report). */
  admins: Array<{ userId: string; email: string; email_weekly_report: boolean }>
  /** Lesefeil på profiles — «vi vet ikke hvem som har meldt seg av». */
  profileSelectFails: boolean
} = {
  orgs: [], latestClosed: null, stamps: [], sentTo: [], headers: [], htmls: [],
  admins: [], profileSelectFails: false,
}

const summaryFor = (quizId: string) => ({
  quizId,
  quizTitle: 'Fredagsquiz',
  closesAt: state.latestClosed?.closes_at ?? hoursAgo(2),
  winner: { displayName: 'Kari Ansatt', correct: 7, total: 10 },
  top3: [{ displayName: 'Kari Ansatt', correct: 7, total: 10 }],
  participantCount: 5,
})

const computeWeeklySummaryMock = mock.fn(async (_orgId: string) => summaryFor(QUIZ))
const getLatestClosedQuizMock = mock.fn(async () => state.latestClosed)

mock.module('@/lib/weekly-report', {
  namedExports: {
    computeWeeklySummary: computeWeeklySummaryMock,
    getLatestClosedQuiz: getLatestClosedQuizMock,
    buildWeeklyShareText: () => 'delingstekst',
  },
})

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        assert.ok(table === 'organizations' || table === 'profiles', `ukjent tabell i mock: ${table}`)
        let updatePatch: { weekly_report_sent_at: string } | null = null
        let updateId: string | null = null
        const eqs: Record<string, unknown> = {}
        let inVals: string[] = []
        const b = {
          select() { return b },
          eq(col: string, v: unknown) {
            if (updatePatch && col === 'id') updateId = String(v)
            else eqs[col] = v
            return b
          },
          not() { return b },
          // `fetchOptedInIds` filtrerer på id-liste og sorterer/paginerer.
          in(_col: string, vals: string[]) { inVals = vals.map(String); return b },
          order() { return b },
          range() { return b },
          update(patch: { weekly_report_sent_at: string }) { updatePatch = patch; return b },
          then(resolve: (v: unknown) => void) {
            if (updatePatch) {
              if (updateId) state.stamps.push({ id: updateId, sent_at: updatePatch.weekly_report_sent_at })
              return resolve({ error: null })
            }
            if (table === 'profiles') {
              if (state.profileSelectFails) {
                return resolve({ data: null, error: { message: 'profiles-oppslaget er nede' } })
              }
              // Filteret er implementert EKTE: uten det ville en fjernet
              // `.eq('email_weekly_report', true)` sett like grønn ut.
              const rows = state.admins
                .filter(a => inVals.includes(a.userId))
                .filter(a => Object.entries(eqs).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v))
                .map(a => ({ id: a.userId }))
              return resolve({ data: rows, error: null })
            }
            return resolve({ data: state.orgs, error: null })
          },
        }
        return b
      },
    },
  },
})

mock.module('@/lib/org-admin-emails', {
  namedExports: {
    getOrgAdminEmails: async () => ({
      emails: state.admins.map(a => a.email),
      admins: state.admins.map(({ userId, email }) => ({ userId, email })),
      orgName: 'Testbedrift AS',
      orgSlug: 'testbedrift',
    }),
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to, html, headers }: { to: string; html: string; headers?: Record<string, string> }) => {
      state.sentTo.push(to)
      state.htmls.push(html)
      state.headers.push(headers)
      return { id: 'mock' }
    },
  },
})

mock.module('@/lib/email-templates', {
  namedExports: {
    weeklyReportEmail: ({ unsubscribeUrl }: { unsubscribeUrl?: string }) =>
      `<html>rapport ${unsubscribeUrl ?? 'ingen-lenke'}</html>`,
  },
})

const { GET } = await import('@/app/api/cron/weekly-report/route')

const call = () =>
  GET(new Request('https://quizkanonen.no/api/cron/weekly-report', {
    headers: { authorization: 'Bearer test-cron-secret' },
  }) as never)

const afterQuizOrg = (id: string, sentAt: string | null): OrgRow => ({
  id, name: 'Testbedrift AS',
  weekly_report_timing: 'after_quiz',
  weekly_report_sent_at: sentAt,
  stripe_subscription_id: 'sub_123',
  plan: 'standard',
})

beforeEach(() => {
  state.orgs = []
  state.latestClosed = { id: QUIZ, title: 'Fredagsquiz', closes_at: hoursAgo(12) }
  state.stamps = []
  state.sentTo = []
  state.headers = []
  state.htmls = []
  state.admins = [{ userId: ADMIN_A, email: 'admin@example.com', email_weekly_report: true }]
  state.profileSelectFails = false
  computeWeeklySummaryMock.mock.resetCalls()
  getLatestClosedQuizMock.mock.resetCalls()
})

test('rapport alt sendt → computeWeeklySummary kalles ikke', async () => {
  // sent_at NYERE enn quizens stengetid = rapporten for denne quizen er sendt.
  // Dette er normaltilstanden 95+ % av uken — den tunge beregningen skal ikke
  // kjøre i det hele tatt.
  state.orgs = [afterQuizOrg(ORG_A, hoursAgo(10))]

  const res = await call()
  const body = await res.json() as { sent: number }

  assert.equal(res.status, 200)
  assert.equal(body.sent, 0)
  assert.equal(computeWeeklySummaryMock.mock.calls.length, 0,
    'den tunge beregningen skal ikke kjøre når rapporten alt er sendt')
  assert.deepEqual(state.sentTo, [])
  assert.deepEqual(state.stamps, [])
})

test('ikke sendt ennå → rapport sendes og stemples', async () => {
  state.orgs = [afterQuizOrg(ORG_A, null)]

  const res = await call()
  const body = await res.json() as { sent: number; errors: string[] }

  assert.equal(body.sent, 1)
  assert.deepEqual(body.errors, [])
  assert.equal(computeWeeklySummaryMock.mock.calls.length, 1)
  assert.equal(computeWeeklySummaryMock.mock.calls[0].arguments[0], ORG_A)
  assert.deepEqual(state.sentTo, ['admin@example.com'])
  assert.equal(state.stamps.length, 1)
  assert.equal(state.stamps[0].id, ORG_A)
})

test('sendt for FORRIGE quiz → ny quiz stengt etterpå sendes fortsatt', async () => {
  // sent_at ELDRE enn sist stengte quiz: forrige ukes stempel skal ikke
  // blokkere denne ukens rapport.
  state.latestClosed = { id: QUIZ, title: 'Fredagsquiz', closes_at: hoursAgo(3) }
  state.orgs = [afterQuizOrg(ORG_A, hoursAgo(24 * 7))]

  const res = await call()
  const body = await res.json() as { sent: number }

  assert.equal(body.sent, 1)
  assert.equal(computeWeeklySummaryMock.mock.calls.length, 1)
})

test('ingen stengt quiz finnes → ingen beregning, ingen sending', async () => {
  state.latestClosed = null
  state.orgs = [afterQuizOrg(ORG_A, null)]

  const res = await call()
  const body = await res.json() as { sent: number }

  assert.equal(body.sent, 0)
  assert.equal(computeWeeklySummaryMock.mock.calls.length, 0)
})

test('flere after_quiz-orger → sist-stengte-quiz-oppslaget kjøres bare én gang', async () => {
  state.orgs = [afterQuizOrg(ORG_A, hoursAgo(10)), afterQuizOrg(ORG_B, hoursAgo(10))]

  await call()

  assert.equal(getLatestClosedQuizMock.mock.calls.length, 1,
    'oppslaget er globalt og skal memoiseres på tvers av orgene')
})

test('monday_morning-org alt sendt i dag → verken oppslag eller beregning', async () => {
  // dateKey-vakten (uendret logikk) skal fortsatt kortslutte før alt annet,
  // uansett ukedag — sent_at er satt til nå, altså «i dag» i Oslo-tid.
  state.orgs = [{
    id: ORG_A, name: 'Testbedrift AS',
    weekly_report_timing: 'monday_morning',
    weekly_report_sent_at: new Date().toISOString(),
    stripe_subscription_id: 'sub_123',
    plan: 'standard',
  }]

  const res = await call()
  const body = await res.json() as { sent: number }

  assert.equal(body.sent, 0)
  assert.equal(computeWeeklySummaryMock.mock.calls.length, 0)
  assert.equal(getLatestClosedQuizMock.mock.calls.length, 0)
})

// ── Avmelding fra ukesrapporten (9. september 2026) ─────────────────────────
//
// `email_weekly_report` er kolonnen avmeldingstypen 'weeklyreport' slår av
// (app/api/notifications/unsubscribe). Leses den ikke HER, er avmeldingen
// verdiløs: admin-en får kvittering på at hen er avmeldt, og rapporten
// fortsetter å komme hver uke.
//
// MUTASJONSBEVIS (hver vakt fjernet i tur, mutasjonen verifisert anvendt på
// disk før resultatet ble tolket):
//   (e) `fetchOptedInIds`-kallet + `recipients`-filteret byttet mot at alle
//       admins sendes til → «avmeldt admin får INGEN rapport» ryker.
//   (f) `catch { continue }` byttet mot at feilen svelges → «lesefeil på
//       avmeldingsstatus → ingen rapport, og ingen stempling» ryker i BEGGE
//       retninger (både sending og stempel).
//   (g) `headers: listUnsubscribeHeaders(unsubUrl)` fjernet → «rapporten
//       bærer List-Unsubscribe» ryker (og lib/email-signals.test.ts DEL C
//       ryker uavhengig).

const { generateUnsubscribeToken } = await import('@/lib/unsubscribe')

test('avmeldt admin får INGEN rapport — den påmeldte kollegaen får sin', async () => {
  state.orgs = [afterQuizOrg(ORG_A, null)]
  state.admins = [
    { userId: ADMIN_A, email: 'a@example.com', email_weekly_report: true },
    { userId: ADMIN_B, email: 'b@example.com', email_weekly_report: false },
  ]

  const res = await call()
  const body = await res.json() as { sent: number }

  assert.equal(body.sent, 1)
  assert.deepEqual(state.sentTo, ['a@example.com'])
})

test('alle admins avmeldt → ingen rapport, og orgen stemples ikke', async () => {
  // Stemples den likevel, ser neste kjøring en sendt rapport som aldri gikk ut.
  state.orgs = [afterQuizOrg(ORG_A, null)]
  state.admins = [{ userId: ADMIN_A, email: 'a@example.com', email_weekly_report: false }]

  const res = await call()
  const body = await res.json() as { sent: number }

  assert.equal(body.sent, 0)
  assert.deepEqual(state.sentTo, [])
  assert.deepEqual(state.stamps, [])
})

test('påmeldt admin: rapporten går, med List-Unsubscribe og sin egen signerte lenke', async () => {
  state.orgs = [afterQuizOrg(ORG_A, null)]

  await call()

  const forventetUrl =
    'https://www.quizkanonen.no/api/notifications/unsubscribe' +
    `?token=${generateUnsubscribeToken(ADMIN_A, 'weeklyreport')}&type=weeklyreport&uid=${ADMIN_A}`

  assert.deepEqual(state.headers[0], {
    'List-Unsubscribe': `<${forventetUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  })
  // Samme URL i malen som i headeren — ellers peker den ene på noe den andre
  // ikke har bevist virker.
  assert.ok(state.htmls[0].includes(forventetUrl), 'malen skal få den samme lenken')
})

test('to admins får HVER SIN signerte lenke, ikke den samme', async () => {
  state.orgs = [afterQuizOrg(ORG_A, null)]
  state.admins = [
    { userId: ADMIN_A, email: 'a@example.com', email_weekly_report: true },
    { userId: ADMIN_B, email: 'b@example.com', email_weekly_report: true },
  ]

  await call()

  const uids = state.headers.map(h => new URL(
    h!['List-Unsubscribe'].slice(1, -1)).searchParams.get('uid'))
  assert.deepEqual(uids.sort(), [ADMIN_A, ADMIN_B].sort())
})

test('lesefeil på avmeldingsstatus → ingen rapport, og ingen stempling', async () => {
  // Den som lett glemmes. Ukjent er ikke samtykke — og stempler vi likevel,
  // mister orgen rapporten for hele uken på grunn av ett mislykket oppslag.
  state.orgs = [afterQuizOrg(ORG_A, null)]
  state.profileSelectFails = true

  const res = await call()
  const body = await res.json() as { sent: number; errors: string[] }

  assert.equal(body.sent, 0)
  assert.deepEqual(state.sentTo, [])
  assert.deepEqual(state.stamps, [], 'stemplingen skal ikke skje — neste kjøring må kunne prøve igjen')
  assert.equal(body.errors.length, 1, 'feilen skal være synlig i svaret, ikke svelges')
})
