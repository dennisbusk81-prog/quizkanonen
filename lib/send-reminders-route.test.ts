// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte send-reminders-cronen. `mock.module` bytter ut
// supabase-admin, lib/email og waitUntil — ruten selv kjøres uendret,
// inkludert quiz-vinduet, is_test/is_active-guardene, varslingsloggen og
// stemplingen.
//
// INGEN EKTE E-POST: `sendEmail` er mocket bort, så verken Resend eller
// nettverket røres. Mocken teller kall i stedet.
//
// MUTASJONSBEVIS (verifisert ved å sette mekanismene tilbake midlertidig):
//   (a) Settes `.is('reminder_sent_at', null)` tilbake i quiz-oppslaget,
//       feiler «delvis varslet quiz ... plukkes opp igjen» — quizen forsvinner
//       da fra oppslaget og de gjenstående får ALDRI e-post (stille
//       undersending, forkledd som «ingen quiz i vinduet»).
//   (b) Fjernes fratrekket mot varslingsloggen, feiler «kun restene får
//       e-post» motsatt vei: den alt varslede får e-posten på nytt.
//   (c) Flyttes stemplingen ut av løkken (én upsert til slutt), feiler
//       «stemplingen skrives per batch» (1 skriving i stedet for 3).
//   (d) Settes org-grenens gamle `org_close_reminder_quiz_id`-sjekk tilbake,
//       feiler «delvis varslet org: kun restene får e-post».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { osloDateString, osloWallClockToUtcIso } from '@/lib/oslo-time'

process.env.CRON_SECRET = 'test-cron-secret'
process.env.NEXT_PUBLIC_SITE_URL = 'https://www.quizkanonen.no'

const QUIZ_ID   = 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e'
const ORG_A     = 'aaaaaaaa-1111-2222-3333-444444444444'
const ORG_B     = 'bbbbbbbb-1111-2222-3333-444444444444'
const NIL_SCOPE = '00000000-0000-0000-0000-000000000000'

type QuizRow = {
  id: string; title: string | null; opens_at: string; closes_at: string
  is_test: boolean; is_active: boolean; reminder_sent_at: string | null
}
type LogRow = { quiz_id: string; channel: string; scope_id: string; recipient_id: string }

const db: {
  quizzes: QuizRow[]
  profiles: { id: string; email_reminders: boolean }[]
  orgs: { id: string; name: string; org_quiz_closes_at: string | null; org_close_reminder_quiz_id: string | null }[]
  members: { organization_id: string; user_id: string }[]
  log: LogRow[]
  sentTo: string[]
  subjects: string[]
  sendFailsFor: Set<string>
  upserts: LogRow[][]
  orgWrites: number
  quizWrites: number
} = {
  quizzes: [], profiles: [], orgs: [], members: [], log: [],
  sentTo: [], subjects: [], sendFailsFor: new Set(), upserts: [],
  orgWrites: 0, quizWrites: 0,
}

const minutesAgo   = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const minutesAhead = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

// ── waitUntil: fang bakgrunnsjobbene så testen kan vente på dem ─────────────
let pending: Promise<unknown>[] = []
mock.module('@vercel/functions', {
  namedExports: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
})

// ── e-post: ingen ekte utsending ───────────────────────────────────────────
mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to, subject }: { to: string; subject: string }) => {
      if (db.sendFailsFor.has(to)) throw new Error('Resend sa nei')
      db.sentTo.push(to)
      db.subjects.push(subject)
      return { id: 'mock' }
    },
  },
})

