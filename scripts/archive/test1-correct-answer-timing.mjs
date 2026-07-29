// TEST 1 — fasit-retting med realistisk antall attempts.
// Oppretter en isolert testquiz (is_test=true) med 5 spørsmål og 60 forsøk
// (300 attempt_answers-rader), kaller /api/admin/correct-answer for å rette
// fasiten på ett spørsmål, og tidsmåler HELE operasjonen (synkron regradering
// + resync av season_scores). Rydder opp etter seg.
//
//   npm run dev   (eller preview_start)
//   node scripts/test1-correct-answer-timing.mjs
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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const exp = String(Date.now() + 60 * 60 * 1000)
const ADMIN_TOKEN = `${exp}.${createHmac('sha256', env.ADMIN_PASSWORD).update(exp).digest('base64url')}`
const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN, ...(init.headers ?? {}) },
  })

const N_ATTEMPTS = 65
const N_QUESTIONS = 5
const created = { quizId: null, questionIds: [], attemptIds: [] }

async function cleanup() {
  console.log('\n── Rydder opp ───────────────────────────────────────────────')
  if (created.attemptIds.length) {
    for (let i = 0; i < created.attemptIds.length; i += 200) {
      await db.from('attempt_answers').delete().in('attempt_id', created.attemptIds.slice(i, i + 200))
    }
    for (let i = 0; i < created.attemptIds.length; i += 200) {
      await db.from('attempts').delete().in('id', created.attemptIds.slice(i, i + 200))
    }
  }
  if (created.quizId) {
    await db.from('season_scores').delete().eq('quiz_id', created.quizId)
    await db.from('questions').delete().eq('quiz_id', created.quizId)
    await db.from('quizzes').delete().eq('id', created.quizId)
  }
  const { data: leftover } = await db.from('quizzes').select('id').eq('id', created.quizId ?? '00000000-0000-0000-0000-000000000000')
  console.log(`  Testquiz slettet: ${leftover?.length ? 'NEI — sjekk manuelt!' : 'ja'}`)
  console.log(`  quiz_id (for manuell verifisering om nødvendig): ${created.quizId}`)
}

