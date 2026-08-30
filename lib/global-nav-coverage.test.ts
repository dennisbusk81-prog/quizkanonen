// Kjøres med:  npm test
//
// VAKTEN FOR DEN GLOBALE NAV-MODELLEN (B-30/A2 steg 2). Arvtakeren til
// lib/site-nav-hide-lists.test.ts, som døde med skjule-listene den voktet:
// DEL 1 der (to synkroniserte skjule-lister i UserMenu/BackNav) har ingen
// motpart lenger, DEL 2 (har flaten nav i det hele tatt?) er gjenfødt her,
// og B-27/B-18-registrene (dobbel meny / inert wrapper) er slettet fordi
// fenomenene ikke kan eksistere uten UserMenuWrapper.
//
// DEN STORE FORSKJELLEN fra forgjengeren: opt-out-registeret og matcheren bor
// i lib/global-nav-routes.ts og IMPORTERES og KJØRES direkte — nøyaktig samme
// kode som components/GlobalNav.tsx bruker i produksjon. Forgjengeren måtte
// regex-parse predikater ut av 'use client'-kilde, med tokenizer og
// selvtester for at parsingen ikke skulle lyve. Det maskineriet trengs kun
// ett sted her: `harSiteNav`-deteksjonen leser fortsatt sidekilde, og
// kommentarer strippes med renKode() så prosa om SiteNav ikke teller som
// rendering.
//
// Kun page.tsx skannes. loading.tsx/error-flater trenger ingen rad lenger:
// de rendres INNE i rot-layouten og arver den globale nav-en av konstruksjon
// — det var to av de åpne punktene i den gamle modellen.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Matcheren skrives om til prefiks-form (startsWith) → begge
//     /quizer-testene ryker: '/quiz'-mønstrene ville da slukt /quizer, som
//     skal leve av den globale nav-en.
//   • En rad fjernes fra opt-out uten at sidens lokale <SiteNav /> fjernes →
//     «hver side med egen SiteNav står i opt-out» ryker (dobbel nav).
//   • En side opt-outes uten hverken SiteNav eller UTEN_NAV-rad → «hver
//     opt-out-side uten egen SiteNav står i UTEN_NAV» ryker (navløs flate).
//   • NavErrorBoundary fjernes rundt GlobalNav i app/layout.tsx →
//     layout-testen ryker: en ufanget krasj i en layout-montert
//     klientkomponent blanker hele appen.
//   • Et mønster blir stående etter at siden det gjaldt er borte →
//     «ingen foreldede mønstre» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { GLOBAL_NAV_OPT_OUT, hasGlobalNav, matchesRoutePattern } from './global-nav-routes'

const ROT = join(import.meta.dirname, '..')

/**
 * Kilden uten kommentarer. Blokkommentarer fjernes først; linjekommentarer
 * kun når linja BEGYNNER med `//`. Bevisst GROV (sporer ikke strenger):
 * en streng-bevisst tokenizer veltet på regex-litteraler som
 * `/^[\p{L}\s\-']{2,40}$/u` i app/profil/page.tsx — apostrofen ble lest som
 * strengstart. Ikke bytt til en «finere» tokenizer uten regex-støtte.
 */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

function finnSider(dir: string, funnet: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      // app/api har ingen ruteflater, kun route.ts — hopp over hele treet.
      if (e.name === 'api') continue
      finnSider(p, funnet)
    } else if (e.name === 'page.tsx') funnet.push(p)
  }
  return funnet
}

/**
 * Filsti → et KONKRET pathname matcheren kan evalueres mot. Rutegrupper
 * `(navn)` faller bort (de er ikke i URL-en), og dynamiske segmenter
 * `[param]` byttes med 'x' — i motsetning til forgjengerens tilRute(), som
 * KUTTET ved første dynamiske segment og dermed ikke kunne skille
 * /org/<slug> fra /org/<slug>/admin.
 */
function tilPathname(filsti: string): string {
  const rel = filsti.slice(join(ROT, 'app').length + 1)
  const segmenter: string[] = []
  for (const s of rel.split(sep).slice(0, -1)) {
    if (s.startsWith('(') && s.endsWith(')')) continue
    segmenter.push(s.startsWith('[') ? 'x' : s)
  }
  return '/' + segmenter.join('/')
}