// ── Supabase ───────────────────────────────────────────────────────────────
// Filtrene er implementert ekte, ikke bare som signatur. Uten det ville
// mutasjonsbevisene bestått også med mekanismen fjernet fra ruten.
function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let lteCol: string | null = null, lteVal: string | null = null
  let gteCol: string | null = null, gteVal: string | null = null
  let notNullCol: string | null = null
  let isNullCol: string | null = null
  let inCol: string | null = null, inVals: string[] = []
  let limitN: number | null = null
  let rangeFrom = 0, rangeTo = Number.MAX_SAFE_INTEGER
  let upserting: LogRow[] | null = null
  let deleting = false

  const source = (): Record<string, unknown>[] => {
    switch (table) {
      case 'quizzes':                return db.quizzes as unknown as Record<string, unknown>[]
      case 'profiles':               return db.profiles as unknown as Record<string, unknown>[]
      case 'organizations':          return db.orgs as unknown as Record<string, unknown>[]
      case 'organization_members':   return db.members as unknown as Record<string, unknown>[]
      case 'quiz_notification_log':  return db.log as unknown as Record<string, unknown>[]
      default: throw new Error(`ukjent tabell i mock: ${table}`)
    }
  }

  const rows = (): Record<string, unknown>[] => {
    let out = source().filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (lteCol && lteVal !== null && String(r[lteCol]) > lteVal) return false
      if (gteCol && gteVal !== null && String(r[gteCol]) < gteVal) return false
      if (notNullCol && (r[notNullCol] === null || r[notNullCol] === undefined)) return false
      if (isNullCol && r[isNullCol] !== null && r[isNullCol] !== undefined) return false
      if (inCol && !inVals.includes(String(r[inCol]))) return false
      return true
    })
    if (limitN !== null) out = out.slice(0, limitN)
    return out.slice(rangeFrom, rangeTo + 1)
  }

  const b = {
    select() { return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    is(col: string, val: unknown) { if (val === null) isNullCol = col; return b },
    not(col: string, op: string, val: unknown) { if (op === 'is' && val === null) notNullCol = col; return b },
    lte(col: string, val: string) { lteCol = col; lteVal = val; return b },
    gte(col: string, val: string) { gteCol = col; gteVal = val; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals.map(String); return b },
    order() { return b },
    limit(n: number) { limitN = n; return b },
    range(from: number, to: number) { rangeFrom = from; rangeTo = to; return b },
    update() { if (table === 'organizations') db.orgWrites++; if (table === 'quizzes') db.quizWrites++; return b },
    delete() { deleting = true; return b },
    upsert(vals: LogRow[]) { upserting = vals; return b },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
    then(resolve: (v: unknown) => void) {
      if (upserting) {
        // ignoreDuplicates: en rad som alt finnes skal ikke felle skrivingen.
        const fresh = upserting.filter(n => !db.log.some(e =>
          e.quiz_id === n.quiz_id && e.channel === n.channel &&
          e.scope_id === n.scope_id && e.recipient_id === n.recipient_id))
        db.upserts.push([...upserting])
        db.log.push(...fresh)
        return resolve({ error: null })
      }
      if (deleting) return resolve({ error: null, count: 0 })
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

// Alle profiler har e-post <id>@example.com. listUsers paginerer i ruten, men
// datasettet er alltid under én side her.
mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      auth: {
        admin: {
          listUsers: async () => ({
            data: { users: db.profiles.map(p => ({ id: p.id, email: `${p.id}@example.com` })) },
            error: null,
          }),
        },
      },
    },
  },
})

const routeModule = await import('@/app/api/cron/send-reminders/route')
const { GET } = routeModule

async function call(secret = 'test-cron-secret') {
  pending = []
  const request = new Request('https://quizkanonen.no/api/cron/send-reminders', {
    headers: { authorization: `Bearer ${secret}` },
  })
  const res = await GET(request as never)
  await Promise.all(pending)
  return res
}

const quiz = (over: Partial<QuizRow> = {}): QuizRow => ({
  id: QUIZ_ID, title: 'Ukens quiz',
  opens_at: minutesAgo(3), closes_at: minutesAhead(180),
  is_test: false, is_active: true, reminder_sent_at: null,
  ...over,
})

const logged = (recipientId: string, over: Partial<LogRow> = {}): LogRow => ({
  quiz_id: QUIZ_ID, channel: 'quiz_open_email', scope_id: NIL_SCOPE,
  recipient_id: recipientId, ...over,
})

/** Profiler p0..p{n-1}, alle påmeldt. */
const subscribers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, email_reminders: true }))

