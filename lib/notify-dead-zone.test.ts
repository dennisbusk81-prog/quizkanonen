// Kjøres med:  npm test
//
// Dødsone-deteksjonen: quizer som falt UT av det 60 minutters varslingsvinduet
// uten at noen ble varslet. Filen den tester SENDER INGENTING — den leser og
// rapporterer — og det er nettopp det som må felles her, ikke bare påstås.
//
// Den falske klienten under KASTER på enhver skriveoperasjon (insert, upsert,
// update, delete). En test som bare teller sendte e-poster ville vært grønn
// også for en implementasjon som skrev til quiz_notification_log; denne felles
// i det den prøver.
//
// MUTASJONSBEVIS — hver mutasjon faktisk lagt inn i lib/notify-dead-zone.ts,
// `npm test` kjørt, og linja rullet tilbake (16. august 2026):
//   • `.lt('opens_at', yngsteIso)` → `.lte('opens_at', nowIso)` (altså ingen
//     nedre utestengelse) → «en quiz INNE i vinduet er ikke en dødsone» ryker.
//     Dette er den viktigste: uten den grensen ville hver eneste fredag gitt
//     et falskt dødsone-varsel i det minuttet før første kjøring rakk fram.
//   • `.gte('opens_at', eldsteIso)` fjernet → «en quiz eldre enn 6 timer
//     rapporteres ikke» ryker (hver gamle quiz ville rapportert for alltid).
//   • mottakersjekken fjernet (antar alltid mottakere) → «tom mottakerliste er
//     ikke en dødsone» ryker.
//   • `quizHasQuestions`-sjekken fjernet → «en placeholder-quiz rapporteres
//     ikke som dødsone» ryker (to Sentry-saker for samme tilstand, den ene med
//     feil årsak).
//   • `.or(closes_at...)` fjernet → «en stengt quiz rapporteres ikke» ryker.
//   • `varsleNotifyGuard(...)` fjernet → «funnet rapporteres til Sentry» ryker,
//     og hele poenget med filen forsvinner.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const QUIZ = 'aaaaaaaa-1111-2222-3333-444444444444'
const NOW = Date.parse('2026-08-21T14:00:00.000Z')
const GLOBAL = '00000000-0000-0000-0000-000000000000'

const minutterSiden = (m: number) => new Date(NOW - m * 60_000).toISOString()

type QuizRow = {
  id: string; title: string | null; opens_at: string; closes_at: string | null
  is_test: boolean; is_active: boolean
}
type LogRow = { quiz_id: string; channel: string; scope_id: string; recipient_id: string }
type Capture = { melding: string; ctx: { level: string; extra: Record<string, unknown> } }

const db: {
  quizzes: QuizRow[]
  questions: Array<{ id: string; quiz_id: string; question_text: string | null }>
  log: LogRow[]
  profiles: Array<{ id: string; email_reminders: boolean }>
  push: Array<{ id: string }>
  feilPåTabell: string | null
  spørringer: number
  skrivinger: number
} = {
  quizzes: [], questions: [], log: [], profiles: [], push: [],
  feilPåTabell: null, spørringer: 0, skrivinger: 0,
}

const captured: Capture[] = []

mock.module('@sentry/nextjs', {
  namedExports: {
    captureMessage: (melding: string, ctx: Capture['ctx']) => { captured.push({ melding, ctx }) },
  },
})

