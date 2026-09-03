// Kjøres med:  npm test
//
// STRUKTURELL SPERRE over UNDERTITTELEN på /login.
//
// BAKGRUNN (3. september 2026, rett etter 2a9f2bc): modalen fikk modus-avhengig
// overskrift og undertekst, men /login beholdt «Bli med i Quizkanonen» og
// «Logg inn eller opprett konto» HELT STILLE mens fire ting under dem skiftet:
// passordhintet, begge knappene, magic link-blokka og vilkårslinja. Skjermen
// rykket fortsatt i stedet for å skifte — bare litt mindre enn før.
//
// ARBEIDSDELINGEN som testene under vokter:
//   • H1 «Bli med i Quizkanonen» er en DESTINASJONSRAMME. Den er sann i begge
//     moduser, nås fra både «Bli med» og «Logg inn», og skal ALDRI få
//     modus-logikk (N9, 17. august 2026).
//   • UNDERTITTELEN er handlingsetiketten. Det er den som følger modusen.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • undertittelen gjøres statisk igjen → «undertittelen følger modusen» ryker.
//   • signup-teksten kommer i utakt med modalens → «de to flatene sier det
//     samme» ryker.
//   • modus-logikk legges på H1-en → «H1-en står urørt» ryker.
//   • marginkompensasjonen fjernes → «tittelen overtar luften» ryker.
//   • onViewChange kobles fra AuthForm på /login → «siden lytter på signalet»
//     ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Kilden uten kommentarer — se lib/authform-rate-limit-og-resend.test.ts. */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const SIDE = 'app/login/page.tsx'
const MODAL = 'components/AuthModal.tsx'
const side = renKode(readFileSync(SIDE, 'utf8'))
const modal = renKode(readFileSync(MODAL, 'utf8'))

test('siden lytter på signalet fra AuthForm — ingen ny vei', () => {
  // onViewChange finnes fra 2a9f2bc og brukes allerede av modalen. /login skal
  // gjenbruke DEN, ikke bygge en egen mekanisme.
  assert.match(side, /<AuthForm variant="page" onViewChange=\{handleViewChange\} \/>/,
    'AuthForm på /login er ikke koblet til onViewChange')
  assert.match(side, /const handleViewChange = useCallback\(\(v: AuthView\) => setView\(v\), \[\]\)/,
    'handleViewChange mangler eller er ikke stabil')
})

test('undertittelen følger modusen', () => {
  assert.match(side, /const UNDERTITLER: Record<AuthView, string \| null>/,
    'UNDERTITLER er borte eller ikke nøkkeltypet på AuthView')
  assert.match(side, /\{undertittel && <p className="login-sub">\{undertittel\}<\/p>\}/,
    'undertittelen er statisk igjen — den leser ikke fra UNDERTITLER')
  // Den gamle, faste strengen skal ikke lenger stå hardkodet i markupen.
  assert.doesNotMatch(side, /<p className="login-sub">Logg inn eller opprett konto<\/p>/,
    'den gamle faste undertittelen står fortsatt i markupen')
})

test('login-modus er uendret, signup-modus sier hva brukeren får', () => {
  assert.match(side, /login: 'Logg inn eller opprett konto'/,
    'login-undertittelen er endret — den skulle stå')
  assert.match(side, /signup: 'Kontoen er gratis\. Resultatene lagres på deg, og poengene teller i sesongen\.'/,
    'signup-undertittelen er endret')
})

test('de to flatene sier det SAMME i signup-modus', () => {
  // Strengen er bevisst duplisert: modalens tekster er prod-verifiserte og
  // skulle ikke røres i denne runden. Prisen er at de kan drive fra hverandre
  // — nøyaktig feilen /login og modalen hadde før 20. juli, da de var to helt
  // ulike flyter. Denne testen er betalingen for duplikatet.
  //
  // Skal de slås sammen senere, hører strengen hjemme i lib/auth-messages.ts,
  // som allerede er huset for delte auth-tekster. Da kan denne testen bli en
  // ren import-sjekk — men ikke slett den uten å erstatte den.
  const iSiden = side.match(/signup: '([^']+)'/)
  const iModalen = modal.match(/const SIGNUP_DESCRIPTION = '([^']+)'/)
  assert.ok(iSiden, 'fant ikke signup-undertittelen i /login')
  assert.ok(iModalen, 'fant ikke SIGNUP_DESCRIPTION i AuthModal')
  assert.equal(iSiden[1], iModalen[1],
    '/login og modalen sier ULIKE ting i registreringsmodus — de skal si det samme')
})

test('kvitteringsskjermene har ingen undertittel', () => {
  // AuthForm viser da sin egen grønne boks, og FØRSTE LINJE i den er «Sjekk
  // innboksen din!». En undertittel med samme beskjed ville gjentatt seg selv
  // to linjer unna.
  for (const v of ['sent-magic', 'sent-reset', 'sent-signup']) {
    assert.match(side, new RegExp(`'${v}': null`),
      `${v} har fått en undertittel — den ville duplisert den grønne boksen under`)
  }
})

test('tittelen overtar luften når undertittelen forsvinner', () => {
  // .login-sub bidrar med 32 px ned mot skillelinjen. Uten kompensasjon
  // klemmes .login-rule opp mot overskriften på kvitteringsskjermene.
  assert.match(side, /\.login-title-alene \{ margin-bottom: 32px; \}/,
    'marginkompensasjonen er borte — skillelinjen klemmes mot tittelen')
  assert.match(side, /className=\{undertittel \? 'login-title' : 'login-title login-title-alene'\}/,
    'tittelen bytter ikke klasse når undertittelen forsvinner')
})

test('H1-en står urørt — ingen modus-logikk på destinasjonsrammen', () => {
  // N9, 17. august 2026: siden nås fra både «Bli med» og «Logg inn». H1-en er
  // en destinasjonsramme som er sann i begge moduser. Får den modus-logikk,
  // kan den motsi den ene inngangen.
  assert.match(side, /Bli med i <em>Quizkanonen<\/em>/,
    'H1-teksten er endret')
  const h1 = side.slice(side.indexOf('<h1'), side.indexOf('</h1>'))
  assert.doesNotMatch(h1, /view ===|isSignup|UNDERTITLER\[/,
    'H1-en har fått modus-logikk — den skal være nøytral (N9)')
})

test('modusen eies fortsatt av AuthForm — siden leser bare av', () => {
  // Ingen kontrollflyt: /login skal ikke kunne SETTE modusen.
  assert.doesNotMatch(side, /setMode|switchMode/,
    '/login prøver å styre modusen — den skal kun lese av view')
})
