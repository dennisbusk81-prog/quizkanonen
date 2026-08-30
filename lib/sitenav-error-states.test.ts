// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: at <SiteNav /> står i FEIL- OG LASTETILSTANDENE, ikke
// bare i den vellykkede returen.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// Fram til 29. august 2026 lå <SiteNav /> i de vellykkede returene på seks
// sider, men bare stedvis i loading-/feilgrenene. Altså manglet navigasjonen
// nøyaktig der brukeren trenger en utvei mest: på skjermen som sier at noe
// gikk galt.
//
// Verst på /historikk/[attemptId]. Der er BackNav og UserMenu begge skjult av
// sine egne stilister (components/BackNav.tsx, components/UserMenu.tsx), så
// det finnes ingen global fallback, og filas egen «← Tilbake» er
// `router.back()` — som kildekommentaren i page.tsx selv slår fast «ikke
// fører noe sted når siden åpnes direkte fra en delt lenke eller ny fane».
// Feilet hentingen for en som kom fra en delt lenke, var skjermen en LUKKET
// SLØYFE: ingen lenke ut, ingen meny, ingen tilbakeknapp som virket.
//
// Feilen er lett å gjeninnføre: en ny loading- eller feilgren skrives etter
// mønster av naboen ovenfor, og naboen ovenfor er som regel en gren som ennå
// ikke hadde nav. Denne filen er vakten mot den kopieringen.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/historikk-arkivlenke-wiring.test.ts og lib/archive-ranking-wiring.test.ts
// — npm test kjører kun lib/**/*.test.ts under Node sin egen runner, uten
// jsdom, og flatene er 300–1100-linjers klientkomponenter.
//
// ── HVORFOR DETTE IKKE ER EN FALSK POSITIV ──────────────────────────────────
// Filene har mange returgrener, og nabogrenene HAR <SiteNav />. En naiv
// «finnes strengen i fila»-test ville derfor vært grønn uansett. Fire
// forsvar, i denne rekkefølgen:
//
//   1. Kommentarer strippes FØR noe måles. Denne filens egen forklaring — og
//      kildekommentarene i page.tsx — nevner SiteNav i prosa.
//   2. Hver vaktstreng må forekomme NØYAKTIG ÉN gang i fila. Ellers vet vi
//      ikke hvilken gren vi målte.
//   3. Grenen hentes ut ved PARENTESTELLING fra `return (` etter vakten —
//      ikke «fra vakten og n linjer ned».
//   4. Den uttrukne blokken må IKKE inneholde noen ANNEN vaktstreng fra samme
//      fil. Det er selve anti-nabo-testen: overskjøt tellingen, ville blokken
//      svelget nabogrenen — som HAR SiteNav — og testen blitt grønn av feil
//      grunn.
//
// ── AVVIK-LISTEN, OG HVORFOR DEN NÅ ER TOM ──────────────────────────────────
// Fram til 29. august 2026 sto `loading` og `not-found` i
// app/historikk/[attemptId]/page.tsx utenfor tabellen: den filen hadde IKKE
// SiteNav i sin vellykkede retur, så nav i loading ville latt navigasjonen
// FORSVINNE i det innholdet landet — nøyaktig det hoppet en lastetilstand
// skal unngå.
//
// Beslutningen samme kveld var nav i ALLE fem grenene på den siden, og da
// faller forutsetningen bort: den vellykkede returen HAR nav nå, så loading
// har ikke lenger noe å hoppe fra. Begge grenene er flyttet til GRENER, og
// den vellykkede returen er tatt inn som egen rad (`suksess`) — nettopp
// fordi det er DEN som bar avvikets forutsetning. Mister den nav igjen, skal
// det felles her, ikke oppdages som et layout-hopp i produksjon.
//
// AVVIK sto igjen tom, med maskineriet intakt: en framtidig gren som BEVISST
// skal stå uten nav hører hjemme der, ikke utenfor tabellen.
//
// ── AVVIK ER IKKE TOM LENGER (30. august 2026) ──────────────────────────────
// Tabellen dekket fram til nå bare filer som styrer på en `loadState`-verdi.
// De to største flatene i appen gjør ikke det: app/quiz/[id]/page.tsx (9
// toppgrener) og app/org/[slug]/admin/page.tsx (4 grener foran hovedreturen)
// styrer på `loading` / `phase` / `needsWelcome`, og falt derfor helt utenfor
// — ikke som avvik, men som noe tabellen aldri hadde hørt om.
//
// Det er den samme feilklassen én etasje opp: fullstendighetstesten under er
// bundet til ÉN skriveform (`if (loadState === '…')`), så en fil som velger en
// annen form er usynlig for den. Denne runden tar de to filene inn manuelt.
// Den generelle sperren — «hver SIDE har nav, eller står i AVVIK» — er lagt i
// DEL 2 av lib/site-nav-hide-lists.test.ts, som teller sider i stedet for
// grener og derfor ikke kan omgås ved å skrive vakten annerledes.
//
// ⚠ ÆRLIG HULL: for quiz/[id] og org/[slug]/admin er det INGEN
// fullstendighetssjekk på grennivå. Fem grener i quiz/[id] står hverken i
// GRENER eller AVVIK (de HAR nav, men ingenting feller at de mister den), og
// en NY gren i noen av de to filene glir inn ubemerket. loadState-filene har
// den sperren; disse to har den ikke.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • SiteNav fjernes fra én gren → «<gren>: har navigasjon» ryker.
//   • En ny loadState-gren legges til uten nav → «alle loadState-grener er
//     dekket» ryker (tabellen er da ikke lenger komplett).
//   • Importen fjernes → «importerer SiteNav» ryker (og bygget med den).
//   • Parentestellingen overskyter → «grenen svelger ikke nabogrenen» ryker,
//     framfor at resten blir grønn på en blokk som inneholder halve fila.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Kilden uten kommentarer.
 *
 * Blokkommentarer (inkludert JSX-varianten) fjernes først; da står `{}` igjen
 * der en JSX-kommentar var, så klammebalansen uttrekket hviler på er intakt.
 * Linjekommentarer fjernes kun når linja BEGYNNER med `//`, slik at en `//`
 * inne i en streng ikke kan spise resten av linja.
 */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const KILDER = new Map<string, string>()