type Flate = {
  fil: string        // repo-relativ, med skråstrek — nøkkelen i UTEN_NAV
  pathname: string
  harSiteNav: boolean
  harGlobalNav: boolean
}

const FLATER: Flate[] = finnSider(join(ROT, 'app'))
  .map(f => {
    const fil = f.slice(ROT.length + 1).split(sep).join('/')
    const pathname = tilPathname(f)
    return {
      fil,
      pathname,
      harSiteNav: /<SiteNav[\s/>]/.test(renKode(readFileSync(f, 'utf8'))),
      harGlobalNav: hasGlobalNav(pathname),
    }
  })
  .sort((a, b) => a.fil.localeCompare(b.fil))

// ════════════════════════════════════════════════════════════════════════════
// DEL A — SEGMENTMATCHEREN. Ikke prefiks. Aldri prefiks.
// ════════════════════════════════════════════════════════════════════════════

test('segmentmatcheren skiller /quiz fra /quizer — prefiks-matching felles her', () => {
  // DEN VIKTIGSTE TESTEN I FILA. `startsWith('/quiz')` treffer '/quizer' —
  // det sammentreffet bar den gamle skjule-modellen og er en FELLE i denne:
  // /quizer skal leve av den globale nav-en, og en prefiks-matcher ville
  // gjort quizoversikten navløs i det stille.
  assert.equal(matchesRoutePattern('/quiz', '/quizer'), false,
    "mønsteret '/quiz' matcher '/quizer' — matcheren er blitt prefiksbasert")
  assert.equal(matchesRoutePattern('/quiz/*', '/quizer'), false,
    "mønsteret '/quiz/*' matcher '/quizer' — matcheren er blitt prefiksbasert")
  assert.equal(matchesRoutePattern('/quiz/*', '/quiz/abc123'), true,
    "'/quiz/*' matcher ikke lenger spillesiden /quiz/<id>")
})

test('/quizer dekkes KUN av sin egen rad i registeret', () => {
  // Evaluerer registeret UTEN '/quizer'-raden: ingen annen rad skal dekke
  // den. Overlever steg 3 (raden fjernes → /quizer skal ha global nav), og
  // feller både en prefiks-matcher og et framtidig bredt '/quiz'-mønster.
  const andreRader = Object.keys(GLOBAL_NAV_OPT_OUT).filter(m => m !== '/quizer')
  const dekketAv = andreRader.filter(m => matchesRoutePattern(m, '/quizer'))
  assert.deepEqual(dekketAv, [],
    '/quizer dekkes av andre rader enn sin egen — quizoversikten mister da ' +
    'den globale nav-en uten at noen fjernet den med vilje')
})

test('matcher-semantikk: eksakt, *, ** — grensene som bærer registeret', () => {
  // Hver assertion her tilsvarer en konkret side som ville mistet eller fått
  // feil nav om semantikken glir.
  assert.equal(matchesRoutePattern('/', '/'), true)
  assert.equal(matchesRoutePattern('/', '/arkiv'), false, "'/' skal kun matche forsiden")
  assert.equal(matchesRoutePattern('/bedrift', '/bedrift/success'), false,
    'eksakt segment har fått prefiks-oppførsel — /bedrift/success mister da B-18-fiksen sin')
  assert.equal(matchesRoutePattern('/org/*', '/org/elkjop'), true)
  assert.equal(matchesRoutePattern('/org/*', '/org/elkjop/velkommen'), false,
    "'*' matcher mer enn ett segment — veiviseren mister da B-18-fiksen sin")
  assert.equal(matchesRoutePattern('/org/*/admin', '/org/elkjop/admin'), true)
  assert.equal(matchesRoutePattern('/liga/*', '/liga/bli-med/tok123'), false,
    "'*' matcher mer enn ett segment — liga-invitasjonen blir navløs igjen")
  assert.equal(matchesRoutePattern('/admin/**', '/admin'), true,
    "'**' skal også matche null gjenværende segmenter — /admin selv")
  assert.equal(matchesRoutePattern('/admin/**', '/admin/quizzes/abc/analytics'), true)
  assert.equal(matchesRoutePattern('/admin/**', '/administrasjon'), false,
    "'**'-mønsteret har fått prefiks-oppførsel på segmentet foran")
})

// ════════════════════════════════════════════════════════════════════════════
// DEL B — VAKT MOT STILLE UTVINNINGSSVIKT
// ════════════════════════════════════════════════════════════════════════════

