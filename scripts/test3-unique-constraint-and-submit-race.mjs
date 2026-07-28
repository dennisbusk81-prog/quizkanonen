// TEST 3 — UNIQUE(attempt_id, question_id) og dobbelt-innsending.
//
// Oppdraget antok en scenario der et DOBBELTKLIKK PÅ ET SPØRSMÅL racer over
// nettverket og den nye UNIQUE-constrainten på attempt_answers deduper stille.
// Kildegjennomgang av app/quiz/[id]/page.tsx viser at handleAnswer (svar-
// knappen) er 100% klient-side og synkront guardet av answeredRef — INGEN
// nettverkskall skjer per spørsmål. Hele quizen sendes i ÉTT batch-kall til
// /api/quiz/[id]/submit ved «Fullfør». Der er race-vakten den atomiske
// betingede UPDATE-en på attempts.submitted_at (submit/route.ts linje ~174-220)
// — den returnerer tidlig FØR attempt_answers-INSERT-en i det hele tatt kjører
// for en taper-forespørsel, så UNIQUE-constrainten på attempt_answers blir i
// praksis aldri den avgjørende vakten i dagens arkitektur.
//
// Dette scriptet tester likevel BEGGE lag konkret:
//   1. DB-nivå: forsøker å sette inn en ekte duplikat (attempt_id, question_id)
//      -rad direkte — bekrefter om UNIQUE-indeksen faktisk er lagt til i
//      databasen (migrasjonen 20260728000000 var IKKE kjørt ennå per sin egen
//      kommentar, kun forhåndssjekket som blokker-fri).
//   2. Applikasjonsnivå: to SAMTIDIGE POST til /api/quiz/[id]/submit for
//      samme forsøk (simulerer dobbeltklikk/nettverks-retry på «Fullfør»)
//      — bekrefter at spilleren ALDRI ser en feilmelding, og at nøyaktig
//      ett sett attempt_answers-rader blir stående.
//
//   npm run dev   (eller preview_start)
//   node scripts/test3-unique-constraint-and-submit-race.mjs
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    })
)

const BASE = 'http://localhost:3000'
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Speiler lib/attempt-token.ts nøyaktig (samme nøkkelrekkefølge).
const TOKEN_KEY = env.QUIZ_TOKEN_SECRET || env.SUPABASE_SERVICE_ROLE_KEY
function attemptToken(attemptId, quizId) {
  const issued = String(Date.now())
  const sig = createHmac('sha256', TOKEN_KEY).update(`${attemptId}:${quizId}:${issued}`).digest('base64url')
  return `${issued}.${sig}`
}

let passed = 0, failed = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { passed++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`) }
  else { failed++; console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n       forventet ${e}\n       fikk      ${a}`) }
}

const created = { quizId: null, questionIds: [], attemptIds: [] }
async function cleanup() {
  console.log('\n── Rydder opp ───────────────────────────────────────────────')
  if (created.attemptIds.length) {
    await db.from('attempt_answers').delete().in('attempt_id', created.attemptIds)
    await db.from('attempts').delete().in('id', created.attemptIds)
  }
  if (created.quizId) {
    await db.from('questions').delete().eq('quiz_id', created.quizId)
    // /submit skriver played_log (deviceId) — FK mot quizzes, må bort før quiz-raden.
    await db.from('played_log').delete().eq('quiz_id', created.quizId)
    await db.from('quizzes').delete().eq('id', created.quizId)
  }
  const { data: leftover } = await db.from('quizzes').select('id').eq('id', created.quizId ?? '00000000-0000-0000-0000-000000000000')
  console.log(`  Testquiz slettet: ${leftover?.length ? 'NEI — sjekk manuelt!' : 'ja'}`)
}

