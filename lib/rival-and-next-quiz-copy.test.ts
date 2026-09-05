// Kjøres med:  npm test
//
// STRUKTURELL SPERRE for tre tekstavvik rettet 6. september 2026. Ordlyden i
// disse tre er ikke kosmetikk — hver av dem sa noe konkret usant til brukeren,
// så en fremtidig «uskyldig» omskriving skal bli rød og tvinge fram et valg.
//
//   [N-4] Rival-kortet på resultatskjermen doblet rivalens navn i samme
//         setning: «Elin Åmot slo deg denne uken — Elin Åmot fikk 9 riktige.»
//         Gjaldt BEGGE utfallsgrenene («won» og «lost»), ikke bare den meldte.
//         «tied» hadde aldri doblingen og er bevisst urørt.
//
//   [N-9] «Spill mot vennene dine → Opprett en liga (Premium)» var gatet kun
//         på `isLoggedIn`, i samme kolonne som ligaBox-kortet ~65 linjer under.
//         En premium-bruker MED liga fikk solgt en liga rett over lenken til
//         sin egen. Lenken er slettet; ligaBox dekker alle tilstandene.
//
//   [N-11] «Neste quiz kommer fredag» sto ubetinget på leaderboard-siden — også
//         mens quizen var åpen, på samme side som «Spill quizen →».
//
// Hvorfor kildetekst-test og ikke oppførselstest: npm test kjører kun
// lib/**/*.test.ts under Node sin egen runner, uten jsdom, og all tre bor i
// JSX inne i tusenvis av linjer klientkomponent. Samme form som
// lib/league-affordance-wiring.test.ts og lib/archive-ranking-wiring.test.ts.
//
// ⚠ KOMMENTAR-BEVISSTHET ER IKKE VALGFRITT HER. Begge kildefilene inneholder
// nå forklarende kommentarer som SITERER de fjernede/gamle strengene ordrett
// («Spill mot vennene dine → Opprett en liga (Premium)», «Neste quiz kommer
// fredag»). En naiv `assert.doesNotMatch` mot rå kildetekst ville derfor vært
// rød uten at noe var galt, og husets `aktiveLinjer`-helper i
// league-affordance-wiring.test.ts fanger `//` og `*` — men IKKE `{/* … */}`,
// som er nettopp formen de nye kommentarene har. `aktivKode()` under stripper
// blokk-kommentarer FØR linjefiltreringen. Mutasjonsrunden nedenfor
// verifiserer eksplisitt at strippingen ikke er for ivrig: en GJENINNFØRT
// aktiv linje skal bli rød selv om den samme teksten står i en kommentar.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Navnet dobles igjen i «won»-grenen → «won nevner rivalen én gang» ryker.
//   • Navnet dobles igjen i «lost»-grenen → «lost nevner rivalen én gang» ryker.
//   • «tied»-grenen mister `begge fikk` → «tied er urørt» ryker.
//   • Lenken på resultatskjermen gjeninnføres som AKTIV kode → «lenken er
//     borte fra aktiv kode» ryker (og består om teksten kun står i kommentar).
//   • ligaBox-kortet slettes ved et uhell → «ligaBox-kortet står igjen» ryker.
//   • `isClosed ?`-grenen fjernes så teksten blir ubetinget igjen →
//     «teksten er betinget av isClosed» og «åpen-grenen finnes» ryker.
//   • `nextQuizLabel` byttes mot en lokal fredags-streng → «stengt-grenen går
//     gjennom nextQuizLabel» ryker.
//   • site_settings-hentingen fjernes → «datoen hentes» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const QUIZ_PAGE = 'app/quiz/[id]/page.tsx'
const LB_PAGE = 'app/leaderboard/[id]/page.tsx'

/** BOM-en er del av fila, ikke av koden — se lib/bom-lærdommen. */
function utenBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/**
 * Kun kode som faktisk KJØRER.
 *
 * Rekkefølgen er poenget: blokk-kommentarer (`/* … *\/`, som dekker JSX-formen
 * `{/* … *\/}`) fjernes FØR linjer filtreres, ellers overlever
 * fortsettelseslinjene i en flerlinjes JSX-kommentar — de starter hverken med
 * `//`, `*` eller `/*`, og ville blitt lest som kode.
 */
function aktivKode(kilde: string): string {
  return utenBom(kilde)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .filter(l => l.trim() !== '')
    .join('\n')
}

const QUIZ = aktivKode(readFileSync(QUIZ_PAGE, 'utf8'))
const LB = aktivKode(readFileSync(LB_PAGE, 'utf8'))

// ── [N-4] Rival-kortet ──────────────────────────────────────────────────────

/**
 * Selve setningen for én utfallsgren, hentet ut som én linje. Ankeret er
 * teksten som SKILLER grenene fra hverandre («Du slo» / «slo deg» / «Likt
 * med»), ikke posisjon i fila — se lærdommen om at et linjestart-anker ikke
 * er en posisjonsgaranti.
 */