function src(fil: string): string {
  let s = KILDER.get(fil)
  if (s === undefined) { s = renKode(readFileSync(fil, 'utf8')); KILDER.set(fil, s) }
  return s
}

// ════════════════════════════════════════════════════════════════════════════
// MASKERING AV IKKE-KODE — grunnlaget for at en gren kan AVGRENSES
// ════════════════════════════════════════════════════════════════════════════
//
// Fram til 30. august 2026 fant uttrekket grenen ved `indexOf('return (')` fra
// vakten. Det søket har ingen øvre grense: returnerer grenen uten parentes,
// finner det bare den neste parentesreturen som finnes — hvor som helst
// nedover i fila — og måler NABOEN i stillhet.
//
// Rettelsen er ikke en avstandsterskel. En terskel er feil akse: `playing` i
// app/quiz/[id]/page.tsx har 1735 tegn mellom vakten og sin EGEN retur (≈40
// linjer const-erklæringer) og er RIKTIG, mens et bom på
// app/org/[slug]/page.tsx ville hatt 130 tegn og vært FEIL. Avstand skiller
// dem ikke.
//
// I stedet avgrenses grenen FØRST — ved klammetelling fra vaktens `{` — og
// returen søkes bare INNENFOR den. Da kan uttrekket ikke nå naboen, uansett
// avstand, og en retur inne i en callback (dybde > 0) blir ignorert.
//
// For å telle klammer må alt som ikke er kode maskeres bort.
//
// ── HVORFOR REGEX-LITTERALER MÅ MED ─────────────────────────────────────────
// app/profil/page.tsx:806 inneholder
//     const NAME_RE = /^[\p{L}\s\-']{2,40}$/u
// Den har både klammer OG en apostrof. En streng-bevisst, men regex-uvitende
// tokenizer — som `fjernKommentarer` i lib/site-nav-hide-lists.test.ts — ser
// apostrofen, tror en streng begynner, og sluker resten av fila til neste
// apostrof. Dagens `renKode` overlever kun fordi den er GROVERE: den sporer
// ikke strenger i det hele tatt, så en ubalansert apostrof kan ikke spre seg.
// Å gjenbruke den finere tokenizeren her ville altså vært en REGRESJON.
//
// ── TO JSX-UNNTAK I REGEX-GJENKJENNINGEN ────────────────────────────────────
// En `/` starter et regex-litteral bare når forrige kodetegn er en operator.
// To tegn som ellers hører hjemme i det settet er BEVISST utelatt:
//   `<`  — `</div>` er en lukketagg, aldri en regex.
//   `}`  — `<Comp x={{ a: 1 }} />` er en selvlukkende tagg, aldri en regex.
// Begge felles av selvtestene under. Uten unntakene ville masken spist ekte
// JSX mellom to skråstreker på samme linje.
//
// ── KJENT GRENSE ────────────────────────────────────────────────────────────
// `return /re/` gjenkjennes ikke som regex (forrige kodetegn er `n`). Det
// finnes ikke i repoet i dag; dukker det opp, må settet utvides med
// nøkkelord-gjenkjenning.
const REGEX_KAN_FOELGE = '(,=:[!&|?;+-*%^~'

/** Indeksen til den avsluttende `/` i et regex-litteral fra `start`, ellers -1. */
function regexSlutt(kilde: string, start: number): number {
  let j = start + 1
  let iTegnklasse = false
  while (j < kilde.length) {
    const c = kilde[j]
    if (c === '\n') return -1            // et regex-litteral kan ikke gå over linjeskift
    if (c === '\\') { j += 2; continue }
    if (c === '[') iTegnklasse = true
    else if (c === ']') iTegnklasse = false
    else if (c === '/' && !iTegnklasse) return j
    j++
  }
  return -1
}

