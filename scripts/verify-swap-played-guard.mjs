// ─────────────────────────────────────────────────────────────────────────────
// EMPIRISK VERIFISERING av quiz_played-vakten i public.swap_question_order
// mot EKTE database. Kjøres ETTER at migrasjonen
// supabase/migrations/20260824000001_swap_question_order_played_guard.sql er
// kjørt i Supabase SQL Editor.
//
// Lager sin EGEN engangsquiz (samme markører som verify-delete-renumber.mjs:
// is_test=true, is_active=false, quiz_type='test', season_points_awarded=true)
// og sletter alt den lagde til slutt, også når et bevis feiler.
//
// Beviser tre ting:
//   1. Bytte på en USPILT quiz virker fortsatt (vakten sperrer ikke bygging).
//   2. Etter ÉN svarrad er bytte sperret med quiz_played — også for et par
//      der INGEN av de to spørsmålene er besvart (vakten er quiz-nivå:
//      streak-rekonstruksjonen går over hele quizens rekkefølge).
//   3. Avvisningen er atomisk: rekkefølgen står nøyaktig som før kallet.
//
// KJØRING:  node scripts/verify-swap-played-guard.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const TITLE = '[TEST] verify-swap-played-guard — slettes automatisk'
let quizId = null
let exitCode = 0

const fail = msg => { console.error(`\n❌ ${msg}`); exitCode = 1; throw new Error(msg) }

async function hentOrden() {
  const { data, error } = await sb
    .from('questions').select('id, order_index, question_text')
    .eq('quiz_id', quizId).order('order_index').order('id')
  if (error) fail(`kunne ikke lese spørsmål: ${error.message}`)
  return data
}

async function ryddOpp() {
  if (!quizId) return
  const { data: atts } = await sb.from('attempts').select('id').eq('quiz_id', quizId)
  const attIds = (atts ?? []).map(a => a.id)
  if (attIds.length > 0) await sb.from('attempt_answers').delete().in('attempt_id', attIds)
  await sb.from('attempts').delete().eq('quiz_id', quizId)
  await sb.from('questions').delete().eq('quiz_id', quizId)
  await sb.from('quizzes').delete().eq('id', quizId).eq('is_test', true)
  console.log('\nRyddet opp: testquizen og alt den eide er slettet.')
}

