// Kjøres med:  npm test
//
// Rydderuten for quiz_notification_log. Mocken implementerer `.lt('sent_at')`
// ekte, så testen måler grensen og ikke bare at et kall ble gjort.
//
// MUTASJONSBEVIS: byttes `.lt` mot `.gt`, feiler «kun rader eldre enn 30 dager
// slettes» — da forsvinner nettopp de ferske radene som gjør en pågående
// kjøring gjenopptakbar.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

type LogRow = { quiz_id: string; sent_at: string }

const db: { log: LogRow[]; deleted: LogRow[] } = { log: [], deleted: [] }

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => {
        assert.equal(table, 'quiz_notification_log')
        let ltCol: string | null = null, ltVal: string | null = null
        let counting = false
        const b = {
          delete(opts?: { count?: string }) { counting = opts?.count === 'exact'; return b },
          lt(col: string, val: string) { ltCol = col; ltVal = val; return b },
          then(resolve: (v: unknown) => void) {
            const doomed = db.log.filter(r => ltCol && ltVal !== null && String(r[ltCol as 'sent_at']) < ltVal)
            db.deleted.push(...doomed)
            db.log = db.log.filter(r => !doomed.includes(r))
            return resolve({ error: null, count: counting ? doomed.length : null })
          },
        }
        return b
      },
    },
  },
})

const routeModule = await import('@/app/api/cron/cleanup-notification-log/route')
const { GET } = routeModule

const call = (secret = 'test-cron-secret') =>
  GET(new Request('https://quizkanonen.no/api/cron/cleanup-notification-log', {
    headers: { authorization: `Bearer ${secret}` },
  }) as never)

beforeEach(() => {
  db.log = []
  db.deleted = []
})

test('ruten setter maxDuration eksplisitt', () => {
  assert.equal((routeModule as { maxDuration?: number }).maxDuration, 60)
})

test('feil hemmelighet gir 401 og sletter ingenting', async () => {
  db.log = [{ quiz_id: 'q', sent_at: daysAgo(90) }]
  const res = await call('feil-hemmelighet')

  assert.equal(res.status, 401)
  assert.deepEqual(db.deleted, [])
  assert.equal(db.log.length, 1)
})

test('kun rader eldre enn 30 dager slettes', async () => {
  db.log = [
    { quiz_id: 'gammel',  sent_at: daysAgo(31) },
    { quiz_id: 'eldgamm', sent_at: daysAgo(400) },
    { quiz_id: 'fersk',   sent_at: daysAgo(29) },
    { quiz_id: 'i_dag',   sent_at: daysAgo(0) },
  ]

  const res = await call()
  const body = await res.json() as { deleted: number }

  assert.equal(body.deleted, 2)
  assert.deepEqual(db.log.map(r => r.quiz_id).sort(), ['fersk', 'i_dag'])
  assert.deepEqual(db.deleted.map(r => r.quiz_id).sort(), ['eldgamm', 'gammel'])
})

test('tom tabell er en gyldig kjøring, ikke en feil', async () => {
  const res = await call()
  assert.equal(res.status, 200)
  assert.equal((await res.json() as { deleted: number }).deleted, 0)
})
