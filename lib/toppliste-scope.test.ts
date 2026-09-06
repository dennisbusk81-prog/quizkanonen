// Kjøres med:  npm test
//
// /toppliste?scope=… som VIDEREKOBLING (7. september 2026). To lag:
//   • decideTopplisteScope — ren logikk, testet direkte med ekte kall.
//   • Koblingen i app/toppliste/page.tsx — strukturelt, fordi npm test kjører
//     uten jsdom (samme grunn som lib/kontomeny-arkivlenke).
//
// ── HISTORIKK — HVA SOM FORSVANT FRA DENNE FILA, OG HVORFOR ─────────────────
// Lørdag 6. september voktet fila en scope-BRYTER som byttet innhold på
// stedet. Søndag ble bryteren lagt om til å navigere (lib/scope-rail.ts), og
// visningsmodusen på /toppliste er borte. Fem tester voktet noe som ikke
// finnes lenger og er fjernet, ikke skrevet om:
//   1. «H1 følger scopet — Bedriftens toppliste i org-visning»: siden har
//      én overskrift nå. Bedriftens overskrift bor på /org/[slug].
//   2. «undertittelen bytter FELT, ikke verb»: samme grunn — én undertittel.
//   3. «scope og periode er uavhengige akser i URL-en»: scope er ikke lenger
//      en akse på denne siden; period følger med i viderekoblingen i stedet
//      (testet under).
//   4. «scope-spesifikke cacher nullstilles ved scopebytte»: SeasonLeaderboard
//      får konstante props på alle tre flatene nå, ingen bytte på stedet.
//   5. «skinnen rendres kun når beslutningen sier det, med ett valg per org»:
//      regelen og skinnen bor i lib/scope-rail.ts og voktes i
//      lib/scope-rail.test.ts.
// Sju er skrevet om til viderekoblingssemantikk (redirect/wait/clean/none),
// åtte står som før med justerte felt.
//
// ── DEN VIKTIGSTE INVARIANTEN ───────────────────────────────────────────────
// Viderekoblingen endrer IKKE hvem som har tilgang til hva. Gaten ligger i
// /api/toppliste og verifiserer medlemskap på hver eneste forespørsel, uansett
// hva klienten viser. Testene under vokter at klienten ikke later som noe
// annet, og at premiumView-regelen står urørt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideTopplisteScope, topplisteRedirectHref } from './toppliste-scope'

const A = { orgId: 'org-a', orgSlug: 'a' }
const B = { orgId: 'org-b', orgSlug: 'b' }

/** Standardtilfellet: medlemskapene er bekreftet og hentingen gikk bra. */
function bekreftet(myOrgs: { orgId: string; orgSlug: string }[], scopeParam: string | null, scopeIdParam: string | null) {
  return decideTopplisteScope({ scopeParam, scopeIdParam, myOrgs, myOrgsLoaded: true, myOrgsError: false })
}

// ── Uten parameter skjer ingenting ──────────────────────────────────────────

test('ingen org, ingen parameter ⇒ none', () => {
  assert.deepEqual(bekreftet([], null, null), { action: 'none' })
})

test('gjest uten parameter ⇒ none', () => {
  assert.deepEqual(decideTopplisteScope({ scopeParam: null, scopeIdParam: null, myOrgs: [], myOrgsLoaded: true, myOrgsError: false }), { action: 'none' })
})

test('én org, ingen parameter ⇒ none — siden viser nasjonal, skinnen er i lib/scope-rail', () => {
  assert.deepEqual(bekreftet([A], null, null), { action: 'none' })
})

test('to org-er, ingen parameter ⇒ none', () => {
  assert.deepEqual(bekreftet([A, B], null, null), { action: 'none' })
})

// ── Delte lenker viderekobles ───────────────────────────────────────────────

test('egen org i URL ⇒ redirect til /org/<slug>', () => {
  assert.deepEqual(bekreftet([A], 'organization', 'org-a'), { action: 'redirect', orgSlug: 'a' })
  assert.deepEqual(bekreftet([A, B], 'organization', 'org-b'), { action: 'redirect', orgSlug: 'b' })
})

test('FREMMED org i URL ⇒ clean — parameterne ryddes, ingen 403', () => {
  // En fremmed lenke er ikke et forsøk på noe, bare en lenke som ikke gjelder deg.
  assert.deepEqual(bekreftet([A], 'organization', 'org-x'), { action: 'clean' })
  assert.deepEqual(bekreftet([], 'organization', 'org-a'), { action: 'clean' })
})

test('scope=organization uten scope_id ⇒ none, ingen rydding', () => {
  assert.deepEqual(bekreftet([A], 'organization', null), { action: 'none' })
  assert.deepEqual(bekreftet([A], 'organization', ''), { action: 'none' })
})

test('ukjent scope-verdi ignoreres', () => {
  assert.deepEqual(bekreftet([A], 'league', 'org-a'), { action: 'none' })
  assert.deepEqual(bekreftet([A], 'global', 'org-a'), { action: 'none' })
})

test('medlemskapene har ikke landet ⇒ wait — ikke nasjonal først og hopp etterpå', () => {
  const d = decideTopplisteScope({ scopeParam: 'organization', scopeIdParam: 'org-a', myOrgs: [], myOrgsLoaded: false, myOrgsError: false })
  assert.deepEqual(d, { action: 'wait' })
})

