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
//   eksakt    '/arkiv'         → kun /arkiv
//   '*'       '/quiz/*'        → /quiz/<én ting>, ALDRI /quizer, aldri dypere
//   '**' sist '/admin/**'      → /admin og alt under, vilkårlig dybde
// lib/global-nav-coverage.test.ts feller en matcher som er skrevet om til
// prefiks-form.

/**
 * Rutene som IKKE skal ha den globale toppnav-en, med begrunnelse per rad.
 *
 * En begrunnelse er ikke pynt: den er forskjellen på et valg og en
 * forglemmelse. To klasser rader:
 *
 *   VARIG — ruter som rendrer sin egen <SiteNav … /> med props layouten ikke
 *   kan kjenne (quizId fra server-data, orgName fra fetch, backQuery fra
 *   sidehistorikk), pluss admin og selve spillestien.
 *
 *   STEG 2-TILSTAND — sider som fortsatt har en lokal, propfri <SiteNav />.
 *   De krympes i steg 3: slett den lokale SiteNav-en og fjern raden HER i
 *   samme commit — testen er toveis og feller begge halvdelene alene.
 */
export const GLOBAL_NAV_OPT_OUT: Record<string, string> = {
  '/':
    'VARIG: forsiden er server-komponent og sender quizId til SiteNav ' +
    '(«Spill ukens quiz →»-knappen) fra server-hentet quiz-data i begge ' +
    'returgrenene — props en global klientnav ikke kan kjenne.',

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

  // ── STEG 2-TILSTAND — krympes i steg 3, rad for rad ──────────────────────
  '/arkiv':
    'STEG 2: har egen propfri <SiteNav /> i sidefila. Steg 3: slett den ' +
    'lokale og fjern denne raden i samme commit.',
  '/bedrift':
    'STEG 2: marketingsiden har egen <SiteNav />. EKSAKT segment med vilje: ' +
    '/bedrift/registrer og /bedrift/success skal ha den globale nav-en — det ' +
    'er B-18-fiksen (inert UserMenuWrapper ga dem ingenting).',
  '/historikk':
    'STEG 2: har egen propfri <SiteNav /> i sidefila. Steg 3: slett den ' +
    'lokale og fjern denne raden i samme commit.',
  '/historikk/*':
    'STEG 2: attempt-detaljsiden har egen propfri <SiteNav /> i alle fem ' +
    'grener. Steg 3: slett de lokale og fjern denne raden i samme commit.',
  '/liga':
    'STEG 2: har egen propfri <SiteNav /> i sidefila. Steg 3: slett den ' +
    'lokale og fjern denne raden i samme commit.',
  '/liga/*':
    'STEG 2: liga-siden har egen propfri <SiteNav />. Dekker IKKE ' +
    '/liga/bli-med/<token> (tre segmenter) — invitasjonssiden var navløs i ' +
    'den gamle modellen (arvet skjulingen uten erstatningen) og lever nå av ' +
    'den globale nav-en.',
  '/login':
    'STEG 2: har egen propfri <SiteNav /> i sidefila. Steg 3: slett den ' +
    'lokale og fjern denne raden i samme commit.',
  '/org/*':
    'STEG 2: bedriftssiden har egen propfri <SiteNav />. Dekker IKKE ' +
    '/org/<slug>/velkommen — veiviseren var navløs (B-18) og lever nå av den ' +
    'globale nav-en.',
  '/premium/success':
    'STEG 2: kvitteringen har egen propfri <SiteNav />. EKSAKT med vilje: ' +
    'salgssiden /premium skal ha den globale nav-en (hadde dobbel konto-pille ' +
    'i den gamle modellen, B-27).',
  '/profil':
    'STEG 2: har egen propfri <SiteNav /> i sidefila. Steg 3: slett den ' +
    'lokale og fjern denne raden i samme commit.',
  '/quizer':
    'STEG 2: quizoversikten har egen propfri <SiteNav />. EGEN rad — dekkes ' +
    'med vilje IKKE av /quiz/* (segmentmatcheren skiller /quiz fra /quizer; ' +
    'prefiks-matching var sammentreffet som bar den gamle modellen). Steg 3: ' +
    'slett den lokale og fjern denne raden i samme commit.',
  '/slik-fungerer-det':
    'STEG 2: har egen propfri <SiteNav /> i sidefila. Steg 3: slett den ' +
    'lokale og fjern denne raden i samme commit.',
  '/toppliste':
    'STEG 2: har egen propfri <SiteNav /> i sidefila. Steg 3: slett den ' +
    'lokale og fjern denne raden i samme commit.',
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
