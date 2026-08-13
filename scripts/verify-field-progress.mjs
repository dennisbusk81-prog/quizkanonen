// LESENDE verifisering av lib/field-relative-progress.ts mot prod.
// Kjører den EKTE lib-koden — ikke en kopi av algoritmen — over ekte forsøk,
// og skriver ut setningene virkelige spillere ville sett.
//
//   node --import ./scripts/ts-node-resolve.mjs --env-file=.env.local \
//        scripts/verify-field-progress.mjs
//
// Ingen skriving. Scriptet må ligge i repoet for at ESM-oppslaget av
// node_modules og TypeScript-loaderen skal virke.

import { createClient } from '@supabase/supabase-js'
import {
  computeFieldProgress,
  averageCorrectByQuiz,
} from '../lib/field-relative-progress.ts'

// .env.local mangler NEXT_PUBLIC_SUPABASE_URL — den har drevet fra prod.
// URL-en er den offentlige NEXT_PUBLIC-verdien, ikke en hemmelighet.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://nbfyarftteitbjglgfyd.supabase.co'

const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function alle(table, select, tweak = (q) => q) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(select).range(from, from + 999)
    q = tweak(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

const attempts = await alle('attempts', 'id, quiz_id, user_id, correct_answers, completed_at, correct_streak', (q) =>
  q.not('correct_streak', 'is', null).order('id', { ascending: true })
)
const profiles = await alle('profiles', 'id, display_name')
const navn = new Map(profiles.map((p) => [p.id, p.display_name]))

// Samme aggregering som fetchFieldAverages bruker
const felt = averageCorrectByQuiz(attempts.map((a) => ({ quiz_id: a.quiz_id, correct_answers: a.correct_answers })))
console.log('Feltets snitt per quiz (riktige):')
for (const [qid, v] of Object.entries(felt)) console.log(`  ${qid.slice(0, 8)} → ${v.toFixed(2)}`)

const byUser = new Map()
for (const a of attempts) {
  if (!a.user_id) continue
  const l = byUser.get(a.user_id) ?? []
  l.push(a)
  byUser.set(a.user_id, l)
}

const NOW = Date.now()
const fordeling = { null: 0, positive: 0, negative: 0, neutral: 0 }
const eksempler = []

for (const [uid, arr] of byUser) {
  const r = computeFieldProgress(
    arr
      .filter((a) => felt[a.quiz_id] !== undefined)
      .map((a) => ({
        correct: a.correct_answers,
        fieldAvgCorrect: felt[a.quiz_id],
        completedAt: a.completed_at,
      })),
    NOW
  )
  if (!r) { fordeling.null++; continue }
  fordeling[r.variant]++
  eksempler.push({ navn: navn.get(uid) ?? uid.slice(0, 8), n: arr.length, ...r })
}

console.log('\nVariantfordeling:', JSON.stringify(fordeling))

// Sannhetskontroller på ALLE genererte setninger
const feil = []
for (const e of eksempler) {
  if (/kveld/i.test(e.tekst)) feil.push(`«kveld» i: ${e.tekst}`)
  if (/poeng/i.test(e.tekst)) feil.push(`«poeng» i: ${e.tekst}`)
  if (e.tekst.includes('%')) feil.push(`prosent i: ${e.tekst}`)
  if (/NaN|undefined/.test(e.tekst)) feil.push(`ødelagt tall i: ${e.tekst}`)
  if (/-\d/.test(e.tekst)) feil.push(`minustegn i: ${e.tekst}`)
  if (/\d\.\d/.test(e.tekst)) feil.push(`punktum-desimal i: ${e.tekst}`)
}
console.log(`\nSannhetskontroll over ${eksempler.length} ekte setninger: ${feil.length === 0 ? 'OK' : 'FEIL'}`)
for (const f of feil.slice(0, 10)) console.log('  ' + f)

// Unike setningsformer, med ett eksempel hver
const former = new Map()
for (const e of eksempler) {
  const form = e.tekst.replace(/\d+,\d+/g, '{tall}').replace(/\b\d+\b/g, '{n}')
  if (!former.has(form)) former.set(form, e)
}
console.log(`\n${former.size} unike setningsformer i prod:`)
for (const e of former.values()) {
  console.log(`\n  [${e.variant}] ${e.navn} (${e.n} quizer)`)
  console.log(`  «${e.tekst}»`)
}