function grenLinje(anker: string): string {
  const linje = QUIZ.split('\n').find(l => l.includes(anker) && l.includes('rivalScore'))
  assert.ok(linje, `fant ingen aktiv rival-gren som inneholder «${anker}» — er kortet flyttet eller fjernet?`)
  return linje
}

test('[N-4] «won»-grenen nevner rivalen ÉN gang', () => {
  const linje = grenLinje('Du slo')
  const treff = linje.match(/\{name\}/g) ?? []
  assert.equal(
    treff.length, 1,
    `«won» skal nevne {name} én gang, fant ${treff.length}. Linja: ${linje.trim()}`,
  )
})

test('[N-4] «lost»-grenen nevner rivalen ÉN gang', () => {
  const linje = grenLinje('slo deg')
  const treff = linje.match(/\{name\}/g) ?? []
  assert.equal(
    treff.length, 1,
    `«lost» skal nevne {name} én gang, fant ${treff.length}. Linja: ${linje.trim()}`,
  )
})

test('[N-4] begge grenene bærer fortsatt rivalens poengsum', () => {
  // Betydningen skal være beholdt, ikke bare doblingen fjernet: leser man bort
  // rivalScore for å «forenkle», sier kortet ikke lenger hva rivalen fikk.
  assert.match(grenLinje('Du slo'), /som fikk \{rivalScore\}/)
  assert.match(grenLinje('slo deg'), /med \{rivalScore\}/)
})

test('[N-4] «tied»-grenen er urørt', () => {
  const linje = grenLinje('Likt med')
  assert.match(linje, /begge fikk \{rivalScore\}/)
  assert.match(linje, /Tiden avgjør/)
})

// ── [N-9] Den ugatede liga-lenken ───────────────────────────────────────────

test('[N-9] lenken er borte fra AKTIV kode', () => {
  assert.doesNotMatch(
    QUIZ, /Spill mot vennene dine/,
    'Den ugatede liga-lenken er gjeninnført. Den var samme oppfordring som ' +
    'ligaBox-kortet, uten ligaBox sin tilstandsskillelse — se kommentaren på ' +
    'stedet. Skal den tilbake, må den gates på ligaBox, ikke på isPremium.',
  )
})

test('[N-9] ligaBox-kortet står igjen — det er dette som skal dekke tilstandene', () => {
  // Motvekten til testen over: hadde jeg slettet feil blokk, ville «lenken er
  // borte» vært grønn mens flaten mistet liga-oppfordringen helt.
  assert.match(QUIZ, /Opprett en liga \(Premium\) og inviter vennegjengen/)
  assert.match(QUIZ, /ligaBox\.type === 'liga'/)
  assert.match(QUIZ, /Se hvordan du gjør det mot vennene dine/)
})

// ── [N-11] «Neste quiz»-teksten på leaderboard ──────────────────────────────

test('[N-11] teksten er betinget av isClosed — ikke ubetinget', () => {
  assert.match(
    LB, /\{isClosed \? `Neste quiz: \$\{nextQuizLabel\(nextQuizAt\)\}` : 'Denne quizen er åpen nå'\}/,
    'Teksten skal skille åpen fra stengt. Ubetinget «Neste quiz kommer fredag» ' +
    'ba folk vente på en quiz de kunne spille der og da.',
  )
})

test('[N-11] åpen-grenen sier at quizen er åpen', () => {
  assert.match(LB, /Denne quizen er åpen nå/)
})

test('[N-11] den gamle ubetingede strengen er borte fra aktiv kode', () => {
  assert.doesNotMatch(LB, /^\s*Neste quiz kommer fredag\s*$/m)
})

test('[N-11] stengt-grenen går gjennom nextQuizLabel — ikke en lokal fredags-streng', () => {
  assert.match(LB, /import \{ nextQuizLabel \} from '@\/lib\/next-quiz-label'/)
  assert.match(LB, /nextQuizLabel\(nextQuizAt\)/)
})

test('[N-11] den annonserte datoen HENTES — ellers divergerer flatene', () => {
  // Uten denne hentingen faller leaderboard på førstkommende fredag mens
  // resultatskjermen viser en annonsert bonusdato: to flater, to datoer.
  assert.match(LB, /const \[nextQuizAt, setNextQuizAt\] = useState<string \| null>\(null\)/)
  assert.match(LB, /\.eq\('key', 'next_quiz_at'\)/)
  assert.match(LB, /setNextQuizAt\(data\.value\)/)
})

// ── Paritet mellom de to flatene ────────────────────────────────────────────

test('begge flatene formaterer «Neste quiz» gjennom samme helper', () => {
  // Hele poenget med lib/next-quiz-label.ts. Får én av dem sin egen
  // formatering igjen, er driften tilbake.
  assert.match(QUIZ, /Neste quiz: \{nextQuizLabel\(nextQuizAt\)\}/)
  assert.match(LB, /Neste quiz: \$\{nextQuizLabel\(nextQuizAt\)\}/)
})