beforeEach(() => {
  db.quizzes = [quiz()]
  db.profiles = []
  db.orgs = []
  db.members = []
  db.log = []
  db.sentTo = []
  db.subjects = []
  db.sendFailsFor = new Set()
  db.upserts = []
  db.orgWrites = 0
  db.quizWrites = 0
})

// ── Rammeverk ───────────────────────────────────────────────────────────────

test('ruten setter maxDuration eksplisitt', () => {
  assert.equal((routeModule as { maxDuration?: number }).maxDuration, 60)
})

test('feil hemmelighet gir 401 og sender ingenting', async () => {
  db.profiles = subscribers(2)
  const res = await call('feil-hemmelighet')
  assert.equal(res.status, 401)
  assert.deepEqual(db.sentTo, [])
})

// ── Gren A: grunnflyt ───────────────────────────────────────────────────────

test('alle påmeldte får e-post og én loggrad hver', async () => {
  db.profiles = subscribers(3)

  const res = await call()
  assert.equal(res.status, 200)

  assert.deepEqual(db.sentTo.sort(), ['p0@example.com', 'p1@example.com', 'p2@example.com'])
  assert.deepEqual(
    db.log.map(l => l.recipient_id).sort(),
    ['p0', 'p1', 'p2'],
  )
  assert.equal(db.log.every(l => l.quiz_id === QUIZ_ID && l.channel === 'quiz_open_email'), true)
  assert.equal(db.log.every(l => l.scope_id === NIL_SCOPE), true)
})

test('profiler uten email_reminders får ingenting', async () => {
  db.profiles = [
    { id: 'p0', email_reminders: true },
    { id: 'p1', email_reminders: false },
  ]

  await call()
  assert.deepEqual(db.sentTo, ['p0@example.com'])
  assert.deepEqual(db.log.map(l => l.recipient_id), ['p0'])
})

test('ingen quiz i vinduet (åpnet for over en time siden) → ingen e-post', async () => {
  db.quizzes = [quiz({ opens_at: minutesAgo(120) })]
  db.profiles = subscribers(2)

  await call()
  assert.deepEqual(db.sentTo, [])
})

test('testquiz og skjult quiz varsles ikke', async () => {
  db.profiles = subscribers(2)

  db.quizzes = [quiz({ is_test: true })]
  await call()
  assert.deepEqual(db.sentTo, [], 'is_test=true skal ikke varsles')

  db.quizzes = [quiz({ is_active: false })]
  await call()
  assert.deepEqual(db.sentTo, [], 'is_active=false skal ikke varsles')
})

// ── Gren A: gjenopptakelse — kjernen i saken ────────────────────────────────

test('delvis varslet quiz: kun restene får e-post, ingen duplikat', async () => {
  // Slik ser verden ut etter en kjøring som ble drept midt i løkken: p0 er
  // levert OG stemplet, p1/p2 er ikke.
  db.profiles = subscribers(3)
  db.log = [logged('p0')]

  await call()

  assert.equal(db.sentTo.includes('p0@example.com'), false, 'allerede varslet skal ikke få duplikat')
  assert.deepEqual(db.sentTo.sort(), ['p1@example.com', 'p2@example.com'])
  assert.deepEqual(db.log.map(l => l.recipient_id).sort(), ['p0', 'p1', 'p2'])
})

test('delvis varslet quiz med reminder_sent_at satt plukkes fortsatt opp', async () => {
  // MUTASJONSBEVIS (a). Den gamle koden filtrerte quiz-oppslaget på
  // `reminder_sent_at IS NULL`. En avbrutt kjøring rakk å stemple quizen, og
  // da forsvant den fra oppslaget for godt — resten fikk aldri e-post, mens
  // ruten meldte «ingen quiz i vinduet». Kolonnen skal nå ignoreres helt.
  db.quizzes = [quiz({ reminder_sent_at: minutesAgo(2) })]
  db.profiles = subscribers(3)
  db.log = [logged('p0')]

  await call()

  assert.deepEqual(db.sentTo.sort(), ['p1@example.com', 'p2@example.com'])
})

test('ruten skriver ikke lenger til quizzes', async () => {
  db.profiles = subscribers(3)
  await call()
  assert.equal(db.quizWrites, 0, 'reminder_sent_at er død og skal ikke skrives')
})

