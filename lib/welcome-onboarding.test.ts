// Kjøres med:  npm test
//
// Beslutningene bak /velkommen. Alt her ligger MIDT I REGISTRERINGSSTIEN, så
// testene er skrevet rundt de tre måtene endringen kan gjøre skade på:
//
//   1. Bryteren av skal gi BIT-IDENTISK oppførsel med før siden fantes.
//   2. En bruker som er midt i en invitasjonsflyt skal aldri kapres hit.
//   3. En bruker skal aldri bli stående fast på siden.
//
// MUTASJONSBEVIS — kjørt 6. august 2026, tallene er MÅLT, ikke anslått
// (26 tester i baseline, alle grønne):
//
//   a) `if (!enabled) return false` fjernet fra shouldShowWelcome
//      → 3 faller, alle tre i «bryteren av»-blokken.
//   b) `return next === '/'` byttet til `return true`
//      → 5 faller, alle i «next-vernet»-blokken (org, liga, sett-passord,
//        founders, quiz-lenke).
//   c) `if (!isNewUser) return false` fjernet
//      → 2 faller: «eksisterende bruker ser ALDRI velkomstsiden» og
//        «kun én gang i praksis».
//   d) `if (!loaded.ok) return false` fjernet fra shouldAskForName
//      → 1 faller: «feilet henting skjuler feltet». Kun én test dekker den
//        grenen, og det er nok — de andre navnetestene verner den IKKE.
//   e) `attempt <= 1` byttet til `attempt <= 2` i decideNavigation
//      → 1 faller: «andre trykk navigerer ALLTID».
//   f) allowlisten i welcomeOnboardingEnabled byttet til `return true`
//      → 1 faller: «bryteren er AV ved en skrivefeil». At undefined/null/''
//        fortsatt gir false skyldes den tidligere `if (!raw)`-returen, ikke
//        allowlisten — de to grenene vernes altså hver for seg.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WELCOME_PATH,
  classifyNameSave,
  decideNavigation,
  greetingName,
  isValidDisplayName,
  postLoginPath,
  shouldAskForName,
  shouldShowWelcome,
  welcomeExitPath,
  welcomeOnboardingEnabled,
} from './welcome-onboarding'

// ── Bryteren: uten variabelen skjer INGENTING ────────────────────────────────
//
// Dette er den viktigste blokken i filen. Registreringsstien er kritisk, og
// hele begrunnelsen for bryteren er at fraværet av den skal gi nøyaktig dagens
// oppførsel — ikke «nesten».

test('bryteren er AV når variabelen mangler helt', () => {
  assert.equal(welcomeOnboardingEnabled(undefined), false)
  assert.equal(welcomeOnboardingEnabled(null), false)
  assert.equal(welcomeOnboardingEnabled(''), false)
})

test('bryteren er AV ved en skrivefeil — feilretningen er med vilje', () => {
  // En typo i Vercel skal gjøre funksjonen inert, ikke aktiv.
  assert.equal(welcomeOnboardingEnabled('ja'), false)
  assert.equal(welcomeOnboardingEnabled('enabled'), false)
  assert.equal(welcomeOnboardingEnabled('0'), false)
  assert.equal(welcomeOnboardingEnabled('false'), false)
})

test('bryteren er PÅ for de fire aksepterte verdiene, uansett skrivemåte', () => {
  for (const v of ['1', 'true', 'on', 'yes', 'TRUE', ' Yes ', 'On']) {
    assert.equal(welcomeOnboardingEnabled(v), true, `«${v}» skulle slått den på`)
  }
})

test('bryter AV: en ny bruker sendes IKKE til velkomstsiden', () => {
  assert.equal(shouldShowWelcome({ isNewUser: true, next: '/', enabled: false }), false)
})

