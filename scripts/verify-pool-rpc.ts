// Verifiserer server-side trekning av puljen MOT PROD, etter at migrasjon
// 20260909000000_pool_question_ids_rpc.sql er kjørt. KUN LESING.
//
//   node --disable-warning=ExperimentalWarning --env-file <env uten BOM> \
//        --import ./scripts/ts-node-resolve.mjs scripts/verify-pool-rpc.ts
//
// (.env.local starter med BOM; lag en BOM-fri kopi først, ellers leses
// NEXT_PUBLIC_SUPABASE_URL som «﻿NEXT_PUBLIC_SUPABASE_URL».)
//
// To bevis (id-for-id-sammenligningen mot den gamle TS-puljen ble kjørt
// 9. september 2026 — 4235/460/252 identiske — og fjernet sammen med
// fetchPoolQuestionIds):
//   1. TILFELDIG: fem trekninger à 15 gir ikke samme sett hver gang, og hver
//      trekning er distinkt og ligger inne i kandidatsettet (pool_question_ids).
//   2. TID: RPC-trekningen, blandet og per kategori.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pickPoolQuestionIds } from '@/lib/generated-quiz-pool'
import { REAL_QUIZ_TYPES } from '@/lib/real-quiz-population'
import { fetchAllRows } from '@/lib/paginate'
import { GENERATED_QUIZ_QUESTION_COUNT } from '@/lib/generated-quiz-rules'

const nowIso = new Date().toISOString()
let feil = 0
const ok = (navn: string, cond: boolean, detalj = '') => {
  console.log(`${cond ? '✔' : '✖'} ${navn}${detalj ? ' — ' + detalj : ''}`)
  if (!cond) feil++
}

// SETOF gjennom PostgREST kuttes stille ved 1000 rader (husregel) — puljen er
// 4235, så lesingen MÅ pagineres. Funksjonen har ORDER BY q.id, så et
// paginert kutt er stabilt.
async function sqlPool(category: string | null): Promise<string[]> {
  const rows = await fetchAllRows<string>((from, to) =>
    supabaseAdmin
      .rpc('pool_question_ids', {
        p_category: category,
        p_real_types: [...REAL_QUIZ_TYPES],
        p_now: nowIso,
      })
      .range(from, to)
  )
  return rows
}

// ── 1. Tilfeldig ────────────────────────────────────────────────────────────
const alle = await sqlPool(null)
const kandidater = new Set(alle)
ok(`kandidatsett (blandet): ${alle.length} id-er, ingen duplikater`, kandidater.size === alle.length)
const trekninger: string[][] = []
for (let i = 0; i < 5; i++) {
  const r = await pickPoolQuestionIds({ category: null, count: GENERATED_QUIZ_QUESTION_COUNT, nowIso })
  if (!r.ok) throw new Error('pickPoolQuestionIds feilet')
  trekninger.push(r.value)
  ok(`trekning ${i + 1}: ${r.value.length} distinkte id-er, alle i kandidatsettet`,
     r.value.length === GENERATED_QUIZ_QUESTION_COUNT
       && new Set(r.value).size === r.value.length
       && r.value.every((id) => kandidater.has(id)))
}
const nøkler = new Set(trekninger.map((t) => [...t].sort().join(',')))
const overlapp = trekninger.slice(1).map((t) => t.filter((id) => trekninger[0].includes(id)).length)
ok(`fem trekninger gir ${nøkler.size} ulike sett (forventet 5); overlapp med første: ${overlapp.join('/')} av 15`, nøkler.size === 5)
const kat = await pickPoolQuestionIds({ category: 'Sport', count: GENERATED_QUIZ_QUESTION_COUNT, nowIso })
if (!kat.ok) throw new Error('pick Sport feilet')
const sportSet = new Set(await sqlPool('Sport'))
ok(`kategori-trekning (Sport): 15 id-er, alle i Sport-settet`, kat.value.length === 15 && kat.value.every((id) => sportSet.has(id)))

// ── 2. Tid ──────────────────────────────────────────────────────────────────
const tid = async (f: () => Promise<unknown>) => { const t = performance.now(); await f(); return Math.round(performance.now() - t) }
const blandet: number[] = [], sport: number[] = []
for (let i = 0; i < 3; i++) {
  blandet.push(await tid(() => pickPoolQuestionIds({ category: null, count: GENERATED_QUIZ_QUESTION_COUNT, nowIso })))
  sport.push(await tid(() => pickPoolQuestionIds({ category: 'Sport', count: GENERATED_QUIZ_QUESTION_COUNT, nowIso })))
}
console.log(`tid, RPC-trekning (blandet): ${blandet.join(' / ')} ms`)
console.log(`tid, RPC-trekning (Sport):   ${sport.join(' / ')} ms`)

console.log(feil === 0 ? '\nALT GRØNT' : `\n${feil} FEIL`)
process.exit(feil === 0 ? 0 : 1)