test('to kjøringer på rad gir nøyaktig én e-post per mottaker', async () => {
  db.profiles = subscribers(3)

  await call()
  await call()

  assert.deepEqual(db.sentTo.sort(), ['p0@example.com', 'p1@example.com', 'p2@example.com'])
  assert.equal(db.log.length, 3)
})

test('alle alt varslet → ingen e-post og ingen skriving', async () => {
  db.profiles = subscribers(2)
  db.log = [logged('p0'), logged('p1')]

  await call()
  assert.deepEqual(db.sentTo, [])
  assert.deepEqual(db.upserts, [])
})

test('logg for en ANNEN quiz blokkerer ikke varselet om den nye', async () => {
  db.profiles = subscribers(2)
  db.log = [logged('p0', { quiz_id: '11111111-2222-3333-4444-555555555555' })]

  await call()
  assert.deepEqual(db.sentTo.sort(), ['p0@example.com', 'p1@example.com'])
})

test('logg for en annen KANAL blokkerer ikke e-posten', async () => {
  // Push og e-post deler tabell, men aldri rader.
  db.profiles = subscribers(1)
  db.log = [logged('p0', { channel: 'quiz_open_push' })]

  await call()
  assert.deepEqual(db.sentTo, ['p0@example.com'])
})

// ── Gren A: feilede sendinger ───────────────────────────────────────────────

test('en feilet sending stemples ikke og forsøkes på nytt neste kjøring', async () => {
  db.profiles = subscribers(2)
  db.sendFailsFor = new Set(['p1@example.com'])

  await call()
  assert.deepEqual(db.sentTo, ['p0@example.com'])
  assert.deepEqual(db.log.map(l => l.recipient_id), ['p0'], 'feilet skal stå ustemplet')

  db.sendFailsFor = new Set()
  db.sentTo = []
  await call()

  assert.deepEqual(db.sentTo, ['p1@example.com'])
  assert.deepEqual(db.log.map(l => l.recipient_id).sort(), ['p0', 'p1'])
})

// ── Gren A: stempling per batch ─────────────────────────────────────────────

test('stemplingen skrives per batch, ikke som én skriving til slutt', async () => {
  // MUTASJONSBEVIS (c). 20 mottakere = 3 batcher (8/8/4) → 3 separate
  // skrivinger. Flyttes stemplingen ut av løkken, blir det 1.
  db.profiles = subscribers(20)

  await call()

  assert.equal(db.upserts.length, 3, 'én skriving per batch')
  assert.deepEqual(db.upserts.map(u => u.length), [8, 8, 4])
  assert.equal(db.sentTo.length, 20)
  assert.equal(db.log.length, 20)
})

// ── Gren B: org close-påminnelse ────────────────────────────────────────────
//
// Org-tiden er en NORSK veggklokke på quizens stengedato. Vi regner baklengs
// fra «om 60 minutter» så testen er uavhengig av når på året den kjøres.
// Quizen settes til å stenge sent samme norske dato, slik at datoen org-tiden
// festes til er den samme.
const OSLO_HHMMSS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo', hour12: false,
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function orgCloseInOneHour(): { time: string; closesAt: string } {
  const targetMs = Date.now() + 60 * 60_000
  const time = OSLO_HHMMSS.format(new Date(targetMs))
  const date = osloDateString(new Date(targetMs).toISOString())!
  // Slutten av samme norske døgn — garanterer at quizens closes_at faller på
  // samme dato som org-tiden, uten å hardkode noe klokkeslett.
  const closesAt = osloWallClockToUtcIso(date, '23:59:59')!
  return { time, closesAt }
}

function setUpOrgScenario(orgIds: string[]) {
  const { time, closesAt } = orgCloseInOneHour()
  // opens_at 90 min tilbake: utenfor gren A sitt 60-minutters vindu, så bare
  // org-grenen er i spill i disse testene.
  db.quizzes = [quiz({ opens_at: minutesAgo(90), closes_at: closesAt })]
  db.orgs = orgIds.map((id, i) => ({
    id, name: `Org ${i}`, org_quiz_closes_at: time, org_close_reminder_quiz_id: null,
  }))
}

