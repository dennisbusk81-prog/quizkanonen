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
//
// ── 401 «sesjonen er borte» (lagt til 24. august 2026, [AU-2]) ────────────────
// Andre halvdel av samme klasse: submit svarte 403 «Ingen tilgang til dette
// forsøket» BÅDE når spilleren ikke eide forsøket OG når sesjonen hennes var
// død server-side. De to krever motsatt handling — «logg inn igjen» mot «dette
// er ikke ditt» — og sammenslåingen kostet en spiller hele quizen.
//
// MUTASJONSBEVIS for skillet:
//   • Slås 401 og 403 sammen igjen (matching på status alene, eller på
//     `needsLogin` alene) → «eierskaps-403 er aldri en innloggingsoppfordring»
//     og «needsLogin på en 403 endrer ingenting» ryker.
//   • Flyttes 401-grenen ned UNDER hasTimedOutOnce-porten → «gjelder også det
//     FØRSTE forsøket» ryker (og det er nettopp den vanlige veien: en død
//     sesjon rammer første innsending, ikke en retry).
//   • Droppes kravet om `needsLogin`-flagget → «401 uten flagg er en feil» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifySubmitResponse, ALREADY_SUBMITTED_ERROR, SESSION_EXPIRED_ERROR } from './submit-response'

// Testene bruker KONSTANTEN, ikke en ordrett kopi av teksten. Det er poenget
// med å dele den: endres ordlyden ett sted, følger server, klient og tester
// med. Det som IKKE får endre seg i stillhet, er at ruten faktisk bruker
// konstanten — det låses av den siste testen i denne filen.

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
    errorMessage: ALREADY_SUBMITTED_ERROR,
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
    errorMessage: ALREADY_SUBMITTED_ERROR,
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
    status: 409, ok: false, errorMessage: ALREADY_SUBMITTED_ERROR, hasTimedOutOnce: true,
  })
  assert.equal(v.kind, 'error')
})

test('503 er retryable — uavhengig av om vi har timet ut før', () => {
  // Submit-rutens fem 503-er er alle «prøv igjen om et øyeblikk». De skal til
  // timeout-veiens retry-skjerm, ikke feilveien med «vi fikk ikke bekreftet».
  // MUTASJONSBEVIS: gjeninnføres hasTimedOutOnce-avhengighet for 503 →
  // false-varianten ryker; fjernes 503-grenen helt → begge ryker.
  for (const hasTimedOutOnce of [false, true]) {
    const v = classifySubmitResponse({
      status: 503, ok: false,
      errorMessage: 'Kunne ikke hente forsøket. Prøv igjen om et øyeblikk.',
      hasTimedOutOnce,
    })
    assert.equal(v.kind, 'retryable', `503 (timeout=${hasTimedOutOnce}) gikk ikke retry-veien`)
  }
})

test('503 er retryable også uten lesbar kropp — statusen alene er nok', () => {
  const v = classifySubmitResponse({ status: 503, ok: false, errorMessage: null, hasTimedOutOnce: false })
  assert.equal(v.kind, 'retryable')
})

test('serverfeil og rate-limit går feilveien uansett flaggets tilstand', () => {
  for (const status of [429, 500, 502]) {
    for (const hasTimedOutOnce of [true, false]) {
      const v = classifySubmitResponse({ status, ok: false, errorMessage: 'noe galt', hasTimedOutOnce })
      assert.equal(v.kind, 'error', `status ${status} (timeout=${hasTimedOutOnce}) ble ikke feil`)
    }
  }
})

// ── Sesjonen er borte: 401 ≠ 403 ─────────────────────────────────────────────

test('401 med needsLogin er «logg inn», ikke en feil — og gjelder også det FØRSTE forsøket', () => {
  // hasTimedOutOnce=false er HOVEDVEIEN her: sesjonen dør mens hun spiller, og
  // den aller første innsendingen avvises. Lå grenen under hasTimedOutOnce-
  // porten, ville nettopp dette tilfellet fått den generiske feilteksten.
  for (const hasTimedOutOnce of [false, true]) {
    const v = classifySubmitResponse({
      status: 401, ok: false, errorMessage: SESSION_EXPIRED_ERROR,
      needsLogin: true, hasTimedOutOnce,
    })
    assert.equal(v.kind, 'needs-login', `401 (timeout=${hasTimedOutOnce}) gikk ikke innloggingsveien`)
  }
})

test('eierskaps-403 er ALDRI en innloggingsoppfordring — skillet holder begge veier', () => {
  // Kjernen i fiksen. En gyldig, innlogget bruker som leverer et forsøk hun
  // ikke eier, skal møte en tilgangsfeil. Ber vi henne logge inn, sender vi
  // henne gjennom en runde som umulig kan hjelpe — og skjuler den ekte grunnen.
  //
  // MUTASJON: bytt 401-grenen til `if (facts.status === 401 || facts.needsLogin)`
  // eller la eierskaps-403 svare 401 i ruten, og denne ryker.
  const v = classifySubmitResponse({
    status: 403, ok: false, errorMessage: 'Ingen tilgang til dette forsøket',
    hasTimedOutOnce: false,
  })
  assert.equal(v.kind, 'error')
  assert.notEqual(v.kind, 'needs-login',
    'eierskapsfeil ble tolket som utløpt sesjon — spilleren sendes til innlogging som ikke løser noe')
})

test('needsLogin-flagget på en 403 endrer ingenting — begge betingelsene kreves', () => {
  // Flagget alene er ikke nok. Ellers ville et framtidig svar som tilfeldigvis
  // bar flagget kunne kapre feilveien.
  for (const msg of OTHER_403S) {
    const v = classifySubmitResponse({
      status: 403, ok: false, errorMessage: msg, needsLogin: true, hasTimedOutOnce: true,
    })
    assert.equal(v.kind, 'error', `403 «${msg}» med needsLogin ble ikke behandlet som feil`)
  }
})