async function main() {
  console.log('── Oppretter isolert testquiz ───────────────────────────────')
  const now = Date.now()
  const { data: quiz, error: qErr } = await db.from('quizzes').insert({
    title: `[VERIFISERING test1-timing] slett meg — ${new Date().toISOString()}`,
    description: 'Midlertidig quiz opprettet av scripts/test1-correct-answer-timing.mjs',
    opens_at: new Date(now - 7200_000).toISOString(),
    closes_at: new Date(now - 3600_000).toISOString(),
    time_limit_seconds: 20,
    num_options: 4,
    is_active: false,
    is_test: true,
    quiz_type: 'weekly',
  }).select('id').single()
  if (qErr) throw new Error(`Kunne ikke opprette quiz: ${qErr.message}`)
  created.quizId = quiz.id
  console.log(`  quiz_id = ${quiz.id}`)

  const { data: questions, error: insQErr } = await db.from('questions').insert(
    Array.from({ length: N_QUESTIONS }, (_, i) => ({
      quiz_id: quiz.id,
      question_text: `Testspørsmål ${i + 1}`,
      option_a: 'Alt A', option_b: 'Alt B', option_c: 'Alt C', option_d: 'Alt D',
      correct_answer: 'A',
      order_index: i + 1,
      shuffle_options: false,
    }))
  ).select('id, order_index')
  if (insQErr) throw new Error(`Kunne ikke opprette spørsmål: ${insQErr.message}`)
  const qs = questions.sort((a, b) => a.order_index - b.order_index)
  created.questionIds = qs.map(q => q.id)
  const targetQuestion = qs[2] // spørsmål 3 — rettes senere

  console.log(`  ${N_QUESTIONS} spørsmål opprettet. Oppretter ${N_ATTEMPTS} forsøk...`)

  // Batch-insert attempts (60/65 spillere). Om lag 60% svarer A (riktig), resten
  // sprer seg på B/C/timeout — realistisk fordeling, ikke bare ensfarget data.
  const attemptRows = Array.from({ length: N_ATTEMPTS }, (_, i) => ({
    quiz_id: quiz.id,
    player_name: `Testspiller ${i + 1}`,
    is_team: false,
    total_questions: N_QUESTIONS,
    total_time_ms: N_QUESTIONS * 3000,
    submitted_at: new Date().toISOString(),
    // correct_answers/correct_streak fylles ut riktig under, etter at vi vet svarmønsteret
    correct_answers: 0,
    correct_streak: 0,
  }))
  const { data: attempts, error: aErr } = await db.from('attempts').insert(attemptRows).select('id, player_name')
  if (aErr) throw new Error(`Kunne ikke opprette forsøk: ${aErr.message}`)
  created.attemptIds = attempts.map(a => a.id)

  // Svarmønster per spiller: ~60% A (riktig på alt), ~25% B (feil på alt),
  // ~15% timeout (null) på ett tilfeldig spørsmål ellers B.
  const answerRows = []
  const finalTotals = new Map()
  for (const a of attempts) {
    const idx = Number(a.player_name.split(' ')[1])
    const pattern = idx % 20 < 12 ? 'A' : idx % 20 < 17 ? 'B' : 'TIMEOUT_ON_3'
    let correct = 0
    const perQ = []
    for (const q of qs) {
      let selected = 'A'
      if (pattern === 'B') selected = 'B'
      if (pattern === 'TIMEOUT_ON_3' && q.id === targetQuestion.id) selected = null
      const isCorrect = selected === 'A'
      if (isCorrect) correct++
      perQ.push({ attempt_id: a.id, question_id: q.id, selected_answer: selected, is_correct: isCorrect, time_ms: 3000 })
    }
    answerRows.push(...perQ)
    // streak = lengste sammenhengende rekke fra start (alle A → full streak; alle B → 0)
    const streak = pattern === 'A' ? N_QUESTIONS : pattern === 'B' ? 0 : qs.findIndex(q => q.id === targetQuestion.id)
    finalTotals.set(a.id, { correct, streak })
  }

  for (let i = 0; i < answerRows.length; i += 500) {
    const { error } = await db.from('attempt_answers').insert(answerRows.slice(i, i + 500))
    if (error) throw new Error(`Kunne ikke opprette svar (batch ${i}): ${error.message}`)
  }

  // Skriv riktige totaler tilbake på attempts, så utgangspunktet er konsistent
  // (correct-answer-ruten leser attempt_answers på nytt uansett, men attempts
  // sitt FØR-tall skal være riktig for en meningsfull før/etter-sammenligning).
  for (const [attemptId, t] of finalTotals) {
    await db.from('attempts').update({ correct_answers: t.correct, correct_streak: t.streak }).eq('id', attemptId)
  }

  console.log(`  ${answerRows.length} svarrader opprettet på tvers av ${N_ATTEMPTS} forsøk.`)
  console.log(`  Retter fasiten på spørsmål 3 (id=${targetQuestion.id}): A → C\n`)

  console.log('── Kjører /api/admin/correct-answer ────────────────────────')
  const startedAt = Date.now()
  const res = await api('/api/admin/correct-answer', {
    method: 'POST',
    body: JSON.stringify({ questionId: targetQuestion.id, newCorrectAnswers: ['C'] }),
  })
  const elapsedMs = Date.now() - startedAt
  const body = await res.json()

  console.log(`  HTTP status:        ${res.status}`)
  console.log(`  Tid brukt:           ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)} s)`)
  console.log(`  maxDuration-grense:  60000 ms`)
  console.log(`  Margin til grensen:  ${60000 - elapsedMs} ms (${(((60000 - elapsedMs) / 60000) * 100).toFixed(1)}% igjen)`)
  if (elapsedMs > 60000) {
    console.log('  \x1b[31m*** OVER GRENSEN — ville feilet i produksjon (Vercel maxDuration=60) ***\x1b[0m')
  } else if (elapsedMs > 45000) {
    console.log('  \x1b[33m*** NÆRMER SEG GRENSEN (>75% av 60s) — flagg for videre overvåking ***\x1b[0m')
  } else {
    console.log('  \x1b[32mGod margin til maxDuration=60.\x1b[0m')
  }
  console.log(`\n  Response: ${JSON.stringify(body, null, 2)}`)

  // Verifiser at regraderingen faktisk stemmer: alle A-svarere (pattern A) er nå
  // FEIL på spørsmål 3 (fasit ble endret til C), alle timeout er fortsatt feil.
  const { data: check } = await db
    .from('attempt_answers')
    .select('attempt_id, selected_answer, is_correct')
    .eq('question_id', targetQuestion.id)
  const wrongAfter = check.filter(r => r.selected_answer === 'A' && r.is_correct === true)
  console.log(`\n  Sanity-sjekk: A-svar fortsatt markert riktig (skal være 0): ${wrongAfter.length}`)
  console.log(`  Forventet oppdaterte rader: ${answerRows.filter(r => r.selected_answer === 'A').length}, faktisk 'updated' fra API: ${body.updated}`)
}

main()
  .catch(e => { console.error('\n\x1b[31mUVENTET FEIL\x1b[0m', e) })
  .finally(async () => {
    await cleanup()
  })
