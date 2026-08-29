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
// AVVIK står igjen tom, med maskineriet intakt: en framtidig gren som
// BEVISST skal stå uten nav hører hjemme der, ikke utenfor tabellen.
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

type Gren = { fil: string; stat: string; vakt: string }

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
  { fil: 'app/historikk/[attemptId]/page.tsx', stat: 'suksess',   vakt: 'const pct = scorePct(detail.correct_answers, detail.total_questions)' },

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
]

/**
 * loadState-grener som BEVISST ikke har nav. Se «AVVIK-LISTEN» over.
 *
 * Tom per 29. august 2026. Listen beholdes fordi den er den dokumenterte
 * plassen et framtidig avvik skal stå — fullstendighetstesten under leser
 * ALLE = GRENER + AVVIK, så en gren som havner utenfor BEGGE listene felles.
 */
const AVVIK: Gren[] = []

const ALLE = [...GRENER, ...AVVIK]
const FILER = [...new Set(GRENER.map(g => g.fil))]

/**
 * Innholdet i `return ( … )` etter `vakt`, funnet ved parentestelling.
 *
 * Parentestelling, ikke «n linjer fra vakten»: grenene er 3–35 linjer lange,
 * og en linjegrense ville enten kuttet en lang gren (falsk negativ) eller
 * svelget nabogrenen (falsk positiv).
 */
function returGren(fil: string, vakt: string): string {
  const s = src(fil)
  const i = s.indexOf(vakt)
  assert.notEqual(i, -1, `fant ikke vakten «${vakt}» i ${fil}`)
  assert.equal(
    i, s.lastIndexOf(vakt),
    `vakten «${vakt}» finnes flere ganger i ${fil} — da vet vi ikke hvilken gren vi måler`,
  )

  const r = s.indexOf('return (', i)
  assert.notEqual(r, -1, `fant ingen «return (» etter «${vakt}» i ${fil}`)
  const start = r + 'return '.length

  let dybde = 0
  for (let j = start; j < s.length; j++) {
    const c = s[j]
    if (c === '(') dybde++
    else if (c === ')') {
      dybde--
      if (dybde === 0) return s.slice(start, j + 1)
    }
  }
  throw new Error(`ubalanserte parenteser fra «${vakt}» i ${fil}`)
}

for (const g of ALLE) {
  const merke = `${g.fil} · ${g.stat}`

  test(`${merke}: uttrekket traff en JSX-fragment-retur`, () => {
    const blokk = returGren(g.fil, g.vakt)
    assert.match(
      blokk.slice(0, 40), /^\(\s*<>/,
      'blokken starter ikke med «( <>» — uttrekket traff noe annet enn grenens retur',
    )
  })

  test(`${merke}: grenen svelger ikke nabogrenen`, () => {
    const blokk = returGren(g.fil, g.vakt)
    for (const annen of ALLE) {
      if (annen.fil !== g.fil || annen.vakt === g.vakt) continue
      assert.ok(
        !blokk.includes(annen.vakt),
        `blokken for ${merke} inneholder vakten «${annen.vakt}» — parentestellingen overskjøt, og et treff på SiteNav kan komme fra nabogrenen`,
      )
    }
  })
}

for (const g of GRENER) {
  test(`${g.fil} · ${g.stat}: har navigasjon`, () => {
    const blokk = returGren(g.fil, g.vakt)
    assert.ok(
      blokk.includes('<SiteNav'),
      `${g.stat}-grenen i ${g.fil} rendrer ingen <SiteNav /> — brukeren står uten utvei på nettopp den skjermen`,
    )
  })
}

for (const g of AVVIK) {
  test(`${g.fil} · ${g.stat}: BEVISST uten navigasjon (dokumentert avvik)`, () => {
    const blokk = returGren(g.fil, g.vakt)
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