/**
 * Erstatter alt som ikke er kode — strenginnhold, template-tekst,
 * regex-kropper og kommentarer — med mellomrom.
 *
 * LENGDEN BEVARES TEGN FOR TEGN. Det er hele poenget: vi teller klammer i
 * masken og henter teksten fra KILDEN på de samme indeksene. Blir lengden
 * ulik, peker hver eneste indeks feil — derfor har selvtesten en egen
 * lengde-assertion.
 */
function maskerIkkeKode(kilde: string): string {
  // `split('')`, IKKE `Array.from()`. Array.from splitter på KODEPUNKTER: et
  // emoji blir da ÉN plass i arrayet, mens `kilde[i]` og alle indekser vi får
  // utenfra teller UTF-16-ENHETER. Blankes et surrogatpar, krymper strengen
  // med ett tegn, og fra det punktet peker hver eneste indeks feil.
  // Medalje-emojiene på leaderboard er et bevisst unntak i designsystemet, så
  // dette er ikke en teoretisk sak — det veltet quiz/[id] og org-admin da
  // maskeren ble tatt i bruk. Felles av selvtesten «masken bevarer lengden
  // også med emoji».
  const ut = kilde.split('')
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < ut.length; k++) if (ut[k] !== '\n') ut[k] = ' '
  }

  // Template-literal: teksten maskeres, men koden inne i ${…} skal IKKE det.
  function mal(start: number): number {
    let j = start + 1
    while (j < kilde.length) {
      const c = kilde[j]
      if (c === '\\') { blank(j, j + 2); j += 2; continue }
      if (c === '`') return j + 1
      if (c === '$' && kilde[j + 1] === '{') { j = kode(j + 2, true) + 1; continue }
      if (c !== '\n') ut[j] = ' '
      j++
    }
    return j
  }

  function kode(start: number, stoppVedKlammeLukk: boolean): number {
    let i = start
    let forrige = ''
    let klammer = 0
    while (i < kilde.length) {
      const c = kilde[i], n = kilde[i + 1]

      if (c === '}' && stoppVedKlammeLukk && klammer === 0) return i
      if (c === '{') klammer++
      else if (c === '}') klammer--

      if (c === '/' && n === '/') {
        let j = i
        while (j < kilde.length && kilde[j] !== '\n') j++
        blank(i, j); i = j; continue
      }
      if (c === '/' && n === '*') {
        let j = i + 2
        while (j < kilde.length && !(kilde[j] === '*' && kilde[j + 1] === '/')) j++
        j = Math.min(j + 2, kilde.length)
        blank(i, j); i = j; continue
      }
      if (c === '"' || c === "'") {
        let j = i + 1
        // Stopper også på linjeskift: en uterminert streng skal ikke kunne
        // spise resten av fila.
        while (j < kilde.length && kilde[j] !== c && kilde[j] !== '\n') {
          if (kilde[j] === '\\') j++
          j++
        }
        blank(i + 1, j); i = j + 1; forrige = c; continue
      }
      if (c === '`') { i = mal(i); forrige = '`'; continue }
      if (c === '/' && REGEX_KAN_FOELGE.includes(forrige)) {
        const slutt = regexSlutt(kilde, i)
        if (slutt !== -1) { blank(i + 1, slutt); i = slutt + 1; forrige = '/'; continue }
      }
      if (!/\s/.test(c)) forrige = c
      i++
    }
    return i
  }

  kode(0, false)
  return ut.join('')
}

const MASKER = new Map<string, string>()
function maske(fil: string): string {
  let m = MASKER.get(fil)
  if (m === undefined) { m = maskerIkkeKode(src(fil)); MASKER.set(fil, m) }
  return m
}

/** Indeksen der klammen/parentesen som åpner på `p` lukkes, ellers -1. */
function matchendeLukk(m: string, p: number): number {
  const aapen = m[p]
  const lukk = aapen === '{' ? '}' : aapen === '(' ? ')' : ''
  if (lukk === '') return -1
  let dybde = 0
  for (let j = p; j < m.length; j++) {
    if (m[j] === aapen) dybde++
    else if (m[j] === lukk) { dybde--; if (dybde === 0) return j }
  }
  return -1
}

/**
 * Første `return` på RELATIV DYBDE 0 mellom `fra` og `til`, ellers -1.
 *
 * Dybden er det som gjør at `playing` går fint uten noen terskel: dens
 * `currentStreak`-IIFE inneholder `return s` på dybde 1 og hoppes over, mens
 * grenens egen retur står på dybde 0 — 1735 tegn unna, men inne i grenen.
 * Går dybden negativ, har vi forlatt blokken, og søket stopper.
 */
function finnEgenRetur(m: string, fra: number, til: number): number {
  let dybde = 0
  for (let j = fra; j < til && j < m.length; j++) {
    const c = m[j]
    if (c === '{' || c === '(' || c === '[') { dybde++; continue }
    if (c === '}' || c === ')' || c === ']') { dybde--; if (dybde < 0) return -1; continue }
    if (dybde === 0 && m.startsWith('return', j)) {
      const foer = j === 0 ? ' ' : m[j - 1]
      const etter = m[j + 'return'.length] ?? ' '
      if (!/[\w$]/.test(foer) && !/[\w$]/.test(etter)) return j
    }
  }
  return -1
}

