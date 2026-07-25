// Ende-til-ende-verifisering av fasit-opprydningen, mot en ISOLERT testquiz.
//
// Oppretter sin egen quiz (is_test = true) med egne spørsmål og forsøk, kjører
// alle scenariene mot den KJØRENDE dev-serveren (ekte HTTP mot ekte ruter), og
// sletter alt den laget til slutt. Rører aldri eksisterende data.
//
//   npm run dev   (eller preview_start)
//   node scripts/verify-answer-key-flow.mjs
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

// ── Oppsett ──────────────────────────────────────────────────────────────────
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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// Samme tokenformat som lib/admin-token.ts
const exp = String(Date.now() + 60 * 60 * 1000)
const ADMIN_TOKEN = `${exp}.${createHmac('sha256', env.ADMIN_PASSWORD).update(exp).digest('base64url')}`

const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN, ...(init.headers ?? {}) },
  })

let passed = 0
let failed = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`) }
  else { failed++; console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n       forventet ${e}\n       fikk      ${a}`) }
}

const created = { quizId: null, questionIds: [], attemptIds: [] }

async function cleanup() {
  console.log('\n── Rydder opp ───────────────────────────────────────────────')
  if (created.attemptIds.length) await db.from('attempt_answers').delete().in('attempt_id', created.attemptIds)
  if (created.attemptIds.length) await db.from('attempts').delete().in('id', created.attemptIds)
  if (created.quizId) await db.from('questions').delete().eq('quiz_id', created.quizId)
  if (created.quizId) await db.from('season_scores').delete().eq('quiz_id', created.quizId)
  if (created.quizId) await db.from('quizzes').delete().eq('id', created.quizId)
  const { data: leftover } = await db.from('quizzes').select('id').eq('id', created.quizId ?? '00000000-0000-0000-0000-000000000000')
  console.log(`  Testquiz slettet: ${leftover?.length ? 'NEI — sjekk manuelt!' : 'ja'}`)
}

