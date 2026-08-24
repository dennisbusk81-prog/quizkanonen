// ─────────────────────────────────────────────────────────────────────────────
// EMPIRISK VERIFISERING av public.delete_question_and_renumber mot EKTE
// database. Kjøres ETTER at migrasjonen
// supabase/migrations/20260824000000_delete_question_and_renumber.sql er
// kjørt i Supabase SQL Editor, og FØR koden som kaller RPC-en deployes.
//
// Lager sin EGEN engangsquiz (is_test=true, is_active=false, quiz_type='test',
// season_points_awarded=true — samme markører som .claude/QK_TESTQUIZ_OPPSKRIFT.md
// bruker for å holde varslings- og sesong-cronene unna) og sletter ALT den
// lagde til slutt, også når et bevis feiler. Rører ingen eksisterende quiz.
//
// Beviser fire ting:
//   1. Sletting midt i quizen renummererer resten til 1..N-1 med bevart
//      relativ rekkefølge — i samme kall.
//   2. last_question: det siste spørsmålet kan ikke slettes, og raden består.
//   3. question_played: et spørsmål med attempt_answers-rader kan ikke
//      slettes — resultater er urørlige (regelen fra 24. august 2026) — og
//      hverken raden eller svarraden røres.
//   4. Atomisitet i praksis: etter hvert avvist kall er rekkefølgen fortsatt
//      sammenhengende 1..N (ingenting ble renummerert uten sletting).
//
// KJØRING:  node scripts/verify-delete-renumber.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const TITLE = '[TEST] verify-delete-renumber — slettes automatisk'
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

function krevSammenhengende(rows, ventetAntall, hvor) {
  const idx = rows.map(q => q.order_index)
  const ok = rows.length === ventetAntall
    && new Set(idx).size === idx.length
    && idx[0] === 1 && idx[idx.length - 1] === idx.length
  if (!ok) fail(`${hvor}: forventet sammenhengende 1..${ventetAntall}, fikk [${idx.join(',')}]`)
}

async function ryddOpp() {
  if (!quizId) return
  // Samme rekkefølge som oppskriften: attempt_answers → attempts → questions
  // → quiz. Hvert steg scopet til VÅR quiz-id — aldri på tittel alene.
  const { data: atts } = await sb.from('attempts').select('id').eq('quiz_id', quizId)
  const attIds = (atts ?? []).map(a => a.id)
  if (attIds.length > 0) await sb.from('attempt_answers').delete().in('attempt_id', attIds)
  await sb.from('attempts').delete().eq('quiz_id', quizId)
  await sb.from('questions').delete().eq('quiz_id', quizId)
  await sb.from('quizzes').delete().eq('id', quizId).eq('is_test', true)
  console.log('\nRyddet opp: testquizen og alt den eide er slettet.')
}

