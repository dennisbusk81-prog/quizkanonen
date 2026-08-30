// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: at «Arkivet» står i konto-menyen — nå ÉN komponent,
// components/NavAuth.tsx (dropdownen i SiteNav-baren).
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// Fram til B-30/A2 steg 2 fantes konto-menyen i to bevisste tvillinger
// (NavAuth + UserMenu, den globale flytende pillen), og denne filen voktet at
// arkivlenken sto i begge. UserMenu er pensjonert (steg 2) — de sju
// elementene den hadde alene ble flyttet inn i NavAuth i steg 1 (c47b87f),
// og nav-en er global via components/GlobalNav.tsx. MENYFILER-løkka under er
// beholdt med vilje: får menyen noen gang en tvilling igjen, er det én
// listelinje å legge til, og hele vakten gjelder den nye fila.
//
// Fram til 30. august 2026 hadde /arkiv tre innganger, og alle var dårlige:
// /historikk (Premium-only — kan aldri være noens FØRSTE møte), /quizer (uten
// desktop-navlenke, kun i hamburgeren som er skjult over 640px) og
// resultatskjermen etter en arkivrunde (forutsetter at du allerede er der). En
// uinnlogget desktop-besøkende hadde null vei inn.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/historikk-arkivlenke-wiring.test.ts og lib/sitenav-error-states.test.ts —
// npm test kjører kun lib/**/*.test.ts under Node sin egen runner, uten jsdom,
// og flatene er 400–500-linjers klientkomponenter.
//
// ── KOMMENTARER MÅ STRIPPES, ELLERS ER TESTEN GRØNN AV FEIL GRUNN ───────────
// Kildekommentarene over lenken forklarer i prosa hvorfor den står uten
// lås-badge og utenfor profileLoaded-gaten, og nevner derfor både «Arkivet»,
// «Premium» og «isPremium» ordrett. En naiv tekstsjekk ville lest dem som kode.
// `renKode()` fjerner blokkommentarer FØR noe måles. At `{/* … */}` blir
// stående igjen som `{}` er med vilje: klammene balanserer, så posisjons-
// sammenligningene under er ikke avhengige av at kommentaren forsvant sporløst.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Lenken slettes → «arkivlenken finnes» ryker. /arkiv mister da sin
//     eneste ugatede desktop-inngang.
//   • Lenken flyttes ut av konto-menyen (f.eks. ned til hamburgeren i NavAuth)
//     → «står mellom Mine ligaer og Quizhistorikk» ryker.
//   • Lenken får en Premium-lås-badge → «bærer ingen lås-markering» ryker.
//   • Lenken pakkes inn i profileLoaded-gaten sammen med Quizhistorikk →
//     «står utenfor profileLoaded-gaten» ryker.
//   • Lenken gis gullfarge → «bruker ikke gull» ryker.
//   • Ankeret slutter å treffe (menyen skrives om) → «ankrene forekommer
//     nøyaktig én gang» ryker, framfor at resten blir grønn på tomme treff.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Filene som implementerer konto-menyen. Hver må bestå hver test under. */
const MENYFILER = [
  'components/NavAuth.tsx',
] as const

/**
 * Kilden uten kommentarer.
 *
 * Blokkommentarer (`/* … *\/`, inkludert JSX-varianten `{/* … *\/}`) fjernes
 * først; da står `{}` igjen der en JSX-kommentar var. Linjekommentarer fjernes
 * kun når linja BEGYNNER med `//`, slik at en `//` inne i en streng ikke kan
 * spise resten av linja.
 */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

function les(fil: string): string {
  return renKode(readFileSync(fil, 'utf8'))
}

const ARKIV_HREF = 'href="/arkiv"'

/**
 * Selve `<a …>…</a>`-elementet som bærer arkivlenken: fra den nærmeste `<a`
 * FØR href-en, til første `</a>` etter.
 *
 * Uttrekket er poenget med lås-badge- og gull-testene: en `Premium`-streng
 * eller en gullfarge et vilkårlig annet sted i menyen (Quizhistorikk har
 * begge deler) skal ikke kunne felle dem, og heller ikke skjule dem.
 */
function arkivElement(src: string, fil: string): string {
  const href = src.indexOf(ARKIV_HREF)
  assert.notEqual(href, -1, `fant ikke ${ARKIV_HREF} i ${fil}`)
  const start = src.lastIndexOf('<a', href)
  assert.notEqual(start, -1, `fant ingen <a foran ${ARKIV_HREF} i ${fil}`)
  const slutt = src.indexOf('</a>', href)
  assert.notEqual(slutt, -1, `fant ingen </a> etter ${ARKIV_HREF} i ${fil}`)
  return src.slice(start, slutt + 4)
}

