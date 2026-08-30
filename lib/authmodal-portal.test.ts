// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: AuthModal skal rendres gjennom createPortal til
// document.body — ikke inline der kalleren står.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// Et element med `filter`/`backdrop-filter`/`transform` på en FORFAR blir
// containing block for `position: fixed`-etterkommere. Da NavAuth begynte å
// rendre AuthModal inne i SiteNavs <nav> (backdropFilter: blur(12px),
// c47b87f, 30. august 2026), målte overlegget 1280×54 — nav-baren, ikke
// viewporten. I prod: «tom» modal med kun lukkekryss, dimmet navlinje, og en
// scrollbar inne i 54-pikselstripen. Innloggingen var i praksis ødelagt fra
// navlinjen på alle SiteNav-sider.
//
// Fiksen bor VED SINKET (samme prinsipp som escapeHtml i email-templates og
// scrubEvent i sentry-scrub): modalen porterer seg selv til document.body og
// er trygg uansett hvor den kalles fra. I B-30/A2 steg 2 blir SiteNav global
// på alle sider — en fiks hos kalleren ville armert fella permanent for
// enhver framtidig kaller inne i nav-en.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/kontomeny-arkivlenke.test.ts og lib/sitenav-error-states.test.ts —
// npm test kjører kun lib/**/*.test.ts under Node sin egen runner, uten
// jsdom, og containing block-effekten finnes uansett bare i en ekte
// nettleser. Den visuelle verifiseringen (rect-måling: overlegg = viewport)
// er gjort manuelt; denne testen holder STRUKTUREN som gjorde den sann.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • createPortal-kallet fjernes (return <div …> igjen) → «rendres gjennom
//     createPortal» ryker.
//   • Importen fjernes → «importerer createPortal fra react-dom» ryker (og
//     bygget med den).
//   • Portalen flyttes FORAN open-guarden → «portalen nås først etter
//     open-guarden» ryker: da rendres portalen også under SSR-passet, der
//     document ikke finnes.
//   • Målet byttes fra document.body til noe annet → «porterer til
//     document.body» ryker.
//   • Guarden skrives om → «ankrene forekommer nøyaktig én gang» ryker,
//     framfor at posisjonstesten blir grønn på tomme treff.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Kilden uten kommentarer. Blokkommentarer fjernes først; linjekommentarer
 * kun når linja BEGYNNER med `//`, slik at `//` inne i en streng ikke spiser
 * resten av linja. Samme form som lib/kontomeny-arkivlenke.test.ts — og
 * nødvendig her: kildekommentaren over portalen i AuthModal.tsx nevner både
 * «createPortal» (via testnavnet) og «document» i prosa.
 */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const FIL = 'components/AuthModal.tsx'
const src = renKode(readFileSync(FIL, 'utf8'))

const IMPORT_ANKER = "import { createPortal } from 'react-dom'"
const GUARD_ANKER = 'if (!open) return null'
const PORTAL_ANKER = 'return createPortal('
// Merk: `document.body` alene er IKKE entydig i fila — scroll-låse-effekten
// bruker `document.body.style.overflow` to steder. Portal-målet gjenkjennes
// derfor på formen «</div>, document.body )»: JSX-en etterfulgt av
// container-argumentet. Bare portal-kallet har et komma etter rot-elementet.
const MÅL_REGEX = /<\/div>,\s*document\.body\s*\)/g

test('ankrene forekommer nøyaktig én gang — posisjonstesten måler riktig sted', () => {
  // Uten dette kan indexOf-sammenligningen under peke på feil forekomst, og
  // «grønn» ikke bety noe.
  const målTreff = [...src.matchAll(MÅL_REGEX)]
  assert.equal(
    målTreff.length,
    1,
    `fant ${målTreff.length} forekomster av portal-målet «</div>, document.body)» i ${FIL} — ` +
      'ankeret er ikke lenger entydig. Skriv testen om, ikke slett den.'
  )
  for (const anker of [IMPORT_ANKER, GUARD_ANKER, PORTAL_ANKER]) {
    const antall = src.split(anker).length - 1
    assert.equal(
      antall,
      1,
      `fant ${antall} forekomster av «${anker}» i ${FIL} — ankeret er ikke lenger entydig. ` +
        'Skriv testen om, ikke slett den.'
    )
  }
})

test('AuthModal importerer createPortal fra react-dom', () => {
  assert.ok(
    src.includes(IMPORT_ANKER),
    `${FIL} importerer ikke lenger createPortal — da kan komponenten heller ikke portere seg til body`
  )
})

test('AuthModal rendres gjennom createPortal og porterer til document.body', () => {
  // DEN sentrale testen. Fjernes portalen, rendres modalen inline hos
  // kalleren — og en kaller inne i et element med backdrop-filter (SiteNav)
  // får et overlegg som er forankret i nav-baren i stedet for viewporten.
  const portal = src.indexOf(PORTAL_ANKER)
  assert.notEqual(
    portal,
    -1,
    `${FIL} returnerer ikke lenger via createPortal(…) — modalen er inline igjen, ` +
      'og ødelagt for enhver kaller inne i SiteNav (backdrop-filter = containing ' +
      'block for position: fixed)'
  )
  const mål = src.slice(portal).match(MÅL_REGEX)
  assert.ok(
    mål,
    `fant ikke «</div>, document.body)» etter createPortal-kallet i ${FIL} — er portal-målet byttet?`
  )
})

test('portalen nås først etter open-guarden — SSR rendrer aldri portalen', () => {
  // createPortal krever et DOM-element, og document finnes ikke under
  // server-passet. Tryggheten hviler på at `if (!open) return null` står FØR
  // portal-returen og at open starter false hos alle kallere — havner
  // portalen foran guarden, krasjer SSR på hver side som monterer modalen.
  assert.ok(
    src.indexOf(GUARD_ANKER) < src.indexOf(PORTAL_ANKER),
    `open-guarden står ikke lenger foran createPortal-returen i ${FIL}`
  )
})
