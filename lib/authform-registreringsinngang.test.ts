// Kjøres med:  npm test
//
// STRUKTURELL SPERRE over PLASSERINGEN av registreringsinngangen i
// components/AuthForm.tsx — det DELTE innloggingsskjemaet for både /login og
// AuthModal i toppnavigasjonen.
//
// BAKGRUNN (3. september 2026): modusbyttet lå som en 13 px tekstlenke NEDERST,
// mellom magic link-hintet og vilkårsteksten. På desktop havnet den under
// folden; på mobil enda lenger ned. Alt som var synlig over folden forutsatte
// dermed at den besøkende ALLEREDE hadde konto. Det er feil antakelse når
// eneste vekstkanal er én post til ~2500 kontakter som alle er nye.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/authform-rate-limit-og-resend.test.ts og lib/authmodal-portal.test.ts —
// npm test kjører kun lib/**/*.test.ts under Node sin egen runner, uten jsdom.
// Plassering i et JSX-tre er dessuten ikke noe en ren funksjon kan svare på.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • outline-knappen fjernes helt → «registreringsinngangen er en knapp …»
//     ryker.
//   • knappen flyttes tilbake under magic link-blokka → «… står FØR
//     eller-skillelinjen» og «… står over magic link-blokka» ryker.
//   • knappen flyttes over e-postfeltet → «… står ETTER den primære
//     handlingen» ryker.
//   • tekstlenken nederst gjeninnføres ved siden av knappen → «det finnes
//     nøyaktig ÉN inngang til modusbyttet» ryker.
//   • knappen gjøres gullfylt → «knappen er outline, ikke gullfylt» ryker.
//   • signup-retningen fjernes (knappen tilbyr «Opprett konto» i begge
//     modi) → «knappen er symmetrisk begge veier» ryker.
//   • .qk-auth-switch-regelen slettes som «ubrukt» → «.qk-auth-switch lever
//     videre for kvitteringsskjermen» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Kilden uten kommentarer. Blokkommentarer fjernes først; linjekommentarer kun
 * når linja BEGYNNER med `//`, slik at `//` inne i en streng ikke spiser resten
 * av linja. Samme form som lib/authform-rate-limit-og-resend.test.ts.
 *
 * Helt nødvendig her: kommentaren som forklarer flyttingen nevner både
 * «Opprett konto», «Logg inn», «eller»-skillelinjen og gull i prosa. Uten
 * strippingen ville flere av testene under blitt grønne av kommentartekst —
 * grønn av feil grunn. JSX-kommentarer (`{/* … *\/}`) fanges av den samme
 * blokkommentar-regelen.
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

/** Utsnitt av fila, slik at rekkefølgetester ikke måler på tvers av den. */
function kropp(startAnker: string, sluttAnker: string): string {
  const start = src.indexOf(startAnker)
  assert.notEqual(start, -1, `fant ikke startankeret «${startAnker}» i ${FIL}`)
  const slutt = src.indexOf(sluttAnker, start)
  assert.notEqual(slutt, -1, `fant ikke sluttankeret «${sluttAnker}» etter «${startAnker}»`)
  return src.slice(start, slutt)
}

// Selve render-treet, avgrenset OPPOVER av den primære innsend-knappen og
// NEDOVER av stilarket. Avgrensningen er poenget: klassenavnene finnes også i
// STYLES lenger nede, så en indexOf mot hele fila ville målt rekkefølgen på
// CSS-reglene i stedet for på JSX-en. Det ville vært grønt uansett hvor
// knappen faktisk står.
const jsx = kropp('<button type="submit"', 'const STYLES = ')

const idx = (nål: string, hvor = jsx) => {
  const i = hvor.indexOf(nål)
  assert.notEqual(i, -1, `fant ikke «${nål}» i render-treet i ${FIL}`)
  return i
}

// ── Selve inngangen ────────────────────────────────────────────────────────

