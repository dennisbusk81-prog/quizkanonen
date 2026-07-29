// Frittstående verifiseringsscript — leser KUN via GET, oppretter aldri attempt.
// Kalles: node scripts/verify-shuffle.mjs
const BASE = process.env.BASE_URL || 'https://quizkanonen.no'
const QUIZ_ID = '3053b3d1-0d4f-438e-a0fb-d5427dffce33'
const INDEXES = [0, 1, 5]
const CALLS = 8

async function fetchQuestion(index) {
  const url = `${BASE}/api/quiz/${QUIZ_ID}/questions?index=${index}`
  const res = await fetch(url)
  let body = null
  try { body = await res.json() } catch { /* ignore */ }
  return { status: res.status, body }
}

function optionTuple(q) {
  return [q.option_a, q.option_b, q.option_c, q.option_d]
    .map(o => (o == null ? '∅' : o))
    .join(' | ')
}

async function run() {
  console.log(`Base:  ${BASE}`)
  console.log(`Quiz:  ${QUIZ_ID}`)
  console.log(`Kall per index: ${CALLS}\n`)

  for (const index of INDEXES) {
    console.log(`── index=${index} ─────────────────────────────────────────`)
    const orders = new Set()
    let shuffleFlag = null
    let questionText = null
    let firstStatus = null

    for (let i = 0; i < CALLS; i++) {
      const { status, body } = await fetchQuestion(index)
      if (firstStatus === null) firstStatus = status
      if (status !== 200 || !body || !body.question) {
        console.log(`  kall ${i + 1}: HTTP ${status} — ${body ? JSON.stringify(body) : '(ingen body)'}`)
        continue
      }
      const q = body.question
      shuffleFlag = q.shuffle_options
      questionText = q.question_text
      orders.add(optionTuple(q))
    }

    if (questionText) {
      console.log(`  spørsmål:        "${String(questionText).slice(0, 70)}"`)
      console.log(`  shuffle_options: ${shuffleFlag}`)
      console.log(`  ulike rekkefølger returnert: ${orders.size}`)
      for (const o of orders) console.log(`    → ${o}`)
    } else {
      console.log(`  (fikk aldri et gyldig spørsmål — første status: ${firstStatus})`)
    }
    console.log('')
  }
}

run().catch(e => { console.error('Scriptet feilet:', e); process.exit(1) })