// ── SELVTEST AV MASKEREN ────────────────────────────────────────────────────
// Registrert FØR tabellene, så den kjører FØRST — samme mønster som
// `fjernKommentarer` sin selvtest i lib/site-nav-hide-lists.test.ts.
//
// 31 rader hviler på denne matcheren. En feil i den gir enten 31 røde eller —
// verre — 31 GRØNNE på feil grunnlag, som er nøyaktig feilklassen hele denne
// runden handler om. Derfor melder maskeren seg selv her, i stedet for at et
// bom dukker opp som «grenen mangler navigasjon».
//
// Merk at BALANSE alene er en svak sjekk: den profil-regexen som motiverte alt
// dette (`/^[\p{L}\s\-']{2,40}$/u`) er tilfeldigvis balansert selv når
// maskeringen feiler. Derfor sjekker hver selvtest også at KODEN RUNDT
// overlever — det er den assertionen som faktisk skiller.

function klammebalanse(m: string): number {
  let d = 0
  for (const c of m) { if (c === '{') d++; else if (c === '}') d-- }
  return d
}

test('selvtest: regex-litteralet fra app/profil/page.tsx:806 velter ikke masken', () => {
  const kilde = [
    'function f() {',
    // Ordrett fra kilden. Har BÅDE klammer og en apostrof.
    "  const NAME_RE = /^[\\p{L}\\s\\-']{2,40}$/u; const etterpaa = { a: 1 }",
    '  return NAME_RE',
    '}',
  ].join('\n')
  const m = maskerIkkeKode(kilde)

  assert.equal(m.length, kilde.length, 'masken må bevare lengden — ellers peker hver indeks feil')
  assert.equal(klammebalanse(m), 0, 'regex-kroppens klammer skal være maskert bort')
  // DEN AVGJØRENDE: uten regex-håndtering starter apostrofen en «streng» som
  // blanker resten av linja, og koden etter regexen forsvinner.
  assert.ok(m.includes('const etterpaa'),
    'koden ETTER regex-litteralet på samme linje er spist — apostrofen inne i regexen ble lest som strengstart')
  assert.ok(m.includes('return NAME_RE'), 'linja under regexen skal overleve')
  assert.ok(!m.includes('2,40'), 'selve regex-kroppen skal være maskert')
})

test('selvtest: divisjon (a / b) forveksles ikke med et regex-litteral', () => {
  const kilde = 'const x = a / b; const re = /ab/; const etterpaa = { z: 1 }'
  const m = maskerIkkeKode(kilde)

  assert.equal(m.length, kilde.length)
  assert.ok(m.includes('a / b'), 'divisjon skal stå urørt')
  // Leses divisjonen som regex-start, sluker den fram til neste skråstrek og
  // spiser «const re = ».
  assert.ok(m.includes('const re'), 'divisjonen ble lest som regex-start og spiste koden etter seg')
  // Motsatt vei: droppes regex-håndteringen, står regex-kroppen igjen.
  assert.ok(!m.includes('ab'), 'regex-kroppen skal være maskert')
  assert.ok(m.includes('const etterpaa'), 'koden etter regexen skal overleve')
  assert.equal(klammebalanse(m), 0)
})

test('selvtest: template-literal med ${} som inneholder klammer', () => {
  const kilde = 'function f() { const t = `FOERTEKST${ { b: 1 } }ETTERTEKST`; return t }'
  const m = maskerIkkeKode(kilde)

  assert.equal(m.length, kilde.length)
  assert.equal(klammebalanse(m), 0, 'klammene i ${…} skal telles, malteksten skal ikke')
  assert.ok(m.includes('b: 1'), 'koden inne i ${…} er kode og skal overleve')
  assert.ok(!m.includes('FOERTEKST'), 'malteksten før ${…} skal maskeres')
  assert.ok(!m.includes('ETTERTEKST'), 'malteksten etter ${…} skal maskeres')
  assert.ok(m.includes('return t'), 'koden etter malen skal overleve')
})

test('selvtest: streng med ubalansert klamme velter ikke tellingen', () => {
  const kilde = 'function f() { const s = "en } uten make"; return s }'
  const m = maskerIkkeKode(kilde)

  assert.equal(m.length, kilde.length)
  assert.equal(klammebalanse(m), 0, 'klammen inne i strengen ble talt — funksjonen «lukkes» for tidlig')
  assert.ok(!m.includes('uten make'), 'strenginnholdet skal maskeres')
  assert.ok(m.includes('return s'), 'koden etter strengen skal overleve')
})

test('selvtest: kommentar med klamme i telles ikke', () => {
  const kilde = 'function f() { // en } i en kommentar\n  return 1\n}'
  const m = maskerIkkeKode(kilde)

  assert.equal(m.length, kilde.length)
  assert.equal(klammebalanse(m), 0, 'klammen i linjekommentaren ble talt')
  assert.ok(!m.includes('i en kommentar'), 'kommentarinnholdet skal maskeres')
  assert.ok(m.includes('return 1'), 'koden under kommentaren skal overleve')
})

