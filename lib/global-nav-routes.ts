// Opt-out-registeret for den globale toppnavigasjonen (B-30/A2 steg 2).
//
// REN logikk og rene data — ingen React, ingen hooks. Importeres av BÅDE
// components/GlobalNav.tsx (runtime) og lib/global-nav-coverage.test.ts
// (node:test). At testen kan importere og KJØRE nøyaktig samme matcher som
// produksjonen er hele poenget med at dette bor her og ikke inline i
// klientkomponenten: forgjengerne (skjule-listene i UserMenu/BackNav) levde
// i 'use client'-filer og måtte testes ved å regex-parse kildekode, med en
// egen tokenizer og egne selvtester for at parsingen ikke skulle lyve.
//
// FEILRETNINGEN ER SNUDD: nav er standard. Glemmer du å legge en ny rute inn
// her, får den nav den kanskje ikke trengte — synlig og ufarlig. I den gamle
// modellen ga glemsel en side der brukeren sto fast (B-30).
//
// ── MATCHEREN ER SEGMENTBASERT, IKKE PREFIKSBASERT ──────────────────────────
// `startsWith('/quiz')` treffer '/quizer'. Det sammentreffet var dokumentert
// og testet i den gamle modellen, og i denne modellen snur det til en felle:
// '/quizer' skal leve av den globale nav-en, så en prefiks-match på '/quiz'
// ville gjort quizoversikten navløs. Derfor matches det på HELE segmenter:
//   eksakt    '/'              → kun forsiden
//   '*'       '/quiz/*'        → /quiz/<én ting>, ALDRI /quizer, aldri dypere
//   '**' sist '/admin/**'      → /admin og alt under, vilkårlig dybde
// lib/global-nav-coverage.test.ts feller en matcher som er skrevet om til
// prefiks-form.

/**
 * Rutene som IKKE skal ha den globale toppnav-en, med begrunnelse per rad.
 *
 * En begrunnelse er ikke pynt: den er forskjellen på et valg og en
 * forglemmelse. Alle radene er VARIG: ruter som rendrer sin egen
 * <SiteNav … /> med props layouten ikke kan kjenne (quizId fra server-data,
 * orgName fra fetch, backQuery fra sidehistorikk), pluss admin og selve
 * spillestien. STEG 2-klassen (17 sider med propfri lokal SiteNav) ble
 * krympet til null i steg 3 (30. august 2026) — de sidene lever nå av den
 * globale nav-en, og lib/global-nav-coverage.test.ts feller både en ny rad
 * uten side og en lokal SiteNav uten rad.
 */
export const GLOBAL_NAV_OPT_OUT: Record<string, string> = {
  '/':
    'VARIG: forsiden er server-komponent og sender quizId til SiteNav ' +
    'som gir den videre til NavAuth — der spill-knappen faktisk rendres ' +
    '(«Spill ukens quiz →» på desktop, «Spill nå →» på mobil; SiteNav selv ' +
    'har ingen slik label). Verdien kommer fra server-hentet quiz-data i ' +
    'begge returgrenene — props en global klientnav ikke kan kjenne.',

  '/quiz/*':
    'VARIG: spillesiden. `phase === \'playing\'` skal ikke ha nav (timeren ' +
    'løper, «kun én gjennomspilling», feiltrykk avslutter forsøket), og ' +
    'QuizInterlude er fullskjerm med zIndex 20 mot SiteNavs 100 — en global ' +
    'nav ville lagt seg oppå mellomskjermen. Fasen er klient-state layouten ' +
    'ikke kan se, så hele ruten står utenfor; siden rendrer selv SiteNav i ' +
    '8 av 9 toppgrener (lib/sitenav-error-states.test.ts).',

  '/leaderboard/*':
    'VARIG: sender variant/orgSlug/quizId/backQuery fra async klient-state — ' +
    'backQuery (?hist=1) er sidehistorikk ingen global komponent kan kjenne.',

  '/org/*/admin':
    'VARIG: `variant="org-admin"` med orgName fra fetch. orgSlug kunne vært ' +
    'utledet av URL-en, men orgName kan ikke — en global nav ville vist ' +
    'admin-linjen uten bedriftsnavn.',

  '/admin/**':
    'VARIG: admin-intern flate med én operatør, bevisst utenfor ' +
    'SiteNav-utrullingen. Undersidene har egen «← Admin»-lenke, /admin har ' +
    '«Se siden ↗». ÅPENT PUNKT som består: /admin/login har ingen lenke ut ' +
    'i det hele tatt (dit sendes man av decideAdminRedirect på 401).',
}

/**
 * Segmentbasert match av ETT mønster mot ett pathname.
 *   - vanlige segmenter må være identiske
 *   - '*'  matcher nøyaktig ett vilkårlig segment
 *   - '**' er kun gyldig SIST og matcher null eller flere gjenværende segmenter
 * Ingen prefiks-semantikk: '/quiz' matcher aldri '/quizer', fordi 'quiz' og
 * 'quizer' er ulike segmenter — ikke fordi noen husket et unntak.
 */
export function matchesRoutePattern(pattern: string, pathname: string): boolean {
  const p = splitSegments(pattern)
  const s = splitSegments(pathname)
  const deep = p.length > 0 && p[p.length - 1] === '**'
  const fixed = deep ? p.slice(0, -1) : p
  if (deep ? s.length < fixed.length : s.length !== fixed.length) return false
  return fixed.every((seg, i) => seg === '*' || seg === s[i])
}

function splitSegments(sti: string): string[] {
  return sti.split('/').filter(Boolean)
}

/** Skal dette pathnamet ha den globale toppnav-en? */
export function hasGlobalNav(pathname: string): boolean {
  return !Object.keys(GLOBAL_NAV_OPT_OUT).some(m => matchesRoutePattern(m, pathname))
}
