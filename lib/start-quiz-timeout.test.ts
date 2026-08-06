// Kjøres med:  npm test
//
// STRUKTURELL SPERRE mot at et nettverkskall ved STARTSTREKEN i
// app/quiz/[id]/page.tsx igjen står uten øvre tidsgrense.
//
// BAKGRUNN
// 6. august 2026 var startQuiz det SISTE ubeskyttede leddet i spillestien —
// og den FØRSTE handlingen enhver spiller gjør. getSession, POST
// /api/quiz/start-attempt og spørsmålshentingen lå alle uten grense: hang ett
// av dem, settlet aldri try-blokken, finally kjørte aldri, og isStarting ble
// stående true. «Start quiz»-knappen sto disabled i «Laster…» for alltid, og
// eneste vei videre var å laste siden på nytt. Søsknene var allerede rettet
// etter at ekte spillere frøs: goToNext 1. august (e3e21bc), finishQuiz og
// already_played 5. august.
//
// Hvorfor en kildetekst-test og ikke en oppførselstest: samme begrunnelse som
// i lib/finish-quiz-timeout.test.ts — logikken ligger inline i en 3900-linjers
// klientkomponent uten React-testoppsett i prosjektet. Selve timeout-
// mekanikken er oppførselstestet og mutasjonsbevist i lib/with-timeout.test.ts
// (inkludert at et promise som ALDRI settles gir {ok:false, timedOut:true}).
// Det denne testen fanger, er at et kall på startstreken står/legges inn uten
// å bli pakket inn.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes withTimeout rundt start-attempt-blokken → «start-attempt ligger
//     inne i en withTimeout» ryker.
//   • Fjernes withTimeout rundt spørsmålshentingen → «to timeout-blokker» og
//     «spørsmålshentingen er tidsbegrenset» ryker.
//   • Fjernes abort/signal → «aborter det hengende kallet» ryker.
//   • Legges et nytt, ubeskyttet awaited fetch inn i startQuiz → «ingen bar
//     await fetch» ryker.
//   • Fjernes finally-frigivelsen av guarden → «isStarting frigis i finally»
//     ryker.
//   • Skrus timeouten opp/ned utilsiktet → «grensen er 9 sekunder» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('app/quiz/[id]/page.tsx', 'utf8')

// Samme klamme-tellende utklipper som i lib/finish-quiz-timeout.test.ts.
function functionBody(source: string, decl: string): string {
  const start = source.indexOf(decl)
  assert.notEqual(start, -1, `fant ikke «${decl}» i page.tsx — er funksjonen omdøpt?`)
  const braceStart = source.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(braceStart, i + 1)
    }
  }
  throw new Error(`fant ikke slutten på «${decl}»`)
}

const startQuizBody = functionBody(SRC, 'const startQuiz = async () => {')

test('grensen ved startstreken er 9 sekunder, som i goToNext og finishQuiz', () => {
  const m = SRC.match(/const START_TIMEOUT_MS = (\d+)/)
  assert.ok(m, 'START_TIMEOUT_MS er borte fra page.tsx')
  assert.equal(m![1], '9000',
    'grensen ved startstreken skal være 9 sekunder per steg, samme som NEXT_STEP_TIMEOUT_MS og FINISH_TIMEOUT_MS')
})