test('401 uten flagg (eller uten lesbar kropp) er en feil — vi lover ikke at innlogging hjelper', () => {
  // Utfallet åpner et innloggingsvindu. Er vi ikke sikre på at det er DET som
  // mangler, skal spilleren få en ærlig feiltekst i stedet for et falskt løfte.
  for (const needsLogin of [undefined, false]) {
    const v = classifySubmitResponse({
      status: 401, ok: false, errorMessage: null, needsLogin, hasTimedOutOnce: true,
    })
    assert.equal(v.kind, 'error', `401 med needsLogin=${String(needsLogin)} ble godtatt som innloggingssak`)
  }
})

test('503 vinner fortsatt over alt — en transient feil skal aldri logge noen ut', () => {
  // Rekkefølgen i klassifisereren: 503 sjekkes FØR 401. Skulle en framtidig
  // 503-respons bære needsLogin, er den fortsatt «prøv igjen om et øyeblikk».
  const v = classifySubmitResponse({
    status: 503, ok: false, errorMessage: null, needsLogin: true, hasTimedOutOnce: false,
  })
  assert.equal(v.kind, 'retryable')
})

test('submit-ruten har NØYAKTIG ett 401, og det bærer needsLogin + konstanten', () => {
  // Klienten krever begge deler (status + flagg) for å åpne innloggingsvinduet.
  // Legges det inn en ny 401 i ruten som betyr noe annet, må dette skillet
  // gjøres om — testen er varselet.
  const route = readFileSync('app/api/quiz/[id]/submit/route.ts', 'utf8')

  const count401 = (route.match(/status:\s*401/g) ?? []).length
  assert.equal(count401, 1,
    `submit-ruten har ${count401} 401-svar, forventet 1. Klienten tolker ETHVERT 401 med needsLogin som «logg inn».`)

  assert.ok(/import \{[^}]*\bSESSION_EXPIRED_ERROR\b[^}]*\} from '@\/lib\/submit-response'/.test(route),
    'ruten importerer ikke SESSION_EXPIRED_ERROR — da er koblingen til klienten kun en tilfeldig lik streng')
  const literalInResponse = new RegExp(`error:\\s*['"\`]${SESSION_EXPIRED_ERROR}['"\`]`)
  assert.ok(!literalInResponse.test(route),
    'ruten har en ordrett kopi av sesjons-teksten — bruk SESSION_EXPIRED_ERROR')
  assert.ok(/error: SESSION_EXPIRED_ERROR, needsLogin: true/.test(route),
    '401-svaret bærer ikke needsLogin: true — klienten vil da klassifisere det som en vanlig feil')

  // Eierskapsfeilen skal fortsatt finnes, og fortsatt som 403.
  const ownership = route.indexOf("error: 'Ingen tilgang til dette forsøket'")
  assert.notEqual(ownership, -1, 'eierskapsfeilen er borte fra ruten')
  assert.ok(/error: 'Ingen tilgang til dette forsøket' \}, \{ status: 403 \}/.test(route),
    'eierskapsfeilen svarer ikke lenger 403 — da er 401/403-skillet slått sammen igjen')
})

// ── Én kilde til sannhet: ruten må BRUKE konstanten, ikke kopiere teksten ─────
// Dette er hele grunnen til at konstanten finnes. Skriver noen teksten ordrett
// i ruten igjen — eller endrer den der uten å vite at klienten leser den —
// klassifiseringen brytes i stillhet, og spilleren får «vi fikk ikke bekreftet»
// om et resultat som ligger trygt lagret. En oppførselstest kan ikke fange det:
// den ville fortsatt vært grønn, fordi begge sider ville sett riktige ut hver
// for seg.
test('submit-ruten bruker konstanten og har ingen ordrett kopi av teksten', () => {
  const route = readFileSync('app/api/quiz/[id]/submit/route.ts', 'utf8')

  // EGENSKAPS-BASERT, IKKE FORM-BASERT (justert 24. august 2026). Her sto en
  // regex mot den EKSAKTE importlinjen med ett symbol. Da ruten fikk sitt andre
  // delte symbol (SESSION_EXPIRED_ERROR), ble testen rød uten at egenskapen den
  // vokter — at teksten kommer fra den delte konstanten — hadde endret seg.
  // Samme lærdom som standings-kallene i lib/finish-quiz-timeout.test.ts.
  assert.ok(/import \{[^}]*\bALREADY_SUBMITTED_ERROR\b[^}]*\} from '@\/lib\/submit-response'/.test(route),
    'submit-ruten importerer ikke ALREADY_SUBMITTED_ERROR — da er koblingen til klienten kun en tilfeldig lik streng')

  // Teksten skal kun forekomme som konstant-referanse, aldri som strengliteral
  // i en respons. Kommentarer er greit; det er `error: '...'` som er farlig.
  const literalInResponse = new RegExp(`error:\\s*['"\`]${ALREADY_SUBMITTED_ERROR}['"\`]`)
  assert.ok(!literalInResponse.test(route),
    'submit-ruten har en ordrett kopi av teksten i en respons — bruk ALREADY_SUBMITTED_ERROR i stedet')

  // Begge stedene som svarer med denne teksten (403-vernet og 409-race-grenen)
  // skal gå via konstanten, ellers kan de drifte fra hverandre.
  const uses = (route.match(/error: ALREADY_SUBMITTED_ERROR/g) ?? []).length
  assert.equal(uses, 2,
    `forventet 2 bruk av konstanten i ruten (403-vernet og 409-grenen), fant ${uses}`)
})
