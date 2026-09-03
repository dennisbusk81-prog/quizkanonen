// Kjøres med:  npm test
//
// STRUKTURELL SPERRE over components/AuthForm.tsx — det DELTE innloggings-
// skjemaet for både /login og AuthModal i toppnavigasjonen.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/authmodal-portal.test.ts og lib/sitenav-error-states.test.ts — npm test
// kjører kun lib/**/*.test.ts under Node sin egen runner, uten jsdom. De rene
// beslutningene testes for OPPFØRSEL i lib/auth-messages.test.ts; denne fila
// holder KOBLINGEN som gjør dem virksomme. Uten den kan hele
// isRateLimitedAuthError-grenen fjernes fra handleLogin uten at én test blir
// rød — akkurat det ærlige hullet CLAUDE.md beskriver for
// middleware-cookie-guard.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • rate-limit-sjekken flyttes UNDER diagnoseLoginFailure() → «rate-limit
//     sjekkes før diagnosen» ryker.
//   • rate-limit-grenen fjernes fra handleLogin → «handleLogin har en
//     rate-limit-gren» ryker.
//   • 429-sjekken i diagnoseLoginFailure flyttes under `!res.ok` → «429
//     sjekkes før den generiske !res.ok-grenen» ryker (den er uoppnåelig der:
//     !res.ok er sann for 429).
//   • supabase.auth.resend-kallet fjernes → «resend-kallet finnes» ryker.
//   • setResendCooldown(true) flyttes etter await → «cooldown settes før
//     kallet» ryker.
//   • cooldownen kobles fra knappen → «knappen deaktiveres av cooldownen» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Kilden uten kommentarer. Blokkommentarer fjernes først; linjekommentarer kun
 * når linja BEGYNNER med `//`, slik at `//` inne i en streng ikke spiser resten
 * av linja. Samme form som lib/authmodal-portal.test.ts.
 *
 * Helt nødvendig her: kildekommentarene i AuthForm.tsx nevner «429»,
 * «Glemt passord?», «diagnoseLoginFailure» og «resend» i prosa, flere ganger.
 * Uten strippingen ville halvparten av testene under blitt grønne av
 * kommentartekst — grønn av feil grunn.
 */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const FIL = 'components/AuthForm.tsx'
const src = renKode(readFileSync(FIL, 'utf8'))

/** Utsnitt av en funksjonskropp, slik at rekkefølgetester ikke måler på tvers av fila. */
function kropp(startAnker: string, sluttAnker: string): string {
  const start = src.indexOf(startAnker)
  assert.notEqual(start, -1, `fant ikke startankeret «${startAnker}» i ${FIL}`)
  const slutt = src.indexOf(sluttAnker, start)
  assert.notEqual(slutt, -1, `fant ikke sluttankeret «${sluttAnker}» etter «${startAnker}»`)
  return src.slice(start, slutt)
}

// ── ENDRING 1: rate-limit meldes ikke lenger som feil passord ───────────────

const handleLogin = kropp('const handleLogin = async ()', 'const resendAction')

test('handleLogin har en rate-limit-gren', () => {
  assert.match(handleLogin, /isRateLimitedAuthError\(error\)/)
  assert.match(handleLogin, /LOGIN_RATE_LIMIT_TEXT/)
})

test('rate-limit sjekkes FØR diagnosen — ellers er grenen uvirksom', () => {
  // diagnoseLoginFailure() antar at feilen handler om legitimasjon og faller
  // til «Feil passord. Bruk «Glemt passord?»…». Kommer rate-limit-sjekken
  // etter den, er den død kode og brukeren dyttes fortsatt mot en e-post fra
  // en kvote som nettopp tok slutt.
  const rl = handleLogin.indexOf('isRateLimitedAuthError')
  const diag = handleLogin.indexOf('diagnoseLoginFailure()')
  assert.notEqual(rl, -1, 'rate-limit-sjekken mangler i handleLogin')
  assert.notEqual(diag, -1, 'diagnoseLoginFailure-kallet mangler i handleLogin')
  assert.ok(rl < diag, 'rate-limit sjekkes etter diagnosen — grenen er uvirksom')
})

test('«ikke bekreftet» sjekkes også før diagnosen, og via den delte funksjonen', () => {
  const ikkeBekreftet = handleLogin.indexOf('isEmailNotConfirmedError')
  const diag = handleLogin.indexOf('diagnoseLoginFailure()')
  assert.notEqual(ikkeBekreftet, -1, 'not-confirmed-sjekken mangler i handleLogin')
  assert.ok(ikkeBekreftet < diag, 'not-confirmed sjekkes etter diagnosen')
})

const diagnose = kropp('const diagnoseLoginFailure = async ()', 'const handleLogin')

test('diagnoseLoginFailure skiller check-email sin egen 429 fra en legitimasjonsfeil', () => {
  assert.match(diagnose, /res\.status === 429/)
  assert.match(diagnose, /LOOKUP_RATE_LIMIT_TEXT/)
})

