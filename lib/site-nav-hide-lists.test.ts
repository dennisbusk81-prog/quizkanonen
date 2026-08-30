// Kjøres med:  npm test
//
// STRUKTURTEST av navigasjonsdekningen på tvers av alle ruteflater. Fila har
// to deler, og de stiller motsatte spørsmål:
//
//   DEL 1  Har en side med egen SiteNav fått de globale widgetene skrudd av?
//          (ellers: to konto-menyer oppå hverandre)
//   DEL 2  Har flaten en utvei i det hele tatt? — registrene UTEN_NAV,
//          KJENT_DOBBEL_MENY og KJENT_INERT_WRAPPER, lagt til 30. august 2026
//          som forarbeid til B-30/A2. Se den egne overskriften nede i fila.
//
// DEL 1 — de to skjule-listene som holder den globale <UserMenu /> og
// <BackNav /> (begge montert i app/layout.tsx) borte fra sider som har sin egen
// SiteNav.
//
// BAKGRUNN (29. august 2026)
// `/arkiv` rendret <SiteNav /> — med NavAuths konto-meny — og fikk i tillegg
// den globale UserMenu-pillen liggende oppå, pluss en løs «← Tilbake»-stripe.
// To konto-menyer på samme skjerm, med ULIKT innhold: UserMenu har «Innlogget
// som», Premium-merket, fornyelsesdato og «Sesong-topplisten →»; NavAuths
// dropdown har ingen av delene.
//
// Kommentarene i begge filene sa at listene «holdes synkronisert». Det gjorde
// de — med HVERANDRE. Begge manglet /arkiv. Den sammenligningen som betyr noe
// er mot SiteNav-UTRULLINGEN, og den kan ingen holde i hodet: den bor i
// filsystemet. Denne testen gjør den.
//
// ── HVORFOR DENNE ER STRUKTURELL, OG HVA SOM GJØR DET FORSVARLIG ───────────
// Predikatene bor inline i to 'use client'-komponenter med React-hooks, og kan
// ikke importeres av node:test. Testen leser derfor KILDEN. Det er formen
// husets regler advarer mot, og de to kjente fellene er håndtert eksplisitt:
//
//   1. «Regex passerer utkommentert kode.» Kommentarene i BEGGE filene
//      inneholder nå bokstavelig `startsWith('/quiz')` og `'/quizer'` som
//      forklarende TEKST — en naiv regex ville plukket dem opp som regler og
//      vært grønn av feil grunn. Derfor strimles kommentarer av en tokenizer
//      som respekterer strenglitteraler (`fjernKommentarer` under), ikke av en
//      regex. `selvtest`-blokken nederst feller tokenizeren direkte.
//   2. «Grep teller NAVN, ikke oppførsel.» Testen sjekker ikke at en streng
//      FINNES i fila. Den bygger regler av `=== 'x'` / `startsWith('x')` /
//      Set-innholdet, og EVALUERER dem mot hver rute — samme semantikk som
//      komponentene. Derfor fanger den at `/quizer` allerede dekkes av
//      prefikset `/quiz`, i stedet for å kreve en egen linje som ikke trengs.
//
// Utvinningen er likevel koblet til skriveformen. `assert`-ene under «Vakt mot
// stille utvinningssvikt» finnes for at et omskrevet predikat skal gi
// «parseren må oppdateres» og ikke «siden mangler i lista» — en rød test som
// lyver om årsaken er verre enn ingen test.
//
// ── MUTASJONSBEVIS (kjørt 29. august 2026, hver mutasjon gjenopprettet) ─────
// Fiksen ble staget først, så `git diff` viser kun mutasjonen og
// `git checkout --` gjenoppretter fiksen i stedet for å kaste den:
//   1. fjern `pathname === '/arkiv' ||` fra UserMenu.tsx
//      → RØD: «/arkiv → mangler i components/UserMenu.tsx» — feilen navngir
//        både ruten og filen, som er hele poenget med å bygge en liste
//   2. fjern `'/arkiv',` fra BackNav.tsx sitt EXCLUDED_EXACT
//      → RØD: samme rute, andre fil
//   3. bytt UserMenus `startsWith('/quiz')` mot `startsWith('/quiz/')`
//      → RØD på «hver side …» (/quiz og /quizer) OG på «/quizer dekkes av
//        prefikset», og GRØNN på begge selvtestene. Beviser to ting: at
//        testen evaluerer prefiks-semantikk i stedet for å lete etter
//        strenger, og at selvtestene ikke er koblet til reglenes innhold.
//   4. la `fjernKommentarer` returnere kilden urørt
//      → RØD på BEGGE selvtestene og grønn på resten. Det er riktig rekkefølge:
//        en ødelagt tokenizer melder seg selv, i stedet for å gi falsk grønt
//        på 1 og 2 ved å lese `'/arkiv'` ut av en kommentar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROT = join(import.meta.dirname, '..')