try {
  // ── Oppsett: engangsquiz med 3 spørsmål ────────────────────────────────────
  const { data: quiz, error: qErr } = await sb.from('quizzes').insert({
    title: TITLE,
    description: 'Engangsquiz for verify-swap-played-guard. Slettes automatisk.',
    opens_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    closes_at: new Date(Date.now() - 1 * 3600_000).toISOString(),
    is_test: true, quiz_type: 'test', season_points_awarded: true, is_active: false,
    num_options: 4, time_limit_seconds: 15,
  }).select('id').single()
  if (qErr) fail(`kunne ikke opprette testquiz: ${qErr.message}`)
  quizId = quiz.id
  console.log(`Testquiz opprettet: ${quizId}`)

  const tekster = ['Spørsmål én', 'Spørsmål to', 'Spørsmål tre']
  const { data: qs, error: insErr } = await sb.from('questions').insert(
    tekster.map((t, i) => ({
      quiz_id: quizId, question_text: t,
      option_a: 'A-tekst', option_b: 'B-tekst', option_c: 'C-tekst', option_d: 'D-tekst',
      correct_answer: 'A', order_index: i + 1, time_limit_seconds: 15,
    })),
  ).select('id, order_index')
  if (insErr) fail(`kunne ikke opprette spørsmål: ${insErr.message}`)
  const byIndex = new Map(qs.map(q => [q.order_index, q.id]))
  console.log('  3 spørsmål med order_index [1,2,3]\n')

  // ── BEVIS 1: bytte på uspilt quiz virker fortsatt ──────────────────────────
  console.log('BEVIS 1 — uspilt quiz: bytte 1↔2 skal lykkes (vakten sperrer ikke bygging):')
  const { error: okErr } = await sb.rpc('swap_question_order', {
    p_quiz_id: quizId, p_question_a: byIndex.get(1), p_question_b: byIndex.get(2),
  })
  if (okErr) {
    fail(`bytte på USPILT quiz ble avvist: ${okErr.message}\n`
       + '   Er vakten skrevet for bredt — eller mangler migrasjonen 20260824000001?')
  }
  const etter1 = await hentOrden()
  const tekst1 = etter1.map(q => q.question_text)
  if (JSON.stringify(tekst1) !== JSON.stringify(['Spørsmål to', 'Spørsmål én', 'Spørsmål tre'])) {
    fail(`BEVIS 1: byttet skjedde ikke — rekkefølgen er [${tekst1.join(' | ')}]`)
  }
  console.log('  ✓ byttet gikk gjennom: [to, én, tre]')

  // ── Én svarrad på spørsmål «to» (nå order_index 1) ────────────────────────
  const { data: attempt, error: attErr } = await sb.from('attempts').insert({
    quiz_id: quizId, player_name: '[TEST] verify-swap-played-guard',
    is_team: false, team_size: 1, total_questions: 3,
    correct_answers: 0, total_time_ms: 0, user_id: null, submitted_at: null,
  }).select('id').single()
  if (attErr) fail(`kunne ikke opprette forsøk: ${attErr.message}`)
  const { error: aaErr } = await sb.from('attempt_answers').insert({
    attempt_id: attempt.id, question_id: byIndex.get(2),
    selected_answer: 'A', is_correct: true, time_ms: 1234,
  })
  if (aaErr) fail(`kunne ikke opprette svarrad: ${aaErr.message}`)

  // ── BEVIS 2: quiz-nivå — sperret også for et UBESVART par ─────────────────
  console.log('\nBEVIS 2 — én svarrad finnes (på «to»): bytte av de UBESVARTE «én»↔«tre» skal avvises:')
  const { error: playedErr } = await sb.rpc('swap_question_order', {
    p_quiz_id: quizId, p_question_a: byIndex.get(1), p_question_b: byIndex.get(3),
  })
  if (!playedErr) fail('bytte på en SPILT quiz lyktes — quiz_played-vakten virker ikke (eller er per spørsmål, ikke quiz-nivå)')
  if (!playedErr.message.includes('quiz_played')) {
    fail(`ventet quiz_played, fikk: ${playedErr.code} ${playedErr.message}`)
  }
  console.log(`  ✓ avvist som forventet: ${playedErr.message.slice(0, 80)}…`)

  // ── BEVIS 3: avvisningen rørte ingenting ───────────────────────────────────
  const etter2 = await hentOrden()
  const tekst2 = etter2.map(q => q.question_text)
  if (JSON.stringify(tekst2) !== JSON.stringify(tekst1)) {
    fail(`BEVIS 3: rekkefølgen er endret tross avvisning — [${tekst2.join(' | ')}]`)
  }
  const idx = etter2.map(q => q.order_index)
  if (JSON.stringify(idx) !== JSON.stringify([1, 2, 3])) {
    fail(`BEVIS 3: order_index er ikke lenger 1..3 — [${idx.join(',')}] (sentinel lekket?)`)
  }
  console.log('  ✓ rekkefølgen står nøyaktig som før — avvisningen var atomisk')

  console.log('\n✅ Alle bevis holder: bygging er fri, spilt quiz er låst på quiz-nivå, avvisning er atomisk.')
} catch (e) {
  if (exitCode === 0) { console.error(`\n❌ uventet feil: ${e.message}`); exitCode = 1 }
} finally {
  try { await ryddOpp() } catch (e) {
    console.error(`⚠ opprydding feilet: ${e.message} — slett manuelt: quiz-id ${quizId}, tittel «${TITLE}»`)
    exitCode = 1
  }
}
process.exit(exitCode)