test('429 sjekkes FØR den generiske !res.ok-grenen', () => {
  // !res.ok er sann for 429. Står 429-sjekken etter, nås den aldri, og
  // brukeren får «Feil e-post eller passord.» av vår EGEN throttle.
  const status429 = diagnose.indexOf('res.status === 429')
  const resOk = diagnose.indexOf('!res.ok')
  assert.notEqual(status429, -1, '429-sjekken mangler i diagnoseLoginFailure')
  assert.notEqual(resOk, -1, '!res.ok-grenen mangler i diagnoseLoginFailure')
  assert.ok(status429 < resOk, '429 sjekkes etter !res.ok — grenen er uoppnåelig')
})

test('den gamle teksten som pekte mot «Glemt passord?» står kun igjen på ekte feil passord', () => {
  // Teksten er riktig der den fortsatt står (konto finnes, har passord, passord
  // avvist). Den skal bare ikke lenger kunne nås av en 429.
  const treff = src.match(/Bruk «Glemt passord\?» under feltet/g) ?? []
  assert.equal(treff.length, 1, 'teksten skal finnes nøyaktig ett sted')
  assert.ok(diagnose.includes('Bruk «Glemt passord?» under feltet'),
    'teksten skal ligge i diagnoseLoginFailure, etter at kontoen er slått opp')
})

// ── ENDRING 2 Del A: vei ut av en ubekreftet konto ──────────────────────────

const resend = kropp('async function handleResendConfirmation()', 'const handleSignup')

test('resend-kallet finnes, og ber om signup-typen', () => {
  assert.match(resend, /supabase\.auth\.resend\(/)
  assert.match(resend, /type:\s*'signup'/)
})

test('resend sender brukeren til callback-URL-en, ikke til roten', () => {
  assert.match(resend, /emailRedirectTo:\s*callbackUrl\(\)/)
})

test('resend-feil bruker den DELTE tekstfamilien, ikke en fjerde variant', () => {
  assert.match(resend, /sendLinkErrorMessage\(error\)/)
})

test('cooldown settes FØR kallet — det er mens det pågår andretrykket kommer', () => {
  const cooldown = resend.indexOf('setResendCooldown(true)')
  const kall = resend.indexOf('await supabase.auth.resend')
  assert.notEqual(cooldown, -1, 'cooldownen settes ikke i handleResendConfirmation')
  assert.notEqual(kall, -1, 'resend-kallet mangler')
  assert.ok(cooldown < kall, 'cooldownen settes etter kallet — knappen kan hamres imens')
})

test('en pågående cooldown avviser nye forsøk tidlig', () => {
  assert.match(resend, /if \(resendCooldown\) return/)
})

test('timeren ryddes ved avmontering', () => {
  // Modalen lukkes typisk lenge før 60 sekunder er gått.
  assert.match(src, /clearTimeout\(resendTimer\.current\)/)
  assert.match(src, /useEffect\(\(\) => \(\) => \{/)
})

test('knappen deaktiveres av cooldownen — og kun resend-knappen', () => {
  // «Sett et passord» sender en annen e-posttype fra en annen bøtte hos
  // Supabase, og skal ikke låses av at bekreftelseslenken nettopp ble sendt.
  assert.match(src, /notice\.action\.id === 'resend' && resendCooldown/)
  assert.match(src, /disabled=\{loading \|\| \(notice\.action\.id === 'resend' && resendCooldown\)\}/)
})

test('«ikke bekreftet»-tilstanden tilbyr faktisk knappen', () => {
  // Uten koblingen her er resend-funksjonen død kode, og blindveien består:
  // signup sier «allerede registrert», innlogging sier «ikke bekreftet», og
  // lenken det vises til finnes ikke.
  const grenen = kropp('E-posten er ikke bekreftet ennå', '} else {')
  assert.match(grenen, /action:\s*resendAction\(\)/)
})

// ── ENDRING 2 Del B: signup-grenen skiller feiltyper ────────────────────────

const signup = kropp('const handleSignup = async ()', 'async function handleSetPassword')

test('signup-feil klassifiseres i stedet for å få én tekst for alt', () => {
  assert.match(signup, /classifySignupFailure\(error\)/)
})

test('den gamle enetekst-grenen er borte', () => {
  assert.ok(!src.includes('Kunne ikke opprette konto. Prøv igjen.'),
    'den gamle samle-teksten står fortsatt igjen')
})

test('et race mot pre-signup-sperren sender brukeren til innlogging', () => {
  assert.match(signup, /failure\.kind === 'already-registered'/)
  assert.match(signup, /setMode\('login'\)/)
})

test('«allerede registrert» finnes som ÉN konstant, ikke to strenger', () => {
  const treff = src.match(/ALREADY_REGISTERED_TEXT/g) ?? []
  assert.ok(treff.length >= 2, 'konstanten brukes ikke begge steder')
  assert.ok(!src.includes("'Denne e-posten er allerede registrert."),
    'teksten står fortsatt hardkodet i AuthForm i stedet for å komme fra konstanten')
})
