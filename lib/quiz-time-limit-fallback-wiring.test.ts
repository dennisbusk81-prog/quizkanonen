// Kjøres med:  npm test
//
// STRUKTURTEST: spillsidens siste tidsgrense-fallback er KONSTANTEN, ikke et
// frittstående 30 (8. september 2026, kveld — Dennis: «30 skal ikke finnes
// noe sted i kodebasen som et frittstående tall»).
//
// Bakgrunn: tidsgrensen hadde tre kilder — spørsmålsnivået, quiz-raden og
// `getTimeLimit` sin `|| 30` i app/quiz/[id]/page.tsx. De to første er nå
// bundet til DEFAULT_QUESTION_TIME_LIMIT_SECONDS via arkivkopien og
// admin-importen; denne testen binder den tredje. Den treffer kun når BEGGE
// nivåene er NULL, men da skal svaret være det samme som overalt ellers.
//
// MUTASJONSBEVIS (8. september 2026):
//   • `|| DEFAULT_QUESTION_TIME_LIMIT_SECONDS` → `|| 30` i getTimeLimit → begge testene røde
//   • fjern DEFAULT_QUESTION_TIME_LIMIT_SECONDS fra importen             → import-testen rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const RAW = readFileSync(path.join(process.cwd(), 'app/quiz/[id]/page.tsx'), 'utf8')
const SRC = RAW.charCodeAt(0) === 0xfeff ? RAW.slice(1) : RAW

/** Kun linjer som faktisk kjører — en utkommentert vakt skal ikke telle. */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*')
    })
    .join('\n')
}

const AKTIV = aktiveLinjer(SRC)

test('getTimeLimit faller tilbake på DEFAULT_QUESTION_TIME_LIMIT_SECONDS — ikke et frittstående 30', () => {
  assert.match(
    AKTIV,
    /question\?\.time_limit_seconds \|\| quiz\?\.time_limit_seconds \|\| DEFAULT_QUESTION_TIME_LIMIT_SECONDS/,
    'siste ledd i getTimeLimit er ikke konstanten',
  )
  assert.doesNotMatch(
    AKTIV,
    /quiz\?\.time_limit_seconds \|\| \d+/,
    'et frittstående tall står som siste fallback i getTimeLimit',
  )
})

test('spillsiden importerer konstanten fra lib/quiz-time-limit', () => {
  assert.match(
    AKTIV,
    /import \{ DEFAULT_QUESTION_TIME_LIMIT_SECONDS, describeQuestionTimeLimit \} from '@\/lib\/quiz-time-limit'/,
  )
})