/** Termene splittes på de TO FØRSTE punktumene — ISO-tid har selv et punktum. */
const orMatch = (uttrykk: string, rad: Record<string, unknown>): boolean =>
  uttrykk.split(',').some(term => {
    const i1 = term.indexOf('.')
    const i2 = term.indexOf('.', i1 + 1)
    const col = term.slice(0, i1)
    const op = term.slice(i1 + 1, i2)
    const val = term.slice(i2 + 1)
    const rå = rad[col]
    if (op === 'is') return val === 'null' ? (rå === null || rå === undefined) : false
    if (rå === null || rå === undefined) return false
    if (op === 'gte') return String(rå) >= val
    throw new Error(`ukjent or-operator i mock: ${op}`)
  })

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from(table: string) {
        db.spørringer++
        const preds: Array<(r: Record<string, unknown>) => boolean> = []
        let take = Infinity

        const kilde = (): Record<string, unknown>[] => {
          switch (table) {
            case 'quizzes': return db.quizzes as unknown as Record<string, unknown>[]
            case 'questions': return db.questions as unknown as Record<string, unknown>[]
            case 'quiz_notification_log': return db.log as unknown as Record<string, unknown>[]
            case 'profiles': return db.profiles as unknown as Record<string, unknown>[]
            case 'push_subscriptions': return db.push as unknown as Record<string, unknown>[]
            default: throw new Error(`ukjent tabell i mock: ${table}`)
          }
        }

        // Enhver skriving er en feil i denne filen. Se filhodet.
        const forbudt = (op: string) => () => {
          db.skrivinger++
          throw new Error(`notify-dead-zone forsøkte å SKRIVE (${op} på ${table}) — den skal kun lese`)
        }

        const b: Record<string, unknown> = {
          select() { return b },
          eq(col: string, val: unknown) { preds.push(r => r[col] === val); return b },
          neq(col: string, val: unknown) { preds.push(r => r[col] !== val); return b },
          not(col: string, op: string, val: unknown) {
            if (op === 'is' && val === null) preds.push(r => r[col] !== null && r[col] !== undefined)
            return b
          },
          gte(col: string, val: string) { preds.push(r => String(r[col]) >= val); return b },
          lte(col: string, val: string) { preds.push(r => String(r[col]) <= val); return b },
          lt(col: string, val: string) { preds.push(r => String(r[col]) < val); return b },
          or(uttrykk: string) { preds.push(r => orMatch(uttrykk, r)); return b },
          order() { return b },
          limit(n: number) { take = n; return b },
          insert: forbudt('insert'),
          upsert: forbudt('upsert'),
          update: forbudt('update'),
          delete: forbudt('delete'),
          then(resolve: (v: unknown) => void) {
            if (db.feilPåTabell === table) {
              return resolve({ data: null, error: { message: `simulert feil på ${table}` } })
            }
            return resolve({ data: kilde().filter(r => preds.every(p => p(r))).slice(0, take), error: null })
          },
        }
        return b
      },
    },
  },
})

const { detectNotifyDeadZone, DEAD_ZONE_LOOKBACK_MS } = await import('@/lib/notify-dead-zone')

const dødsoneQuiz = (over: Partial<QuizRow> = {}): QuizRow => ({
  id: QUIZ,
  title: 'Fredagsquiz 21.08.2026',
  opens_at: minutterSiden(120),          // 2 t siden: utenfor vinduet, innenfor 6 t
  closes_at: new Date(NOW + 8 * 3_600_000).toISOString(),
  is_test: false,
  is_active: true,
  ...over,
})

beforeEach(() => {
  db.quizzes = [dødsoneQuiz()]
  db.questions = [{ id: 'q1', quiz_id: QUIZ, question_text: 'Hva heter hovedstaden i Norge?' }]
  db.log = []
  db.profiles = [{ id: 'bruker-1', email_reminders: true }]
  db.push = [{ id: 'push-1' }]
  db.feilPåTabell = null
  db.spørringer = 0
  db.skrivinger = 0
  captured.length = 0
})

const kanaler = (r: { funn: Array<{ channel: string }> }) => r.funn.map(f => f.channel).sort()

// ── Kjernen ─────────────────────────────────────────────────────────────────

test('quiz utenfor vinduet uten ett eneste varslingsspor → dødsone på begge kanaler', async () => {
  const res = await detectNotifyDeadZone('cron/send-push', NOW)

  assert.equal(res.kandidater, 1)
  assert.deepEqual(kanaler(res), ['quiz_open_email', 'quiz_open_push'])
  assert.equal(res.feilet, false)

  const varsler = captured.filter(c => /falt i dødsonen/.test(c.melding))
  assert.equal(varsler.length, 2)
  assert.equal(varsler[0].ctx.level, 'error')
  assert.equal(varsler[0].ctx.extra.quizId, QUIZ)
  assert.equal(varsler[0].ctx.extra.minutterSidenÅpning, 120)
  assert.match(String(varsler[0].ctx.extra.consequence), /aldri plukket opp av seg selv/)
})

test('SENDER ALDRI, STEMPLER ALDRI — enhver skriving feller testen', async () => {
  // Den falske klienten kaster på insert/upsert/update/delete. Ville
  // implementasjonen «hjulpet til» ved å sende eller stemple, ville dette
  // kallet kastet i stedet for å returnere et funn.
  const res = await detectNotifyDeadZone('cron/send-reminders', NOW)

  assert.equal(db.skrivinger, 0, 'deteksjonen skrev til databasen')
  assert.equal(res.funn.length, 2)
  // Loggen er urørt: ingen er merket som varslet, så en senere ekte kjøring
  // hopper ikke over noen. Dette er hele dobbeltsending-garantien.
  assert.deepEqual(db.log, [])
})

