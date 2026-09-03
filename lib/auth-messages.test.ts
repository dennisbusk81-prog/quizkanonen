// Kjøres med:  npm test
//
// lib/auth-messages.ts var HELT utestet fram til 3. september 2026, samtidig som
// den eier hver eneste setning en bruker får se når innlogging eller
// registrering feiler. Denne fila dekker de rene beslutningene; koblingen inn i
// components/AuthForm.tsx dekkes strukturelt av
// lib/authform-rate-limit-og-resend.test.ts.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// Ved 429 fra Supabase sin sign-in-grense (100 per 5 min per IP) meldte
// AuthForm «Feil passord. Bruk «Glemt passord?» under feltet hvis du trenger et
// nytt.» Begge halvdelene er gale: vi kom aldri så langt som til å sjekke
// passordet, og «Glemt passord?» sender en e-post fra nøyaktig den kvoten som
// nettopp tok slutt. Rådet forsterker altså problemet det gir råd om — en
// selvforsterkende sløyfe under en lanseringsspiss.
//
// RETNINGSVALGET som testene låser: ved TVIL meldes rate-limit, ikke feil
// passord. Kostnaden er asymmetrisk. «Rate-limit» om et feil passord koster ett
// minutts venting, og retter seg selv ved neste forsøk. «Feil passord» om en
// rate-limit koster en e-post fra en presset kvote, og retter seg IKKE selv:
// den e-posten uteblir også.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRateLimitedAuthError,
  isEmailNotConfirmedError,
  sendLinkErrorMessage,
  classifySignupFailure,
  RATE_LIMIT_WAIT_TEXT,
  LOGIN_RATE_LIMIT_TEXT,
  LOOKUP_RATE_LIMIT_TEXT,
  ALREADY_REGISTERED_TEXT,
} from './auth-messages'

// ── isRateLimitedAuthError — tre signaler, hvert enkelt nok ─────────────────

test('status 429 alene er nok — det ryddige tilfellet', () => {
  assert.equal(isRateLimitedAuthError({ status: 429, message: 'Too Many Requests' }), true)
})

test('koden alene er nok når status mangler', () => {
  // AuthError.code er satt på HTTP-baserte feil, men status kan mangle på feil
  // som oppstår før svaret er lest.
  assert.equal(isRateLimitedAuthError({ code: 'over_request_rate_limit' }), true)
  assert.equal(isRateLimitedAuthError({ code: 'over_email_send_rate_limit' }), true)
  assert.equal(isRateLimitedAuthError({ code: 'over_sms_send_rate_limit' }), true)
})

test('60-sekunders-sperren fanges på TEKST — den kommer med status 400 og uten kode', () => {
  // Dette er hele grunnen til at tekstmatchen ikke kan fjernes som overflødig.
  const err = {
    status: 400,
    message: 'For security purposes, you can only request this after 47 seconds.',
  }
  assert.equal(isRateLimitedAuthError(err), true)
})

test('«rate limit» i teksten fanges uansett status', () => {
  assert.equal(isRateLimitedAuthError({ status: 400, message: 'Request rate limit reached' }), true)
})

test('en ekte legitimasjonsfeil er IKKE rate-limit', () => {
  // Den viktigste negative: 400 invalid_credentials skal fortsatt gå til
  // diagnosen, ellers ville hver eneste tastefeil blitt meldt som «vent et
  // minutt» og retningsvalget vårt hadde blitt en generell regel i stedet for
  // et unntak.
  const err = { status: 400, message: 'Invalid login credentials', code: 'invalid_credentials' }
  assert.equal(isRateLimitedAuthError(err), false)
})

test('tomt feilobjekt er ikke rate-limit', () => {
  assert.equal(isRateLimitedAuthError({}), false)
})

// ── isEmailNotConfirmedError ────────────────────────────────────────────────

test('ubekreftet e-post fanges både på kode og på tekst', () => {
  assert.equal(isEmailNotConfirmedError({ code: 'email_not_confirmed' }), true)
  assert.equal(isEmailNotConfirmedError({ message: 'Email not confirmed' }), true)
})

test('koden alene holder om GoTrue endrer ordlyden', () => {
  // Bommer denne, forsvinner «send lenken på nytt»-knappen — altså nøyaktig den
  // blindveien knappen finnes for.
  assert.equal(isEmailNotConfirmedError({ code: 'email_not_confirmed', message: 'noe helt annet' }), true)
})

test('feil passord er ikke ubekreftet e-post', () => {
  assert.equal(isEmailNotConfirmedError({ message: 'Invalid login credentials' }), false)
})

// ── sendLinkErrorMessage ────────────────────────────────────────────────────

test('sendLinkErrorMessage gir vente-teksten på rate-limit', () => {
  assert.equal(sendLinkErrorMessage({ status: 429 }), RATE_LIMIT_WAIT_TEXT)
})