test('selvtest: JSX med klammer i attributter, og lukketagger som ikke er regex', () => {
  const kilde = [
    'function f() {',
    '  return (<div style={{ margin: 0 }}><Comp x={{ a: 1 }} /><span>tekst</span></div>)',
    '}',
  ].join('\n')
  const m = maskerIkkeKode(kilde)

  assert.equal(m.length, kilde.length)
  assert.equal(klammebalanse(m), 0, 'dobbeltklammene i JSX-attributter skal telle som vanlige klammer')
  // `</span>` og `</div>` på samme linje: leses `<` som regex-start, blir alt
  // mellom de to skråstrekene maskert bort.
  assert.ok(m.includes('</span>'), '«</span>» ble spist — «<» blir lest som regex-start')
  assert.ok(m.includes('</div>'), '«</div>» ble spist')
  // `}` rett før `/>`: leses `}` som regex-start, ryker resten av taggen.
  assert.ok(m.includes('a: 1'), 'attributtkoden skal overleve')
  assert.ok(m.includes('<span>tekst</span>'), '«}» rett før «/>» ble lest som regex-start')
})

test('selvtest: masken bevarer lengden også med emoji (surrogatpar)', () => {
  // Fant en ekte feil da maskeren ble tatt i bruk: `Array.from()` splitter på
  // kodepunkter, så et emoji ble ÉN plass i arrayet mens alle indekser teller
  // UTF-16-enheter. Blanking krympet strengen, og quiz/[id] + org-admin fikk
  // «ubalanserte klammer» — en feil som pekte på grenen, ikke på maskeren.
  const kilde = 'function f() { const s = "🥇 gull 🥈 sølv"; return { s } }'
  const m = maskerIkkeKode(kilde)

  assert.equal(m.length, kilde.length,
    'masken krympet: et surrogatpar ble blanket til ÉN plass. Bruk split(\'\'), ikke Array.from().')
  assert.equal(klammebalanse(m), 0)
  assert.ok(m.includes('return { s }'), 'koden etter emoji-strengen skal overleve på riktig indeks')
})

test('selvtest: maskeren tåler den EKTE fila som motiverte den', () => {
  // Ikke en syntetisk fixture: app/profil/page.tsx er der regex-litteralet
  // faktisk står, og fila er 1367 linjer med JSX, strenger og maler.
  const fil = 'app/profil/page.tsx'
  const s = src(fil), m = maske(fil)
  assert.equal(m.length, s.length, 'lengden må bevares på den ekte fila også')
  assert.equal(klammebalanse(m), 0,
    'app/profil/page.tsx er ikke klammebalansert etter maskering — maskeren spiser eller etterlater struktur')
  assert.ok(m.includes('NAME_RE'), 'variabelnavnet skal stå igjen som kode')
  assert.ok(!m.includes('2,40'), 'regex-kroppen skal være maskert')
})

type Gren = {
  fil: string
  stat: string
  vakt: string
  /**
   * `'anker'`: vakten er IKKE en gren, men en linje rett over en toppnivå-
   * retur. Brukes av den vellykkede returen, som ikke har noen vakt å telle
   * fra. Søket er likevel bundet — `finnEgenRetur` stopper når dybden går
   * negativ, altså når vi forlater funksjonen ankeret står i.
   *
   * Feltet finnes for at en ukjent vaktform skal kunne HARDFEILE. Uten det
   * måtte parseren gjette, og en skrivefeil i en vakt (glemt `{`) ville blitt
   * stilltiende behandlet som et anker.
   */
  form?: 'anker'
}

/**
 * Grenene som SKAL ha navigasjon. `stat` er navnet på loadState-verdien
 * (eller den andre betingelsen) og brukes til fullstendighetssjekken under.
 */