test('bryter AV: redirect-målet er `next`, uendret — dette ER kontrakten', () => {
  // Samme påstand som ruten hviler på: uten bryteren rører den ikke
  // location-headeren i det hele tatt, fordi target === next.
  assert.equal(postLoginPath({ isNewUser: true, next: '/', enabled: false }), '/')
  assert.equal(postLoginPath({ isNewUser: true, next: '/bli-med/abc', enabled: false }), '/bli-med/abc')
  assert.equal(postLoginPath({ isNewUser: false, next: '/', enabled: false }), '/')
})

test('bryter AV slår ut selv når alt annet peker mot velkomstsiden', () => {
  assert.notEqual(postLoginPath({ isNewUser: true, next: '/', enabled: false }), WELCOME_PATH)
})

// ── next-vernet: invitasjonsflyter skal aldri kapres ─────────────────────────

test('next !== "/" sendes ALDRI til velkomstsiden — org-invitasjon', () => {
  assert.equal(postLoginPath({ isNewUser: true, next: '/bli-med/tok3n', enabled: true }), '/bli-med/tok3n')
})

test('next !== "/" sendes ALDRI til velkomstsiden — liga-invitasjon', () => {
  assert.equal(
    postLoginPath({ isNewUser: true, next: '/liga/bli-med/tok3n', enabled: true }),
    '/liga/bli-med/tok3n',
  )
})

test('next !== "/" sendes ALDRI til velkomstsiden — /sett-passord', () => {
  // Recovery-lenken har hardkodet dette målet. En velkomstside foran den ville
  // etterlatt brukeren uten passordet hen kom for å sette.
  assert.equal(postLoginPath({ isNewUser: true, next: '/sett-passord', enabled: true }), '/sett-passord')
})

test('next !== "/" sendes ALDRI til velkomstsiden — founders-checkout', () => {
  assert.equal(postLoginPath({ isNewUser: true, next: '/founders', enabled: true }), '/founders')
})

test('selv en dyp quiz-lenke beholdes', () => {
  assert.equal(shouldShowWelcome({ isNewUser: true, next: '/quiz/abc-123', enabled: true }), false)
})

// ── Eksisterende brukere ─────────────────────────────────────────────────────

test('en eksisterende bruker ser ALDRI velkomstsiden', () => {
  assert.equal(shouldShowWelcome({ isNewUser: false, next: '/', enabled: true }), false)
  assert.equal(postLoginPath({ isNewUser: false, next: '/', enabled: true }), '/')
})

test('en eksisterende bruker med next beholder next', () => {
  assert.equal(postLoginPath({ isNewUser: false, next: '/toppliste', enabled: true }), '/toppliste')
})

test('«kun én gang» i praksis: andre innlogging er ikke lenger ny', () => {
  // ensureProfileForUser returnerer isNewUser=true kun på INSERT-grenen, som
  // nås én gang per konto. Neste innlogging treffer UPDATE-grenen.
  const first = postLoginPath({ isNewUser: true, next: '/', enabled: true })
  const second = postLoginPath({ isNewUser: false, next: '/', enabled: true })
  assert.equal(first, WELCOME_PATH)
  assert.equal(second, '/')
})

// ── Det ene tilfellet som SKAL treffe ────────────────────────────────────────

test('ny bruker + bryter på + next "/" → velkomstsiden', () => {
  assert.equal(shouldShowWelcome({ isNewUser: true, next: '/', enabled: true }), true)
  assert.equal(postLoginPath({ isNewUser: true, next: '/', enabled: true }), WELCOME_PATH)
})

// ── Navnefeltet ──────────────────────────────────────────────────────────────

test('feltet skjules når brukeren allerede har et gyldig navn', () => {
  assert.equal(shouldAskForName({ ok: true, value: 'Ola Nordmann' }), false)
  assert.equal(shouldAskForName({ ok: true, value: 'Anne-Marie' }), false)
})

