// Kjøres med:  npm test
//
// Varselet i fetchQuestionAt (app/quiz/[id]/page.tsx) påsto «spiller trolig
// strandet ved stengetid» på ENHVER 403 fra questions-ruten. Målt 4. september
// 2026 fyrte det på en arkivquiz med closes_at = NULL — en quiz som ikke kan
// stenge — mens spilleren spilte ferdig og leverte normalt. Saken talte da to
// ulike ting under én overskrift.
//
// MUTASJONER DENNE FILEN SKAL FELLE:
//   • `serverError === QUIZ_CLOSED_ERROR` → `!==`  ....... test 1 og 2 ryker
//   • begge grenene returnerer samme konstant  ........... test 3 ryker
//   • `serverError` droppes fra extra  ................... test 4 og 5 ryker
//   • extra normaliseres fra input i stedet for fra den
//     lokale variabelen (drift melding↔extra)  ........... test 5 ryker
//   • kallstedet i page.tsx bygger varselet selv igjen
//     med en hardkodet streng  ........................... test 7 ryker
//   • returverdi-grenen kobles til varsel-skillet  ....... test 8 ryker
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildQuestions403Alert,
  QUESTIONS_403_CLOSED_ALERT,
  QUESTIONS_403_UNKNOWN_ALERT,
} from './questions-403-alert'
import { QUIZ_CLOSED_ERROR } from './late-play-window'

const base = { quizId: 'q-1', attemptId: 'a-1', index: 3 }

test('serveren sa «Quizen er ikke åpen» → stengetids-meldingen', () => {
  const varsel = buildQuestions403Alert({ ...base, serverError: QUIZ_CLOSED_ERROR })
  assert.equal(varsel.message, QUESTIONS_403_CLOSED_ALERT)
})

test('alle de STILLE 403-utgangene → ukjent-meldingen, aldri en påstand om stengetid', () => {
  // Ordrett teksten hver av rutens øvrige 403-utganger returnerer
  // (app/api/quiz/[id]/questions/route.ts). Ingen av dem sier noe om tid.
  for (const serverError of [
    'Ugyldig attempt-token',
    'Ingen tilgang til dette forsøket',
    'Forsøket er allerede levert',
  ]) {
    const varsel = buildQuestions403Alert({ ...base, serverError })
    assert.equal(
      varsel.message,
      QUESTIONS_403_UNKNOWN_ALERT,
      `«${serverError}» sier ingenting om stengetid og skal ikke telles som det`,
    )
  }
})

test('ulesbar body (null/undefined) → ukjent, ikke stengetid', () => {
  assert.equal(buildQuestions403Alert({ ...base, serverError: null }).message, QUESTIONS_403_UNKNOWN_ALERT)
  assert.equal(buildQuestions403Alert({ ...base, serverError: undefined }).message, QUESTIONS_403_UNKNOWN_ALERT)
})

test('de to meldingene er FAKTISK forskjellige — Sentry grupperer på strengen', () => {
  assert.notEqual(
    QUESTIONS_403_CLOSED_ALERT,
    QUESTIONS_403_UNKNOWN_ALERT,
    'like strenger ville slått de to tellerne sammen igjen — hele poenget med skillet',
  )
  // Ingen interpolasjon: én sak per feiltekst ville vært like ulesbart.
  assert.ok(!QUESTIONS_403_UNKNOWN_ALERT.includes('${'))
  assert.equal(
    QUESTIONS_403_CLOSED_ALERT,
    'quiz: spørsmålshenting avvist med 403 — spiller trolig strandet ved stengetid',
    'stengetids-teksten er uendret siden a8b7adc — Sentry-saken skal beholde historikken',
  )
})

test('serverError bæres videre i extra — ruten logger ingenting, extra er eneste kilde', () => {
  const varsel = buildQuestions403Alert({ ...base, serverError: 'Ugyldig attempt-token' })
  assert.equal(
    varsel.extra.serverError,
    'Ugyldig attempt-token',
    'uten denne kan ingen avgjøre HVILKEN av rutens stille utganger som traff',
  )
  // Melding og extra utledes av samme normaliserte verdi — de kan ikke drifte.
  assert.equal(varsel.message, QUESTIONS_403_UNKNOWN_ALERT)
})

test('extra bærer også quizId, attemptId og index — i begge grenene', () => {
  for (const serverError of [QUIZ_CLOSED_ERROR, 'Ugyldig attempt-token']) {
    const varsel = buildQuestions403Alert({ ...base, serverError })
    assert.deepEqual(varsel.extra, { quizId: 'q-1', attemptId: 'a-1', index: 3, serverError })
  }
  // Gjest uten attempt-id skal ikke miste de andre feltene.
  assert.deepEqual(
    buildQuestions403Alert({ quizId: 'q-2', attemptId: null, index: 0, serverError: null }).extra,
    { quizId: 'q-2', attemptId: null, index: 0, serverError: null },
  )
})

// ── Kallstedet ───────────────────────────────────────────────────────────────
// De rene testene over kan stå grønne mens page.tsx bygger varselet selv med en
// hardkodet streng. Disse to feller kallstedet.
const PAGE = readFileSync(new URL('../app/quiz/[id]/page.tsx', import.meta.url), 'utf8')

test('page.tsx bygger varselet via helperen, og har ingen egen 403-meldingsstreng', () => {
  assert.match(
    PAGE,
    /^\s*const varsel = buildQuestions403Alert\(\{ quizId, attemptId: aId, index, serverError: errBody\?\.error \}\)$/m,
    'varselet skal bygges av helperen, med serverError fra responsen',
  )
  assert.match(PAGE, /^\s*Sentry\.captureMessage\(varsel\.message, \{$/m)
  assert.match(PAGE, /^\s*extra: varsel\.extra,$/m, 'extra skal komme fra helperen, ikke settes sammen på nytt her')
  // Ankeret over ville også passert om en hardkodet streng lå ved siden av.
  // Meldingsteksten skal finnes NØYAKTIG ett sted i repoet: konstanten.
  assert.ok(
    !PAGE.includes('avvist med 403 —'),
    'meldingsteksten skal kun bo i lib/questions-403-alert.ts, ellers kan de to drifte',
  )
})

test('varsel-skillet endrer ikke returverdien — {closed:true} henger fortsatt kun på QUIZ_CLOSED_ERROR', () => {
  assert.match(
    PAGE,
    /^\s*if \(errBody\?\.error === QUIZ_CLOSED_ERROR\) return \{ closed: true \}$/m,
    'utfallet som lar goToNext levere det spilleren har, skal være uendret av målingen',
  )
  // Returverdien skal ikke utledes av varselet — da ville en endring i
  // Sentry-tellingen flyttet spilleren mellom «lever nå» og «Prøv igjen».
  assert.ok(
    !/return \{ closed: true \}/.test(PAGE.replace(/if \(errBody\?\.error === QUIZ_CLOSED_ERROR\) return \{ closed: true \}/, '')),
    'det finnes kun ÉN vei til {closed:true}, og den leser serverens tekst direkte',
  )
})
