// Kjøres med:  npm test
//
// STRUKTURELL SPERRE mot at et nettverkskall ved MÅLSTREKEN i
// app/quiz/[id]/page.tsx igjen står uten øvre tidsgrense.
//
// BAKGRUNN
// 31. juli 2026 frøs mellomskjermen fordi `goToNext` awaitet Promise.all på tre
// fetch-kall uten grense (rettet i e3e21bc, se lib/with-timeout.ts). 4. august
// ble det oppdaget at `finishQuiz` og already_played-stien hadde nøyaktig samme
// svakhet — de fikk aldri samme vakt, fordi /standings ikke er en del av
// spilleløkka og derfor falt utenfor den forrige runden.
//
// Konsekvensen ved målstreken er verre enn mellom to spørsmål:
//   • finishQuiz: henger submit, nås aldri setPhase('finished') nederst, OG
//     goToNext rekker aldri å frigi advancingRef → knappen står disabled i
//     «Laster…» for alltid.
//   • already_played: /standings-kallet ligger FØR setLoading(false) → hele
//     siden blir stående på lasteskjermen.
//
// Hvorfor en kildetekst-test og ikke en oppførselstest: logikken ligger inline i
// en 3800-linjers klientkomponent uten React-testoppsett i prosjektet. Selve
// timeout-mekanikken er allerede oppførselstestet og mutasjonsbevist i
// lib/with-timeout.test.ts. Det denne testen fanger, er det som faktisk gikk
// galt begge gangene: at et NYTT kall legges inn på et av disse stedene uten å
// bli pakket inn. Samme sjanger som de strukturelle sperrene nederst i
// lib/has-password-route.test.ts.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes withTimeout rundt submit → «submit ligger inne i en withTimeout» ryker.
//   • Fjernes grensen på et av standings-kallene → «hvert standings-kall er
//     tidsbegrenset» ryker.
//   • Legges et nytt, ubeskyttet fetch-kall inn i finishQuiz → «ingen bar fetch
//     i finishQuiz» ryker.
//   • Fjernes retry-/videre-utgangen fra timeout-skjermen → «timeout gir alltid
//     en vei videre» ryker.
//   • Skrus timeouten opp/ned utilsiktet → «grensen er 9 sekunder» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('app/quiz/[id]/page.tsx', 'utf8')

// Klipper ut kroppen til en funksjon deklarert som `const <navn> = async () => {`
// ved å telle klammer. Enkelt, men nok: vi trenger kun å vite hvilke kall som
// står inne i akkurat denne funksjonen.
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

const finishQuizBody = functionBody(SRC, 'const finishQuiz = async () => {')

test('grensen ved målstreken er 9 sekunder, som i goToNext', () => {
  const m = SRC.match(/const FINISH_TIMEOUT_MS = (\d+)/)
  assert.ok(m, 'FINISH_TIMEOUT_MS er borte fra page.tsx')
  assert.equal(m![1], '9000',
    'grensen ved målstreken skal være 9 sekunder, samme som NEXT_STEP_TIMEOUT_MS i goToNext')
})

