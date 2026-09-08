// Kjøres med:  npm test
//
// STRUKTURTEST for server-side trekning av puljen (9. september 2026):
// migrasjonen 20260909000000 og TS-veien pickPoolQuestionIds. Den ekte
// likheten mellom RPC-en og fetchPoolQuestionIds (samme kandidatsett) kan ikke
// bevises uten database — det gjør scripts/verify-pool-rpc.ts mot prod, etter
// at migrasjonen er kjørt. Denne fila vokter det som KAN vokte seg tekstlig:
//
//   • SQL-en har ingen egen hviteliste: `= ANY (p_real_types)`, og aldri
//     `quiz_type IN ('weekly'` — CLAUDE.md-fella fra 25. august 2026
//   • is_test = false (kildegaten krever === false), closes_at <= p_now
//   • begge funksjonene: SET search_path = '' INLINE, REVOKE som navngir
//     authenticated, GRANT til service_role
//   • ruten trekker via pickPoolQuestionIds, og har sluttet å hente puljen
//     til Vercel (fetchPoolQuestionIds/sampleDistinct er ikke importert der)
//
// MUTASJONSBEVIS (9. september 2026):
//   • `= ANY (p_real_types)` → `IN ('weekly', 'bonus')` i SQL → hviteliste-testen rød
//   • `SET search_path = ''` fjernet fra én funksjon                → search_path-testen rød
//   • `authenticated` fjernet fra én REVOKE                         → REVOKE-testen rød
//   • ruten importerer fetchPoolQuestionIds igjen                  → rute-testen rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function les(rel: string): string {
  const raw = readFileSync(path.join(process.cwd(), rel), 'utf8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/** SQL uten `--`-kommentarer — en regel i en kommentar skal ikke telle. */
function sqlUtenKommentarer(sql: string): string {
  return sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
}

/** Kun linjer som faktisk kjører (TS). */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

const SQL = sqlUtenKommentarer(les('supabase/migrations/20260909000000_pool_question_ids_rpc.sql'))
const ROUTE = aktiveLinjer(les('app/api/tilfeldig-quiz/route.ts'))
const POOL = aktiveLinjer(les('lib/generated-quiz-pool.ts'))

// ── Migrasjonen ─────────────────────────────────────────────────────────────

test('SQL: hvitelisten kommer inn som argument — ingen hardkodet IN-liste over quiz_type', () => {
  assert.match(SQL, /z\.quiz_type = ANY \(p_real_types\)/)
  assert.doesNotMatch(SQL, /quiz_type\s+IN\s*\(/i, 'en IN-liste i SQL drifter fra REAL_QUIZ_TYPES i TS')
  assert.doesNotMatch(SQL, /'weekly'|'bonus'/, 'typenavn skal ikke stå i SQL-koden (kun i kommentarer)')
})

test('SQL: samme pulje-regel som fetchPoolQuestionIds — bank ELLER stengt ekte quiz, kategori valgfri', () => {
  assert.match(SQL, /q\.quiz_id IS NULL/)
  assert.match(SQL, /z\.is_test = false/)
  assert.match(SQL, /z\.closes_at <= p_now/)
  assert.match(SQL, /\(p_category IS NULL OR q\.category = p_category\)/)
})

test('SQL: trekningen er ORDER BY random() LIMIT p_count over kandidatsettet', () => {
  assert.match(SQL, /FROM public\.pool_question_ids\(p_category, p_real_types, p_now\)/)
  assert.match(SQL, /ORDER BY random\(\)\s*LIMIT GREATEST\(p_count, 0\)/)
})

test('SQL: begge funksjonene har SECURITY DEFINER og SET search_path = \'\' inline', () => {
  const defs = SQL.match(/CREATE OR REPLACE FUNCTION public\.(pool_question_ids|pick_pool_question_ids)[\s\S]*?AS \$\$/g) ?? []
  assert.equal(defs.length, 2, 'forventet nøyaktig to funksjonsdefinisjoner')
  for (const d of defs) {
    assert.match(d, /SECURITY DEFINER/, d.slice(0, 60))
    assert.match(d, /SET search_path = ''/, d.slice(0, 60))
  }
})

test('SQL: REVOKE navngir authenticated eksplisitt, og GRANT går til service_role — for begge', () => {
  for (const sig of ['pool_question_ids(text, text[], timestamptz)', 'pick_pool_question_ids(text, integer, text[], timestamptz)']) {
    const e = sig.replace(/[()[\],]/g, m => '\\' + m)
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${e} FROM PUBLIC, anon, authenticated;`), sig)
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${e} TO service_role;`), sig)
  }
})

// ── TS-veien ────────────────────────────────────────────────────────────────

test('pickPoolQuestionIds kaller RPC-en med hvitelisten fra REAL_QUIZ_TYPES', () => {
  assert.match(POOL, /supabaseAdmin\.rpc\('pick_pool_question_ids', \{\s*p_category: input\.category,\s*p_count: input\.count,\s*p_real_types: \[\.\.\.REAL_QUIZ_TYPES\],\s*p_now: input\.nowIso,\s*\}\)/)
  assert.match(POOL, /import \{ onlyRealQuizzes, REAL_QUIZ_TYPES \} from '@\/lib\/real-quiz-population'/)
})

test('pickPoolQuestionIds: feil er { ok: false }, aldri en tom liste', () => {
  const i = POOL.indexOf('export async function pickPoolQuestionIds')
  const kropp = POOL.slice(i)
  assert.match(kropp, /if \(error\) \{[\s\S]*?return \{ ok: false \}/)
  assert.doesNotMatch(kropp, /return \{ ok: true, value: \[\] \}/)
})

test('ruten trekker via pickPoolQuestionIds og henter ikke lenger puljen til Vercel', () => {
  assert.match(ROUTE, /import \{ pickPoolQuestionIds \} from '@\/lib\/generated-quiz-pool'/)
  assert.match(ROUTE, /const pick = await pickPoolQuestionIds\(\{\s*category,\s*count: GENERATED_QUIZ_QUESTION_COUNT,/)
  assert.doesNotMatch(ROUTE, /fetchPoolQuestionIds|sampleDistinct/)
  assert.match(ROUTE, /if \(pick\.value\.length < GENERATED_QUIZ_QUESTION_COUNT\)/)
})

test('fetchPoolQuestionIds står fortsatt — den gamle veien beholdes til den nye er verifisert', () => {
  assert.match(POOL, /export async function fetchPoolQuestionIds/)
})
