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

const state: {
  orgs: OrgRow[]
  latestClosed: { id: string; title: string; closes_at: string } | null
  stamps: Array<{ id: string; sent_at: string }>
  sentTo: string[]
} = { orgs: [], latestClosed: null, stamps: [], sentTo: [] }

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
        assert.equal(table, 'organizations')
        let updatePatch: { weekly_report_sent_at: string } | null = null
        let updateId: string | null = null
        const b = {
          select() { return b },
          eq(col: string, v: unknown) {
            if (updatePatch && col === 'id') updateId = String(v)
            return b
          },
          not() { return b },
          update(patch: { weekly_report_sent_at: string }) { updatePatch = patch; return b },
          then(resolve: (v: unknown) => void) {
            if (updatePatch) {
              if (updateId) state.stamps.push({ id: updateId, sent_at: updatePatch.weekly_report_sent_at })
              return resolve({ error: null })
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
    getOrgAdminEmails: async () => ({ emails: ['admin@example.com'] }),
    sendToOrgAdmins: async (emails: string[]) => {
      state.sentTo.push(...emails)
      return { sent: emails.length }
    },
  },
})

mock.module('@/lib/email-templates', {
  namedExports: { weeklyReportEmail: () => '<html>rapport</html>' },
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
