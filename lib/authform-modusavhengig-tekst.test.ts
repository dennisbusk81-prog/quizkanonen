// Kjøres med:  npm test
//
// STRUKTURELL SPERRE over de MODUS-AVHENGIGE TEKSTENE i AuthForm/AuthModal —
// den delte innloggingsflaten for både /login og modalen i toppnavigasjonen.
//
// BAKGRUNN (3. september 2026, rett etter 87427f8): «Opprett konto» ble synlig
// som outline-knapp, men et trykk på den byttet BARE de to knappene. Overskrift
// («Logg inn»), undertekst («Logg inn for å se din plassering …») og
// vilkårslinje («Ved å logge inn godtar du våre vilkår») sto stille. Skjermen
// så ut til å rykke i stedet for å skifte, og brukeren fikk ingen bekreftelse
// på at hun hadde gjort noe riktig.
//
// Hvorfor kildetekst-test: samme grunn som lib/authform-rate-limit-og-resend.ts
// og lib/authmodal-portal.test.ts — npm test kjører kun lib/**/*.test.ts under
// Node sin egen runner, uten jsdom.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • overskriften gjøres statisk igjen («Logg inn» hardkodet i <h2>) →
//     «overskriften er modus-avhengig» + «HEADINGS dekker alle skjermene» ryker.
//   • vilkårslinja gjøres statisk igjen → «vilkårslinja følger modusen» ryker.
//   • signup-defaulten legges FØR kallerens description → «kallerens
//     description vinner» ryker.
//   • onViewChange flyttes inn i switchMode → «skjermen meldes som en
//     observasjon av tilstanden» ryker.
//   • kvitteringsskjermene fjernes fra AuthView → «kvitteringene er egne
//     skjermer» ryker.
//   • aria-label settes tilbake til «Logg inn» → «dialogens navn følger
//     overskriften» ryker.
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

const FORM = 'components/AuthForm.tsx'
const MODAL = 'components/AuthModal.tsx'
const form = renKode(readFileSync(FORM, 'utf8'))
const modal = renKode(readFileSync(MODAL, 'utf8'))

// ── Overskriften ───────────────────────────────────────────────────────────

test('overskriften er modus-avhengig, ikke hardkodet «Logg inn»', () => {
  // Selve feilen: <h2> sa «Logg inn» uansett hvilken skjerm som vistes.
  assert.match(modal, /\{heading\.start\} <em[^>]*>\{heading\.gull\}<\/em>/,
    'overskriften leser ikke fra HEADINGS — er den hardkodet igjen?')
  assert.doesNotMatch(modal, />\s*Logg <em/,
    'overskriften har en hardkodet «Logg inn» igjen')
})

test('HEADINGS dekker alle skjermene i AuthView', () => {
  // Record<AuthView, …> ville fanget et manglende felt i tsc, men ikke at
  // noen bytter typen til string og lar en skjerm falle ut.
  assert.match(modal, /const HEADINGS: Record<AuthView,/,
    'HEADINGS er ikke lenger nøkkeltypet på AuthView — en ny skjerm kan falle ut stille')
  for (const v of ['login:', 'signup:', "'sent-magic':", "'sent-reset':", "'sent-signup':"]) {
    assert.ok(modal.includes(v), `HEADINGS mangler skjermen ${v}`)
  }
})

test('registreringsoverskriften sier «Opprett konto»', () => {
  assert.match(modal, /signup:\s*\{\s*start:\s*'Opprett',\s*gull:\s*'konto'\s*\}/,
    'signup-overskriften er endret bort fra «Opprett konto»')
})

test('dialogens tilgjengelige navn følger overskriften', () => {
  // aria-label sto fast på «Logg inn» — en skjermleser meldte feil dialog.
  assert.match(modal, /aria-label=\{`\$\{heading\.start\} \$\{heading\.gull\}`\}/,
    'aria-label følger ikke overskriften')
  assert.doesNotMatch(modal, /aria-label="Logg inn"/,
    'aria-label er hardkodet til «Logg inn» igjen')
})

// ── Underteksten, og kallerens forrang ─────────────────────────────────────

test('kallerens description vinner over den modus-avhengige defaulten', () => {
  // Quiz-siden setter description ut fra quizens tilstand («Svarene dine ligger
  // klare …»). Den beskjeden er mer verdt enn en generisk standardtekst, og en
  // modus-avhengig default skal ALDRI overkjøre den.
  assert.match(modal, /description \?\? \(view === 'signup' \? SIGNUP_DESCRIPTION : DEFAULT_DESCRIPTION\)/,
    'defaulten kan overkjøre kallerens description — rekkefølgen på ?? er snudd')
})

test('signup-defaulten lover ikke noe Premium krever', () => {
  const m = modal.match(/const SIGNUP_DESCRIPTION = '([^']+)'/)
  assert.ok(m, 'SIGNUP_DESCRIPTION finnes ikke')
  const tekst = m[1].toLowerCase()
  // Nøyaktig plassering, historikk og egen plass på sesong-topplisten er
  // Premium (se PAYWALL-LOGIKK i CLAUDE.md). En gratis konto gir dem ikke.
  for (const forbudt of ['plassering', 'historikk', 'statistikk', 'liga']) {
    assert.ok(!tekst.includes(forbudt),
      `SIGNUP_DESCRIPTION lover «${forbudt}», som krever Premium`)
  }
})

