// Kjøres med:  npm test
//
// ENHETSTEST av premium-kravet i attempt-tokenet (P-2, 23. august 2026) og av
// gatePlacement, den delte formingsfunksjonen de tre plasseringsrutene bruker.
//
// Hvorfor kravet ligger i tokenet i det hele tatt: se lib/attempt-token.ts.
// Kort — `auth.getUser` + `getUserPremium` er to serielle rundturer, og
// ranking-snapshot ble kalt 21,6 ganger per spiller 21. august 2026, ett av
// kallstedene rett etter at spilleren trykker på et svar. Kravet leses derfor
// én gang ved start-attempt og verifiseres med lokal HMAC per kall.
//
// DET SOM MÅ HOLDE, og som testene under feller hver for seg:
//   1. Kravet kan ikke FORFALSKES. Flippes «f» til «p» i et gyldig token, må
//      hele tokenet bli ugyldig — flagget er inne i den signerte nyttelasten.
//   2. Kravet kan ikke FLYTTES. Et premium-token for ett forsøk må ikke gi
//      premium på et annet forsøk eller en annen quiz.
//   3. GAMLE tokens (to segmenter, uten flagg) må fortsatt verifisere. Uten
//      det ville en spiller med åpen fane under deploy mistet både questions
//      og submit — altså ikke kunne levere.
//   4. Ugyldig token gir ALDRI `premium: true` — heller ikke «halvveis».
//
// MUTASJONSBEVIS
//   • Legg flagget utenfor nyttelasten i payloadFor (signer uten det), og
//     «flippet flagg» ryker.
//   • La readAttemptToken returnere `premium` før signaturen er sjekket, og
//     «ugyldig signatur gir ikke premium» ryker.
//   • Fjern to-segments-grenen, og «gammelt token verifiserer fortsatt» ryker.
//   • Fjern `isPremium ?`-leddene i gatePlacement, og alle tre gate-testene
//     ryker samtidig — det er hele poenget med at de deler én funksjon.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'crypto'

process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const { createAttemptToken, readAttemptToken, verifyAttemptToken } = await import('./attempt-token')
const { gatePlacement, attemptIsPremium } = await import('./live-premium')

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const QUIZ_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ATTEMPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ATTEMPT_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function tok(attemptId: string, quizId: string, premium: boolean): string {
  const t = createAttemptToken(attemptId, quizId, { premium })
  assert.ok(t, 'token skal kunne lages når signeringsnøkkelen finnes')
  return t
}

// ── Grunnlaget: kravet kommer fram, og default er trygg ─────────────────────

test('premium-kravet overlever tur/retur, og false er standardverdien', () => {
  assert.deepEqual(readAttemptToken(tok(ATTEMPT, QUIZ, true), ATTEMPT, QUIZ), { valid: true, premium: true })
  assert.deepEqual(readAttemptToken(tok(ATTEMPT, QUIZ, false), ATTEMPT, QUIZ), { valid: true, premium: false })

  // Uten claims-argument: gyldig token, men ikke premium. Et kallsted som
  // glemmer å sende kravet skal degradere til gratis, aldri oppgradere.
  const uten = createAttemptToken(ATTEMPT, QUIZ)
  assert.ok(uten)
  assert.deepEqual(readAttemptToken(uten, ATTEMPT, QUIZ), { valid: true, premium: false })
})

// ── 1. Kravet kan ikke forfalskes ──────────────────────────────────────────

test('flippet flagg (f → p) gjør hele tokenet ugyldig — signaturen dekker flagget', () => {
  const gratis = tok(ATTEMPT, QUIZ, false)
  const [issued, flag, sig] = gratis.split('.')
  assert.equal(flag, 'f', 'gratis-token skal bære f — ellers tester vi ikke det vi tror')

  const forfalsket = `${issued}.p.${sig}`
  assert.deepEqual(readAttemptToken(forfalsket, ATTEMPT, QUIZ), { valid: false, premium: false })
  assert.equal(verifyAttemptToken(forfalsket, ATTEMPT, QUIZ), false)
})

test('ukjent flaggverdi avvises i stedet for å tolkes', () => {
  const [issued, , sig] = tok(ATTEMPT, QUIZ, true).split('.')
  for (const rart of ['x', 'P', 'pp', '']) {
    assert.equal(
      readAttemptToken(`${issued}.${rart}.${sig}`, ATTEMPT, QUIZ).valid,
      false,
      `flagg ${JSON.stringify(rart)} skal ikke godtas`,
    )
  }
})

test('ugyldig signatur gir aldri premium, uansett hvor gyldig flagget ser ut', () => {
  const [issued] = tok(ATTEMPT, QUIZ, true).split('.')
  // Riktig lengde på signaturen, feil innhold — timingSafeEqual krever lik
  // lengde, så dette treffer selve sammenligningen og ikke lengdesjekken.
  const ekte = tok(ATTEMPT, QUIZ, true).split('.')[2]
  const falsk = 'A'.repeat(ekte.length)
  assert.deepEqual(readAttemptToken(`${issued}.p.${falsk}`, ATTEMPT, QUIZ), { valid: false, premium: false })
})