test('submit ligger inne i en withTimeout med abort', () => {
  assert.ok(/withTimeout\(/.test(finishQuizBody),
    'finishQuiz har ingen withTimeout i det hele tatt — submit kan henge for alltid')

  const submitIdx = finishQuizBody.indexOf('/submit`')
  assert.notEqual(submitIdx, -1, 'fant ikke submit-kallet i finishQuiz')
  const beforeSubmit = finishQuizBody.slice(0, submitIdx)
  assert.ok(/withTimeout\(/.test(beforeSubmit),
    'submit-kallet står ikke inne i en withTimeout')

  assert.ok(/onTimeout: \(\) => submitController\.abort\(\)/.test(finishQuizBody),
    'submit-timeouten aborter ikke det hengende kallet — det ville da ligge og kunne lande midt i et nytt forsøk')
  assert.ok(/signal: submitController\.signal/.test(finishQuizBody),
    'submit-fetchen får ingen AbortSignal, så abort() har ingen effekt')
})

test('finishQuiz har ingen bar fetch — hvert kall er dekket av en tidsgrense', () => {
  // Alle fetch-kall i finishQuiz skal ligge inne i én av de to timeout-blokkene
  // (submit-blokken eller extras-blokken). Teller vi dem opp må tallet stemme:
  // submit, standings og leaderboard-fallbacken — tre, ikke flere.
  const fetchCount = (finishQuizBody.match(/\bfetch\(/g) ?? []).length
  assert.equal(fetchCount, 3,
    `finishQuiz har ${fetchCount} fetch-kall, forventet 3 (submit, standings, leaderboard-fallback). ` +
    'Er et nytt kall lagt til, må det inn i en av timeout-blokkene — ellers kan det fryse resultatskjermen.')

  const withTimeoutCount = (finishQuizBody.match(/withTimeout(OrNull)?\(/g) ?? []).length
  assert.equal(withTimeoutCount, 2,
    'forventet nøyaktig to timeout-blokker i finishQuiz: én rundt submit, én felles rundt pynte-kallene')
})

test('pynte-kallene deler ETT budsjett og kan ikke utsette resultatskjermen mer enn én grense', () => {
  assert.ok(/withTimeoutOrNull\(/.test(finishQuizBody),
    'extras-blokken bruker ikke withTimeoutOrNull — et utfall som ikke rekker fram må degradere til null, ikke kaste')
  assert.ok(/onTimeout: \(\) => extrasController\.abort\(\)/.test(finishQuizBody),
    'extras-blokken aborter ikke kallene sine ved timeout')
  // Begge fetch-ene i blokken må dele den samme controlleren — ellers er det
  // ikke ett felles budsjett, og to serielle kall kan koste to grenser.
  const shared = (finishQuizBody.match(/signal: extrasController\.signal/g) ?? []).length
  assert.equal(shared, 2,
    'både standings- og leaderboard-fallback-fetchen skal bruke extrasController.signal')
})

test('hvert standings-kall i filen er tidsbegrenset', () => {
  // Tre kallsteder: already_played i fetchData, phase-effekten, og finishQuiz.
  const callSites = (SRC.match(/fetch\(`\/api\/quiz\/\$\{quizId\}\/standings/g) ?? []).length
  assert.equal(callSites, 3,
    `forventet 3 standings-kall i page.tsx, fant ${callSites} — et nytt kallsted må også få tidsgrense`)

  // Ingen av dem skal stå uten en AbortSignal. Signal er det observerbare
  // sporet etter at kallet ligger inne i en withTimeout-blokk med abort.
  const withSignal = (SRC.match(/\/standings[^)]*\{ signal: \w+\.signal \}/g) ?? []).length
  const withParamsAndSignal = (SRC.match(/\/standings\?\$\{stParams\.toString\(\)\}`, \{ signal: extrasController\.signal \}/g) ?? []).length
  assert.equal(withSignal + withParamsAndSignal, 3,
    'ett eller flere standings-kall mangler AbortSignal — da er de heller ikke tidsbegrenset')
})

test('already_played-stien når alltid setLoading(false)', () => {
  // Kallet som ligger FØR setLoading(false) må være det tidsbegrensede, ikke et
  // bart await. Dette var den konkrete fryse-mekanismen på den stien.
  const idx = SRC.indexOf("setPhase('already_played')")
  assert.notEqual(idx, -1, 'fant ikke already_played-grenen')
  // NB: må treffe SETNINGEN setLoading(false), ikke en omtale av den i en
  // kommentar — ellers kutter slicen for tidlig og testen blir meningsløs.
  const rest = SRC.slice(idx)
  const stop = rest.search(/\n\s*setLoading\(false\)\s*\n/)
  assert.notEqual(stop, -1, 'fant ikke setLoading(false) etter already_played-grenen')
  const branch = rest.slice(0, stop)
  assert.ok(/withTimeoutOrNull\(/.test(branch),
    'standings-kallet før setLoading(false) er ikke tidsbegrenset — henger det, blir siden stående på lasteskjermen')
  // Et awaited fetch i denne grenen er lov — men KUN inne i timeout-blokken.
  // Sporet etter det er at kallet bærer en AbortSignal. Et bart `await fetch(`
  // uten signal er nøyaktig fryse-mekanismen fra 4. august.
  for (const m of branch.matchAll(/await fetch\(/g)) {
    const window = branch.slice(m.index!, m.index! + 300)
    assert.ok(/signal: \w+\.signal/.test(window),
      `et \`await fetch(\` uten AbortSignal står før setLoading(false):\n${window.slice(0, 160)}`)
  }
})

test('en submit-timeout gir alltid en vei videre, og påstår ingenting om lagringen', () => {
  assert.ok(/setFinishTimedOut\(true\)/.test(finishQuizBody),
    'timeout-tilstanden settes aldri — spilleren får ingen skjerm og blir stående')

  // Begge utgangene må finnes i UI-et: nytt forsøk OG «vis resultatet likevel».
  assert.ok(/onClick=\{retryFinishQuiz\}/.test(SRC), 'mangler «Prøv igjen»-utgang')
  assert.ok(/setFinishTimedOut\(false\); setPhase\('finished'\)/.test(SRC),
    'mangler utgangen som lar spilleren se resultatet uten å prøve igjen')

  // Teksten skal ikke påstå at noe ikke ble lagret — vi har ikke fått svar og
  // vet det ikke. (QK_3 regel 5.)
  const cardIdx = SRC.indexOf('{finishTimedOut && (')
  assert.notEqual(cardIdx, -1, 'timeout-skjermen finnes ikke')
  const card = SRC.slice(cardIdx, cardIdx + 2000)
  assert.ok(!/ble ikke lagret/.test(card),
    'timeout-skjermen påstår at resultatet ikke ble lagret — det vet vi ikke, submit kan ha landet')
})

test('«allerede lagret» avbryter IKKE try-blokken — extras-blokken skal kjøre', () => {
  // Klassifiseringen selv er oppførselstestet i lib/submit-response.test.ts.
  // Det denne fanger er WIRINGEN: at grenen faktisk faller videre ned i resten
  // av try-blokken i stedet for å returnere tidlig. Returnerte den tidlig, ville
  // spilleren fått en resultatskjerm uten topp-3 og plassering — nøyaktig
  // symptomet fiksen skulle fjerne.
  assert.ok(/classifySubmitResponse\(/.test(finishQuizBody),
    'finishQuiz klassifiserer ikke submit-svaret — da er 403 «allerede levert» ikke til å skille fra en ekte feil')
  assert.ok(/hasTimedOutOnce: finishTimedOutOnceRef\.current/.test(finishQuizBody),
    'klassifiseringen får ikke vite om vi har timet ut — da godtas «allerede levert» også på et første forsøk')

  const branchIdx = finishQuizBody.indexOf('alreadyStored')
  assert.notEqual(branchIdx, -1, 'fant ikke «allerede lagret»-grenen')
  // Fra grenen og fram til slutten av submit-blokken skal det ikke stå et
  // `return` som kortslutter resten av finishQuiz.
  const afterBranch = finishQuizBody.slice(finishQuizBody.indexOf('if (!submitOutcome.value.alreadyStored)'))
  const untilExtras = afterBranch.slice(0, afterBranch.indexOf('extrasController'))
  assert.ok(!/\n\s*return\b/.test(untilExtras),
    'et return mellom «allerede lagret»-grenen og extras-blokken kortslutter topp-3/plassering')
  assert.ok(/localStorage\.removeItem\(`qk_progress_/.test(untilExtras)
    && /localStorage\.setItem\(`qk_result_/.test(untilExtras),
    'qk_progress_ ryddes / qk_result_ skrives ikke på «allerede lagret»-veien — den skal være konsistent med happy path')
})

test('feilteksten etter en timeout påstår ikke at resultatet gikk tapt', () => {
  // submit er ikke idempotent: et nytt forsøk etter at det første faktisk landet
  // svarer 403 «Forsøket er allerede levert». Uten dette skillet ville spilleren
  // fått «Resultatet ble ikke lagret» om et lagret resultat.
  assert.ok(/finishTimedOutOnceRef\.current/.test(finishQuizBody),
    'feilgrenen skiller ikke på om vi allerede har timet ut — da kan den påstå tap om et lagret resultat')
  assert.ok(/Vi fikk ikke bekreftet om resultatet ble lagret/.test(SRC),
    'mangler den ærlige teksten for «vi vet ikke»-tilfellet')
})
