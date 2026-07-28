// READ-ONLY diagnose av live-hendelse. Ingen skriv. node scripts/inspect-live-incident.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const QUIZ = '3053b3d1-0d4f-438e-a0fb-d5427dffce33'

const { data: att } = await sb.from('attempts')
  .select('id,user_id,player_name,correct_answers,total_time_ms,correct_streak,submitted_at,completed_at,is_team')
  .eq('quiz_id', QUIZ).eq('is_team', false).limit(5000)

console.log(`Totalt solo-forsøk (rå rader): ${att.length}`)
const submitted = att.filter(a => a.submitted_at != null)
const timePos   = att.filter(a => a.total_time_ms > 0)
console.log(`  submitted_at != null : ${submitted.length}   (brukt av top3/leaderboard)`)
console.log(`  total_time_ms > 0    : ${timePos.length}   (brukt av ranking-snapshot)`)
const submSet = new Set(submitted.map(a => a.id))
const onlyTime = timePos.filter(a => !submSet.has(a.id))
const onlySubm = submitted.filter(a => a.total_time_ms <= 0)
console.log(`  DIVERGENS: time>0 men ikke submitted: ${onlyTime.length};  submitted men time<=0: ${onlySubm.length}`)

function dedup(rows) {
  const m = new Map()
  for (const a of rows) {
    const k = a.user_id ?? `name:${a.player_name}`
    const e = m.get(k)
    if (!e || a.correct_answers > e.correct_answers ||
      (a.correct_answers === e.correct_answers && a.total_time_ms < e.total_time_ms) ||
      (a.correct_answers === e.correct_answers && a.total_time_ms === e.total_time_ms && (a.correct_streak??0) > (e.correct_streak??0)))
      m.set(k, a)
  }
  return [...m.values()]
}
const cmp = (a,b)=> b.correct_answers-a.correct_answers || a.total_time_ms-b.total_time_ms || (b.correct_streak??0)-(a.correct_streak??0) || a.id.localeCompare(b.id)

// top3/leaderboard-modell
const lb = dedup(submitted).sort(cmp).map((a,i)=>({...a,rank:i+1}))
// snapshot-modell (kilde total_time_ms>0, better via 2 nøkler)
const snapPool = dedup(timePos)

console.log(`\n── Live topp 6 (top3/leaderboard-modell, submitted, 4-nøkkel) ──`)
for (const r of lb.slice(0,6)) console.log(`  #${r.rank}  ${r.player_name}  ${r.correct_answers} rik / ${(r.total_time_ms/1000).toFixed(0)}s  ${r.user_id?'(innlogget)':'(gjest)'}`)

const kevin = lb.find(r => /kevin/i.test(r.player_name))
if (kevin) {
  const better2 = snapPool.filter(e => e.correct_answers>kevin.correct_answers || (e.correct_answers===kevin.correct_answers && e.total_time_ms<kevin.total_time_ms)).length
  console.log(`\n── Kevin Lu ──`)
  console.log(`  top3/leaderboard rank : #${kevin.rank} av ${lb.length}   (${kevin.correct_answers} rik / ${(kevin.total_time_ms/1000).toFixed(1)}s)`)
  console.log(`  snapshot-modell (fersk): #${better2+1} av ${snapPool.length}`)
}

// premium-omfang
const uids = [...new Set(att.map(a=>a.user_id).filter(Boolean))]
const { data: profs } = await sb.from('profiles').select('id,premium_status,display_name').in('id', uids)
const premIds = new Set((profs||[]).filter(p=>p.premium_status===true).map(p=>p.id))
const premPlayers = dedup(submitted).filter(a=>a.user_id && premIds.has(a.user_id))
console.log(`\n── Premium-omfang på denne quizen ──`)
console.log(`  innloggede spillere: ${uids.length}`)
console.log(`  med premium_status=true: ${premPlayers.length}`)

// snapshot-cache
const { data: snaps } = await sb.from('ranking_snapshots').select('question_index,created_at').eq('quiz_id', QUIZ).order('question_index')
console.log(`\n── ranking_snapshots cache (60s TTL) ──`)
const now = Date.now()
for (const s of (snaps||[])) {
  const age = ((now - new Date(s.created_at).getTime())/1000).toFixed(0)
  console.log(`  q_index=${String(s.question_index).padStart(2)}  alder=${age}s  ${age>60?'STALE':'fersk'}`)
}