// ── Grensene (punkt 3: vinduet står på 60 min) ──────────────────────────────

test('en quiz INNE i vinduet er ikke en dødsone — den venter bare på neste kjøring', async () => {
  db.quizzes = [dødsoneQuiz({ opens_at: minutterSiden(30) })]

  const res = await detectNotifyDeadZone('test', NOW)

  assert.equal(res.kandidater, 0)
  assert.deepEqual(captured, [], 'hver fredag ville gitt et falskt varsel')
})

test('grensen er nøyaktig NOTIFY_WINDOW_MS, ikke «omtrent en time»', async () => {
  db.quizzes = [dødsoneQuiz({ opens_at: minutterSiden(60) })]
  assert.equal((await detectNotifyDeadZone('test', NOW)).kandidater, 0, '60 min er fortsatt inne')

  captured.length = 0
  db.quizzes = [dødsoneQuiz({ opens_at: new Date(NOW - 60 * 60_000 - 1).toISOString() })]
  assert.equal((await detectNotifyDeadZone('test', NOW)).kandidater, 1, 'ett ms utenfor er ute')
})

test('en quiz eldre enn tilbakeblikket rapporteres ikke i det uendelige', async () => {
  db.quizzes = [dødsoneQuiz({ opens_at: new Date(NOW - DEAD_ZONE_LOOKBACK_MS - 60_000).toISOString() })]

  const res = await detectNotifyDeadZone('test', NOW)

  assert.equal(res.kandidater, 0)
})

// ── Falske positiver som MÅ være lukket ─────────────────────────────────────

test('tom mottakerliste er ikke en dødsone — ingen ble varslet fordi ingen finnes', async () => {
  db.profiles = []
  db.push = []

  const res = await detectNotifyDeadZone('test', NOW)

  assert.equal(res.kandidater, 1, 'quizen er fortsatt en kandidat')
  assert.deepEqual(res.funn, [], 'men det er ingenting galt')
  assert.deepEqual(captured, [])
})

test('en placeholder-quiz rapporteres IKKE som dødsone — den ble holdt tilbake med vilje', async () => {
  // Innholdsvakten har allerede rapportert denne tilstanden med riktig årsak.
  // Uten dette skillet får Dennis to Sentry-saker om samme quiz, der den ene
  // peker på cron-jobben og den andre på den ekte årsaken.
  db.questions = [{ id: 'q1', quiz_id: QUIZ, question_text: '' }]

  const res = await detectNotifyDeadZone('test', NOW)

  assert.deepEqual(res.funn, [])
  assert.equal(captured.filter(c => /falt i dødsonen/.test(c.melding)).length, 0)
})

test('en stengt quiz rapporteres ikke — closes_at-vakten holdt den lovlig tilbake', async () => {
  db.quizzes = [dødsoneQuiz({ closes_at: minutterSiden(10) })]

  const res = await detectNotifyDeadZone('test', NOW)

  assert.equal(res.kandidater, 0)
})

test('en quiz uten stengetid er fortsatt en kandidat', async () => {
  db.quizzes = [dødsoneQuiz({ closes_at: null })]

  assert.equal((await detectNotifyDeadZone('test', NOW)).kandidater, 1)
})

test('testquiz og skjult quiz gir ingen dødsone', async () => {
  db.quizzes = [dødsoneQuiz({ is_test: true })]
  assert.equal((await detectNotifyDeadZone('test', NOW)).kandidater, 0)

  db.quizzes = [dødsoneQuiz({ is_active: false })]
  assert.equal((await detectNotifyDeadZone('test', NOW)).kandidater, 0)
})

// ── Per kanal, ikke per quiz ────────────────────────────────────────────────

test('delvis varsling: e-post kom fram, push gjorde ikke → kun push rapporteres', async () => {
  // Dette er formen «én av tre cron-jobber er slått av». Rapporterte vi per
  // quiz i stedet for per kanal, ville den levende kanalen skjult den døde.
  db.log = [{ quiz_id: QUIZ, channel: 'quiz_open_email', scope_id: GLOBAL, recipient_id: 'bruker-1' }]

  const res = await detectNotifyDeadZone('test', NOW)

  assert.deepEqual(kanaler(res), ['quiz_open_push'])
})

