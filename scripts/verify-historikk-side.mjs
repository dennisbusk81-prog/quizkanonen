// LESENDE gjengivelse av hele /historikk for ekte spillere.
//
//   node --import ./scripts/ts-node-resolve.mjs --env-file=.env.local \
//        scripts/verify-historikk-side.mjs
//
// Kjører den EKTE lib-koden — decideHero, decideRecords, decideSisteQuiz,
// computeFieldProgress, buildFrozenRanks — mot ekte prod-data, og skriver ut
// nøyaktig hva spilleren ville sett. Ingen navn og ingen e-post skrives ut:
// spillerne heter «Spiller A/B/C».
//
// Finnes fordi eieren av kontoen har spilt én quiz og derfor ikke kan se sin
// egen side i de interessante tilstandene. Ingen skriving.

import { createClient } from '@supabase/supabase-js'
import { decideHero, decideRecords, pickBesteResultat } from '../lib/historikk-oversikt.ts'
import { decideSisteQuiz, settPersonligRekord } from '../lib/siste-quiz.ts'
import { averageCorrectByQuiz, computeFieldProgress } from '../lib/field-relative-progress.ts'
import { buildFrozenRanks, countPlayersByQuiz, pickBestePlassering } from '../lib/frozen-rank.ts'
import { computeParticipationStreak } from '../lib/participation-streak.ts'
import { computeCategoryStats, pickCategoryStrength } from '../lib/category-stats.ts'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://nbfyarftteitbjglgfyd.supabase.co'
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function alle(table, select, tweak = (q) => q) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tweak(db.from(table).select(select).range(from, from + 999))
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

const attempts = await alle(
  'attempts',
  'id, quiz_id, user_id, correct_answers, total_questions, total_time_ms, correct_streak, completed_at, submitted_at',
  (q) => q.not('correct_streak', 'is', null).order('id', { ascending: true })
)
const quizzes = await alle('quizzes', 'id, title, quiz_type, is_test, opens_at, season_points_awarded')
const season = await alle('season_scores', 'user_id, quiz_id, rank, scope_type, scope_id', (q) =>
  q.eq('scope_type', 'global').order('user_id', { ascending: true })
)
const answers = await alle('attempt_answers', 'attempt_id, question_id, is_correct', (q) =>
  q.order('id', { ascending: true })
)
const questions = await alle('questions', 'id, category')

const quizById = new Map(quizzes.map((q) => [q.id, q]))
const qCat = new Map(questions.map((q) => [q.id, q.category]))
const feltSnitt = averageCorrectByQuiz(attempts.map((a) => ({ quiz_id: a.quiz_id, correct_answers: a.correct_answers })))
const deltakere = countPlayersByQuiz(attempts.map((a) => ({ quiz_id: a.quiz_id })))

const ukentlige = quizzes
  .filter((q) => !q.is_test && q.quiz_type === 'weekly' && q.opens_at && new Date(q.opens_at) <= new Date())
  .sort((a, b) => new Date(a.opens_at) - new Date(b.opens_at))
  .map((q) => ({ id: q.id, settled: q.season_points_awarded === true }))

const byUser = new Map()
for (const a of attempts) {
  if (!a.user_id) continue
  const l = byUser.get(a.user_id) ?? []
  l.push(a)
  byUser.set(a.user_id, l)
}
const ansByAttempt = new Map()
for (const s of answers) {
  const l = ansByAttempt.get(s.attempt_id) ?? []
  l.push(s)
  ansByAttempt.set(s.attempt_id, l)
}

const dato = (iso) =>
  new Date(iso).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' })
const tid = (ms) => `${(ms / 1000).toFixed(1)}s`
const pct = (c, t) => (t > 0 ? Math.round((c / t) * 100) : 0)