test('feltet vises når navnet mangler eller er ubrukelig', () => {
  assert.equal(shouldAskForName({ ok: true, value: null }), true)
  assert.equal(shouldAskForName({ ok: true, value: '' }), true)
  assert.equal(shouldAskForName({ ok: true, value: '   ' }), true)
  // Ett ord er ikke et fullt navn — /api/profile/upsert avviser det med 400.
  assert.equal(shouldAskForName({ ok: true, value: 'Ola' }), true)
})

test('feilet henting skjuler feltet — «vet ikke» er ikke «mangler navn»', () => {
  // Å vise feltet her ville bedt en Google-bruker som HAR navn om å skrive det
  // på nytt. NameRequiredModal fanger opp den som faktisk mangler navn.
  assert.equal(shouldAskForName({ ok: false }), false)
})

test('navneregelen er den samme som upsert-ruten håndhever', () => {
  assert.equal(isValidDisplayName('Ola Nordmann'), true)
  assert.equal(isValidDisplayName("O'Brien Hansen"), true)
  assert.equal(isValidDisplayName('Anne-Marie'), true)
  assert.equal(isValidDisplayName('Ola'), false)       // mangler etternavn
  assert.equal(isValidDisplayName('O K'), true)        // 3 tegn, har mellomrom
  assert.equal(isValidDisplayName('Ola Nordmann 2'), false) // siffer
  assert.equal(isValidDisplayName('Ola N.'), false)    // punktum
  assert.equal(isValidDisplayName(null), false)
  assert.equal(isValidDisplayName(undefined), false)
})

test('hilsenen bruker fornavnet, og står uten navn når vi ikke har et', () => {
  assert.equal(greetingName('Ola Nordmann'), 'Ola')
  assert.equal(greetingName('  Kari Ann Berg  '), 'Kari')
  assert.equal(greetingName('Ola'), null)
  assert.equal(greetingName(null), null)
})

// ── Utgangen ─────────────────────────────────────────────────────────────────

test('åpen quiz → quizen, ingen åpen quiz → forsiden', () => {
  assert.equal(welcomeExitPath('abc-123'), '/quiz/abc-123')
  assert.equal(welcomeExitPath(null), '/')
})

// ── Feilhåndtering: brukeren blir aldri stående fast ─────────────────────────

test('avvisninger brukeren kan RETTE klassifiseres som rettbare', () => {
  assert.equal(classifyNameSave(409), 'correctable') // navnet er opptatt
  assert.equal(classifyNameSave(400), 'correctable') // mangler etternavn
  assert.equal(classifyNameSave(422), 'correctable') // for kort / ugyldige tegn
})

test('våre egne feil er ALDRI brukerens problem', () => {
  assert.equal(classifyNameSave(401), 'failed')
  assert.equal(classifyNameSave(429), 'failed')
  assert.equal(classifyNameSave(500), 'failed')
  assert.equal(classifyNameSave(0), 'failed')
})

test('en rettbar avvisning holder brukeren igjen ÉN gang', () => {
  assert.equal(decideNavigation({ nameOutcome: 'correctable', attempt: 1 }), 'stay')
})

test('andre trykk navigerer ALLTID — dette er invarianten mot å stå fast', () => {
  assert.equal(decideNavigation({ nameOutcome: 'correctable', attempt: 2 }), 'navigate')
  assert.equal(decideNavigation({ nameOutcome: 'correctable', attempt: 9 }), 'navigate')
})

test('en feilet skriving blokkerer aldri navigasjonen', () => {
  // Kjernen i bestillingen: det er verre å sperre en ny bruker ute fra quizen
  // enn å miste et varselvalg hen kan sette på profilen når som helst.
  assert.equal(decideNavigation({ nameOutcome: 'failed', attempt: 1 }), 'navigate')
  assert.equal(decideNavigation({ nameOutcome: 'ok', attempt: 1 }), 'navigate')
  assert.equal(decideNavigation({ nameOutcome: 'skipped', attempt: 1 }), 'navigate')
})