/**
 * Fjerner // - og / * * / -kommentarer, men lar innholdet i strenglitteraler
 * stå. En regex kan ikke gjøre dette: `startsWith('/quiz')` inne i en
 * kommentar ser identisk ut med den ekte regelen, og `'https://…'` inne i en
 * streng ser ut som en kommentarstart.
 */
function fjernKommentarer(kilde: string): string {
  let ut = ''
  let i = 0
  let streng: string | null = null   // aktivt anførselstegn, ellers null

  while (i < kilde.length) {
    const c = kilde[i], neste = kilde[i + 1]

    if (streng) {
      if (c === '\\') { ut += c + (neste ?? ''); i += 2; continue }
      if (c === streng) streng = null
      ut += c; i++; continue
    }

    if (c === '"' || c === "'" || c === '`') { streng = c; ut += c; i++; continue }

    if (c === '/' && neste === '/') {
      while (i < kilde.length && kilde[i] !== '\n') i++
      continue
    }
    if (c === '/' && neste === '*') {
      i += 2
      while (i < kilde.length && !(kilde[i] === '*' && kilde[i + 1] === '/')) i++
      i += 2
      continue
    }

    ut += c; i++
  }
  return ut
}

// ── Rutene som faktisk rendrer <SiteNav /> ──────────────────────────────────

function finnFiler(dir: string, navn: Set<string>, funnet: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      // app/api har ingen ruteflater, kun route.ts — hopp over hele treet.
      if (e.name === 'api') continue
      finnFiler(p, navn, funnet)
    }
    else if (navn.has(e.name)) funnet.push(p)
  }
  return funnet
}

const finnSider = (dir: string) => finnFiler(dir, new Set(['page.tsx']))

/**
 * Filsti → rute. Rutegrupper `(navn)` faller bort (de er ikke i URL-en), og
 * ruten kuttes ved FØRSTE dynamiske segment: `app/liga/[slug]/page.tsx` blir
 * `/liga`, som er den delen skjule-listene faktisk kan matche på.
 */
function tilRute(filsti: string): string {
  const rel = filsti.slice(join(ROT, 'app').length + 1)
  const segmenter: string[] = []
  for (const s of rel.split(sep).slice(0, -1)) {
    if (s.startsWith('(') && s.endsWith(')')) continue
    if (s.startsWith('[')) break
    segmenter.push(s)
  }
  return '/' + segmenter.join('/')
}

const siteNavRuter = [...new Set(
  finnSider(join(ROT, 'app'))
    .filter(f => /<SiteNav[\s/>]/.test(fjernKommentarer(readFileSync(f, 'utf8'))))
    .map(tilRute)
)].sort()

// ── Reglene, hentet ut av kilden og gjort kjørbare ──────────────────────────

type Regel = { form: 'eksakt' | 'prefiks'; sti: string }

function alleTreff(kilde: string, re: RegExp): string[] {
  return [...kilde.matchAll(re)].map(m => m[1])
}

const userMenuKilde = fjernKommentarer(
  readFileSync(join(ROT, 'components', 'UserMenu.tsx'), 'utf8')
)
const backNavKilde = fjernKommentarer(
  readFileSync(join(ROT, 'components', 'BackNav.tsx'), 'utf8')
)