test('hentingen FEILET ⇒ none, men URL-en ryddes IKKE', () => {
  // Et feilsvar er ikke bevis på at brukeren ikke er medlem. Omlasting kan rette det.
  const d = decideTopplisteScope({ scopeParam: 'organization', scopeIdParam: 'org-a', myOrgs: [], myOrgsLoaded: false, myOrgsError: true })
  assert.deepEqual(d, { action: 'none' })
})

test('feil ETTER at en gyldig org er kjent ⇒ redirect likevel', () => {
  const d = decideTopplisteScope({ scopeParam: 'organization', scopeIdParam: 'org-a', myOrgs: [A], myOrgsLoaded: false, myOrgsError: true })
  assert.deepEqual(d, { action: 'redirect', orgSlug: 'a' })
})

test('viderekoblingen tar med resten av query-strengen, minus scope-parameterne', () => {
  // period, hist og histKey overlever — en delt lenke til «kvartal» på
  // bedriften skal lande på kvartal på bedriften.
  assert.equal(topplisteRedirectHref('a', 'scope=organization&scope_id=org-a'), '/org/a')
  assert.equal(topplisteRedirectHref('a', 'scope=organization&scope_id=org-a&period=quarter'), '/org/a?period=quarter')
  assert.equal(topplisteRedirectHref('a', 'period=year&scope=organization&scope_id=org-a&hist=1'), '/org/a?period=year&hist=1')
  assert.equal(topplisteRedirectHref('a', ''), '/org/a')
})

// ── Koblingen i siden ───────────────────────────────────────────────────────

const SIDE = 'app/toppliste/page.tsx'
const RUTE = 'app/api/toppliste/route.ts'

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

test('siden bruker den rene beslutningen, ikke sin egen inline-logikk', () => {
  const src = aktivKode(SIDE)
  assert.match(src, /import \{ decideTopplisteScope, topplisteRedirectHref \} from '@\/lib\/toppliste-scope'/)
  assert.match(src, /const beslutning = decideTopplisteScope\(\{/)
})

test('redirect kjøres med router.replace til topplisteRedirectHref — og siden holdes igjen imens', () => {
  const src = aktivKode(SIDE)
  assert.match(src, /router\.replace\(topplisteRedirectHref\(redirectSlug, searchParams\.toString\(\)\)\)/,
    'viderekoblingen bruker ikke topplisteRedirectHref')
  assert.match(src, /const holdIgjen = action === 'wait' \|\| action === 'redirect'/,
    'siden holder ikke igjen under wait/redirect — nasjonale tall ville blafret forbi')
  assert.match(src, /\{holdIgjen \? \([\s\S]{0,400}Henter bedriften din …[\s\S]{0,400}<SeasonLeaderboard scope="global" \/>/,
    'ventetilstanden og den nasjonale lista er ikke koblet til holdIgjen')
})

test('clean rydder scope og scope_id fra URL-en, ingenting annet', () => {
  const src = aktivKode(SIDE)
  const gren = src.slice(src.indexOf("if (action === 'clean')"), src.indexOf('const holdIgjen'))
  assert.ok(gren.includes("params.delete('scope')") && gren.includes("params.delete('scope_id')"), 'clean rydder ikke begge parameterne')
  assert.ok(!gren.includes("delete('period')"), 'clean sletter period — periodevalget ville gått tapt')
})

test('siden viser ALLTID den nasjonale lista — ingen org-visning på stedet lenger', () => {
  const src = aktivKode(SIDE)
  assert.ok(!src.includes('scope="organization"'), '/toppliste rendrer SeasonLeaderboard i org-scope — visningsmodusen er tilbake')
  assert.ok(!src.includes('visOrgRamme'), 'overskriften følger et scope igjen')
  assert.equal((src.match(/<SeasonLeaderboard scope="global" \/>/g) ?? []).length, 1)
  assert.match(src, /Topp<em[^>]*>listen<\/em>/, 'H1-en er ikke lenger «Topplisten»')
  assert.ok(!src.includes('Bedriftens <em'), 'H1-en har en bedriftsgren — den bor på /org/[slug]')
})

// ── Tilgang og premiumView er URØRT ─────────────────────────────────────────

test('premiumView-regelen står nøyaktig som før', () => {
  const rute = aktivKode(RUTE)
  assert.match(rute, /const premiumView = userIsPremium \|\| isClosedRoom\(scope\)/,
    'premiumView er endret — regelen skulle stå urørt')
})

test('klienten gjør ingen egen tilgangsvurdering', () => {
  // Gaten er serverens. MÅLES PÅ SIDEKOMPONENTEN, ikke på hele fila:
  // PlacementLockedBanner lenger oppe leser isPremium for et informasjonsbanner.
  const src = aktivKode(SIDE)
  const sideKropp = src.slice(src.indexOf('export default function TopplisterPage'))
  assert.ok(sideKropp.length > 0, 'fant ikke sidekomponenten')
  for (const forbudt of ['isPremium', 'premiumView', 'isClosedRoom']) {
    assert.ok(!sideKropp.includes(forbudt),
      `siden refererer «${forbudt}» — tilgang og detaljgrad avgjøres i /api/toppliste, ikke her`)
  }
})

test('/api/toppliste har ingen skinne-spesifikk kode', () => {
  const rute = aktivKode(RUTE)
  for (const forbudt of ['decideTopplisteScope', 'scopeRailOptions', 'topplisteRedirectHref', 'ScopeRail']) {
    assert.ok(!rute.includes(forbudt), `${RUTE} kjenner til skinnen («${forbudt}») — ruten skulle være urørt`)
  }
})