const GRENER: Gren[] = [
  // /historikk/[attemptId] — ingen BackNav, ingen UserMenu, router.back()
  // fører ingensteds fra en delt lenke. Verste tilfellet i settet, og den
  // eneste fila der ALLE grenene — inkludert den vellykkede — står oppført.
  { fil: 'app/historikk/[attemptId]/page.tsx', stat: 'loading',   vakt: "if (loadState === 'loading') {" },
  { fil: 'app/historikk/[attemptId]/page.tsx', stat: 'not-found', vakt: "if (loadState === 'not-found') {" },
  { fil: 'app/historikk/[attemptId]/page.tsx', stat: 'timeout',   vakt: "if (loadState === 'timeout') {" },
  { fil: 'app/historikk/[attemptId]/page.tsx', stat: 'error',     vakt: "if (loadState === 'error' || !detail) {" },
  // Den vellykkede returen har ingen loadState-vakt. Ankeret er linja rett
  // over den, som forekommer nøyaktig én gang i fila — samme unikhetskrav
  // som de andre vaktene, håndhevet av returGren().
  { fil: 'app/historikk/[attemptId]/page.tsx', stat: 'suksess',   vakt: 'const pct = scorePct(detail.correct_answers, detail.total_questions)', form: 'anker' },

  // /historikk — historyLocked HADDE nav fra før; de to andre ikke.
  { fil: 'app/historikk/page.tsx',             stat: 'loading',  vakt: "if (loadState === 'loading') {" },
  { fil: 'app/historikk/page.tsx',             stat: 'error',    vakt: "if (loadState === 'error') {" },
  { fil: 'app/historikk/page.tsx',             stat: 'locked',   vakt: 'if (historyLocked) {' },

  { fil: 'app/liga/page.tsx',                  stat: 'loading',  vakt: "if (loadState === 'loading') return (" },
  { fil: 'app/liga/page.tsx',                  stat: 'error',    vakt: "if (loadState === 'error') return (" },
  { fil: 'app/liga/page.tsx',                  stat: 'guest',    vakt: "if (loadState === 'guest') return (" },

  { fil: 'app/liga/[slug]/page.tsx',           stat: 'loading',  vakt: "if (loadState === 'loading') return (" },
  { fil: 'app/liga/[slug]/page.tsx',           stat: 'notfound', vakt: "if (loadState === 'notfound') return (" },
  { fil: 'app/liga/[slug]/page.tsx',           stat: 'error',    vakt: "if (loadState === 'error') return (" },

  // Bruker variant="default" (ingen props) fordi den VELLYKKEDE returen i
  // samme fil gjør det: dette er selve bedriftssiden, ikke en side UNDER den,
  // så «← Tilbake til bedriften» ville pekt på seg selv.
  { fil: 'app/org/[slug]/page.tsx',            stat: 'loading',  vakt: "if (loadState === 'loading') {" },
  { fil: 'app/org/[slug]/page.tsx',            stat: 'error',    vakt: "if (loadState === 'error') {" },
  { fil: 'app/org/[slug]/page.tsx',            stat: 'notfound', vakt: "if (loadState === 'notfound') {" },

  { fil: 'app/profil/page.tsx',                stat: 'loading',  vakt: "if (loadState === 'loading') {" },
  { fil: 'app/profil/page.tsx',                stat: 'error',    vakt: "if (loadState === 'error') {" },

  // /premium/success — kvitteringen etter EKTE betaling (29. august 2026).
  // Fram til da hadde siden ingen nav i noen gren, og hver feilvei var en
  // redirect til salgssiden (den feilen felles av
  // lib/premium-success-verify.test.ts). Alle fire grenene står her, samme
  // resonnement som /historikk/[attemptId]: suksessgrenen bærer
  // forutsetningen for at loading/feil kan ha nav uten layout-hopp.
  { fil: 'app/premium/success/page.tsx',       stat: 'verifying', vakt: "if (loadState === 'verifying') {" },
  { fil: 'app/premium/success/page.tsx',       stat: 'ukjent',    vakt: "if (loadState === 'ukjent') {" },
  { fil: 'app/premium/success/page.tsx',       stat: 'nosession', vakt: "if (loadState === 'nosession') {" },
  { fil: 'app/premium/success/page.tsx',       stat: 'paid',      vakt: "if (loadState === 'paid') {" },

  // /quiz/[id] — spillesiden, ni toppgrener (30. august 2026).
  // Fem hadde nav fra før (needsLogin, already_played, register×2 og
  // resultatskjermen, som er den VELLYKKEDE returen). Disse tre var
  // forglemmelser av nøyaktig den formen denne fila finnes for: nabogrenen
  // over hadde nav, nabogrenen under hadde nav, disse ble skrevet imellom.
  // Den niende, `phase === 'playing'`, står i AVVIK — se der.
  { fil: 'app/quiz/[id]/page.tsx',             stat: 'loading',     vakt: 'if (loading) return (' },
  { fil: 'app/quiz/[id]/page.tsx',             stat: 'isSuspended', vakt: 'if (isSuspended) return (' },
  { fil: 'app/quiz/[id]/page.tsx',             stat: 'notfound',    vakt: 'if (!quiz) return (' },
]

/**
 * Grener som BEVISST ikke har nav. Se «AVVIK-LISTEN» over.
 *
 * Listen sto tom fra 29. august 2026 til 30. august 2026. Den er den
 * dokumenterte plassen et avvik skal stå — fullstendighetstesten under leser
 * ALLE = GRENER + AVVIK, så en loadState-gren som havner utenfor BEGGE
 * listene felles.
 *
 * Hver rad her er en PÅSTAND OM AT FRAVÆRET ER VALGT. Testen nederst feller
 * at raden får <SiteNav /> uten at begrunnelsen tas opp igjen.
 */