test('registreringsinngangen er en knapp, ikke en tekstlenke i en fotnote', () => {
  assert.match(jsx, /className="qk-auth-btn-secondary"/,
    'outline-knappen mangler — registreringsinngangen er borte eller degradert')
  assert.match(jsx, /switchMode\(/,
    'knappen bytter ikke modus')
})

test('modusbyttet bruker fortsatt switchMode — ingen ny tilstandslogikk', () => {
  // Flyttingen skulle være flytting og styling. Et setMode-kall utenom
  // switchMode ville hoppet over setNotice(null), slik at en feilmelding fra
  // innlogging ble stående synlig etter byttet til registrering.
  assert.doesNotMatch(jsx, /setMode\(/,
    'render-treet kaller setMode direkte — bruk switchMode, som også nullstiller notice')
})

// ── Plasseringen, som er hele poenget ──────────────────────────────────────

test('registreringsinngangen står ETTER den primære handlingen', () => {
  // Over e-postfeltet ville bare flyttet problemet: da måtte den som HAR konto
  // lese forbi noe som ikke gjelder henne.
  assert.ok(idx('qk-auth-btn-primary') < idx('qk-auth-btn-secondary'),
    'registreringsknappen står FØR «Logg inn» — den som har konto må nå lese forbi den')
})

test('registreringsinngangen står FØR «eller»-skillelinjen', () => {
  assert.ok(idx('qk-auth-btn-secondary') < idx('qk-auth-separator'),
    'registreringsknappen har havnet under «eller»-skillelinjen — den var under folden nettopp der')
})

test('registreringsinngangen står over magic link-blokka', () => {
  // Dette er den konkrete regresjonen: den GAMLE plasseringen var like under
  // magic link-hintet. Ryker denne, er inngangen tilbake i fotnoten.
  assert.ok(idx('qk-auth-btn-secondary') < idx('qk-auth-magiclink'),
    'registreringsknappen ligger under magic link-blokka — det var den gamle, usynlige plasseringen')
})

test('vilkårsteksten er fortsatt sist', () => {
  // Den gamle tekstlenken lå mellom magic link og vilkårene. Når den fjernes,
  // skal vilkårene henge på det som nå står over dem — ikke bli foreldreløse
  // eller havne foran knappene.
  assert.ok(idx('qk-auth-magiclink') < idx('qk-auth-terms'),
    'vilkårsteksten har havnet foran magic link-blokka')
})

// ── Ingen dobbel inngang ───────────────────────────────────────────────────

test('det finnes nøyaktig ÉN inngang til modusbyttet', () => {
  // To innganger til samme modus er nettopp det flyttingen skulle fjerne. Blir
  // den gamle tekstlenken stående i tillegg, ryker denne.
  const kall = src.match(/switchMode\(/g) ?? []
  assert.equal(kall.length, 1,
    `fant ${kall.length} kall til switchMode — det skal være nøyaktig ett kallsted`)
})

test('knappen er symmetrisk begge veier', () => {
  // I signup-modus skal den naturligvis tilby «Logg inn», ikke «Opprett
  // konto» — samme symmetri som tekstlenken hadde.
  const knapp = kropp('className="qk-auth-btn-secondary"', '</button>')
  assert.match(knapp, /isSignup \?/,
    'knappen skiller ikke på modus — den tilbyr samme handling i begge retninger')
  assert.ok(knapp.includes('Logg inn') && knapp.includes('Opprett konto'),
    'knappen mangler den ene retningen — begge etikettene skal finnes')
})

// ── Vaktene fra CLAUDE.md ──────────────────────────────────────────────────

const styles = src.slice(src.indexOf('const STYLES = '))
const regel = (velger: string) => {
  const start = styles.indexOf(`${velger} {`)
  assert.notEqual(start, -1, `fant ikke CSS-regelen «${velger}» i ${FIL}`)
  return styles.slice(start, styles.indexOf('}', start))
}

test('knappen er outline, ikke gullfylt — to-gule-regelen', () => {
  // «Logg inn» skal forbli det ENESTE gullfylte elementet på skjermen.
  const r = regel('.qk-auth-btn-secondary')
  assert.match(r, /background:\s*transparent/,
    'registreringsknappen har fylt bakgrunn')
  assert.doesNotMatch(r, /background:\s*#c9a84c/,
    'registreringsknappen er gullfylt — det er to gule elementer på skjermen')
})

test('knappen har full bredde og border-box, som gullknappen over', () => {
  const r = regel('.qk-auth-btn-secondary')
  assert.match(r, /width:\s*100%/, 'knappen er ikke i full bredde')
  // app/globals.css har INGEN egen reset — border-box kommer fra Tailwind sin
  // preflight. Uten eksplisitt box-sizing blir knappen 2px bredere enn
  // gullknappen den skal flukte med, den dagen preflight forsvinner.
  assert.match(r, /box-sizing:\s*border-box/,
    'knappen avhenger av Tailwind-preflight for å flukte med gullknappen')
})

test('ingen forbudt hint-farge i skjemaet', () => {
  // #7a7873 ble hevet til #918f8a 1. august 2026 (WCAG: 3,51:1 mot kortet).
  assert.doesNotMatch(src, /#7a7873/i,
    'AuthForm bruker den forbudte hint-fargen #7a7873')
})

test('.qk-auth-switch lever videre for kvitteringsskjermen', () => {
  // Klassen ble ledig i hovedskjemaet da tekstlenken forsvant, men
  // kvitteringsskjermen («Sjekk innboksen din!» → «← Tilbake») bruker den
  // fortsatt. Slettes regelen som «ubrukt», mister den knappen all styling.
  assert.match(styles, /\.qk-auth-switch \{/,
    'CSS-regelen .qk-auth-switch er fjernet — «← Tilbake» på kvitteringsskjermen mister stilen')
  assert.match(src, /className="qk-auth-switch"/,
    'ingen bruker .qk-auth-switch lenger — da skal regelen fjernes sammen med den siste bruken')
})
