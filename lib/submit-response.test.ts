// Kjøres med:  npm test
//
// OPPFØRSELSTEST av kjeden timeout → «Prøv igjen» → forsøket hadde allerede
// landet på serveren.
//
// SCENARIOET
// Spilleren fullfører siste spørsmål. POST /submit går ut, men svaret kommer
// ikke tilbake innen 9 sekunder — klienten gir opp og viser «Prøv igjen».
// Kallet nådde likevel serveren, som lagret forsøket. Spilleren trykker «Prøv
// igjen», og det NYE kallet treffer dobbel-scoring-vernet i
// app/api/quiz/[id]/submit/route.ts → `403 { error: 'Forsøket er allerede levert' }`.
//
// Det svaret er en BEKREFTELSE på suksess forkledd som en feil. Fram til
// 5. august gikk det generisk feilvei: spilleren fikk «Vi fikk ikke bekreftet om
// resultatet ble lagret» om et resultat som lå trygt lagret, og resultatskjermen
// mistet topp-3 og plasseringskortet fordi resten av try-blokken ble hoppet over.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes 403-håndteringen helt (alt ikke-ok → error) → «retry etter timeout
//     … er en bekreftelse» ryker.
//   • Slippes hasTimedOutOnce-betingelsen → «uten forutgående timeout er samme
//     403 fortsatt en feil» ryker.
//   • Utvides matchingen til status alene → de fire andre 403-ene ryker.
//   • Utvides matchingen til å gjelde 409 også → «409 med samme tekst er en ekte
//     feil» ryker.
//   • Snus ok-sjekken → «et 200-svar er alltid scoret» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySubmitResponse } from './submit-response'

// De fem 403-ene submit-ruten faktisk kan svare med, ordrett fra route.ts.
const OTHER_403S = [
  'Ugyldig eller manglende attempt-token',
  'Forsøk hører ikke til denne quizen',
  'Ingen tilgang til dette forsøket',
  'Mangler autentisering',
  'Innsendingen kom for raskt',
]

test('happy path: 200 er scoret', () => {
  const v = classifySubmitResponse({ status: 200, ok: true, hasTimedOutOnce: false })
  assert.equal(v.kind, 'scored')
})

test('et 200-svar er alltid scoret, også når vi har timet ut før', () => {
  // Retryen kan rekke fram FØR det første kallet ble ferdig behandlet. Da
  // svarer ruten 200 (race-grenen, med alreadySubmitted) og alt er normalt.
  const v = classifySubmitResponse({ status: 200, ok: true, hasTimedOutOnce: true })
  assert.equal(v.kind, 'scored')
})

test('HELE KJEDEN: timeout → retry → 403 «allerede levert» er en bekreftelse, ikke en feil', () => {
  // Steg 1: første forsøk timer ut. Klienten setter flagget og viser kortet.
  let hasTimedOutOnce = false
  const onTimeout = () => { hasTimedOutOnce = true }
  onTimeout()
  assert.equal(hasTimedOutOnce, true, 'forutsetning: timeouten skal ha satt flagget')

  // Steg 2: spilleren trykker «Prøv igjen». Serveren hadde allerede lagret.
  const v = classifySubmitResponse({
    status: 403,
    ok: false,
    errorMessage: 'Forsøket er allerede levert',
    hasTimedOutOnce,
  })

  // Steg 3: dette MÅ klassifiseres som lagret — ikke som feil. Det er dette som
  // avgjør at spilleren slipper den falske teksten OG får extras-blokken
  // (topp-3 + plassering) kjørt i stedet for at try-blokken avbrytes.
  assert.equal(v.kind, 'already-stored')
  assert.notEqual(v.kind, 'error',
    'går denne feilveien, får spilleren «vi fikk ikke bekreftet» om et lagret resultat')
})

test('uten forutgående timeout er samme 403 fortsatt en feil', () => {
  // På et første, ordinært forsøk betyr «allerede levert» noe annet — replay,
  // eller et forsøk levert fra en annen flate. Det skal ikke godtas stille.
  const v = classifySubmitResponse({
    status: 403,
    ok: false,
    errorMessage: 'Forsøket er allerede levert',
    hasTimedOutOnce: false,
  })
  assert.equal(v.kind, 'error')
})

test('de fire andre 403-ene forblir feil, også etter en timeout', () => {
  for (const msg of OTHER_403S) {
    const v = classifySubmitResponse({
      status: 403, ok: false, errorMessage: msg, hasTimedOutOnce: true,
    })
    assert.equal(v.kind, 'error', `«${msg}» ble feilaktig tolket som lagret`)
  }
})

test('403 uten lesbar kropp er en feil — vi gjetter ikke', () => {
  for (const errorMessage of [null, undefined, '']) {
    const v = classifySubmitResponse({ status: 403, ok: false, errorMessage, hasTimedOutOnce: true })
    assert.equal(v.kind, 'error', `errorMessage=${JSON.stringify(errorMessage)} ble godtatt som lagret`)
  }
})

test('409 med samme tekst er en ekte feil — attempts-raden fantes ikke', () => {
  // Rutens 409-gren betyr at raden ikke lot seg lese tilbake etter racet. Der
  // er noe faktisk galt, og det skal ikke skjules bak en resultatskjerm.
  const v = classifySubmitResponse({
    status: 409, ok: false, errorMessage: 'Forsøket er allerede levert', hasTimedOutOnce: true,
  })
  assert.equal(v.kind, 'error')
})

test('serverfeil og rate-limit går feilveien uansett flaggets tilstand', () => {
  for (const status of [429, 500, 502]) {
    for (const hasTimedOutOnce of [true, false]) {
      const v = classifySubmitResponse({ status, ok: false, errorMessage: 'noe galt', hasTimedOutOnce })
      assert.equal(v.kind, 'error', `status ${status} (timeout=${hasTimedOutOnce}) ble ikke feil`)
    }
  }
})