const userMenuRegler: Regel[] = [
  ...alleTreff(userMenuKilde, /pathname === '([^']+)'/g).map(sti => ({ form: 'eksakt' as const, sti })),
  ...alleTreff(userMenuKilde, /pathname\.startsWith\('([^']+)'\)/g).map(sti => ({ form: 'prefiks' as const, sti })),
]

// EXCLUDED_EXACT er et Set-litteral; innholdet hentes som ett stykke og
// splittes, slik at nye linjer i settet følger med uten at parseren endres.
const settInnhold = backNavKilde.match(/EXCLUDED_EXACT = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
const backNavRegler: Regel[] = [
  ...alleTreff(settInnhold, /'([^']+)'/g).map(sti => ({ form: 'eksakt' as const, sti })),
  ...alleTreff(backNavKilde, /pathname\.startsWith\('([^']+)'\)/g).map(sti => ({ form: 'prefiks' as const, sti })),
]

// Samme semantikk som komponentene: eksakt likhet ELLER prefiks.
const skjuler = (regler: Regel[], rute: string) =>
  regler.some(r => (r.form === 'eksakt' ? rute === r.sti : rute.startsWith(r.sti)))

// ── Selvtest av tokenizeren ─────────────────────────────────────────────────
// Kjøres FØRST. Feiler den, er alt under verdiløst — og uten denne ville en
// ødelagt tokenizer gitt GRØNT på testene under, fordi kommentarene i begge
// filene nå bokstavelig inneholder regel-lignende tekst.

test('selvtest: kommentarer strimles, strenger står', () => {
  const kilde = [
    `const a = '/beholdes'`,
    `// pathname === '/kommentar-eksakt'`,
    `const b = "http://ikke-en-kommentar"`,
    `/* pathname.startsWith('/kommentar-prefiks') */`,
    `const c = \`/back\\'tick\``,
  ].join('\n')
  const rent = fjernKommentarer(kilde)

  assert.ok(rent.includes('/beholdes'), 'strenglitteraler skal overleve')
  assert.ok(rent.includes('http://ikke-en-kommentar'),
    '// inne i en streng er ikke en kommentarstart')
  assert.ok(!rent.includes('/kommentar-eksakt'), '//-kommentarer skal bort')
  assert.ok(!rent.includes('/kommentar-prefiks'), 'blokk-kommentarer skal bort')
  assert.ok(rent.includes('/back'), 'escapede tegn skal ikke velte tokenizeren')
})

test('selvtest: kommentarene i DE TO EKTE filene er faktisk strimlet bort', () => {
  // Ikke en påstand om reglene, men om strimlingen av nettopp disse to
  // filene: frasene under finnes kun i prosatekst og kan aldri bli kode.
  // Slutter tokenizeren å virke, ryker denne — og ikke «siden mangler i
  // lista», som ville pekt på feil årsak.
  //
  // Assertionen er bevisst IKKE `!regler.some(sti === '/quiz/')`: en dag noen
  // med rette snevrer prefikset inn til '/quiz/', skal denne testen forbli
  // grønn. Da er det testen «/quizer dekkes av prefikset /quiz» som skal si
  // fra, fordi DEN handler om oppførsel.
  assert.ok(!userMenuKilde.includes('SAMMENTREFF i navngivningen'),
    'UserMenu.tsx: kommentarene er ikke strimlet — regel-lignende tekst i dem kan da bli lest som regler')
  assert.ok(!backNavKilde.includes('SUPERSETT av UserMenus'),
    'BackNav.tsx: kommentarene er ikke strimlet')
  assert.ok(!userMenuRegler.some(r => r.sti === '/quizer'),
    'UserMenu nevner /quizer kun i en kommentar — den skal ikke bli en regel')
})

// ── Vakt mot stille utvinningssvikt ─────────────────────────────────────────