test('sendLinkErrorMessage leser nå også code — regresjonen utvidelsen lukket', () => {
  // Før 3. september leste funksjonen kun message og status. En 429 som kom med
  // kode, men uten status, falt til «Kunne ikke sende lenken akkurat nå».
  assert.equal(sendLinkErrorMessage({ code: 'over_email_send_rate_limit' }), RATE_LIMIT_WAIT_TEXT)
})

test('sendLinkErrorMessage gir den generiske teksten på alt annet', () => {
  assert.equal(
    sendLinkErrorMessage({ status: 500, message: 'boom' }),
    'Kunne ikke sende lenken akkurat nå. Prøv igjen om litt.'
  )
})

// ── classifySignupFailure ───────────────────────────────────────────────────

test('signup-kvotefeil DELEGERER til sendLinkErrorMessage — én vente-tekst, ikke to', () => {
  const f = classifySignupFailure({ status: 429 })
  assert.equal(f.kind, 'rate-limited')
  assert.equal(f.text, RATE_LIMIT_WAIT_TEXT)
})

test('60 s cooldown ved signup blir vente-tekst, ikke «prøv igjen»', () => {
  const f = classifySignupFailure({
    status: 400,
    message: 'For security purposes, you can only request this after 51 seconds.',
  })
  assert.equal(f.kind, 'rate-limited')
})

test('for svakt passord får en KONKRET beskjed, ikke lenke-teksten', () => {
  // Grunnen til at grenen ikke bare er sendLinkErrorMessage(err): den ville
  // gjort dette om til «Kunne ikke sende lenken akkurat nå», altså byttet en
  // unyttig tekst mot en direkte villedende.
  const f = classifySignupFailure({ status: 422, code: 'weak_password', message: 'Password is too short' })
  assert.equal(f.kind, 'weak-password')
  // 8, ikke 6: tallet skal følge VÅR policy (AuthForm og profil-siden krever 8
  // fem steder), ikke Supabase sin egen grense på 6. Meldingen vises i vårt
  // skjema, rett ved siden av vårt eget hint «Minst 8 tegn» — to ulike tall på
  // samme skjerm er verre enn ett tall som er strengere enn GoTrue krever.
  assert.match(f.text, /minst 8 tegn/)
  assert.ok(!f.text.includes('lenken'), 'passordfeil skal ikke snakke om lenker')
})

test('for svakt passord fanges også på GoTrue sin ordlyd uten kode', () => {
  const f = classifySignupFailure({ status: 422, message: 'Password should be at least 6 characters' })
  assert.equal(f.kind, 'weak-password')
})

test('allerede registrert gjenbruker ÉN tekst med pre-signup-sperren', () => {
  const f = classifySignupFailure({ status: 422, code: 'user_already_exists' })
  assert.equal(f.kind, 'already-registered')
  assert.equal(f.text, ALREADY_REGISTERED_TEXT)
})

test('ukjent signup-feil ber om å vente, ikke om å prøve igjen med en gang', () => {
  const f = classifySignupFailure({ status: 500, message: 'upstream exploded' })
  assert.equal(f.kind, 'unknown')
  assert.match(f.text, /Prøv igjen om litt/)
})

// ── Invarianten Dennis faktisk bestilte ─────────────────────────────────────

test('INGEN rate-limit-tekst peker mot «Glemt passord?»', () => {
  // Selve poenget med endringen. Peker en av dem dit, er den selvforsterkende
  // sløyfen tilbake: knappen sender en e-post fra kvoten som nettopp tok slutt.
  for (const [navn, tekst] of [
    ['LOGIN_RATE_LIMIT_TEXT', LOGIN_RATE_LIMIT_TEXT],
    ['LOOKUP_RATE_LIMIT_TEXT', LOOKUP_RATE_LIMIT_TEXT],
    ['RATE_LIMIT_WAIT_TEXT', RATE_LIMIT_WAIT_TEXT],
  ] as const) {
    assert.ok(!/glemt passord/i.test(tekst), `${navn} peker mot «Glemt passord?»`)
  }
})

test('LOGIN_RATE_LIMIT_TEXT påstår ingenting om passordet', () => {
  // Ved 429 kom vi aldri så langt som til å sjekke det. En setning om at
  // passordet «sannsynligvis er i orden» ville sendt brukeren tilbake om ett
  // minutt med falsk trygghet.
  assert.ok(!/passordet/i.test(LOGIN_RATE_LIMIT_TEXT), 'teksten uttaler seg om passordet')
  assert.match(LOGIN_RATE_LIMIT_TEXT, /Vent et minutt/)
})

test('LOOKUP_RATE_LIMIT_TEXT er ærlig om BEGGE halvdelene', () => {
  // Passordet ble avvist av GoTrue (det vet vi), OG vi fikk ikke slått opp
  // hvorfor (det vet vi også). Utelates den andre halvdelen, står brukeren
  // igjen med «Feil e-post eller passord.» som forklaring på noe annet.
  assert.match(LOOKUP_RATE_LIMIT_TEXT, /ikke godtatt/)
  assert.match(LOOKUP_RATE_LIMIT_TEXT, /kunne ikke sjekke/)
})