async function main() {
  console.log('── Oppretter isolert testquiz ───────────────────────────────')
  const now = Date.now()
  const { data: quiz, error: qErr } = await db.from('quizzes').insert({
    title: `[VERIFISERING fasit] slett meg — ${new Date().toISOString()}`,
    description: 'Midlertidig quiz opprettet av scripts/verify-answer-key-flow.mjs',
    opens_at: new Date(now - 3600_000).toISOString(),
    closes_at: new Date(now - 60_000).toISOString(),
    time_limit_seconds: 20,
    num_options: 4,
    is_active: false,
    is_test: true,
    quiz_type: 'weekly',
  }).select('id').single()
  if (qErr) throw new Error(`Kunne ikke opprette quiz: ${qErr.message}`)
  created.quizId = quiz.id
  console.log(`  quiz_id = ${quiz.id}`)

  // q1 og q2 blir spilt. q3 forblir ubesvart (quiz "under bygging"-tilfellet).
  const { data: questions, error: insQErr } = await db.from('questions').insert(
    [1, 2, 3].map(n => ({
      quiz_id: quiz.id,
      question_text: `Testspørsmål ${n}`,
      option_a: 'Alt A', option_b: 'Alt B', option_c: 'Alt C', option_d: 'Alt D',
      correct_answer: 'A',
      order_index: n,
      shuffle_options: false,
    }))
  ).select('id, order_index')
  if (insQErr) throw new Error(`Kunne ikke opprette spørsmål: ${insQErr.message}`)
  const [q1, q2, q3] = questions.sort((a, b) => a.order_index - b.order_index)
  created.questionIds = questions.map(q => q.id)

  // To spillere. Fasit er A på alt.
  //   p1: q1=A (rett), q2=C (feil)   → 1 riktig, streak 1
  //   p2: q1=B (feil), q2=null timeout → 0 riktige, streak 0
  const { data: attempts, error: aErr } = await db.from('attempts').insert([
    { quiz_id: quiz.id, player_name: 'Testspiller 1', is_team: false, total_questions: 2, correct_answers: 1, total_time_ms: 4000, correct_streak: 1, submitted_at: new Date().toISOString() },
    { quiz_id: quiz.id, player_name: 'Testspiller 2', is_team: false, total_questions: 2, correct_answers: 0, total_time_ms: 5000, correct_streak: 0, submitted_at: new Date().toISOString() },
  ]).select('id, player_name')
  if (aErr) throw new Error(`Kunne ikke opprette forsøk: ${aErr.message}`)
  const p1 = attempts.find(a => a.player_name === 'Testspiller 1')
  const p2 = attempts.find(a => a.player_name === 'Testspiller 2')
  created.attemptIds = attempts.map(a => a.id)

  const { error: aaErr } = await db.from('attempt_answers').insert([
    { attempt_id: p1.id, question_id: q1.id, selected_answer: 'A', is_correct: true,  time_ms: 2000 },
    { attempt_id: p1.id, question_id: q2.id, selected_answer: 'C', is_correct: false, time_ms: 2000 },
    { attempt_id: p2.id, question_id: q1.id, selected_answer: 'B', is_correct: false, time_ms: 2500 },
    { attempt_id: p2.id, question_id: q2.id, selected_answer: null, is_correct: false, time_ms: 2500 },
  ])
  if (aaErr) throw new Error(`Kunne ikke opprette svar: ${aaErr.message}`)
  console.log(`  2 spillere, 4 svarrader. q1+q2 spilt, q3 ubesvart.\n`)

  const getQ = async id => (await db.from('questions').select('question_text, explanation, correct_answer, correct_answers').eq('id', id).single()).data
  const getAttempt = async id => (await db.from('attempts').select('correct_answers, correct_streak').eq('id', id).single()).data
  const getAnswer = async (aid, qid) => (await db.from('attempt_answers').select('is_correct').eq('attempt_id', aid).eq('question_id', qid).single()).data

  // ── KRAV 1: vanlig redigering på en SPILT quiz, fasit uendret ──────────────
  console.log('KRAV 1 — vanlig redigering på SPILT quiz (fasit uendret)')
  {
    const res = await api(`/api/admin/quizzes/${quiz.id}/questions/${q1.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        question_text: 'Testspørsmål 1 — rettet skrivefeil',
        explanation: 'Ny forklaring',
        option_a: 'Alt A', option_b: 'Alt B', option_c: 'Alt C', option_d: 'Alt D',
        correct_answer: 'A',          // uendret — sendes alltid av begge admin-sider
        correct_answers: null,
        time_limit_seconds: 20, shuffle_options: false, category: null,
      }),
    })
    const body = await res.json()
    const q = await getQ(q1.id)
    check('HTTP 200', res.status, 200)
    check('spørsmålsteksten er lagret', q.question_text, 'Testspørsmål 1 — rettet skrivefeil')
    check('forklaringen er lagret', q.explanation, 'Ny forklaring')
    check('fasit-kolonnene ble IKKE skrevet', body.updated?.includes('correct_answer'), false)
    check('fasiten står uendret', [q.correct_answer, q.correct_answers], ['A', null])
    check('p1 sin scoring er urørt', await getAttempt(p1.id), { correct_answers: 1, correct_streak: 1 })
  }

  // ── KRAV 2: fasitendring på spørsmål UNDER BYGGING (ingen svar) ────────────
  console.log('\nKRAV 2 — fasitendring på spørsmål UNDER BYGGING (ingen svar ennå)')
  {
    const res = await api(`/api/admin/quizzes/${quiz.id}/questions/${q3.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ question_text: 'Testspørsmål 3', correct_answer: 'C', correct_answers: null }),
    })
    check('HTTP 200 — ingen blokkering, ingen bekreftelse', res.status, 200)
    check('fasiten er skrevet direkte', await getQ(q3.id).then(q => [q.correct_answer, q.correct_answers]), ['C', null])

    const multi = await api(`/api/admin/quizzes/${quiz.id}/questions/${q3.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ correct_answer: 'B', correct_answers: ['B', 'D'] }),
    })
    check('multi-svar skrives også direkte (HTTP 200)', multi.status, 200)
    check('begge svar lagret', await getQ(q3.id).then(q => [q.correct_answer, q.correct_answers]), ['B', ['B', 'D']])
  }

  // ── KRAV 3a: den skjulte veien er stengt ───────────────────────────────────
  console.log('\nKRAV 3a — fasitendring på SPILT spørsmål via PATCH er stengt')
  {
    const res = await api(`/api/admin/quizzes/${quiz.id}/questions/${q2.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ question_text: 'Testspørsmål 2', correct_answer: 'C', correct_answers: null }),
    })
    const body = await res.json()
    check('HTTP 409', res.status, 409)
    check('maskinlesbar kode', body.code, 'answer_key_locked')
    check('antall berørte besvarelser oppgitt', body.answeredCount, 2)
    check('nåværende fasit oppgitt til UI-et', body.currentAnswers, ['A'])
    check('fasiten i databasen er urørt', await getQ(q2.id).then(q => q.correct_answer), 'A')
    check('p1 sitt q2-svar er IKKE regradert av PATCH', await getAnswer(p1.id, q2.id).then(r => r.is_correct), false)
    console.log(`       melding: "${body.error}"`)
  }

  // ── KRAV 3b: samme retting gjennom den ene godkjente ruten ─────────────────
  console.log('\nKRAV 3b — samme retting via «Rett svar» (correct-answer-ruten), TO riktige svar')
  {
    const res = await api('/api/admin/correct-answer', {
      method: 'POST',
      body: JSON.stringify({ questionId: q2.id, newCorrectAnswers: ['A', 'C'] }),
    })
    const body = await res.json()
    check('HTTP 200', res.status, 200)
    check('antall oppdaterte svarrader', body.updated, 2)
    check('ny fasit i responsen', body.correctAnswers, ['A', 'C'])
    check('forrige fasit i responsen', body.previousCorrectAnswers, ['A'])
    check('begge svar lagret på spørsmålet', await getQ(q2.id).then(q => [q.correct_answer, q.correct_answers]), ['A', ['A', 'C']])
    check('p1 svarte C og er nå RIKTIG', await getAnswer(p1.id, q2.id).then(r => r.is_correct), true)
    check('p2 sin timeout er fortsatt feil', await getAnswer(p2.id, q2.id).then(r => r.is_correct), false)
    check('p1: 1 → 2 riktige, streak 1 → 2', await getAttempt(p1.id), { correct_answers: 2, correct_streak: 2 })
    check('p2 er uendret', await getAttempt(p2.id), { correct_answers: 0, correct_streak: 0 })
  }

  // ── KRAV 3c: enkelt-svar-retting fungerer fortsatt som før ─────────────────
  console.log('\nKRAV 3c — retting med ETT riktig svar fungerer som før')
  {
    const res = await api('/api/admin/correct-answer', {
      method: 'POST',
      body: JSON.stringify({ questionId: q1.id, newCorrectAnswers: ['B'] }),
    })
    const body = await res.json()
    check('HTTP 200', res.status, 200)
    check('correct_answers nullstilles ved ett svar', await getQ(q1.id).then(q => [q.correct_answer, q.correct_answers]), ['B', null])
    check('p1 svarte A og er nå FEIL', await getAnswer(p1.id, q1.id).then(r => r.is_correct), false)
    check('p2 svarte B og er nå RIKTIG', await getAnswer(p2.id, q1.id).then(r => r.is_correct), true)
    check('p1: 2 → 1 riktig, streak 2 → 1', await getAttempt(p1.id), { correct_answers: 1, correct_streak: 1 })
    check('p2: 0 → 1 riktig, streak 0 → 1', await getAttempt(p2.id), { correct_answers: 1, correct_streak: 1 })
    check('season_scores-resync kjørte uten feil', body.seasonScores.error, null)
  }

  // ── Bakoverkompatibilitet + validering ────────────────────────────────────
  console.log('\nEkstra — bakoverkompatibilitet og validering')
  {
    const legacy = await api('/api/admin/correct-answer', {
      method: 'POST',
      body: JSON.stringify({ questionId: q1.id, newCorrectAnswer: 'A' }), // gammel enkelt-form
    })
    check('gammelt feltnavn newCorrectAnswer virker fortsatt', legacy.status, 200)
    check('fasiten er tilbake på A', await getQ(q1.id).then(q => q.correct_answer), 'A')

    const bad = await api('/api/admin/correct-answer', {
      method: 'POST',
      body: JSON.stringify({ questionId: q1.id, newCorrectAnswers: [] }),
    })
    check('tomt fasit-sett avvises (400)', bad.status, 400)

    const badLetter = await api('/api/admin/correct-answer', {
      method: 'POST',
      body: JSON.stringify({ questionId: q1.id, newCorrectAnswers: ['E'] }),
    })
    check('ugyldig bokstav avvises (400)', badLetter.status, 400)

    const count = await api(`/api/admin/quizzes/${quiz.id}/questions/${q2.id}`)
    const countBody = await count.json()
    check('GET gir antall besvarelser til UI-et', countBody.answeredCount, 2)
    check('GET gir gjeldende fasit til UI-et', countBody.correctAnswers, ['A', 'C'])

    const noAuth = await fetch(`${BASE}/api/admin/quizzes/${quiz.id}/questions/${q2.id}`, { method: 'PATCH', body: '{}' })
    check('PATCH uten admin-token avvises (401)', noAuth.status, 401)
  }
}

main()
  .catch(e => { failed++; console.error('\n\x1b[31mUVENTET FEIL\x1b[0m', e) })
  .finally(async () => {
    await cleanup()
    console.log(`\n════════════════════════════════════════════════════════════`)
    console.log(`  ${passed} bestått, ${failed} feilet`)
    console.log(`════════════════════════════════════════════════════════════`)
    process.exit(failed > 0 ? 1 : 0)
  })