test('parseren finner fortsatt reglene i begge filene', () => {
  // Skrives et av predikatene om til en annen form (en Set, et array, en
  // hjelpefunksjon), skal feilen si DET — ikke «siden mangler i lista».
  // Tallene er nedre grenser med god margin, ikke fasit: å legge til en sti
  // skal aldri gjøre denne rød.
  assert.ok(userMenuRegler.length >= 12,
    `fant bare ${userMenuRegler.length} regler i UserMenu.tsx — er predikatet skrevet om? Oppdater parseren i denne testen.`)
  assert.ok(backNavRegler.filter(r => r.form === 'eksakt').length >= 10,
    'fant for få EXCLUDED_EXACT-oppføringer i BackNav.tsx — er Set-litteralet skrevet om?')
  assert.ok(backNavRegler.filter(r => r.form === 'prefiks').length >= 8,
    'fant for få startsWith-regler i BackNav.tsx — er kjeden skrevet om?')
  assert.ok(siteNavRuter.length >= 10,
    `fant bare ${siteNavRuter.length} SiteNav-sider — er komponenten omdøpt eller rendret via en innpakning?`)
})

// ── Selve regelen ───────────────────────────────────────────────────────────

test('hver side med SiteNav er skjult i BEGGE listene', () => {
  const mangler: string[] = []
  for (const rute of siteNavRuter) {
    if (!skjuler(userMenuRegler, rute)) mangler.push(`${rute} → mangler i components/UserMenu.tsx`)
    if (!skjuler(backNavRegler, rute)) mangler.push(`${rute} → mangler i components/BackNav.tsx`)
  }
  assert.deepEqual(mangler, [],
    'en side med egen SiteNav får da to konto-menyer og/eller en løs «← Tilbake»-stripe:\n  ' +
    mangler.join('\n  '))
})

test('/quizer dekkes av prefikset /quiz — ingen egen linje trengs', () => {
  // Ikke pynt: kartleggingen som utløste denne runden påsto først at /quizer
  // hadde samme feil som /arkiv. Det stemte ikke — `startsWith('/quiz')`,
  // skrevet for spillesiden /quiz/[id], treffer også /quizer. Testen holder
  // det faktum i live, slik at en innsnevring til '/quiz/' blir fanget her og
  // ikke oppdaget på skjermen.
  assert.ok(siteNavRuter.includes('/quizer'), 'forutsetningen: /quizer har SiteNav')
  assert.ok(skjuler(userMenuRegler, '/quizer') && skjuler(backNavRegler, '/quizer'))
  assert.ok(
    !userMenuRegler.some(r => r.form === 'eksakt' && r.sti === '/quizer'),
    'dekningen skal komme fra prefikset, ikke fra en egen linje — står det en her, er kommentaren i UserMenu.tsx utdatert'
  )
})

// ════════════════════════════════════════════════════════════════════════════
// DEL 2 — HAR RUTEFLATEN NAVIGASJON I DET HELE TATT? (B-30, 30. august 2026)
// ════════════════════════════════════════════════════════════════════════════
//
// Delen over spør «har en side med SiteNav fått de globale widgetene skrudd
// av?». Den forutsetter at siden HAR SiteNav. Kartleggingen av B-30 fant fem
// parallelle navigasjonsmønstre i produksjon, og at det motsatte spørsmålet
// ikke ble stilt noe sted: har flaten en utvei i det hele tatt?
//
// Tre klasser felles her. Alle tre er REGISTRE over dagens tilstand, ikke
// påstander om at tilstanden er riktig — og de er toveis: både en flate som
// mangler i registeret OG en rad som ikke lenger stemmer gjør fila rød.
// Det er forskjellen på et register og en symptom-pinning: fikser du en av
// dem, MÅ raden fjernes i samme runde, ellers er testen rød.
//
// Dette er FORARBEIDET til omleggingen (A2), ikke omleggingen. Skal nav flyttes
// til rot-layouten på ~28 filer, må det finnes noe som feller at en flate MISTET
// nav underveis. Uten dette registeret er «mistet nav» og «hadde aldri nav»
// samme observasjon.

const RUTEFILNAVN = new Set([
  'page.tsx', 'layout.tsx', 'loading.tsx', 'error.tsx', 'not-found.tsx', 'template.tsx',
])