test('ÉN stemplet mottaker er nok — delvis leveranse er ikke en dødsone', async () => {
  // Vakten spør om varslingen kom i gang, ikke om den ble fullført. En delvis
  // levert quiz plukkes opp av neste ordinære kjøring.
  db.profiles = [{ id: 'bruker-1', email_reminders: true }, { id: 'bruker-2', email_reminders: true }]
  db.log = [
    { quiz_id: QUIZ, channel: 'quiz_open_email', scope_id: GLOBAL, recipient_id: 'bruker-1' },
    { quiz_id: QUIZ, channel: 'quiz_open_push', scope_id: GLOBAL, recipient_id: 'push-1' },
  ]

  assert.deepEqual((await detectNotifyDeadZone('test', NOW)).funn, [])
})

test('loggen for en ANNEN quiz dekker ikke over denne', async () => {
  db.log = [{ quiz_id: 'en-helt-annen-quiz', channel: 'quiz_open_email', scope_id: GLOBAL, recipient_id: 'bruker-1' }]

  assert.deepEqual(kanaler(await detectNotifyDeadZone('test', NOW)), ['quiz_open_email', 'quiz_open_push'])
})

// ── Kostnad og feilretning ──────────────────────────────────────────────────

test('normaltilstanden koster ÉN spørring', async () => {
  // Ruten fyrer hvert femte minutt fra tre steder. Er det ingen kandidat, skal
  // vi ikke røre hverken questions, loggen eller mottakertabellene.
  db.quizzes = []

  const res = await detectNotifyDeadZone('test', NOW)

  assert.equal(res.kandidater, 0)
  assert.equal(db.spørringer, 1, 'tomgangen skal ikke koste mer enn kandidatoppslaget')
})

test('kandidatoppslaget feiler → feilet, ingen kast, ingen funn', async () => {
  db.feilPåTabell = 'quizzes'

  const res = await detectNotifyDeadZone('test', NOW)

  assert.equal(res.feilet, true)
  assert.deepEqual(res.funn, [])
})

test('en feil i loggoppslaget gir ikke et falskt dødsone-varsel', async () => {
  // Fail-safe i motsatt retning av innholdsvakten: vet vi ikke om noen er
  // varslet, skal vi ikke påstå at ingen er det.
  db.feilPåTabell = 'quiz_notification_log'

  const res = await detectNotifyDeadZone('test', NOW)

  assert.deepEqual(res.funn, [])
  assert.equal(res.feilet, false, 'en delfeil velter ikke hele undersøkelsen')
})

// ── Strukturelle sperrer ────────────────────────────────────────────────────

const ROT = join(import.meta.dirname, '..')

const aktiveLinjer = (fil: string): string =>
  readFileSync(join(ROT, fil), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')

test('alle tre varslingsrutene kaller deteksjonen', async () => {
  // Koblingen vakt↔kallsted, som ellers ville vært det ærlige hullet: uten
  // denne kan `detectNotifyDeadZone` fjernes fra en rute uten at én test blir
  // rød. `aktiveLinjer` fjerner kommentarer, så en utkommentert linje passerer
  // ikke.
  for (const rute of [
    'app/api/cron/notify-subscribers/route.ts',
    'app/api/cron/send-reminders/route.ts',
    'app/api/cron/send-push/route.ts',
  ]) {
    assert.match(aktiveLinjer(rute), /detectNotifyDeadZone\(/, `${rute} oppdager ikke dødsonen`)
  }
})

test('deteksjonen importerer ingenting som kan sende', async () => {
  // Den sterkeste garantien mot dobbeltsending er at sendeveiene ikke finnes i
  // filen i det hele tatt.
  const kilde = aktiveLinjer('lib/notify-dead-zone.ts')

  for (const forbudt of ['@/lib/email', 'web-push', 'notify-dispatch', 'stampNotified', 'sendEmail']) {
    assert.doesNotMatch(kilde, new RegExp(forbudt.replace(/[/@-]/g, '\\$&')), `dødsone-deteksjonen har fått tilgang til ${forbudt}`)
  }
})

test('vinduet er IKKE utvidet — deteksjonen erstatter en utvidelse', async () => {
  // Punkt 3 i bestillingen. Endres tallet, skal noen ta stilling til det her.
  const { NOTIFY_WINDOW_MS } = await import('@/lib/opened-quiz-lookup')
  assert.equal(NOTIFY_WINDOW_MS, 60 * 60 * 1000)
  assert.equal(DEAD_ZONE_LOOKBACK_MS, 6 * 60 * 60 * 1000)
})