try {
  // ── Oppsett: engangsquiz med 4 spørsmål ────────────────────────────────────
  const { data: quiz, error: qErr } = await sb.from('quizzes').insert({
    title: TITLE,
    description: 'Engangsquiz for verify-delete-renumber. Slettes automatisk.',
    opens_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    closes_at: new Date(Date.now() - 1 * 3600_000).toISOString(),
    is_test: true, quiz_type: 'test', season_points_awarded: true, is_active: false,
    num_options: 4, time_limit_seconds: 15,
  }).select('id').single()
  if (qErr) fail(`kunne ikke opprette testquiz: ${qErr.message}`)
  quizId = quiz.id
  console.log(`Testquiz opprettet: ${quizId}`)

  const tekster = ['Spørsmål én', 'Spørsmål to', 'Spørsmål tre', 'Spørsmål fire']
  const { data: qs, error: insErr } = await sb.from('questions').insert(
    tekster.map((t, i) => ({
      quiz_id: quizId, question_text: t,
      option_a: 'A-tekst', option_b: 'B-tekst', option_c: 'C-tekst', option_d: 'D-tekst',
      correct_answer: 'A', order_index: i + 1, time_limit_seconds: 15,
    })),
  ).select('id, order_index')
  if (insErr) fail(`kunne ikke opprette spørsmål: ${insErr.message}`)
  const byIndex = new Map(qs.map(q => [q.order_index, q.id]))
  console.log('  4 spørsmål med order_index [1,2,3,4]\n')

  // ── BEVIS 1: sletting midt i quizen renummererer og bevarer rekkefølgen ───
  console.log('BEVIS 1 — slett spørsmål 2, resten skal bli 1..3 i bevart rekkefølge:')
  const { data: ret, error: rpcErr } = await sb.rpc('delete_question_and_renumber', {
    p_quiz_id: quizId, p_question_id: byIndex.get(2),
  })
  if (rpcErr) {
    fail(`RPC feilet: ${rpcErr.code} ${rpcErr.message}\n`
       + '   Er migrasjonen 20260824000000_delete_question_and_renumber.sql kjørt i Supabase SQL Editor?')
  }
  console.log('  ✓ RPC returnerte:', JSON.stringify(ret))

  const etter1 = await hentOrden()
  krevSammenhengende(etter1, 3, 'BEVIS 1')
  const venterTekst = ['Spørsmål én', 'Spørsmål tre', 'Spørsmål fire']
  const faktisk = etter1.map(q => q.question_text)
  if (JSON.stringify(faktisk) !== JSON.stringify(venterTekst)) {
    fail(`BEVIS 1: relativ rekkefølge endret — fikk [${faktisk.join(' | ')}]`)
  }
  console.log('  ✓ databasen viser 1..3, relativ rekkefølge bevart (én, tre, fire)')

  // ── BEVIS 3 (før 2, mens vi har >1 spørsmål): question_played ─────────────
  console.log('\nBEVIS 3 — spørsmål med besvarelse kan ikke slettes:')
  const spiltId = byIndex.get(3) // «Spørsmål tre», nå på order_index 2
  const { data: attempt, error: attErr } = await sb.from('attempts').insert({
    quiz_id: quizId, player_name: '[TEST] verify-delete-renumber',
  }).select('id').single()
  if (attErr) fail(`kunne ikke opprette forsøk: ${attErr.message}`)
  const { error: aaErr } = await sb.from('attempt_answers').insert({
    attempt_id: attempt.id, question_id: spiltId,
    selected_answer: 'A', is_correct: true, time_ms: 1234,
  })
  if (aaErr) fail(`kunne ikke opprette svarrad: ${aaErr.message}`)

  const { error: playedErr } = await sb.rpc('delete_question_and_renumber', {
    p_quiz_id: quizId, p_question_id: spiltId,
  })
  if (!playedErr) fail('sletting av et BESVART spørsmål lyktes — question_played-vakten virker ikke')
  if (!playedErr.message.includes('question_played')) {
    fail(`ventet question_played, fikk: ${playedErr.code} ${playedErr.message}`)
  }
  console.log(`  ✓ avvist som forventet: ${playedErr.message.slice(0, 80)}…`)

  // BEVIS 4 innbakt: avvisningen skal ha rørt INGENTING.
  const etter3 = await hentOrden()
  if (!etter3.some(q => q.id === spiltId)) fail('BEVIS 3: raden er borte tross avvisning!')
  krevSammenhengende(etter3, 3, 'BEVIS 3/4 (atomisitet etter avvist kall)')
  const { count: aaCount } = await sb
    .from('attempt_answers').select('id', { count: 'exact', head: true }).eq('question_id', spiltId)
  if (aaCount !== 1) fail(`BEVIS 3: svarraden er rørt (fant ${aaCount})`)
  console.log('  ✓ raden, svarraden og rekkefølgen (1..3) står urørt — kallet var atomisk')

  // ── BEVIS 2: last_question ─────────────────────────────────────────────────
  console.log('\nBEVIS 2 — det siste spørsmålet kan ikke slettes:')
  // Slett ned til ett: fjern «Spørsmål én» og «Spørsmål fire» (usvarte).
  for (const oi of [1, 4]) {
    const { error } = await sb.rpc('delete_question_and_renumber', {
      p_quiz_id: quizId, p_question_id: byIndex.get(oi),
    })
    if (error) fail(`kunne ikke slette usvart spørsmål (oi=${oi}): ${error.message}`)
  }
  const igjen = await hentOrden()
  if (igjen.length !== 1) fail(`ventet nøyaktig ett gjenværende spørsmål, fant ${igjen.length}`)

  const { error: lastErr } = await sb.rpc('delete_question_and_renumber', {
    p_quiz_id: quizId, p_question_id: igjen[0].id,
  })
  if (!lastErr) fail('sletting av det SISTE spørsmålet lyktes — quizen er tømt')
  if (!lastErr.message.includes('last_question')) {
    fail(`ventet last_question, fikk: ${lastErr.code} ${lastErr.message}`)
  }
  const tilSlutt = await hentOrden()
  if (tilSlutt.length !== 1 || tilSlutt[0].order_index !== 1) {
    fail('BEVIS 2: det siste spørsmålet står ikke igjen som order_index 1')
  }
  console.log('  ✓ avvist som forventet, og spørsmålet består med order_index 1')

  console.log('\n✅ Alle bevis holder: renummerering i samme transaksjon, bevart rekkefølge, og begge vaktene griper.')
} catch (e) {
  if (exitCode === 0) { console.error(`\n❌ uventet feil: ${e.message}`); exitCode = 1 }
} finally {
  try { await ryddOpp() } catch (e) {
    console.error(`⚠ opprydding feilet: ${e.message} — slett manuelt: quiz-id ${quizId}, tittel «${TITLE}»`)
    exitCode = 1
  }
}
process.exit(exitCode)