type Flate = {
  fil: string           // repo-relativ, med skråstrek — nøkkelen i registrene under
  rute: string
  harSiteNav: boolean
  harWrapper: boolean
  skjultIUserMenu: boolean
  skjultIBackNav: boolean
}

const FLATER: Flate[] = finnFiler(join(ROT, 'app'), RUTEFILNAVN)
  .map(f => f.slice(ROT.length + 1).split(sep).join('/'))
  // app/layout.tsx er der de to globale widgetene MONTERES, ikke en flate som
  // konsumerer dem. Tas den med, ville den telt som «uten nav» fordi den ikke
  // rendrer <SiteNav /> — mens den er selve grunnen til at de andre har nav.
  .filter(fil => fil !== 'app/layout.tsx')
  .sort()
  .map(fil => {
    const kilde = fjernKommentarer(readFileSync(join(ROT, fil), 'utf8'))
    const rute = tilRute(join(ROT, fil))
    return {
      fil,
      rute,
      harSiteNav: /<SiteNav[\s/>]/.test(kilde),
      harWrapper: /<UserMenuWrapper[\s/>]/.test(kilde),
      skjultIUserMenu: skjuler(userMenuRegler, rute),
      skjultIBackNav: skjuler(backNavRegler, rute),
    }
  })

/**
 * Flater uten NOEN navigasjon: ingen egen SiteNav, og begge de globale
 * widgetene fra app/layout.tsx er skrudd av for ruten.
 *
 * Merk at BackNav-lista er et SUPERSETT av UserMenu-lista (se BackNav.tsx), så
 * en flate kan være skjult for konto-pillen og likevel ha «← Tilbake»-stripen.
 * /bedrift/registrer er nettopp det, og står derfor IKKE her — den har en
 * utvei, om enn en tynn en.
 */
const utenNav = FLATER.filter(f => !f.harSiteNav && f.skjultIUserMenu && f.skjultIBackNav)

const ADMIN_GRUNN =
  'Admin-intern flate med én operatør, bevisst utenfor SiteNav-utrullingen. ' +
  'Undersidene har sin egen «← Admin»-lenke tilbake til navet, og /admin har ' +
  '«Se siden ↗» ut til den offentlige siden.'