test('start-attempt ligger inne i en withTimeout med abort', () => {
  assert.ok(/withTimeout\(/.test(startQuizBody),
    'startQuiz har ingen withTimeout i det hele tatt — oppstarten kan henge for alltid')

  const attemptIdx = startQuizBody.indexOf("'/api/quiz/start-attempt'")
  assert.notEqual(attemptIdx, -1, 'fant ikke start-attempt-kallet i startQuiz')
  const beforeAttempt = startQuizBody.slice(0, attemptIdx)
  assert.ok(/withTimeout\(/.test(beforeAttempt),
    'start-attempt-kallet står ikke inne i en withTimeout')

  assert.ok(/onTimeout: \(\) => startController\.abort\(\)/.test(startQuizBody),
    'start-timeouten aborter ikke det hengende kallet — det ville da ligge og vente i bakgrunnen')
  assert.ok(/signal: startController\.signal/.test(startQuizBody),
    'start-attempt-fetchen får ingen AbortSignal, så abort() har ingen effekt')
})

test('spørsmålshentingen ved oppstart har eget budsjett og aborteres ved timeout', () => {
  const withTimeoutCount = (startQuizBody.match(/withTimeout\(/g) ?? []).length
  assert.equal(withTimeoutCount, 2,
    'forventet nøyaktig to timeout-blokker i startQuiz: én rundt start-attempt, én rundt spørsmålshentingen')

  assert.ok(/onTimeout: \(\) => questionController\.abort\(\)/.test(startQuizBody),
    'spørsmåls-timeouten aborter ikke det hengende kallet')
  // Begge stiene (fersk start og resume) skal sende signalet videre.
  const withSignal = (startQuizBody.match(/fetchQuestionAt\([^)]*questionController\.signal\)/g) ?? []).length
  assert.equal(withSignal, 2,
    'fetchQuestionAt-kallene i startQuiz (fersk start + resume) skal begge bære questionController.signal')
})

test('startQuiz har ingen bar awaited fetch — hvert ventede kall er dekket av en tidsgrense', () => {
  // Rival-kallet er fire-and-forget (.then/.catch, aldri await) og kan derfor
  // ikke fryse noe. Alt som awaites skal bære en AbortSignal — sporet etter at
  // det ligger inne i en withTimeout-blokk med abort.
  for (const m of startQuizBody.matchAll(/await fetch\(/g)) {
    const window = startQuizBody.slice(m.index!, m.index! + 700)
    assert.ok(/signal: \w+Controller\.signal/.test(window),
      `et \`await fetch(\` uten AbortSignal står i startQuiz:\n${window.slice(0, 160)}`)
  }
})

test('en timeout gir alltid en synlig utvei: feiltekst + knappen frigis i finally', () => {
  // Teksten under knappen er utveien — og finally frigir guardene, så selve
  // «Start quiz»-knappen er aktiv igjen og fungerer som «prøv igjen».
  assert.ok(/Det tok for lang tid å starte quizen/.test(startQuizBody),
    'timeout på start-attempt setter ingen feiltekst — spilleren ser bare at spinneren stopper')
  assert.ok(/Det tok for lang tid å laste spørsmålene/.test(startQuizBody),
    'timeout på spørsmålshentingen setter ingen feiltekst')

  // Frigivelsen må ligge i finally — det er den som garanterer at isStarting
  // slipper på ALLE utgangsveier, også de nye timeout-returene.
  const finallyIdx = startQuizBody.lastIndexOf('} finally {')
  assert.notEqual(finallyIdx, -1, 'startQuiz har ingen finally-blokk — guardene frigis ikke på alle utgangsveier')
  const finallyBlock = startQuizBody.slice(finallyIdx)
  // ^\s*-ankeret krever en AKTIV kodelinje — en utkommentert frigivelse
  // (`// setIsStarting(false)`) inneholder fortsatt teksten og ville ellers
  // sluppet gjennom. Avdekket av mutasjonskjøringen 6. august.
  assert.ok(/^\s*startingRef\.current = false/m.test(finallyBlock),
    'startingRef frigis ikke i finally')
  assert.ok(/^\s*setIsStarting\(false\)/m.test(finallyBlock),
    'isStarting frigis ikke i finally — knappen ville stått disabled etter en timeout')
})

test('utfallene klassifiseres uten setState inne i den innpakkede funksjonen', () => {
  // Samme disiplin som submit-blokken i finishQuiz: den innpakkede async-en
  // returnerer verdier ('suspended'/'rejected'/'created'), og all setState
  // skjer utenfor, ETTER at utfallet er avgjort. Da kan ikke et abortert
  // etterslep lande midt i et nytt forsøk. Suspendert-håndteringen må ha
  // overlevd omleggingen.
  assert.ok(/kind: 'suspended' as const/.test(startQuizBody),
    'suspendert-utfallet klassifiseres ikke lenger — suspenderte kontoer ville fått generisk feil')
  assert.ok(/if \(started\.kind === 'suspended'\)/.test(startQuizBody)
    && /setIsSuspended\(true\)/.test(startQuizBody),
    'suspendert-utfallet håndteres ikke utenfor timeout-blokken')
  assert.ok(/kind: 'rejected' as const, message:/.test(startQuizBody),
    'serverens feiltekst (f.eks. fra 429/403) føres ikke lenger videre til startError')
})