function render(uid, merkelapp) {
  const arr = [...byUser.get(uid)].sort(
    (a, b) => new Date(b.completed_at) - new Date(a.completed_at)
  )
  const total = arr.length

  const frosne = buildFrozenRanks(season, deltakere, uid)
  const historikk = arr.map((a) => ({
    id: a.id,
    quiz_id: a.quiz_id,
    quiz_title: quizById.get(a.quiz_id)?.title ?? 'Ukjent quiz',
    correct_answers: a.correct_answers,
    total_questions: a.total_questions,
    total_time_ms: a.total_time_ms,
    correct_streak: a.correct_streak,
    completed_at: a.completed_at,
    rank: frosne[a.quiz_id]?.rank ?? null,
    total_players: frosne[a.quiz_id]?.total_players ?? null,
  }))

  const part = computeParticipationStreak(
    ukentlige,
    arr.filter((a) => a.submitted_at).map((a) => a.quiz_id)
  )
  const hero = decideHero({
    totalAttempts: total,
    deltakelsesrekke: part.current,
    lengsteDeltakelsesrekke: part.longest,
  })

  const svar = arr.flatMap((a) => ansByAttempt.get(a.id) ?? [])
  const kat = pickCategoryStrength(
    computeCategoryStats(
      svar.map((s) => ({ questionId: s.question_id, isCorrect: s.is_correct })),
      [...new Map(svar.map((s) => [s.question_id, { id: s.question_id, category: qCat.get(s.question_id) ?? null }])).values()]
    )
  )

  const prog = computeFieldProgress(
    arr
      .filter((a) => feltSnitt[a.quiz_id] !== undefined)
      .map((a) => ({
        correct: a.correct_answers,
        fieldAvgCorrect: feltSnitt[a.quiz_id],
        completedAt: a.completed_at,
      })),
    Date.now()
  )

  const bestePlassering = pickBestePlassering(
    arr.map((a) => ({
      quiz_id: a.quiz_id,
      quiz_title: quizById.get(a.quiz_id)?.title ?? 'Ukjent quiz',
      completed_at: a.completed_at,
    })),
    frosne
  )

  const rekorder = decideRecords({
    besteResultat: pickBesteResultat(historikk),
    bestStreak: Math.max(0, ...arr.map((a) => a.correct_streak ?? 0)),
    lengsteDeltakelsesrekke: part.longest,
    totalAttempts: total,
    heroViserRekke: hero.kind === 'rekke',
    bestePlassering,
  })

  const siste = historikk[0]
  const kort = siste
    ? decideSisteQuiz({
        quizTittel: siste.quiz_title,
        riktige: siste.correct_answers,
        totalt: siste.total_questions,
        feltSnittRiktige: feltSnitt[siste.quiz_id] ?? null,
        plassering:
          siste.rank !== null ? { rank: siste.rank, total_players: siste.total_players } : null,
        erPersonligRekord: settPersonligRekord(historikk),
      })
    : null

  console.log('\n' + '='.repeat(66))
  console.log(`${merkelapp} — ${total} quizer spilt`)
  console.log('='.repeat(66))

  console.log('\nHERO')
  console.log('  DIN HISTORIKK · PREMIUM')
  if (hero.kind === 'empty') console.log('  Din historikk')
  else {
    console.log(`  ${hero.tall}`)
    console.log(`  ${hero.label}`)
    console.log(`  ${hero.sub}`)
  }

  console.log('\nDIN SISTE QUIZ')
  if (!kort) console.log('  (kortet vises ikke)')
  else {
    console.log(`  ${kort.eyebrow.toUpperCase()}`)
    console.log(`  ${kort.tittel}`)
    console.log(`  ${dato(siste.completed_at)}`)
    console.log(`  ${kort.resultat}`)
    if (kort.felt) console.log(`  ${kort.felt}`)
    if (kort.plassering) console.log(`  ${kort.plassering}`)
    else console.log('  (ingen plasseringslinje — mangler frossen rank)')
    console.log('  Se hele quizen →   Se leaderboard →')
  }

  console.log('\nKATEGORIER')
  if (!kat.sterkeste) console.log('  (vises ikke — færre enn to kategorier over terskelen)')
  else {
    console.log(`  Sterkeste: ${kat.sterkeste} — ${kat.sterkesteProsent}% riktige (${kat.sterkesteRiktige} av ${kat.sterkesteBesvart})`)
    console.log(`  Svakeste:  ${kat.svakeste} — ${kat.svakesteProsent}% riktige (${kat.svakesteRiktige} av ${kat.svakesteBesvart})`)
  }

  console.log('\nUTVIKLING')
  if (historikk.length < 2) console.log('  (kortet skjules helt — under to quizer)')
  else {
    console.log(`  graf: ${historikk.length} punkter, din linje + feltets snitt`)
    console.log(prog ? `  [${prog.variant}] ${prog.tekst}` : '  (ingen progresjonstekst)')
  }

  console.log('\nREKORDER')
  if (rekorder.length < 2) console.log(`  (kortet skjules helt — ${rekorder.length} rad)`)
  else for (const r of rekorder) console.log(`  ${r.label.padEnd(24)} ${r.verdi}`)

  const liste = historikk.slice(1)
  console.log(`\nTIDLIGERE QUIZER  (${total - 1})`)
  if (liste.length === 0) console.log('  (seksjonen vises ikke — alt står i kortet over)')
  for (const a of liste) {
    const p = a.rank !== null ? `#${a.rank} av ${a.total_players}` : '(ingen plassering)'
    console.log(`  ${a.quiz_title}`)
    console.log(`    ${dato(a.completed_at)}${a.correct_streak > 1 ? ` · ${a.correct_streak} på rad` : ''}`)
    console.log(`    ${p} | ${a.correct_answers} av ${a.total_questions} riktige | ${pct(a.correct_answers, a.total_questions)}% · ${tid(a.total_time_ms)}`)
  }
}

// Velg tre spillere med ulikt antall quizer, og prioriter én som mangler
// frossen plassering — det er tilstanden endringen handler om.
const utenRank = [...byUser.entries()].filter(([uid, arr]) => {
  const f = buildFrozenRanks(season, deltakere, uid)
  return arr.some((a) => !f[a.quiz_id])
})

function velg(antall, foretrukket = []) {
  const kandidat = foretrukket.find(([, arr]) => arr.length === antall)
  if (kandidat) return kandidat[0]
  return [...byUser.entries()].find(([, arr]) => arr.length === antall)?.[0]
}

render(velg(8, utenRank), 'SPILLER A')
render(velg(5, utenRank), 'SPILLER B')
render(velg(2, utenRank), 'SPILLER C')

console.log('\n' + '='.repeat(66))
console.log(`Spillere med minst ett forsøk uten frossen plassering: ${utenRank.length}`)
console.log(
  `Forsøk uten frossen plassering totalt: ${
    attempts.filter((a) => a.user_id && !buildFrozenRanks(season, deltakere, a.user_id)[a.quiz_id]).length
  }`
)