test('vakt: flate-oversikten er faktisk bygget', () => {
  // Slutter finnSider, tilPathname eller SiteNav-deteksjonen å virke, skal
  // feilen si DET — ikke «alle flatene mangler i registeret».
  assert.ok(FLATER.length >= 45,
    `fant bare ${FLATER.length} page.tsx under app/ — er finnSider ødelagt?`)
  // ≥ 4, ikke dagens 17: de fire VARIGE prop-sidene (/, /quiz/[id],
  // /leaderboard/[id], /org/[slug]/admin) beholder lokal SiteNav også etter
  // steg 3, så denne nedre grensen skal aldri måtte røres igjen.
  assert.ok(FLATER.filter(f => f.harSiteNav).length >= 4,
    'fant nesten ingen flater med <SiteNav /> — er deteksjonen ødelagt?')
  assert.ok(Object.keys(GLOBAL_NAV_OPT_OUT).length >= 5,
    'opt-out-registeret er nesten tomt — er importen fra lib/global-nav-routes brutt?')
})

// ════════════════════════════════════════════════════════════════════════════
// DEL C — DOBBEL-MENY-VAKTEN (arvtaker etter gamle DEL 1)
// ════════════════════════════════════════════════════════════════════════════

test('hver side med egen <SiteNav /> står i opt-out — ellers dobbel nav', () => {
  // Feilretningen som GJENSTÅR i den nye modellen: en side som rendrer sin
  // egen SiteNav og samtidig får den globale, viser to identiske navlinjer
  // over hverandre. Steg 3 fjerner lokale SiteNav-er — DENNE testen er
  // grunnen til at raden i registeret må fjernes i samme commit.
  const dobbel = FLATER.filter(f => f.harSiteNav && f.harGlobalNav).map(f => f.fil)
  assert.deepEqual(dobbel, [],
    'disse sidene rendrer egen <SiteNav /> uten å stå i opt-out-registeret — ' +
    'de får to navlinjer oppå hverandre:\n  ' + dobbel.join('\n  '))
})

// ════════════════════════════════════════════════════════════════════════════
// DEL D — NAVLØS-VAKTEN (gamle DEL 2, gjenfødt mot opt-out-registeret)
// ════════════════════════════════════════════════════════════════════════════

const ADMIN_GRUNN =
  'Admin-intern flate med én operatør, bevisst utenfor SiteNav-utrullingen. ' +
  'Undersidene har sin egen «← Admin»-lenke tilbake til navet, og /admin har ' +
  '«Se siden ↗» ut til den offentlige siden.'

/**
 * REGISTER over flater som er opt-out OG ikke har egen SiteNav — altså helt
 * uten navigasjon. Nøkkel = repo-relativ sti, verdi = hvorfor fraværet står.
 * Toveis: både en uregistrert navløs flate og en foreldet rad gjør fila rød.
 *
 * Merk hvor mye kortere denne er enn forgjengerens UTEN_NAV (23 rader):
 * loading-flatene, /liga/bli-med, /founders/success, /bedrift/success og
 * org-veiviseren fikk alle nav av selve omleggingen. Kun admin står igjen.
 */
const UTEN_NAV: Record<string, string> = {
  'app/admin/page.tsx': ADMIN_GRUNN,
  'app/admin/classics/page.tsx': ADMIN_GRUNN,
  'app/admin/codes/page.tsx': ADMIN_GRUNN,
  'app/admin/dashboard/page.tsx': ADMIN_GRUNN,
  'app/admin/org-trial-codes/page.tsx': ADMIN_GRUNN,
  'app/admin/quizzes/page.tsx': ADMIN_GRUNN,
  'app/admin/quizzes/new/page.tsx': ADMIN_GRUNN,
  'app/admin/quizzes/[id]/analytics/page.tsx': ADMIN_GRUNN,
  'app/admin/quizzes/[id]/questions/page.tsx': ADMIN_GRUNN,
  'app/admin/quizzes/[id]/results/page.tsx': ADMIN_GRUNN,
  'app/admin/retention/page.tsx': ADMIN_GRUNN,
  'app/admin/sporsmal/page.tsx': ADMIN_GRUNN,
  'app/admin/users/page.tsx': ADMIN_GRUNN,
  'app/admin/users/[id]/page.tsx': ADMIN_GRUNN,

  'app/admin/quizzes/[id]/page.tsx':
    'Ren viderekobling til /admin/quizzes/new?id=… som kun viser «Laster...» ' +
    'mens router.replace kjører. En navlinje ville blinket og forsvunnet.',

  'app/admin/login/page.tsx':
    'ÅPENT PUNKT, ikke en beslutning: ingen lenke ut i det hele tatt. Hit ' +
    'sendes man av decideAdminRedirect (lib/admin-fetch.ts) på 401, og derfra ' +
    'finnes ingen vei tilbake til den offentlige siden uten å redigere URL-en.',
}

