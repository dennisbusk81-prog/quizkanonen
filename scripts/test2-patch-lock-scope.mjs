// TEST 2 — bekreft hva PATCH 409-gjerdet FAKTISK er scopet til.
//
// Oppdraget antok at 409-blokkeringen kun trigges når QUIZEN er stengt.
// Kildekodegjennomgang (lib/answer-key-correction.ts::decideAnswerKeyPatch)
// viser at gjerdet IKKE ser på quiz.closes_at/is_active i det hele tatt — det
// låser basert på om DETTE SPØRSMÅLET har attempt_answers-rader, uavhengig av
// om quizen som helhet er åpen eller stengt. Dette scriptet bekrefter det
// praktisk, mot en quiz som er ÅPEN (closes_at i fremtiden) hele veien:
//
//   A. Uendret fasit + rettet tekst på et BESVART spørsmål i en ÅPEN quiz → 200
//   B. ENDRET fasit på det SAMME besvarte spørsmålet, quizen fortsatt ÅPEN → 409
//   C. Fasitendring på et UBESVART spørsmål i samme ÅPNE quiz → 200 (direkte skriving)
//
//   npm run dev   (eller preview_start)
//   node scripts/test2-patch-lock-scope.mjs
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
const exp = String(Date.now() + 60 * 60 * 1000)
const ADMIN_TOKEN = `${exp}.${createHmac('sha256', env.ADMIN_PASSWORD).update(exp).digest('base64url')}`
const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN, ...(init.headers ?? {}) } })

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
    await db.from('quizzes').delete().eq('id', created.quizId)
  }
  const { data: leftover } = await db.from('quizzes').select('id').eq('id', created.quizId ?? '00000000-0000-0000-0000-000000000000')
  console.log(`  Testquiz slettet: ${leftover?.length ? 'NEI — sjekk manuelt!' : 'ja'}`)
}