test('org-medlemmer får close-påminnelse, logget med org som scope', async () => {
  setUpOrgScenario([ORG_A])
  db.profiles = subscribers(3)
  db.members = [
    { organization_id: ORG_A, user_id: 'p0' },
    { organization_id: ORG_A, user_id: 'p1' },
  ]

  await call()

  assert.deepEqual(db.sentTo.sort(), ['p0@example.com', 'p1@example.com'])
  assert.equal(db.subjects.every(s => s.startsWith('Fristen nærmer seg')), true)
  assert.equal(db.log.every(l => l.channel === 'org_close_email' && l.scope_id === ORG_A), true)
  assert.deepEqual(db.log.map(l => l.recipient_id).sort(), ['p0', 'p1'])
})

test('delvis varslet org: kun restene får e-post', async () => {
  // MUTASJONSBEVIS (d). Den gamle koden hoppet over hele organisasjonen så
  // snart org_close_reminder_quiz_id pekte på denne quizen — et
  // alt-eller-intet-stempel per org.
  setUpOrgScenario([ORG_A])
  db.orgs[0].org_close_reminder_quiz_id = QUIZ_ID
  db.profiles = subscribers(3)
  db.members = [
    { organization_id: ORG_A, user_id: 'p0' },
    { organization_id: ORG_A, user_id: 'p1' },
    { organization_id: ORG_A, user_id: 'p2' },
  ]
  db.log = [logged('p0', { channel: 'org_close_email', scope_id: ORG_A })]

  await call()

  assert.deepEqual(db.sentTo.sort(), ['p1@example.com', 'p2@example.com'])
})

test('ruten skriver ikke lenger til organizations', async () => {
  setUpOrgScenario([ORG_A])
  db.profiles = subscribers(1)
  db.members = [{ organization_id: ORG_A, user_id: 'p0' }]

  await call()
  assert.equal(db.orgWrites, 0, 'org_close_reminder_quiz_id er død og skal ikke skrives')
})

test('bruker i TO organisasjoner får én påminnelse per org', async () => {
  // Dette er hele grunnen til at scope_id finnes. Uten den ville de to
  // radene kollapset til én, og medlemmet mistet den andre påminnelsen —
  // stille undersending innebygd i tabelldesignet.
  setUpOrgScenario([ORG_A, ORG_B])
  db.profiles = subscribers(1)
  db.members = [
    { organization_id: ORG_A, user_id: 'p0' },
    { organization_id: ORG_B, user_id: 'p0' },
  ]

  await call()

  assert.equal(db.sentTo.length, 2, 'én e-post per organisasjon')
  assert.deepEqual(db.log.map(l => l.scope_id).sort(), [ORG_A, ORG_B].sort())
})

test('org utenfor 55–65-minutters-vinduet får ingenting', async () => {
  const { closesAt } = orgCloseInOneHour()
  db.quizzes = [quiz({ opens_at: minutesAgo(90), closes_at: closesAt })]
  const date = osloDateString(closesAt)!
  // To timer fram i tid, uttrykt som norsk veggklokke på samme dato.
  const twoHours = OSLO_HHMMSS.format(new Date(Date.now() + 120 * 60_000))
  db.orgs = [{ id: ORG_A, name: 'Org', org_quiz_closes_at: twoHours, org_close_reminder_quiz_id: null }]
  db.profiles = subscribers(1)
  db.members = [{ organization_id: ORG_A, user_id: 'p0' }]
  assert.ok(osloWallClockToUtcIso(date, twoHours))

  await call()
  assert.deepEqual(db.sentTo, [])
})

test('to kjøringer i org-vinduet gir nøyaktig én e-post per medlem', async () => {
  setUpOrgScenario([ORG_A])
  db.profiles = subscribers(2)
  db.members = [
    { organization_id: ORG_A, user_id: 'p0' },
    { organization_id: ORG_A, user_id: 'p1' },
  ]

  await call()
  await call()

  assert.deepEqual(db.sentTo.sort(), ['p0@example.com', 'p1@example.com'])
})