test('kvitteringsskjermene har ingen undertekst', () => {
  // AuthForm viser da sin egen grønne «Sjekk innboksen din!»-boks. En linje
  // over den om hvorfor man burde logge inn ville pekt på noe brukeren
  // nettopp har gjort.
  assert.match(modal, /const erKvittering = view\.startsWith\('sent-'\)/,
    'kvitteringsskjermene skilles ikke ut lenger')
  assert.match(modal, /erKvittering\s*\?\s*null/,
    'kvitteringsskjermene har fått undertekst igjen')
})

test('modalen nullstiller skjermen når den ÅPNES, og ikke i en effekt', () => {
  // En modal som ble lukket i registreringsmodus ville ellers blinke «Opprett
  // konto» i ett bilde neste gang den åpnes: AuthForm melder «login» på nytt
  // ved remontering, men det skjer i en effekt — etter første render.
  //
  // Justeringen må skje under render. Gjøres den om til en useEffect, tegnes
  // det gale bildet først, og eslint-regelen «Avoid calling setState() directly
  // within an effect» slår inn.
  assert.match(modal, /if \(open !== forrigeOpen\) \{\s*setForrigeOpen\(open\)\s*if \(open\) setView\('login'\)/,
    'nullstillingen ved åpning er borte eller flyttet')
  assert.doesNotMatch(modal, /useEffect\(\(\) => \{\s*if \(!open\) setView/,
    'nullstillingen er flyttet tilbake i en effekt')
})

// ── Vilkårslinja ───────────────────────────────────────────────────────────

test('vilkårslinja følger modusen', () => {
  assert.match(form, /isSignup \? 'Ved å opprette konto godtar du våre' : 'Ved å logge inn godtar du våre'/,
    'vilkårslinja er statisk igjen — den sier «Ved å logge inn» også i registreringsmodus')
})

test('lenkene og 13-årssetningen er uendret i begge moduser', () => {
  // Samtykket er det samme; kun verbet skifter. Står lenkene inne i grenen,
  // kan de komme i utakt.
  const terms = form.slice(form.indexOf('className="qk-auth-terms"'))
  assert.match(terms, /href="\/vilkar"/, 'vilkårslenken mangler')
  assert.match(terms, /href="\/personvern"/, 'personvernlenken mangler')
  assert.match(terms, /13 år eller eldre/, '13-årssetningen mangler')
  assert.equal((terms.match(/13 år eller eldre/g) ?? []).length, 1,
    '13-årssetningen finnes i flere grener — den skal stå ÉN gang, utenfor modus-valget')
})

// ── Signalet utover ────────────────────────────────────────────────────────

test('kvitteringene er egne skjermer, ikke bare login/signup', () => {
  assert.match(form, /export type AuthView = 'login' \| 'signup' \| 'sent-magic' \| 'sent-reset' \| 'sent-signup'/,
    'AuthView dekker ikke lenger kvitteringsskjermene')
  assert.match(form, /const view: AuthView = sent \? \(`sent-\$\{sent\}` as AuthView\) : mode/,
    'view utledes ikke lenger av både sent og mode')
})

test('skjermen meldes som en OBSERVASJON av tilstanden, ikke fra switchMode', () => {
  // Avgjørende: `mode` settes to steder. switchMode() ved knappetrykk, men også
  // setMode('signup') inne i diagnoseLoginFailure() når e-posten ikke finnes —
  // og NETTOPP da er overskriften viktigst. En callback lagt inn i switchMode
  // ville gått glipp av den veien.
  assert.match(form, /useEffect\(\(\) => \{\s*onViewChange\?\.\(view\)\s*\}, \[view, onViewChange\]\)/,
    'skjermskiftet meldes ikke lenger av en effekt på view')
  const switchMode = form.slice(form.indexOf('const switchMode ='), form.indexOf('const diagnoseLoginFailure'))
  assert.doesNotMatch(switchMode, /onViewChange/,
    'onViewChange er flyttet inn i switchMode — da mistes setMode-veien i diagnoseLoginFailure')
  // Vakt for at den andre veien faktisk finnes, så testen over ikke blir
  // meningsløs den dagen diagnosen slutter å bytte modus.
  assert.match(form, /setMode\('signup'\)/,
    'diagnoseLoginFailure bytter ikke lenger modus — da kan denne vakten forenkles')
})

test('modusbyttet selv er uendret — samme switchMode, samme tilstand', () => {
  const kall = form.match(/switchMode\(/g) ?? []
  assert.equal(kall.length, 1, `switchMode kalles ${kall.length} steder — skal være ett`)
  assert.match(form, /const switchMode = \(m: Mode\) => \{\s*setMode\(m\); setNotice\(null\)/,
    'switchMode har endret oppførsel — dette skulle være tekst, ikke logikk')
})
