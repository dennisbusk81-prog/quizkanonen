// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte re-engagement-cronen. Samme feilklasse som F4:
// `re_engagement_sent_at` ble skrevet ÉN gang, etter hele sendeløkken.
//
// INGEN EKTE E-POST: `lib/email` er mocket, så verken Resend eller nettverket
// røres.
//
// Kandidatspørringen filtrerer allerede på `re_engagement_sent_at IS NULL`, så
// gjenopptakelsen kommer gratis når stemplingen først skjer per batch — det
// finnes ingen alt-eller-intet-sjekk her, slik det gjorde i
// notify-subscribers. Testene låser begge halvdelene: at stemplingen skrives
// per batch, og at en alt stemplet bruker aldri får e-posten om igjen.
//
// MUTASJONSBEVIS: flyttes stemplingen tilbake til ÉN skriving etter løkken,
// feiler «stemplingen skrives per batch». Fjernes `.is(re_engagement_sent_at,
// null)` fra kandidatspørringen, feiler «alt påminnet bruker hoppes over».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'
process.env.NEXT_PUBLIC_SITE_URL = 'https://www.quizkanonen.no'

type ProfileRow = {
  id: string
  display_name: string | null
  email_reengagement: boolean
  re_engagement_sent_at: string | null
  last_seen_at: string
}

const db: {
  profiles: ProfileRow[]
  attempts: { user_id: string | null }[]
  authUsers: { id: string; email: string }[]
  sentTo: string[]
  updates: string[][]
} = { profiles: [], attempts: [], authUsers: [], sentTo: [], updates: [] }

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async ({ to }: { to: string }) => { db.sentTo.push(to); return { id: 'mock' } },
  },
})

function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let isNullCol: string | null = null
  let ltCol: string | null = null, ltVal: string | null = null
  let inCol: string | null = null, inVals: string[] = []
  let notNullCol: string | null = null
  let updating: Record<string, string> | null = null

  const rows = (): Record<string, unknown>[] => {
    const source: Record<string, unknown>[] =
      table === 'profiles' ? (db.profiles as unknown as Record<string, unknown>[])
      : table === 'attempts' ? (db.attempts as unknown as Record<string, unknown>[])
      : []

    return source.filter(r => {
      for (const [k, v] of Object.entries(eqs)) if (r[k] !== v) return false
      if (isNullCol && r[isNullCol] !== null && r[isNullCol] !== undefined) return false
      if (notNullCol && (r[notNullCol] === null || r[notNullCol] === undefined)) return false
      if (ltCol && ltVal !== null && String(r[ltCol]) >= ltVal) return false
      if (inCol && !inVals.includes(String(r[inCol]))) return false
      return true
    })
  }

  const b = {
    select() { return b },
    update(patch: Record<string, string>) { updating = patch; return b },
    eq(col: string, val: unknown) { eqs[col] = val; return b },
    is(col: string) { isNullCol = col; return b },
    not(col: string) { notNullCol = col; return b },
    lt(col: string, val: string) { ltCol = col; ltVal = val; return b },
    in(col: string, vals: string[]) { inCol = col; inVals = vals; return b },
    then(resolve: (v: unknown) => void) {
      if (updating && table === 'profiles' && inCol) {
        db.updates.push([...inVals])
        for (const p of db.profiles) {
          if (inVals.includes(p.id)) p.re_engagement_sent_at = updating.re_engagement_sent_at
        }
        return resolve({ error: null })
      }
      return resolve({ data: rows(), error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (t: string) => builder(t),
      auth: {
        admin: {
          listUsers: async ({ page }: { page: number }) =>
            page === 1 ? { data: { users: db.authUsers }, error: null }
                       : { data: { users: [] }, error: null },
        },
      },
    },
  },
})

const { GET } = await import('@/app/api/cron/re-engagement/route')
const routeModule = await import('@/app/api/cron/re-engagement/route')

function call(secret = 'test-cron-secret') {
  const request = new Request('https://quizkanonen.no/api/cron/re-engagement', {
    headers: { authorization: `Bearer ${secret}` },
  })
  return GET(request as never)
}

/** En kandidat som oppfyller alle fire kravene ruten stiller. */
function candidate(id: string, over: Partial<ProfileRow> = {}) {
  db.profiles.push({
    id,
    display_name: `Navn ${id}`,
    email_reengagement: true,
    re_engagement_sent_at: null,
    last_seen_at: daysAgo(30),
    ...over,
  })
  db.attempts.push({ user_id: id })
  db.authUsers.push({ id, email: `${id}@example.com` })
}

beforeEach(() => {
  db.profiles = []
  db.attempts = []
  db.authUsers = []
  db.sentTo = []
  db.updates = []
})

test('ruten setter maxDuration eksplisitt', () => {
  assert.equal((routeModule as { maxDuration?: number }).maxDuration, 60)
})

test('inaktive spillere som aldri er påminnet får e-post og stemples', async () => {
  candidate('a'); candidate('b')

  await call()

  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com'])
  assert.equal(db.profiles.every(p => p.re_engagement_sent_at !== null), true)
})

test('alt påminnet bruker hoppes over — e-posten sendes én gang per liv', async () => {
  candidate('a', { re_engagement_sent_at: daysAgo(5) })
  candidate('b')

  await call()

  assert.deepEqual(db.sentTo, ['b@example.com'])
})

test('to kjøringer på rad gir nøyaktig én e-post per bruker', async () => {
  candidate('a'); candidate('b')

  await call()
  await call()

  assert.deepEqual(db.sentTo.sort(), ['a@example.com', 'b@example.com'])
})

test('en som aldri har spilt får ingen e-post', async () => {
  candidate('a')
  // 'b' er kandidat, men har ingen rad i attempts.
  db.profiles.push({
    id: 'b', display_name: 'B', email_reengagement: true,
    re_engagement_sent_at: null, last_seen_at: daysAgo(30),
  })
  db.authUsers.push({ id: 'b', email: 'b@example.com' })

  await call()
  assert.deepEqual(db.sentTo, ['a@example.com'])
})

test('feil hemmelighet gir 401 og sender ingenting', async () => {
  candidate('a')
  const res = await call('feil')

  assert.equal(res.status, 401)
  assert.deepEqual(db.sentTo, [])
})

test('stemplingen skrives per batch, ikke som én skriving til slutt', async () => {
  // 20 kandidater = 3 batcher (8/8/4) → 3 separate UPDATE-kall. Med den gamle
  // formen ville dette vært nøyaktig 1 skriving med 20 id-er.
  for (let i = 0; i < 20; i++) candidate(`s${i}`)

  await call()

  assert.equal(db.updates.length, 3, 'én skriving per batch')
  assert.deepEqual(db.updates.map(u => u.length), [8, 8, 4])
  assert.equal(db.sentTo.length, 20)
})