test('hver opt-out-side uten egen SiteNav står i UTEN_NAV med begrunnelse', () => {
  const navløse = FLATER.filter(f => !f.harGlobalNav && !f.harSiteNav).map(f => f.fil)
  const mangler = navløse.filter(fil => !(fil in UTEN_NAV))
  assert.deepEqual(mangler, [],
    'disse sidene er tatt ut av den globale nav-en uten å ha egen <SiteNav /> ' +
    '— brukeren står helt uten utvei der. Er det riktig, skal de inn i ' +
    'UTEN_NAV med en skreven grunn; er det ikke, skal ruten ut av ' +
    'opt-out-registeret:\n  ' + mangler.join('\n  '))
})

test('UTEN_NAV inneholder ingen foreldede rader', () => {
  const navløse = new Set(FLATER.filter(f => !f.harGlobalNav && !f.harSiteNav).map(f => f.fil))
  const foreldet = Object.keys(UTEN_NAV).filter(fil => !navløse.has(fil))
  assert.deepEqual(foreldet, [],
    'disse står i UTEN_NAV, men har navigasjon nå (eller finnes ikke lenger). ' +
    'Fjern radene:\n  ' + foreldet.join('\n  '))
})

test('ingen foreldede mønstre i opt-out-registeret', () => {
  // Andre retning for selve registeret: hvert mønster må treffe minst én
  // faktisk side. Ellers vokser registeret til en liste over ruter som en
  // gang fantes, og da beskytter det ingenting.
  const foreldet = Object.keys(GLOBAL_NAV_OPT_OUT)
    .filter(m => !FLATER.some(f => matchesRoutePattern(m, f.pathname)))
  assert.deepEqual(foreldet, [],
    'disse opt-out-mønstrene treffer ingen eksisterende page.tsx — fjern dem:\n  ' +
    foreldet.join('\n  '))
})

test('hver rad i begge registrene har en reell begrunnelse', () => {
  const tynne = [
    ...Object.entries(GLOBAL_NAV_OPT_OUT).map(([k, v]) => [`opt-out ${k}`, v] as const),
    ...Object.entries(UTEN_NAV).map(([k, v]) => [`uten-nav ${k}`, v] as const),
  ].filter(([, grunn]) => grunn.trim().length < 60)
  assert.deepEqual(tynne.map(([rad]) => rad), [],
    'en tom eller ettordsgrunn gjør registeret til en tillatelsesliste. Skriv hvorfor raden står.')
})

// ════════════════════════════════════════════════════════════════════════════
// DEL E — MONTERINGEN I ROT-LAYOUTEN
// ════════════════════════════════════════════════════════════════════════════

test('app/layout.tsx monterer GlobalNav inne i NavErrorBoundary', () => {
  // Boundaryen er ikke pynt: en ufanget krasj i en layout-montert
  // klientkomponent blanker HELE appen — og med nav-en global er
  // eksponeringen på hver eneste side. logClientError-wiringen i selve
  // boundaryen vaktes av lib/client-error.test.ts; her vaktes at layouten
  // faktisk BRUKER den rundt GlobalNav.
  const layout = renKode(readFileSync(join(ROT, 'app', 'layout.tsx'), 'utf8'))
  assert.match(layout, /import GlobalNav from "@\/components\/GlobalNav"/,
    'app/layout.tsx importerer ikke GlobalNav — den globale nav-en er borte')
  assert.match(layout, /import NavErrorBoundary from "@\/components\/NavErrorBoundary"/,
    'app/layout.tsx importerer ikke NavErrorBoundary')
  assert.match(layout, /<NavErrorBoundary>\s*<GlobalNav \/>\s*<\/NavErrorBoundary>/,
    'GlobalNav står ikke (lenger) inne i NavErrorBoundary i app/layout.tsx — ' +
    'en krasj i nav-en tar da med seg hele siden, på alle sider')
})
