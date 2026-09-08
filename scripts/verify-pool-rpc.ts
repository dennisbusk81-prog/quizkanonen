// Verifiserer server-side trekning av puljen MOT PROD, etter at migrasjon
// 20260909000000_pool_question_ids_rpc.sql er kjørt. KUN LESING.
//
//   node --disable-warning=ExperimentalWarning --env-file <env uten BOM> \
//        --import ./scripts/ts-node-resolve.mjs scripts/verify-pool-rpc.ts
//
// (.env.local starter med BOM; lag en BOM-fri kopi først, ellers leses
// NEXT_PUBLIC_SUPABASE_URL som «﻿NEXT_PUBLIC_SUPABASE_URL».)
//
// Tre bevis, i denne rekkefølgen:
//   1. SAMME KANDIDATSETT: pool_question_ids (SQL) == fetchPoolQuestionIds (TS),
//      id for id, for blandet og for minst én kategori. Ikke «samme antall» —
//      symmetrisk differanse skal være tom.
//   2. TILFELDIG: fem trekninger à 15 gir ikke samme sett hver gang, og hver
//      trekning er distinkt og ligger inne i kandidatsettet.
//   3. TID: RPC-trekningen målt mot den gamle veien (pulje + trekning i TS).
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchPoolQuestionIds, pickPoolQuestionIds } from '@/lib/generated-quiz-pool'
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

// ── 1. Samme kandidatsett ───────────────────────────────────────────────────
for (const category of [null, 'Sport', 'Historie']) {
  const etikett = category ?? 'blandet'
  const ts = await fetchPoolQuestionIds({ category, nowIso })
  if (!ts.ok) throw new Error('fetchPoolQuestionIds feilet')
  const sql = await sqlPool(category)
  const a = new Set(ts.value), b = new Set(sql)
  const bareTs = [...a].filter((x) => !b.has(x))
  const bareSql = [...b].filter((x) => !a.has(x))
  ok(`kandidatsett (${etikett}): TS ${a.size} == SQL ${b.size}, symmetrisk differanse tom`,
     a.size === b.size && bareTs.length === 0 && bareSql.length === 0,
     bareTs.length + bareSql.length ? `kun i TS: ${bareTs.slice(0, 3)} | kun i SQL: ${bareSql.slice(0, 3)}` : '')
  ok(`kandidatsett (${etikett}): SQL har ingen duplikater`, b.size === sql.length)
}

// ── 2. Tilfeldig ────────────────────────────────────────────────────────────
const kandidater = new Set(await sqlPool(null))
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

// ── 3. Tid ──────────────────────────────────────────────────────────────────
const tid = async (f: () => Promise<unknown>) => { const t = performance.now(); await f(); return Math.round(performance.now() - t) }
const gammel: number[] = [], ny: number[] = []
for (let i = 0; i < 3; i++) {
  gammel.push(await tid(() => fetchPoolQuestionIds({ category: null, nowIso })))
  ny.push(await tid(() => pickPoolQuestionIds({ category: null, count: GENERATED_QUIZ_QUESTION_COUNT, nowIso })))
}
console.log(`tid, gammel vei (pulje til Vercel, blandet): ${gammel.join(' / ')} ms`)
console.log(`tid, ny vei (RPC-trekning, blandet):         ${ny.join(' / ')} ms`)

console.log(feil === 0 ? '\nALT GRØNT' : `\n${feil} FEIL`)
process.exit(feil === 0 ? 0 : 1)