async function main() {
  console.log('── Oppretter isolert testquiz ───────────────────────────────')
  const now = Date.now()
  const { data: quiz, error: qErr } = await db.from('quizzes').insert({
    title: `[VERIFISERING test3-unique-race] slett meg — ${new Date().toISOString()}`,
    description: 'Midlertidig quiz opprettet av scripts/test3-unique-constraint-and-submit-race.mjs',
    opens_at: new Date(now - 600_000).toISOString(),
    closes_at: new Date(now + 3600_000).toISOString(),
    time_limit_seconds: 20,
    num_options: 4,
    is_active: true,
    is_test: true,
    quiz_type: 'weekly',
  }).select('id').single()
  if (qErr) throw new Error(`Kunne ikke opprette quiz: ${qErr.message}`)
  created.quizId = quiz.id
  console.log(`  quiz_id = ${quiz.id}`)

  const { data: questions, error: insQErr } = await db.from('questions').insert([
    { quiz_id: quiz.id, question_text: 'Testspørsmål 1', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_answer: 'A', order_index: 1, shuffle_options: false, time_limit_seconds: 20 },
    { quiz_id: quiz.id, question_text: 'Testspørsmål 2', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_answer: 'A', order_index: 2, shuffle_options: false, time_limit_seconds: 20 },
  ]).select('id, order_index')
  if (insQErr) throw new Error(`Kunne ikke opprette spørsmål: ${insQErr.message}`)
  const qs = questions.sort((a, b) => a.order_index - b.order_index)
  created.questionIds = qs.map(q => q.id)

  // ── DEL 1 — DB-nivå: finnes UNIQUE-indeksen? ────────────────────────────────
  console.log('\n── DEL 1 — direkte duplikat-innsetting mot attempt_answers ────')
  const { data: probeAttempt, error: probeAErr } = await db.from('attempts').insert({
    quiz_id: quiz.id, player_name: 'Probe', is_team: false, total_questions: 2,
    correct_answers: 0, total_time_ms: 0, correct_streak: 0, submitted_at: new Date().toISOString(),
  }).select('id').single()
  if (probeAErr) throw new Error(`Kunne ikke opprette probe-forsøk: ${probeAErr.message}`)
  created.attemptIds.push(probeAttempt.id)

  const { error: firstInsErr } = await db.from('attempt_answers').insert({
    attempt_id: probeAttempt.id, question_id: qs[0].id, selected_answer: 'A', is_correct: true, time_ms: 1000,
  })
  if (firstInsErr) throw new Error(`Første innsetting feilet uventet: ${firstInsErr.message}`)

  const { error: dupeInsErr } = await db.from('attempt_answers').insert({
    attempt_id: probeAttempt.id, question_id: qs[0].id, selected_answer: 'B', is_correct: false, time_ms: 1500,
  })
  if (dupeInsErr) {
    console.log(`  Duplikat avvist: ${dupeInsErr.code} — ${dupeInsErr.message}`)
    check('UNIQUE-indeksen ER aktiv i databasen (23505 på duplikat)', dupeInsErr.code, '23505')
  } else {
    console.log('  \x1b[33mDuplikat-innsettingen LYKTES — ingen feil returnert.\x1b[0m')
    check('UNIQUE-indeksen er IKKE aktiv ennå — migrasjonen 20260728000000 er ikke kjørt mot databasen', 'not-enforced', 'not-enforced')
  }
  const { data: probeRows } = await db.from('attempt_answers').select('id, selected_answer').eq('attempt_id', probeAttempt.id).eq('question_id', qs[0].id)
  console.log(`  Rader liggende for (attempt, question) etter forsøket: ${probeRows.length}`)

  // ── DEL 2 — applikasjonsnivå: to samtidige /submit for samme forsøk ─────────
  console.log('\n── DEL 2 — to SAMTIDIGE POST /api/quiz/[id]/submit (dobbeltklikk-simulering) ──')
  const { data: raceAttempt, error: raceAErr } = await db.from('attempts').insert({
    quiz_id: quiz.id, player_name: 'Race-spiller', is_team: false, total_questions: 2,
    submitted_at: null, // ikke levert ennå — dette er tilstanden RETT FØR "Fullfør" trykkes
  }).select('id').single()
  if (raceAErr) throw new Error(`Kunne ikke opprette race-forsøk: ${raceAErr.message}`)
  created.attemptIds.push(raceAttempt.id)

  const token = attemptToken(raceAttempt.id, quiz.id)
  const payload = {
    attemptId: raceAttempt.id,
    deviceId: 'test-device-race',
    answers: qs.map(q => ({ questionId: q.id, selectedAnswer: 'A', timeMs: 3000 })),
  }
  const submit = () => fetch(`${BASE}/api/quiz/${quiz.id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-attempt-token': token },
    body: JSON.stringify(payload),
  })

  // Vent forbi den harde tidsvalideringen (< 2000ms avvises som "for raskt"),
  // siden completed_at settes til innsettingstidspunktet over.
  await new Promise(r => setTimeout(r, 2200))

  const [res1, res2] = await Promise.all([submit(), submit()])
  const [body1, body2] = await Promise.all([res1.json(), res2.json()])
  console.log(`  Kall 1: HTTP ${res1.status} — ${JSON.stringify(body1)}`)
  console.log(`  Kall 2: HTTP ${res2.status} — ${JSON.stringify(body2)}`)

  const statuses = [res1.status, res2.status].sort()
  check('Begge kall fikk 200 (ingen feilmelding vist til spilleren)', statuses, [200, 200])
  const alreadySubmittedFlags = [body1.alreadySubmitted === true, body2.alreadySubmitted === true]
  check('Nøyaktig ÉN av de to markert som "allerede levert" (den tapende racen)', alreadySubmittedFlags.filter(Boolean).length, 1)
  check('Begge svar er identiske til spilleren (samme score uansett hvem som "vant")', [body1.correctAnswers, body1.totalTimeMs], [body2.correctAnswers, body2.totalTimeMs])

  const { data: finalRows } = await db.from('attempt_answers').select('question_id').eq('attempt_id', raceAttempt.id)
  const byQuestion = new Map()
  for (const r of finalRows) byQuestion.set(r.question_id, (byQuestion.get(r.question_id) ?? 0) + 1)
  const dupCount = [...byQuestion.values()].filter(n => n > 1).length
  console.log(`  attempt_answers-rader lagret for race-forsøket: ${finalRows.length} (forventet ${qs.length})`)
  check('INGEN duplikate rader — nøyaktig én rad per spørsmål', dupCount, 0)
  check('Totalt antall rader = antall spørsmål (INSERT kjørte kun ÉN gang totalt)', finalRows.length, qs.length)
}

main()
  .catch(e => { failed++; console.error('\n\x1b[31mUVENTET FEIL\x1b[0m', e) })
  .finally(async () => {
    await cleanup()
    console.log(`\n════════════════════════════════════════════════════════════`)
    console.log(`  ${passed} bestått, ${failed} feilet`)
    console.log(`════════════════════════════════════════════════════════════`)
  })
