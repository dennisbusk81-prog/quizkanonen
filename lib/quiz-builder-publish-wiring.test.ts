// Kjøres med:  npm test
//
// STRUKTURELL SPERRE for publiseringspunktet i quiz-veiviseren (27. august
// 2026). Fram til nå opprettet `createQuiz` quizen AKTIV på tittel-blur — før
// admin hadde skrevet et eneste spørsmål — så en tom quiz sto publisert gjennom
// hele byggeperioden. `handleFinish`, bak knappen som allerede het «Lagre og
// publiser →», rørte ikke `is_active` i det hele tatt: flagget var arvet fra
// importruten, ikke en beslutning noen tok.
//
// Nå: opprettes INAKTIV (`activate: false`), publiseres i handleFinish som
// SISTE steg — etter at spørsmålene er lagret.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/dead-session-finish-wiring.test.ts og lib/finish-quiz-timeout.test.ts —
// logikken ligger inline i en 2600-linjers klientkomponent, og prosjektet har
// ikke React-testoppsett. Rute-siden av kontrakten (at `activate: false`
// faktisk hindrer aktiveringen) er ekte integrasjonstestet i
// lib/quiz-import-route.test.ts. Det denne filen vokter er WIRINGEN: at
// veiviseren sender flagget, og at den publiserer sist og bare når den skal.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • fjern `activate: false` fra createQuiz  → «opprettes inaktiv» ryker.
//   • flytt aktiverings-PATCHen foran `Promise.all`-en → «publiserer SIST» ryker.
//   • fjern `return` etter setFinishError     → «feilet aktivering navigerer
//     ikke» ryker (stille suksess: admin sendes til /admin i troen på at
//     quizen er publisert).
//   • fjern `venterPaaPubliseringRef`-vakten  → «rører ikke is_active i
//     redigering» ryker (en skjult quiz ville blitt republisert av et
//     lagringsklikk).
//   • sett `is_active: false` i PATCHen       → «publiserer» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('app/admin/quizzes/new/page.tsx', 'utf8')

// Samme klammetelling som i lib/dead-session-finish-wiring.test.ts.
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

/** Fjerner HELE kommentarlinjer før vi leter etter kode.
 *
 *  Nødvendig, ikke pynt: kommentarene rundt denne logikken forklarer seg selv
 *  med de samme ordene som koden bruker («Ingen router.push: …»), og et anker
 *  som treffer forklaringen i stedet for handlingen måler ingenting. Første
 *  utkast av denne filen gikk i nettopp den fella. Jf.
 *  feedback-structural-tests-need-active-line-anchors.
 *
 *  Kun hele linjer fjernes — da kan strengliteraler med «//» i seg (URL-er)
 *  ikke bli klippet i stykker. */
