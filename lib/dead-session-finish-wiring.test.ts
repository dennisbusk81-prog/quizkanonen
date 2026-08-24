// Kjøres med:  npm test
//
// STRUKTURELL SPERRE for målstrek-halvdelen av [AU-2] (24. august 2026):
// submit svarer 401 når sesjonen er død server-side, og klienten skal da tilby
// INNLOGGING — ikke påstå at nettverket sviktet, og ikke kaste svarene.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/finish-quiz-timeout.test.ts — logikken ligger inline i en 3800-linjers
// klientkomponent uten React-testoppsett i prosjektet. Selve klassifiseringen
// er oppførselstestet i lib/submit-response.test.ts, og ruten i
// lib/submit-dead-session-route.test.ts. Det denne filen vokter er WIRINGEN
// mellom dem — og særlig den ene egenskapen som er lett å ødelegge ved et uhell:
// at den lagrede fremdriften IKKE ryddes på feilveien.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Droppes `needsLogin` inn i klassifiseringen → «flagget videreformidles» ryker.
//   • Fjernes needs-login-grenen (så 401 faller til feilveien) → «egen gren» ryker.
//   • Flyttes `localStorage.removeItem(qk_progress_)` opp før grenen, eller inn
//     i catch → «fremdriften overlever» ryker.
//   • Fjernes `onSuccess` fra målstrek-modalen → «modalen navigerer ikke bort» ryker.
//   • Skrives «sjekk internettforbindelsen» inn i overlegget → «peker ikke på
//     nettverket» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('app/quiz/[id]/page.tsx', 'utf8')

// Samme klammetelling som i lib/finish-quiz-timeout.test.ts.
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

const finishQuizBody = functionBody(SRC, 'const finishQuiz = async (override?: FinishQuizOverride) => {')

test('needsLogin-flagget videreformidles til klassifiseringen', () => {
  // Klassifisereren krever BÅDE status 401 og flagget. Sendes flagget ikke inn,
  // faller enhver død sesjon til 'error' — altså tilbake til feilteksten om
  // internettforbindelsen, som var hele feilen.
  assert.ok(/needsLogin: \(body as \{ needsLogin\?: boolean \} \| null\)\?\.needsLogin/.test(finishQuizBody),
    'finishQuiz leser ikke needsLogin ut av svarkroppen — 401 vil da klassifiseres som en vanlig feil')
})

test('401 har en EGEN gren som ikke setter feiltekst', () => {
  const idx = finishQuizBody.indexOf("'needsLogin' in submitOutcome.value")
  assert.notEqual(idx, -1,
    'ingen needs-login-gren i finishQuiz — et 401-svar faller da ned i den generiske feilveien')

  const branch = finishQuizBody.slice(idx, idx + 400)
  assert.ok(/setFinishNeedsLogin\(true\)/.test(branch),
    'grenen setter ikke tilstanden som viser innloggings-overlegget')
  assert.ok(/\breturn\b/.test(branch),
    'grenen returnerer ikke — da fortsetter finishQuiz som om resultatet var lagret')
  assert.ok(!/setFinishSaveError/.test(branch),
    'grenen setter en feiltekst — den skal vise innloggingsveien, ikke en feil')
})

