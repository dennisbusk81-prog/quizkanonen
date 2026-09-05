// Kjøres med:  npm test
//
// HVA EN INNLOGGINGS-CTA LOVER. Tre strenger, låst mot ordlyd-drift.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// Én fremmed klikker en delt quizlenke fra Facebook. Tre tekster på veien inn
// var enten usanne eller feilinformerte:
//
//   • Knappen på leaderboard-flaten het «Logg inn med Google» og bar Googles
//     firefargede logo — men den åpner AuthModal, som gir FEM innloggingsveier.
//     Etiketten lovet én av dem.
//   • AuthModal sin DEFAULT_DESCRIPTION lovet «se din plassering og følge
//     utviklingen din over tid». BEGGE er Premium-gatet. Teksten ble vist til
//     gratisbrukere på alle SiteNav-sider (NavAuth) og i liga-invitasjonen.
//   • Leaderboard-flaten arvet den defaulten i stedet for å si hva DENNE
//     listen faktisk gir.
//
// ── SANNHETSKONTRAKTEN (målt mot koden, ikke antatt) ────────────────────────
// Ingen av strengene her får love noe utenfor det en GRATIS innlogget bruker
// får:
//   • Listen er trappekuttet — ANON_TOP = 3, FREE_TOP = 10, Premium alt
//     (app/api/leaderboard/[id]/route.ts). «Hele listen» er altså Premium.
//   • Eksakt plassering er Premium; gratis får et bånd.
//   • Sesongpoeng er IKKE Premium-gatet (lib/award-season-points.ts har ingen
//     premium-sjekk).
// Testen «ingen av tekstene lover noe Premium-gatet» under holder den
// kontrakten mot framtidige ordlyd-endringer.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • DEFAULT_DESCRIPTION endres → «standardteksten er ordrett …» ryker.
//   • Knappeteksten endres tilbake → «knappen sier «Logg inn»» ryker.
//   • Google-SVG-en limes inn igjen → «ingen merkelogo på knappen» ryker.
//   • `description`-prop-en fjernes fra AuthModal → «flaten sender sin EGEN
//     description» ryker.
//   • hasSavedResult-grenen fjernes → «retur-spilleren faller til defaulten»
//     ryker.
//   • isClosed-grenen fjernes → «stengt quiz faller til defaulten» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { leaderboardLoginDescription } from './leaderboard-login-copy'

/**
 * Kilden uten kommentarer. Blokkommentarer først, så linjer som BEGYNNER med
 * `//`. Samme form som lib/authmodal-portal.test.ts og lib/login-next.test.ts.
 *
 * Nødvendig her, ikke pynt: kommentaren jeg la over DEFAULT_DESCRIPTION siterer
 * den GAMLE teksten, og kommentaren over knappen siterer «Logg inn med Google».
 * Uten strippingen ville testene under vært grønne av kommentarene alene — og
 * grønne av feil grunn er verre enn røde.
 */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

// Ordlyden Dennis godkjente 5. september 2026. Endres en av dem, skal denne
// fila bli rød — det er hele poenget med å ase på strengen.
const DEFAULT_TEKST = 'Logg inn, så lagres resultatene på deg og poengene teller i sesongen.'
const AAPEN_TEKST = 'Logg inn for å spille denne quizen og komme på listen.'
const STENGT_TEKST = 'Logg inn for å se topp 10 og spille neste quiz.'
const KNAPPETEKST = 'Logg inn'

// ── C: AuthModal sin standardtekst ──────────────────────────────────────────

const AM_FIL = 'components/AuthModal.tsx'
const amSrc = renKode(readFileSync(AM_FIL, 'utf8'))

test('C: standardteksten er ordrett den Dennis godkjente', () => {
  assert.match(
    amSrc,
    new RegExp(`^const DEFAULT_DESCRIPTION = '${DEFAULT_TEKST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`, 'm'),
    `${AM_FIL}: DEFAULT_DESCRIPTION er ikke «${DEFAULT_TEKST}»`,
  )
})

test('C: standardteksten lover ikke lenger plassering eller historikk', () => {
  // Den gamle strengen, ordrett. Står den igjen NOE sted i koden, er enten
  // endringen ikke landet eller teksten duplisert et annet sted.
  assert.ok(
    !amSrc.includes('se din plassering og følge utviklingen din over tid'),
    `${AM_FIL}: den gamle Premium-lovende teksten står fortsatt i koden`,
  )
})

// ── B og D: leaderboard-flaten ──────────────────────────────────────────────

const LB_FIL = 'app/leaderboard/[id]/page.tsx'
const lbSrc = renKode(readFileSync(LB_FIL, 'utf8'))

test('B: knappen sier «Logg inn» — ingen metode navngitt', () => {
  assert.ok(
    !lbSrc.includes('Logg inn med Google'),
    `${LB_FIL}: «Logg inn med Google» står fortsatt i koden`,
  )
  // Ankeret er knappen som åpner modalen, ikke ordet «Logg inn» et sted i en
  // fil på 2000+ linjer — den frasen finnes i flere korttitler.
  //
  // Åpningstaggen skrives UT i ankeret i stedet for `<button[^>]*>`: den
  // klassen stopper på den første `>`-en, og den står inne i pilen i
  // `{() => setShowModal(true)}`. Bonusen er at ankeret samtidig feller
  // gullfargen — `style={s.btnGold}` skal stå urørt, det var eksplisitt krav.
  const m = lbSrc.match(
    /<button onClick=\{\(\) => setShowModal\(true\)\} style=\{s\.btnGold\}>([\s\S]*?)<\/button>/,
  )
  assert.ok(m, `${LB_FIL}: fant ikke gull-knappen som åpner AuthModal`)
  assert.equal(
    m[1].trim(),
    KNAPPETEKST,
    `knappens innhold er ikke nøyaktig «${KNAPPETEKST}»`,
  )
})