for (const fil of MENYFILER) {
  test(`${fil}: ankrene forekommer nøyaktig én gang — posisjonstestene måler riktig sted`, () => {
    // Uten dette ville en posisjonssammenligning kunne peke på feil forekomst,
    // og «grønn» ikke bety noe. «Mine ligaer» og «Quizhistorikk» finnes kun i
    // konto-menyen; hamburgeren i NavAuth har «Ligaer», ikke «Mine ligaer».
    const src = les(fil)
    for (const anker of ['Mine ligaer', 'Quizhistorikk', ARKIV_HREF]) {
      const antall = src.split(anker).length - 1
      assert.equal(
        antall,
        1,
        `fant ${antall} forekomster av «${anker}» i ${fil} — ankeret er ikke lenger entydig, ` +
          'og posisjonstestene under kan måle feil sted. Skriv testen om, ikke slett den.'
      )
    }
  })

  test(`${fil}: arkivlenken finnes i det hele tatt`, () => {
    // DEN sentrale testen. Slettes lenken fra ÉN av tvillingene, ryker denne
    // for den fila alene — som er nøyaktig den halve endringen filen finnes for.
    const src = les(fil)
    assert.match(
      src,
      /href="\/arkiv"/,
      `inngangen til /arkiv er borte fra ${fil}. Da mangler arkivet i konto-menyen på ` +
        'hver side som rendrer denne komponenten — og /arkiv har ingen annen ugatet ' +
        'desktop-inngang.'
    )
    assert.match(
      arkivElement(src, fil),
      /Arkivet/,
      `lenken til /arkiv i ${fil} har ikke lenger teksten «Arkivet»`
    )
  })

  test(`${fil}: arkivlenken står mellom «Mine ligaer» og «Quizhistorikk»`, () => {
    // Plasseringen er bestillingen, men den er også det som beviser at lenken
    // ligger i KONTO-menyen og ikke er flyttet ut i hamburgeren eller topplinja.
    const src = les(fil)
    const ligaer = src.indexOf('Mine ligaer')
    const arkiv = src.indexOf(ARKIV_HREF)
    const historikk = src.indexOf('Quizhistorikk')
    assert.ok(
      ligaer < arkiv,
      `arkivlenken i ${fil} ligger FØR «Mine ligaer» — den er flyttet ut av sin plass i menyen`
    )
    assert.ok(
      arkiv < historikk,
      `arkivlenken i ${fil} ligger ETTER «Quizhistorikk» — den er flyttet ut av sin plass i menyen`
    )
  })

  test(`${fil}: arkivlenken bærer ingen Premium-lås-markering`, () => {
    // Arkivet er IKKE låst: /arkiv-listen er ugatet med vilje, og en
    // gratisbruker ser hele listen med Premium-piller der «Spill» ville stått,
    // pluss et forklaringskort. Det er selve konverteringsflaten. En lås i
    // menyen ville sagt at siden er stengt, og ført gratisbrukeren bort fra
    // den. Låsen hører hjemme på RADENE inne på siden, ikke på inngangen.
    const el = arkivElement(les(fil), fil)
    assert.doesNotMatch(
      el,
      /Premium/,
      `arkivlenken i ${fil} har fått en Premium-markering. Arkivlisten er ugatet — ` +
        'det er spillingen som krever Premium. En lås her er direkte misvisende og ' +
        'stenger gratisbrukeren ute fra konverteringsflaten.'
    )
  })

  test(`${fil}: arkivlenken står UTENFOR profileLoaded-gaten`, () => {
    // Gaten finnes for å hindre at en Premium-bruker ser LÅST variant av
    // Quizhistorikk i blaffet før profilen har landet. Arkivlenken har ingen
    // låst variant, så den skal vises med én gang — havner den innenfor
    // gaten, blinker den unødig inn på hver sidelast.
    const src = les(fil)
    const el = arkivElement(src, fil)
    assert.doesNotMatch(
      el,
      /isPremium/,
      `arkivlenken i ${fil} er blitt betinget av isPremium — den skal vises likt for alle innloggede`
    )
    const historikk = src.indexOf('Quizhistorikk')
    const gate = src.lastIndexOf('{profileLoaded &&', historikk)
    assert.notEqual(
      gate,
      -1,
      `fant ingen profileLoaded-gate foran «Quizhistorikk» i ${fil} — er gaten fjernet? ` +
        'Da må denne testen skrives om, ikke slettes.'
    )
    assert.ok(
      src.indexOf(ARKIV_HREF) < gate,
      `arkivlenken i ${fil} er havnet INNE i profileLoaded-gaten sammen med Quizhistorikk. ` +
        'Den trenger ingen profildata og skal rendres med én gang.'
    )
  })

  test(`${fil}: arkivlenken bruker ikke gull`, () => {
    // To-gule-regelen: menyen har allerede gull i avatar-initialen, i
    // Premium-badgen på Quizhistorikk og på «Mitt abonnement» /
    // «Oppgrader til Premium». Arkivlenken er en vanlig navigasjonslenke og
    // skal ha brødtekstfargen.
    const el = arkivElement(les(fil), fil)
    assert.doesNotMatch(
      el,
      /c9a84c|201,168,76/,
      `arkivlenken i ${fil} bruker gull. Den er ikke en primærhandling, og menyen har ` +
        'allerede flere gullelementer.'
    )
    // NavAuth bruker den delte `menuItem`-konstanten (som selv setter
    // #e8e4dd); inline #e8e4dd godtas også (formen UserMenu brukte før den
    // ble pensjonert) — det som felles er en lenke uten brødtekstfargen.
    assert.match(
      el,
      /#e8e4dd|style=\{menuItem\}/,
      `arkivlenken i ${fil} har verken #e8e4dd inline eller den delte menuItem-stilen`
    )
  })
}
