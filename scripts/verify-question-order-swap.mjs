// ─────────────────────────────────────────────────────────────────────────────
// EMPIRISK VERIFISERING av spørsmåls-omsortering mot EKTE database.
//
// Beviser to ting, i denne rekkefølgen:
//   1. Det GAMLE mønsteret (to skrivinger, hver til den andres nåværende
//      verdi) feiler faktisk med 23505 mot den ekte unique-indeksen.
//   2. Den NYE RPC-en (public.swap_question_order) bytter faktisk plassene.
//
// Velger automatisk en TRYGG quiz: aldri spilt (0 forsøk) og ikke åpen.
// Rydder alltid opp — bytter tilbake til opprinnelig rekkefølge til slutt, og
// verifiserer at sluttilstanden er identisk med starttilstanden.
//
// KJØRING (read-mostly: skriver kun midlertidig, og reverserer):
//   node scripts/verify-question-order-swap.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const fail = msg => { console.error(`\n❌ ${msg}`); process.exit(1) }

// ── Finn en trygg testquiz: 0 forsøk, ikke åpen ──────────────────────────────
const nowIso = new Date().toISOString()
const { data: quizzes, error: qzErr } = await sb
  .from('quizzes').select('id, title, opens_at, closes_at, is_active')
if (qzErr) fail(`kunne ikke hente quizer: ${qzErr.message}`)

let target = null
for (const quiz of quizzes) {
  const { count, error } = await sb
    .from('attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', quiz.id)
  if (error) fail(`kunne ikke telle forsøk: ${error.message}`)
  if (count !== 0) continue
  const isOpen = quiz.closes_at && quiz.closes_at > nowIso && quiz.opens_at && quiz.opens_at <= nowIso
  if (isOpen) continue
  const { data: qs } = await sb
    .from('questions').select('id, order_index').eq('quiz_id', quiz.id).order('order_index')
  if (qs && qs.length >= 2) { target = { quiz, questions: qs }; break }
}
if (!target) fail('fant ingen trygg testquiz (0 forsøk, ikke åpen, ≥2 spørsmål)')

const { quiz, questions } = target
const [qa, qb] = questions
const beforeAll = questions.map(q => `${q.id}:${q.order_index}`).join(' ')

console.log(`Testquiz: "${quiz.title}" (${quiz.id})`)
console.log(`  ${questions.length} spørsmål, 0 forsøk, ikke åpen — trygt å teste på.`)
console.log(`  Bytter: A=${qa.id.slice(0,8)} (idx ${qa.order_index})  B=${qb.id.slice(0,8)} (idx ${qb.order_index})\n`)

// ── BEVIS 1: det gamle mønsteret feiler ──────────────────────────────────────
console.log('BEVIS 1 — gammelt mønster (to direkte skrivinger):')
const { error: oldErr } = await sb
  .from('questions').update({ order_index: qb.order_index }).eq('id', qa.id)

if (!oldErr) {
  // Skulle ikke skje. Rull tilbake umiddelbart så vi ikke etterlater skade.
  await sb.from('questions').update({ order_index: qa.order_index }).eq('id', qa.id)
  fail('den gamle skrivingen LYKTES — unique-indeksen er altså ikke aktiv. '
     + 'Da er premisset for denne fiksen feil; undersøk før du går videre.')
}
console.log(`  ✓ feilet som forventet — code=${oldErr.code}`)
console.log(`    ${oldErr.message}`)
if (oldErr.code !== '23505') {
  fail(`forventet 23505 (unique_violation), fikk ${oldErr.code}. Undersøk.`)
}

// ── BEVIS 2: den nye RPC-en lykkes ───────────────────────────────────────────
console.log('\nBEVIS 2 — ny RPC (swap_question_order):')
const { data: swapped, error: rpcErr } = await sb.rpc('swap_question_order', {
  p_quiz_id: quiz.id, p_question_a: qa.id, p_question_b: qb.id,
})
if (rpcErr) {
  fail(`RPC feilet: ${rpcErr.code} ${rpcErr.message}\n`
     + '   Er migrasjonen 20260731000000_swap_question_order_rpc.sql kjørt i Supabase SQL Editor?')
}
console.log('  ✓ RPC returnerte uten feil:', JSON.stringify(swapped))

// Verifiser mot databasen at byttet FAKTISK skjedde (ikke bare at kallet gikk).
const { data: after } = await sb
  .from('questions').select('id, order_index').eq('quiz_id', quiz.id).order('order_index')
const newA = after.find(q => q.id === qa.id).order_index
const newB = after.find(q => q.id === qb.id).order_index

if (newA !== qb.order_index || newB !== qa.order_index) {
  fail(`byttet skjedde IKKE: A=${newA} (ventet ${qb.order_index}), B=${newB} (ventet ${qa.order_index})`)
}
console.log(`  ✓ bekreftet i databasen: A ${qa.order_index}→${newA}, B ${qb.order_index}→${newB}`)

// Ingen sentinel-verdi lekket ut, og ingen duplikater/hull oppsto.
const idx = after.map(q => q.order_index).sort((a, b) => a - b)
const contiguous = new Set(idx).size === idx.length && idx[0] === 1 && idx[idx.length - 1] === idx.length
if (!contiguous) fail(`rekkefølgen er ikke lenger 1..N: [${idx.join(',')}] — sentinel lekket?`)
console.log(`  ✓ rekkefølgen er fortsatt sammenhengende 1..N: [${idx.join(',')}]`)

// ── Rydd opp: bytt tilbake ───────────────────────────────────────────────────
console.log('\nRydder opp (bytter tilbake):')
const { error: revertErr } = await sb.rpc('swap_question_order', {
  p_quiz_id: quiz.id, p_question_a: qa.id, p_question_b: qb.id,
})
if (revertErr) fail(`kunne ikke bytte tilbake: ${revertErr.message} — MÅ RETTES MANUELT`)

const { data: restored } = await sb
  .from('questions').select('id, order_index').eq('quiz_id', quiz.id).order('order_index')
const afterAll = restored.map(q => `${q.id}:${q.order_index}`).join(' ')
if (afterAll !== beforeAll) fail(`sluttilstand ULIK starttilstand!\n  før:  ${beforeAll}\n  etter: ${afterAll}`)
console.log('  ✓ opprinnelig rekkefølge gjenopprettet, bit for bit identisk med start.')

console.log('\n✅ Begge bevis holder. Omsortering virker, og det gamle mønsteret kunne ikke virket.')