function utenKommentarer(kilde: string): string {
  return kilde
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

const createQuizBody = utenKommentarer(
  functionBody(SRC, 'const createQuiz = useCallback(async (): Promise<string | null> => {'))
const handleFinishBody = utenKommentarer(
  functionBody(SRC, 'const handleFinish = async () => {'))

// ── Opprettelsen ────────────────────────────────────────────────────────────

test('createQuiz ber importruten om å IKKE aktivere', () => {
  // Uten dette flagget aktiverer ruten som før (defaulten er true, av hensyn
  // til Excel-importen), og quizen står publisert og tom fra tittel-blur.
  assert.ok(/activate:\s*false/.test(createQuizBody),
    'createQuiz sender ikke activate:false — quizen opprettes da AKTIV med tomme placeholder-spørsmål')
})

test('createQuiz merker raden som «skylder en publisering»', () => {
  assert.ok(/venterPaaPubliseringRef\.current\s*=\s*true/.test(createQuizBody),
    'uten dette merket vet handleFinish ikke at raden ble opprettet inaktiv, og publiserer aldri')
})

// ── Publiseringen: SIST, og bare når vi eier den ────────────────────────────

test('handleFinish publiserer med is_active: true', () => {
  assert.ok(/is_active:\s*true/.test(handleFinishBody),
    'handleFinish setter ikke is_active — knappen «Lagre og publiser» publiserer da ingenting')
})

test('handleFinish publiserer SIST — etter at spørsmålene er lagret', () => {
  const lagring = handleFinishBody.indexOf('Promise.all(questionsRef.current.map')
  const publisering = handleFinishBody.indexOf('is_active: true')

  assert.notEqual(lagring, -1, 'fant ikke spørsmålslagringen i handleFinish')
  assert.notEqual(publisering, -1, 'fant ikke publiseringen i handleFinish')
  // Rekkefølgen er hele poenget: publiseres den først, er quizen synlig og
  // spillbar i det vinduet lagringene pågår — nøyaktig feilen vi lukker.
  assert.ok(publisering > lagring,
    'publiseringen skjer FØR spørsmålene lagres — da er quizen live med tomme spørsmål i mellomtiden')
})

test('publiseringen er gatet på venterPaaPubliseringRef — redigering rører ikke is_active', () => {
  const vakt = handleFinishBody.indexOf('venterPaaPubliseringRef.current')
  const publisering = handleFinishBody.indexOf('is_active: true')

  assert.notEqual(vakt, -1,
    'ingen vakt i handleFinish — et lagringsklikk ville republisert en quiz admin bevisst har skjult')
  assert.ok(vakt < publisering, 'vakten må stå FØR publiseringen for å kunne hindre den')
})

// ── Feilet publisering: ærlig, ikke stille ──────────────────────────────────

test('feilet publisering setter en feilmelding OG navigerer ikke bort', () => {
  const idx = handleFinishBody.indexOf('is_active: true')
  // Vinduet avgrenses på den ekte grensen — slutten av if-blokken rundt
  // publiseringen — ikke på et tegnantall, jf.
  // feedback-nearby-code-can-satisfy-your-test-anchor.
  const etterPublisering = handleFinishBody.slice(idx)
  const feilgren = etterPublisering.slice(0, etterPublisering.indexOf('router.push'))

  assert.notEqual(feilgren.length, 0, 'fant ingen router.push etter publiseringen')
  assert.ok(/if\s*\(!res\.ok\)/.test(feilgren),
    'ingen sjekk av publiserings-svaret — en feilet publisering ville passert som suksess')
  assert.ok(/setFinishError\(/.test(feilgren),
    'feilet publisering setter ingen feilmelding — admin får ingen beskjed')
  assert.ok(/\breturn\b/.test(feilgren),
    'feilgrenen returnerer ikke — admin sendes til /admin i troen på at quizen er publisert')
})

test('feilmeldingen sier at quizen står SKJULT, ikke bare at «noe gikk galt»', () => {
  // Innholdskravet finnes fordi konsekvensen ikke er utledbar for admin:
  // spørsmålene ER lagret, så alt ser ferdig ut. Det som mangler er nettopp
  // publiseringen. Jf. feedback-colour-must-not-contradict-the-sentence.
  // MÅ ankres etter publiseringen: den FØRSTE setFinishError i handleFinish er
  // `setFinishError(null)`-nullstillingen helt øverst, og den ville gitt et
  // vindu uten meldingsteksten i det hele tatt (målt — testen var rød på
  // nettopp det).
  const publisering = handleFinishBody.indexOf('is_active: true')
  const idx = handleFinishBody.indexOf('setFinishError(', publisering)
  assert.notEqual(idx, -1, 'ingen setFinishError etter publiseringen')
  const melding = handleFinishBody.slice(idx, handleFinishBody.indexOf('return', idx))
  assert.ok(/skjult/i.test(melding),
    'feilmeldingen nevner ikke at quizen fortsatt er skjult — da leses den som en vanlig lagringsfeil')
})