async function main() {
  console.log('── Oppretter isolert testquiz — ÅPEN (closes_at i FREMTIDEN) ──')
  const now = Date.now()
  const { data: quiz, error: qErr } = await db.from('quizzes').insert({
    title: `[VERIFISERING test2-patch-lock] slett meg — ${new Date().toISOString()}`,
    description: 'Midlertidig quiz opprettet av scripts/test2-patch-lock-scope.mjs',
    opens_at: new Date(now - 600_000).toISOString(),
    closes_at: new Date(now + 3600_000).toISOString(), // ÅPEN — stenger om 1 time
    time_limit_seconds: 20,
    num_options: 4,
    is_active: true, // fortsatt aktiv/pågående
    is_test: true,
    quiz_type: 'weekly',
  }).select('id').single()
  if (qErr) throw new Error(`Kunne ikke opprette quiz: ${qErr.message}`)
  created.quizId = quiz.id
  console.log(`  quiz_id = ${quiz.id}  (is_active=true, closes_at=+1t — quizen er ÅPEN/pågående)`)

  const { data: questions, error: insQErr } = await db.from('questions').insert([
    { quiz_id: quiz.id, question_text: 'Testspørsmål 1 (blir besvart)', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_answer: 'A', order_index: 1, shuffle_options: false },
    { quiz_id: quiz.id, question_text: 'Testspørsmål 2 (forblir ubesvart)', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_answer: 'A', order_index: 2, shuffle_options: false },
  ]).select('id, order_index')
  if (insQErr) throw new Error(`Kunne ikke opprette spørsmål: ${insQErr.message}`)
  const [q1, q2] = questions.sort((a, b) => a.order_index - b.order_index)
  created.questionIds = questions.map(q => q.id)

  // Én spiller er MIDT I quizen: har svart på q1, quizen er fortsatt åpen (ikke levert).
  const { data: attempt, error: aErr } = await db.from('attempts').insert({
    quiz_id: quiz.id, player_name: 'Testspiller (pågående)', is_team: false,
    total_questions: 2, correct_answers: 1, total_time_ms: 2000, correct_streak: 1,
    submitted_at: null, // IKKE levert ennå — kvizen pågår aktivt for denne spilleren
  }).select('id').single()
  if (aErr) throw new Error(`Kunne ikke opprette forsøk: ${aErr.message}`)
  created.attemptIds = [attempt.id]

  const { error: aaErr } = await db.from('attempt_answers').insert([
    { attempt_id: attempt.id, question_id: q1.id, selected_answer: 'A', is_correct: true, time_ms: 2000 },
  ])
  if (aaErr) throw new Error(`Kunne ikke opprette svar: ${aaErr.message}`)
  console.log(`  1 spiller MIDT I quizen har svart på q1 (riktig, A). q2 er ubesvart. Quizen pågår (ikke levert).\n`)

  const getQ = async id => (await db.from('questions').select('question_text, correct_answer, correct_answers').eq('id', id).single()).data

  console.log('A — Uendret fasit + rettet tekst på BESVART spørsmål, quiz ÅPEN')
  {
    const res = await api(`/api/admin/quizzes/${quiz.id}/questions/${q1.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        question_text: 'Testspørsmål 1 — rettet skrivefeil (mens quiz pågår)',
        option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D',
        correct_answer: 'A', correct_answers: null, // uendret
        time_limit_seconds: 20, shuffle_options: false, category: null,
      }),
    })
    check('HTTP 200 — vanlig redigering går gjennom selv om quizen er åpen', res.status, 200)
    check('teksten er lagret', await getQ(q1.id).then(q => q.question_text), 'Testspørsmål 1 — rettet skrivefeil (mens quiz pågår)')
  }

  console.log('\nB — ENDRET fasit på SAMME besvarte spørsmål, quiz FORTSATT ÅPEN')
  {
    const res = await api(`/api/admin/quizzes/${quiz.id}/questions/${q1.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ question_text: 'Testspørsmål 1', correct_answer: 'B', correct_answers: null }),
    })
    const body = await res.json()
    check('HTTP 409 — låst SELV OM quizen er åpen (gjerdet ser kun på answeredCount, ikke quiz-status)', res.status, 409)
    check('maskinlesbar kode', body.code, 'answer_key_locked')
    check('fasiten i databasen er urørt', await getQ(q1.id).then(q => q.correct_answer), 'A')
  }

  console.log('\nC — Fasitendring på UBESVART spørsmål i SAMME åpne quiz')
  {
    const res = await api(`/api/admin/quizzes/${quiz.id}/questions/${q2.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ question_text: 'Testspørsmål 2', correct_answer: 'C', correct_answers: null }),
    })
    check('HTTP 200 — ingen lås, quiz-status er irrelevant, kun answeredCount for DETTE spørsmålet', res.status, 200)
    check('fasiten skrevet direkte', await getQ(q2.id).then(q => q.correct_answer), 'C')
  }

  console.log('\n\x1b[36mKONKLUSJON:\x1b[0m 409-gjerdet er PER SPØRSMÅL (answeredCount for nettopp DET spørsmålet),')
  console.log('IKKE per quiz-status. En admin kan fritt endre fasiten på et ubesvart spørsmål i en')
  console.log('quiz som allerede er åpen og pågår (case C), MEN blir låst på et spørsmål som ER')
  console.log('besvart selv om quizen aldri har vært stengt (case B, is_active=true, closes_at i')
  console.log('fremtiden). Kildekoden (decideAnswerKeyPatch) inneholder ingen referanse til quiz.closes_at')
  console.log('eller quiz.is_active i det hele tatt — kun attempt_answers-telling for spørsmålet.')
}

main()
  .catch(e => { failed++; console.error('\n\x1b[31mUVENTET FEIL\x1b[0m', e) })
  .finally(async () => {
    await cleanup()
    console.log(`\n════════════════════════════════════════════════════════════`)
    console.log(`  ${passed} bestått, ${failed} feilet`)
    console.log(`════════════════════════════════════════════════════════════`)
  })