test('KRAV: den lagrede fremdriften overlever feilveien og 401-grenen', () => {
  // Dette er den skjulte recoveryen: `qk_progress_<quizId>` ligger igjen når
  // innsendingen ikke ble bekreftet, og er det Google-/magic link-veien (full
  // reload) trenger for å kunne levere svarene etterpå. Ryddes den for tidlig,
  // forsvinner svarene for godt.
  const removals = [...finishQuizBody.matchAll(/localStorage\.removeItem\(`qk_progress_/g)]
  assert.equal(removals.length, 1,
    `forventet nøyaktig én rydding av qk_progress_ i finishQuiz, fant ${removals.length}`)

  const needsLoginIdx = finishQuizBody.indexOf("'needsLogin' in submitOutcome.value")
  assert.notEqual(needsLoginIdx, -1, 'fant ikke needs-login-grenen')
  assert.ok(removals[0].index! > needsLoginIdx,
    'qk_progress_ ryddes FØR 401-grenen — da er svarene borte i det øyeblikket sesjonen dør')

  // Samme krav for timeout- og retryable-grenene: begge returnerer også tidlig.
  const timeoutIdx = finishQuizBody.indexOf("'retryable' in submitOutcome.value")
  assert.ok(timeoutIdx === -1 || removals[0].index! > timeoutIdx,
    'qk_progress_ ryddes før retryable-grenen')

  // Og catch-blokken skal ikke rydde i det hele tatt.
  const catchIdx = finishQuizBody.lastIndexOf('} catch {')
  assert.notEqual(catchIdx, -1, 'fant ikke catch-blokken i finishQuiz')
  assert.ok(!/localStorage\.removeItem/.test(finishQuizBody.slice(catchIdx)),
    'catch-blokken rydder lagret fremdrift — en feilet innsending ville da kastet svarene')
})

test('overlegget peker ikke på nettverket, og gir alltid en vei videre', () => {
  const idx = SRC.indexOf('{finishNeedsLogin && (')
  assert.notEqual(idx, -1, 'innloggings-overlegget finnes ikke')
  const card = SRC.slice(idx, idx + 2600)

  assert.ok(!/sjekk internettforbindelsen/i.test(card),
    'overlegget skylder på nettverket — submit SVARTE, og svaret var presist')
  assert.ok(/Du ble logget ut mens du spilte/.test(card),
    'overlegget sier ikke hva som faktisk skjedde')
  assert.ok(/Svarene dine er trygge/.test(card),
    'overlegget forteller ikke at svarene er i behold — det er hele poenget med å ikke rydde localStorage')

  // Alltid en utgang, som på timeout-skjermen: spilleren skal aldri bli stående.
  assert.ok(/setFinishNeedsLogin\(false\); setPhase\('finished'\)/.test(card),
    'mangler utgangen som lar spilleren se resultatet uten å logge inn')
  assert.ok(/setAuthModalOpen\(true\)/.test(card),
    'mangler knappen som åpner innloggingsvinduet')
})

test('overlegget lover ikke lagring etter at innleveringsfristen er passert', () => {
  // Samme feilklasse som 66007ee/700347d/634cf2f: en flate som lover noe den
  // ikke kan innfri. Etter SUBMIT_GRACE_MS avviser submit uansett innlogging.
  const idx = SRC.indexOf('{finishNeedsLogin && (')
  const card = SRC.slice(idx, idx + 2600)
  assert.ok(/innleveringsfristen er nå passert/.test(card),
    'mangler den ærlige teksten for tilfellet der fristen er ute')

  // ⚠ Det holder IKKE å slå opp navnet `canStillDeliverLate` i kortet: det står
  // også i ternæren som velger TEKST, så en test på navnet alene ville vært
  // grønn selv om selve KNAPPEN sto ugatet. (Målt: mutasjonen `{canStillDeliverLate && (`
  // → `{true && (` slapp gjennom en slik test.) Vi krever derfor at gaten står
  // foran knappen som åpner innloggingsvinduet.
  const btnIdx = card.indexOf('setAuthModalOpen(true)')
  assert.notEqual(btnIdx, -1, 'fant ikke knappen som åpner innloggingsvinduet')
  assert.ok(/canStillDeliverLate && \(/.test(card.slice(0, btnIdx)),
    '«Logg inn og lagre»-knappen er ikke gatet på fristen — den ville lovet lagring på et forsøk submit avviser uansett')

  // Fristen skal komme fra den DELTE kilden, ikke et nytt håndskrevet tall.
  assert.ok(/const lateDeliveryDeadline = lateSubmitDeadline\(quiz\?\.closes_at\)/.test(SRC),
    'fristen utledes ikke via lateSubmitDeadline — en andre kopi av regelen kan drifte fra submit-porten')
})

test('målstrek-modalen navigerer IKKE bort ved passordinnlogging', () => {
  // AuthModal reloader eller navigerer som standard. Her ville det kastet de
  // ferdigspilte svarene ut av minnet — derfor onSuccess.
  // Egenskaps-basert, ikke form-basert: vi leter etter overstyringen og
  // verifiserer konteksten rundt den. En regex mot den eksakte skrivemåten
  // (linjeskift, innrykk) ville blitt rød av ren formatering — se lærdommen i
  // lib/finish-quiz-timeout.test.ts om standings-kallene.
  const overrideIdx = SRC.indexOf('onSuccess={finishAfterLogin}')
  assert.notEqual(overrideIdx, -1,
    'ingen AuthModal bruker finishAfterLogin — passordinnlogging ville lastet siden på nytt og mistet svarene i minnet')

  const before = SRC.slice(Math.max(0, overrideIdx - 600), overrideIdx)
  assert.ok(/<AuthModal/.test(before), 'onSuccess={finishAfterLogin} står ikke på en AuthModal')
  assert.ok(/finishNeedsLogin && \(/.test(before),
    'målstrek-modalen er ikke gatet på finishNeedsLogin — den ville da kunne åpnes i andre tilstander')
  const modal = SRC.slice(overrideIdx - 600, overrideIdx + 400)
  assert.ok(/next=\{`\/quiz\/\$\{quizId\}`\}/.test(modal),
    'modalen mangler next tilbake til quizen — Google-runden ville landet et annet sted')

  // Og AuthModal må faktisk støtte overstyringen.
  const authModal = readFileSync('components/AuthModal.tsx', 'utf8')
  assert.ok(/if \(onSuccess\) \{ onSuccess\(\); return \}/.test(authModal),
    'AuthModal ignorerer onSuccess — kallstedet tror det blir værende på siden, men navigeres bort')
})

test('B-10-reload-leveringen blir ikke et stille blindspor ved 401', () => {
  // Det ENE kallstedet som kaller finishQuiz mens fasen fortsatt er 'register'
  // (startQuiz sin reload-levering etter stengetid). Overlegget bor i
  // spilleskjermen og vises ikke der, så uten en egen beskjed ville en død
  // sesjon på den stien gitt spilleren INGENTING — en regresjon mot tiden før
  // 401-skillet, da grenen i det minste kastet og satte en feiltekst.
  const startQuizBody = functionBody(SRC, 'const startQuiz = async () => {')
  const deliveryIdx = startQuizBody.indexOf('await finishQuiz({')
  assert.notEqual(deliveryIdx, -1, 'fant ikke reload-leveringen i startQuiz')

  const after = startQuizBody.slice(deliveryIdx, deliveryIdx + 800)
  assert.ok(/finishNeedsLoginRef\.current/.test(after),
    'reload-leveringen sjekker ikke om innsendingen strandet på en død sesjon — spilleren ville stått igjen uten noe svar')
  assert.ok(/setStartError\(/.test(after),
    'ingen beskjed settes på den stien — startskjermen viser startError, og den er eneste flate spilleren ser her')

  // Ref-en må nullstilles ved hvert forsøk, ellers kan en gammel 401 farge et
  // senere, vellykket forsøk.
  assert.ok(/finishNeedsLoginRef\.current = false/.test(finishQuizBody),
    'finishNeedsLoginRef nullstilles ikke i finishQuiz — et gammelt utfall kan lekke inn i neste forsøk')
})

test('finishAfterLogin kaller finishQuiz på nytt bak samme guard som retry', () => {
  const body = functionBody(SRC, 'const finishAfterLogin = async () => {')
  assert.ok(/if \(advancingRef\.current\) return/.test(body),
    'mangler re-entry-guard — to raske innlogginger kunne gitt to samtidige innsendinger')
  assert.ok(/await finishQuiz\(\)/.test(body),
    'finishAfterLogin sender ikke inn på nytt — spilleren logger inn og ingenting skjer')
  assert.ok(/advancingRef\.current = false/.test(body),
    'guarden frigis ikke — knappen ville stått låst etterpå')
  // Ingen override: svarene skal komme fra state, som er intakt.
  assert.ok(!/finishQuiz\(\{/.test(body),
    'finishAfterLogin sender en override — state er intakt her, og en override kan avvike fra den')
})