const AVVIK: Gren[] = [
  // Timeren løper, quizen er «kun én gjennomspilling», og et feiltrykk på en
  // navlenke avslutter forsøket — det finnes ingen vei tilbake inn i det.
  // Fram til 30. august 2026 var dette en UDOKUMENTERT antakelse i en fil på
  // 5000+ linjer, der tre andre nav-løse grener så helt like ut. De tre var
  // forglemmelser og fikk nav samme dag; denne skal ikke ha det. Begrunnelsen
  // står nå også i kilden, rett over vakten.
  { fil: 'app/quiz/[id]/page.tsx',       stat: 'playing', vakt: "if (phase === 'playing') {" },

  // /org/[slug]/admin — bedriftspanelet. Fire nav-løse grener foran en
  // hovedretur som HAR nav.
  //
  // De står i AVVIK og ikke i GRENER fordi fiksen her ikke er en linje:
  // hovedreturen bruker `<SiteNav variant="org-admin" orgSlug={slug}
  // orgName={data?.org.name} />`, og i loading-grenen finnes `data` ennå ikke.
  // En `<SiteNav />` uten variant ville gitt en ANNEN topplinje i lastingen enn
  // i panelet som lander — altså nettopp det layout-hoppet AVVIK-resonnementet
  // over handler om, bare med motsatt fortegn.
  //
  // Dette er derfor et ÅPENT punkt, ikke en ferdig beslutning: radene finnes
  // for at grenene skal være TALT, slik at en omlegging til global nav ikke
  // kan gå forbi dem i stillhet.
  { fil: 'app/org/[slug]/admin/page.tsx', stat: 'loading',      vakt: 'if (loading) {' },
  { fil: 'app/org/[slug]/admin/page.tsx', stat: 'error',        vakt: 'if (error) {' },
  { fil: 'app/org/[slug]/admin/page.tsx', stat: 'orgLocked',    vakt: 'if (data && session && isOrgLocked(data.org)) {' },
  { fil: 'app/org/[slug]/admin/page.tsx', stat: 'needsWelcome', vakt: 'if (needsWelcome) {' },
]

const ALLE = [...GRENER, ...AVVIK]
const FILER = [...new Set(GRENER.map(g => g.fil))]

/**
 * Innholdet i grenens egen `return ( … )`.
 *
 * REKKEFØLGEN ER POENGET: grenen avgrenses FØRST, og returen søkes bare
 * innenfor den. Motsatt vei — «finn en retur, håp at den tilhører grenen» —
 * var formen som lot uttrekket måle naboen uten å merke det.
 *
 * Tre kjente former, og bare tre:
 *   vakt slutter på `{`          → kroppen er klammegruppen
 *   vakt slutter på `return (`   → grenen ER parentesgruppen i vakten
 *   raden er merket form:'anker' → linje rett over en toppnivåretur
 * Alt annet HARDFEILER. Det er med vilje: en gjettende parser er verre enn en
 * som sier fra, fordi den gjetter seg til grønt.
 */
function returGren(fil: string, vakt: string, form?: 'anker'): string {
  const s = src(fil)
  const m = maske(fil)
  const i = s.indexOf(vakt)
  assert.notEqual(i, -1, `fant ikke vakten «${vakt}» i ${fil}`)
  assert.equal(
    i, s.lastIndexOf(vakt),
    `vakten «${vakt}» finnes flere ganger i ${fil} — da vet vi ikke hvilken gren vi måler`,
  )

  const trimmet = vakt.trimEnd()
  let returIdx: number

  if (form === 'anker') {
    returIdx = finnEgenRetur(m, i + vakt.length, m.length)
    assert.notEqual(
      returIdx, -1,
      `fant ingen retur på toppnivå etter ankeret «${vakt}» i ${fil} — står ankeret fortsatt i samme funksjon som returen?`,
    )
  } else if (trimmet.endsWith('return (')) {
    returIdx = i + trimmet.lastIndexOf('return (')
  } else if (trimmet.endsWith('{')) {
    const aapen = i + trimmet.lastIndexOf('{')
    const lukk = matchendeLukk(m, aapen)
    assert.notEqual(lukk, -1, `ubalanserte klammer i grenen «${vakt}» i ${fil}`)
    returIdx = finnEgenRetur(m, aapen + 1, lukk)
    assert.notEqual(
      returIdx, -1,
      `grenen «${vakt}» i ${fil} har ingen retur på sitt EGET toppnivå. Returnerer den bare fra en callback, eller faller den gjennom?`,
    )
  } else {
    assert.fail(
      `«${vakt}» i ${fil}: parseren kjenner ikke denne formen — utvid parseren, ikke tabellen. ` +
      `Kjente former: vakt som slutter på «{», vakt som slutter på «return (», eller en rad merket form: 'anker'.`,
    )
  }

  let p = returIdx + 'return'.length
  while (p < m.length && /\s/.test(m[p])) p++
  assert.equal(
    m[p], '(',
    `grenen «${vakt}» i ${fil} returnerer uten parentes: ${JSON.stringify(s.slice(returIdx, returIdx + 70))}. ` +
    `Da finnes ingen JSX-blokk i DENNE fila å måle — svaret bor i komponenten grenen delegerer til. ` +
    `Det krever delegasjons-støtte (trinn 2), ikke en ny rad. Fram til 30. august 2026 ble en slik gren ` +
    `stilltiende målt som naboen sin.`,
  )

  const slutt = matchendeLukk(m, p)
  assert.notEqual(slutt, -1, `ubalanserte parenteser fra «${vakt}» i ${fil}`)
  return s.slice(p, slutt + 1)
}