test('B: ingen merkelogo på knappen — Googles fire farger er borte', () => {
  // Hardkodede merkefarger utenfor designsystemet. De fantes KUN i denne
  // SVG-en; er én tilbake, er logoen limt inn igjen.
  for (const farge of ['4285F4', '34A853', 'FBBC05', 'EA4335']) {
    assert.ok(!lbSrc.includes(farge), `${LB_FIL}: Google-fargen #${farge} står fortsatt i koden`)
  }
})

test('D: flaten sender sin EGEN description — arver ikke defaulten', () => {
  // Nettopp det som manglet: uten prop-en faller modalen til
  // DEFAULT_DESCRIPTION, som ikke vet noe om denne listen.
  const treff = lbSrc.match(/description=\{leaderboardLoginDescription\(/g) ?? []
  assert.equal(treff.length, 1, `${LB_FIL}: fant ${treff.length} description={leaderboardLoginDescription(…)}, ventet 1`)
})

test('D: begge tilstandene mates inn — isClosed OG savedResult', () => {
  const m = lbSrc.match(/description=\{leaderboardLoginDescription\([\s\S]*?\)\}/)
  assert.ok(m, `${LB_FIL}: fant ikke description={leaderboardLoginDescription(…)}`)
  // `isClosed` alene ville gitt «spill denne quizen» til en retur-spiller som
  // allerede HAR spilt den. Begge må inn, ellers er grenen under uvirksom.
  assert.match(m[0], /isClosed/, m[0])
  assert.match(m[0], /hasSavedResult:\s*!!savedResult/, m[0])
})

test('D: leaderboard importerer tekstvalget', () => {
  assert.match(lbSrc, /^import \{ leaderboardLoginDescription \} from '@\/lib\/leaderboard-login-copy'$/m)
})

// ── Tekstvalget som logikk ──────────────────────────────────────────────────

test('åpen quiz, ingen lagret score: den fremmede får sin egen tekst', () => {
  assert.equal(
    leaderboardLoginDescription({ isClosed: false, hasSavedResult: false }),
    AAPEN_TEKST,
  )
})

test('retur-spilleren faller til defaulten — hen har ALLEREDE spilt quizen', () => {
  // `qk_result_` skrives ubetinget i finishQuiz, også for innloggede, så
  // savedResult betyr retur-spiller. «Logg inn for å spille denne quizen»
  // ville bedt hen gjøre noe hen har gjort, og submit svarer 403 på nytt forsøk.
  assert.equal(leaderboardLoginDescription({ isClosed: false, hasSavedResult: true }), undefined)
  assert.equal(leaderboardLoginDescription({ isClosed: true, hasSavedResult: true }), undefined)
})

test('stengt quiz: teksten lover topp 10, ikke hele listen', () => {
  // Skillet er hele grunnen til at grenen finnes. «Topp 10» er nøyaktig
  // FREE_TOP; «hele listen» er Premium. Utkastet med «hele listen» ble
  // forkastet 5. september 2026 — drifter ordlyden dit igjen, blir både denne
  // og Premium-kontrakten under rød.
  assert.equal(
    leaderboardLoginDescription({ isClosed: true, hasSavedResult: false }),
    STENGT_TEKST,
  )
})

test('stengt quiz lover ikke spilling på en quiz som er over', () => {
  // Den gamle kort-teksten gjorde nettopp det, og det var en av grunnene til
  // at STENGT ble en egen gren i kortet i utgangspunktet.
  const t = leaderboardLoginDescription({ isClosed: true, hasSavedResult: false }) ?? ''
  assert.ok(!t.includes('denne quizen'), `«${t}» lover spilling på en stengt quiz`)
})

test('ingen av tekstene lover noe Premium-gatet', () => {
  // Sannhetskontrakten, håndhevet mot ordlyd-drift. Frasene under beskriver
  // alle noe en gratis innlogget bruker IKKE får: hele listen (FREE_TOP = 10),
  // eksakt plassering (bånd), og historikk/statistikk.
  const forbudt = [
    'hele listen',
    'hele lista',
    'eksakt plassering',
    'nøyaktig plassering',
    'følge utviklingen',
    'historikk',
    'statistikk',
  ]
  // Både konstantene og det funksjonen FAKTISK returnerer — en konstant som
  // slutter å bli brukt ville ellers holdt kontrakten grønn på papiret.
  const tekster = [
    DEFAULT_TEKST,
    AAPEN_TEKST,
    STENGT_TEKST,
    KNAPPETEKST,
    leaderboardLoginDescription({ isClosed: false, hasSavedResult: false }) ?? '',
    leaderboardLoginDescription({ isClosed: true, hasSavedResult: false }) ?? '',
  ]
  for (const t of tekster) {
    for (const f of forbudt) {
      assert.ok(
        !t.toLowerCase().includes(f),
        `«${t}» lover «${f}», som er Premium-gatet`,
      )
    }
  }
})