/**
 * REGISTER over flater uten navigasjon. Nøkkel = repo-relativ sti, verdi =
 * hvorfor fraværet står.
 *
 * En begrunnelse er ikke pynt: den er forskjellen på et valg og en
 * forglemmelse. Fire av radene under sier eksplisitt ÅPENT PUNKT — de er
 * registrert, ikke godkjent.
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
    'ÅPENT PUNKT, ikke en beslutning: denne har ingen lenke ut i det hele tatt ' +
    '— heller ikke «← Admin», siden man per definisjon ikke er innlogget. Hit ' +
    'sendes man av decideAdminRedirect (lib/admin-fetch.ts) på 401, og derfra ' +
    'finnes ingen vei tilbake til den offentlige siden uten å redigere URL-en.',

  'app/bedrift/success/page.tsx':
    'Kvittering etter bedriftskjøp. Rendrer <UserMenuWrapper />, men den er ' +
    'INERT her — se KJENT_INERT_WRAPPER under. Utveien er de tre lenkene til ' +
    '/org/{slug}/… i selve kortet.',

  'app/founders/success/page.tsx':
    'Kvittering etter Founders-aktivering. Har «← Tilbake til forsiden» i ' +
    'begge returgrenene, men ingen nav; /founders er ekskludert i begge de ' +
    'globale listene og siden er utenfor SiteNav-utrullingen.',

  'app/liga/bli-med/[token]/page.tsx':
    'ÅPENT PUNKT: invitasjonsflate under /liga-prefikset, som skrur av begge ' +
    'de globale widgetene fordi liga-SIDENE har SiteNav — men denne siden har ' +
    'den ikke. Den arver altså skjulingen uten å ha erstatningen. Eneste utvei ' +
    'er en «/liga»-lenke i én av grenene.',

  'app/loading.tsx':
    'ÅPENT PUNKT: Next sin rot-skjelettskjerm. Nav måtte komme fra ' +
    'app/layout.tsx, altså nøyaktig omleggingen A2 handler om — en loading.tsx ' +
    'kan ikke arve nav fra siden den venter på. Se også ' +
    'feedback-root-loading-breaks-server-redirects: denne fila har allerede ' +
    'hatt én utilsiktet virkning på ruting.',

  'app/quizer/loading.tsx':
    'ÅPENT PUNKT: skjelettskjerm for /quizer, samme sak som app/loading.tsx. ' +
    '/quizer er skjult via prefikset /quiz og har SiteNav på selve siden, så ' +
    'nav forsvinner i lastingen og kommer tilbake når innholdet lander.',

  'app/org/[slug]/velkommen/page.tsx':
    'Oppsettsveiviseren for en ny bedrift. Rendrer <UserMenuWrapper /> to ' +
    'steder — begge INERTE, se KJENT_INERT_WRAPPER under. Dette er B-18, og ' +
    'den kan ikke fikses slik den er formulert.',

  'app/quiz/[id]/layout.tsx':
    'Gjennomstikks-layout som kun returnerer {children}; den har ingen egen ' +
    'skjerm å legge nav på. Spillesiden under har SiteNav i åtte av ni ' +
    'toppgrener (lib/sitenav-error-states.test.ts).',
}

test('vakt: flate-oversikten er faktisk bygget', () => {
  // Slutter finnFiler, tilRute eller SiteNav-deteksjonen å virke, skal feilen
  // si DET — ikke «alle flatene mangler i registeret», som ville sendt neste
  // leser til å fylle ut 50 rader for en ødelagt parser.
  assert.ok(FLATER.length >= 45,
    `fant bare ${FLATER.length} ruteflater under app/ — er finnFiler eller RUTEFILNAVN ødelagt?`)
  assert.ok(FLATER.filter(f => f.harSiteNav).length >= 10,
    'fant nesten ingen flater med SiteNav — er deteksjonen ødelagt?')
  assert.ok(FLATER.some(f => f.harWrapper),
    'fant ingen <UserMenuWrapper /> i det hele tatt — er komponenten omdøpt? De to registrene under er da verdiløse.')
})

test('hver ruteflate har navigasjon, eller står i UTEN_NAV med en begrunnelse', () => {
  const mangler = utenNav.map(f => f.fil).filter(fil => !(fil in UTEN_NAV))
  assert.deepEqual(mangler, [],
    'disse ruteflatene har hverken egen <SiteNav /> eller noen av de to globale ' +
    'widgetene fra app/layout.tsx — brukeren står helt uten utvei der. Er det ' +
    'riktig, skal de inn i UTEN_NAV med en skreven grunn; er det ikke riktig, ' +
    'skal de ha nav:\n  ' + mangler.join('\n  '))
})

test('UTEN_NAV inneholder ingen foreldede rader', () => {
  // Andre retning. Får /admin/login nav en dag, skal denne bli rød så raden
  // fjernes — ellers vokser registeret til en liste over ting som en gang var
  // sant, og da beskytter det ingenting.
  const foreldet = Object.keys(UTEN_NAV).filter(fil => !utenNav.some(f => f.fil === fil))
  assert.deepEqual(foreldet, [],
    'disse står i UTEN_NAV, men har navigasjon nå (eller finnes ikke lenger). Fjern radene:\n  ' +
    foreldet.join('\n  '))
})

test('hver UTEN_NAV-rad har en reell begrunnelse', () => {
  const tynne = Object.entries(UTEN_NAV).filter(([, grunn]) => grunn.trim().length < 60)
  assert.deepEqual(tynne.map(([fil]) => fil), [],
    'en tom eller ettordsgrunn gjør registeret til en tillatelsesliste. Skriv hvorfor fraværet står.')
})

// ── B-27: <UserMenuWrapper /> der UserMenu IKKE er skjult => DOBBEL meny ─────
//
// UserMenuWrapper er en dynamic(ssr:false)-innpakning rundt NØYAKTIG samme
// <UserMenu />-komponent som app/layout.tsx allerede monterer globalt. Er ruten
// ikke skjult i UserMenus egen liste, rendres komponenten TO ganger — begge med
// `position: fixed, top: 14, right: 18, zIndex: 8000`, altså perfekt oppå
// hverandre. Symptomet er derfor ikke to synlige piller ved siden av hverandre,
// men to identiske i samme punkt: dobbelt oppsett av `onAuthStateChange`, to
// /api/stripe/subscription-kall, og et klikk som åpner den øverste.
//
// REGISTER over kjent tilstand. Fikses en av dem — enten ved å fjerne
// wrapperen eller ved å gi ruten SiteNav — skal raden ut i samme runde.
const KJENT_DOBBEL_MENY = [
  'app/bli-med/[token]/page.tsx',
  'app/premium/page.tsx',
]

test('B-27: <UserMenuWrapper /> uten skjuling gir dobbel konto-meny', () => {
  const faktisk = FLATER.filter(f => f.harWrapper && !f.skjultIUserMenu).map(f => f.fil)
  assert.deepEqual(faktisk, KJENT_DOBBEL_MENY,
    'settet av flater som rendrer <UserMenuWrapper /> UTEN å være skjult i ' +
    'UserMenu.tsx har endret seg. Er en ny kommet til, får den to monteringer ' +
    'av samme komponent oppå hverandre; er en fjernet, skal raden ut av ' +
    'KJENT_DOBBEL_MENY.')
})

// ── B-18: <UserMenuWrapper /> der UserMenu ER skjult => wrapperen er INERT ───
//
// DETTE ER DEN VIKTIGSTE RADEN I FILA.
//
// UserMenu skjuler seg selv på /bedrift- og /org-prefikset. En
// <UserMenuWrapper /> på en av de rutene rendrer altså NULL — den ser ut som
// navigasjon i JSX-en, opptar en plass i layouten, og gir ingenting.
//
// Konsekvensen er konkret for B-18: forslaget der er å legge wrapperen inn i
// loading-grenen så flaten får nav mens den laster. Det VIRKER IKKE. Grenen
// ville fått nøyaktig det den har nå — ingenting — og saken ville blitt meldt
// lukket. Fiksen må enten gi ruten <SiteNav />, eller ta stien ut av UserMenus
// skjule-liste; wrapperen er ikke en av mulighetene.
//
// app/org/[slug]/velkommen/page.tsx er verst: den sender wrapperen inn som
// `nav={<UserMenuWrapper />}` til WelcomeShell. Skallet har altså en
// navigasjons-SPALTE, og spalten fylles med noe som alltid er tomt.
const KJENT_INERT_WRAPPER = [
  'app/bedrift/registrer/page.tsx',
  'app/bedrift/success/page.tsx',
  'app/org/[slug]/velkommen/page.tsx',
]

test('B-18: <UserMenuWrapper /> på skjult rute er INERT — den gir ikke nav', () => {
  const faktisk = FLATER.filter(f => f.harWrapper && f.skjultIUserMenu).map(f => f.fil)
  assert.deepEqual(faktisk, KJENT_INERT_WRAPPER,
    'settet av flater der <UserMenuWrapper /> rendrer null har endret seg. ' +
    'Ble en av dem «fikset» ved å flytte wrapperen til en annen gren, er den ' +
    'fortsatt inert — les kommentaren over denne testen før du melder B-18 lukket.')
})

test('B-18: de tre inerte flatene har heller ingen egen SiteNav', () => {
  // Forutsetningen for at wrapperen er inert OG at det betyr noe: hadde flaten
  // SiteNav, ville skjulingen vært riktig og wrapperen bare overflødig. Uten
  // SiteNav er skjulingen grunnen til at flaten er tom.
  const medSiteNav = FLATER
    .filter(f => KJENT_INERT_WRAPPER.includes(f.fil) && f.harSiteNav)
    .map(f => f.fil)
  assert.deepEqual(medSiteNav, [],
    'har flaten fått SiteNav, er wrapperen bare overflødig og ikke lenger et ' +
    'nav-hull — flytt raden ut av KJENT_INERT_WRAPPER og fjern wrapperen.')
})