for (const g of ALLE) {
  const merke = `${g.fil} · ${g.stat}`

  test(`${merke}: uttrekket traff en JSX-fragment-retur`, () => {
    const blokk = returGren(g.fil, g.vakt, g.form)
    assert.match(
      blokk.slice(0, 40), /^\(\s*<>/,
      'blokken starter ikke med «( <>» — uttrekket traff noe annet enn grenens retur',
    )
  })

  test(`${merke}: grenen svelger ikke nabogrenen`, () => {
    const blokk = returGren(g.fil, g.vakt, g.form)
    for (const annen of ALLE) {
      if (annen.fil !== g.fil || annen.vakt === g.vakt) continue
      assert.ok(
        !blokk.includes(annen.vakt),
        `blokken for ${merke} inneholder vakten «${annen.vakt}» — parentestellingen overskjøt, og et treff på SiteNav kan komme fra nabogrenen`,
      )
    }
  })
}

for (const fil of [...new Set(ALLE.map(g => g.fil))]) {
  test(`${fil}: to vakter måler ikke SAMME blokk`, () => {
    // Det fjerde forsvaret i topplisten fanger at uttrekket SVELGER en
    // nabogren. Det fanger IKKE at uttrekket BOMMER på sin egen og lander helt
    // inne i naboens — da inneholder blokken ingen fremmed vakt, og alt ser
    // riktig ut.
    //
    // Slik skjer det: står grenen som `return <Komponent />` uten parentes,
    // finner `s.indexOf('return (', i)` den NESTE grenens retur i stedet.
    // Nøyaktig det gjorde `isOrgLocked` i app/org/[slug]/admin/page.tsx fram
    // til 30. august 2026 — den målte needsWelcome-grenen, og begge sto som
    // AVVIK, så begge var grønne på en blokk bare den ene av dem eide.
    //
    // To vakter i samme fil som gir identisk blokk kan derfor ikke være riktig.
    const sett = new Map<string, string>()
    for (const g of ALLE.filter(x => x.fil === fil)) {
      const blokk = returGren(g.fil, g.vakt, g.form)
      const eier = sett.get(blokk)
      assert.equal(
        eier, undefined,
        `«${g.vakt}» og «${eier}» gir NØYAKTIG samme blokk i ${fil}. Da eier ` +
        `minst én av dem ikke det den måles på — som regel fordi grenen står ` +
        `som «return <Komponent />» uten «return (». Gi den et eksplisitt ` +
        `return ( <> … </> ), slik isOrgLocked fikk 30. august 2026.`,
      )
      sett.set(blokk, g.vakt)
    }
  })
}

for (const g of GRENER) {
  test(`${g.fil} · ${g.stat}: har navigasjon`, () => {
    const blokk = returGren(g.fil, g.vakt, g.form)
    assert.ok(
      blokk.includes('<SiteNav'),
      `${g.stat}-grenen i ${g.fil} rendrer ingen <SiteNav /> — brukeren står uten utvei på nettopp den skjermen`,
    )
  })
}

for (const g of AVVIK) {
  test(`${g.fil} · ${g.stat}: BEVISST uten navigasjon (dokumentert avvik)`, () => {
    const blokk = returGren(g.fil, g.vakt, g.form)
    assert.ok(
      !blokk.includes('<SiteNav'),
      `${g.stat}-grenen i ${g.fil} har fått <SiteNav />. Det kan være riktig — men da må den VELLYKKEDE returen i samme fil få den også, ellers forsvinner navigasjonen når innholdet lander. Flytt grenen fra AVVIK til GRENER i samme runde.`,
    )
  })
}

for (const fil of FILER) {
  test(`${fil}: importerer SiteNav`, () => {
    assert.match(
      src(fil), /^import SiteNav from '@\/components\/SiteNav'$/m,
      `${fil} importerer ikke SiteNav`,
    )
  })

  test(`${fil}: alle loadState-grener er dekket av tabellen`, () => {
    // Fanger at en NY loadState-gren legges til uten nav: da står den hverken
    // i GRENER eller AVVIK, og tabellen er ikke lenger komplett.
    const funnet = [...src(fil).matchAll(/^\s*if \(loadState === '([a-z-]+)'[^)]*\)\s*(?:\{|return \()/gm)].map(m => m[1])
    const dekket = new Set(ALLE.filter(g => g.fil === fil).map(g => g.stat))
    const udekket = funnet.filter(s => !dekket.has(s))
    assert.deepEqual(
      udekket, [],
      `${fil} har loadState-gren(er) som hverken står i GRENER eller AVVIK: ${udekket.join(', ')}. Legg dem i riktig liste — en ny feilskjerm uten navigasjon skal ikke kunne gli inn ubemerket.`,
    )
  })
}