// ── 2. Kravet kan ikke flyttes ─────────────────────────────────────────────

test('et premium-token gjelder KUN sitt eget forsøk og sin egen quiz', () => {
  const t = tok(ATTEMPT, QUIZ, true)
  assert.equal(readAttemptToken(t, ATTEMPT, QUIZ).premium, true, 'positiv kontroll')
  assert.deepEqual(readAttemptToken(t, ATTEMPT_2, QUIZ), { valid: false, premium: false })
  assert.deepEqual(readAttemptToken(t, ATTEMPT, QUIZ_2), { valid: false, premium: false })
})

// ── 3. Bakoverkompatibilitet gjennom deploy-vinduet ────────────────────────

test('gammelt token (to segmenter, uten flagg) verifiserer fortsatt — og leses som gratis', () => {
  // Nøyaktig formen forrige versjon utstedte: "<utstedt>.<sig>" over
  // "attemptId:quizId:utstedt". Bygget for hånd her, ikke hentet fra koden,
  // slik at testen fortsatt beskriver DET GAMLE formatet om koden endres.
  const issued = String(Date.now())
  const sig = createHmac('sha256', process.env.QUIZ_TOKEN_SECRET as string)
    .update(`${ATTEMPT}:${QUIZ}:${issued}`)
    .digest('base64url')
  const gammelt = `${issued}.${sig}`

  // Dette er det kritiske: questions og submit krever et GYLDIG token. Ryker
  // dette, kan en spiller med åpen fane under deploy ikke levere quizen sin.
  assert.equal(verifyAttemptToken(gammelt, ATTEMPT, QUIZ), true)
  assert.deepEqual(readAttemptToken(gammelt, ATTEMPT, QUIZ), { valid: true, premium: false })
})

test('utløpt token er ugyldig — også når flagget sier premium', () => {
  const forGammelt = String(Date.now() - (6 * 60 * 60 * 1000 + 60_000))
  const sig = createHmac('sha256', process.env.QUIZ_TOKEN_SECRET as string)
    .update(`${ATTEMPT}:${QUIZ}:${forGammelt}:p`)
    .digest('base64url')
  assert.deepEqual(readAttemptToken(`${forGammelt}.p.${sig}`, ATTEMPT, QUIZ), { valid: false, premium: false })
})

// ── attemptIsPremium: sinket rutene faktisk spør gjennom ───────────────────

test('attemptIsPremium er false uten token, uten attemptId og ved uverifisert token', () => {
  const t = tok(ATTEMPT, QUIZ, true)
  assert.equal(attemptIsPremium({ quizId: QUIZ, attemptId: ATTEMPT, token: t }), true, 'positiv kontroll')

  assert.equal(attemptIsPremium({ quizId: QUIZ, attemptId: ATTEMPT, token: null }), false)
  assert.equal(attemptIsPremium({ quizId: QUIZ, attemptId: null, token: t }), false)
  assert.equal(attemptIsPremium({ quizId: QUIZ, attemptId: ATTEMPT, token: 'sprøyt' }), false)
  // Et PÅSTÅTT attemptId med et token som gjelder et annet forsøk.
  assert.equal(attemptIsPremium({ quizId: QUIZ, attemptId: ATTEMPT_2, token: t }), false)
})

// ── gatePlacement: den delte formingen ─────────────────────────────────────

const PLACEMENT = {
  rank: 33,
  total: 65,
  low: 31,
  high: 35,
  above: { name: 'Grunde Varting', correct: 11 },
  below: { name: 'Thomas Riggelsen', correct: 11 },
}

test('Premium får alt: eksakt rank og begge nabonavn', () => {
  assert.deepEqual(gatePlacement(PLACEMENT, true), PLACEMENT)
})

test('ikke-Premium får spenn og total, men verken rank eller nabonavn', () => {
  const g = gatePlacement(PLACEMENT, false)
  assert.equal(g.rank, null, 'det eksakte tallet skal ikke finnes i svaret')
  assert.equal(g.above, null, 'nabonavn er en personopplysning, ikke et tall')
  assert.equal(g.below, null)
  // Gratisvisningen er komplett — den skal ikke degraderes til ingenting.
  assert.equal(g.low, 31)
  assert.equal(g.high, 35)
  assert.equal(g.total, 65)
})

test('navnene forsvinner sammen med tallet, ikke i et eget steg', () => {
  // Regresjonsvern mot den mest sannsynlige fremtidige feilen: at noen gater
  // `rank` og glemmer `above`/`below`. Serialisert svar skal ikke inneholde
  // navnene i det hele tatt — heller ikke nestet.
  const json = JSON.stringify(gatePlacement(PLACEMENT, false))
  assert.ok(!json.includes('Grunde'), 'nabonavnet over lekket gjennom')
  assert.ok(!json.includes('Riggelsen'), 'nabonavnet under lekket gjennom')
  assert.ok(!json.includes('33'), 'den eksakte plasseringen lekket gjennom')
})
