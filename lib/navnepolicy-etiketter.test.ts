// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: ett ord per ting i navigasjon og overskrifter.
//
// ── VEDTATT ORDBRUK (Dennis, 6. september 2026) ─────────────────────────────
//   Toppliste             den nasjonale lista — INGEN kvalifisering, den er
//                         standardtilfellet
//   Bedriftens toppliste  org-lista (H1 på /org/[slug], bunnlenker)
//   <bedriftens navn>     hjemmet /org/[slug] — i topplinjen OG kontomenyen
//                         (6. september 2026). Ikke «Bedriften»: to etiketter
//                         for samme mål er feilklassen denne fila voktet mot
//   Ligaens toppliste     én liga
//   Mine ligaer           oversikten over flere (nav-lenken heter «Ligaer»,
//                         ubestemt som resten av topplinjen — bevisst)
//   Resultater            ÉN quiz sin liste. En avsluttet quiz er ikke en
//                         pågående rangering, så den heter ikke «toppliste»
//   Quizarkiv             ett ord, konsekvent
//   Gratis                motsatsen til Premium (ikke «Standardkonto»)
//
// H1 står i bestemt form («Topplisten», «Quizarkivet»), nav i ubestemt —
// samme mønster som «Mine ligaer»-siden alt hadde.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// En kartlegging 5. september fant samme liste under seks navn
// («Sesongtoppliste», «Nasjonal toppliste», «den åpne topplisten», «Global
// konkurranse», …) og én quiz sine resultater under fire («Se leaderboard»,
// «Se topplisten», «Se full toppliste», «Se ukens resultater»). Ingen test
// voktet ordene, så hver ny flate valgte sitt eget. Denne fila gjør en ny
// drift rød: både at de vedtatte etikettene STÅR der de skal, og at de
// utgåtte ordene ikke kommer tilbake som navigasjonsetiketter.
//
// ── HVA SOM BEVISST IKKE VOKTES ─────────────────────────────────────────────
//   • app/vilkar/page.tsx og app/personvern/page.tsx sier fortsatt
//     «leaderboard». Juridiske sider endres ikke i en navnerunde — egen
//     beslutning, tatt separat. De er derfor unntatt fra fraværstesten.
//   • «Din arbeidsplass» (OrgCard) og «Din bedrift» (profil) er
//     kortoverskrifter for kort som inneholder MER enn topplisten. De
//     beskriver et sted, ikke en liste, og står med vilje.
//   • «Toppliste» som SectionLabel inne i bedriftspanelet: konteksten bærer
//     den, «Bedriftens toppliste» inne på bedriftens egen side er stotring.
//   • «Treningsrunder» / «Arkivkopier» i admin er admins navn på KOPIENE
//     (quiz_type='archive'), ikke brukerens inngang. Ikke Quizarkiv.
//   • Ingenting i lib/email-templates.ts lenger — malene ble hentet inn
//     6. september og vaktes nå av egne tester nederst i denne fila.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/kontomeny-arkivlenke.test.ts — npm test kjører kun lib/**/*.test.ts under
// Node sin egen runner, uten jsdom, og flatene er klientkomponenter på
// 400–5000 linjer.
//
// ── KOMMENTARER MÅ STRIPPES, ELLERS ER TESTEN RØD AV FEIL GRUNN ─────────────
// Kildekommentarer forklarer historikken og siterer de gamle ordene ordrett
// («Sesongtoppliste — konkurrér over tid» var usant …). `renKode()` fjerner
// blokk- og linjekommentarer FØR noe måles — og denne filas egne kommentarer
// er ikke med i målingen, siden den kun leser app/ og components/.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Topplinjens «Toppliste» skrives tilbake til «Sesongtoppliste» →
//     «topplinjen heter Toppliste» OG fraværstesten ryker.
//   • Kontomenyens «Quizarkiv» blir «Arkivet» igjen → «kontomenyen heter
//     Quizarkiv» ryker, og lib/kontomeny-arkivlenke.test.ts med den.
//   • Forsidens knapp får ÉN fast etikett igjen → «forsidens knapp følger
//     målet» ryker (den knappen har to destinasjoner, se testen).
//   • En ny flate skriver «Se leaderboard →» → fraværstesten ryker og
//     navngir fil og linje.
//   • En e-postmal skriver «Sesong-leaderboard» igjen → e-post-fraværstesten
//     nederst ryker (se egen kommentarblokk der).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { accountMenuGroups, guestMenuLinks, topLinks } from './nav-model'

/** Kilden uten BOM og uten kommentarer. */
function renKode(raw: string): string {
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

function les(fil: string): string {
  return renKode(readFileSync(fil, 'utf8'))
}

/** Alle .tsx-filer under en mappe, rekursivt, med skråstrek som skille. */
function tsxFiler(rot: string): string[] {
  const ut: string[] = []
  for (const navn of readdirSync(rot)) {
    const sti = join(rot, navn)
    if (statSync(sti).isDirectory()) ut.push(...tsxFiler(sti))
    else if (navn.endsWith('.tsx')) ut.push(sti.replace(/\\/g, '/'))
  }
  return ut
}

// ── De vedtatte etikettene STÅR der de skal ─────────────────────────────────

// Etikettene i nav-en bor i lib/nav-model.ts (6. september 2026) og kalles
// her per brukertype — ikke regex mot NavAuth.tsx, som bare rendrer modellen.
const NAV_GJEST = { loggedIn: false, activeQuizId: null, pathname: '/', myOrgs: [] }
const NAV_ORG = { orgId: 'o1', orgSlug: 'elkjop-nordic', orgName: 'Elkjøp Nordic', isAdmin: true, allowGlobalLeague: true }
const NAV_MEDLEM = {
  loggedIn: true, activeQuizId: null, pathname: '/', myOrgs: [NAV_ORG],
  profileLoaded: true, isPremium: false, hasStripeCustomer: false, hasUsedTrial: false,
}

test('topplinjen, hamburgeren og kontomenyen heter «Toppliste» — uten kvalifisering', () => {
  const lenker = [
    ...topLinks(NAV_GJEST), ...guestMenuLinks(NAV_GJEST),
    ...topLinks(NAV_MEDLEM), ...accountMenuGroups(NAV_MEDLEM).flat(),
  ].filter(l => 'href' in l && l.href === '/toppliste')
  assert.equal(lenker.length, 4, 'gjest topplinje + hamburger, innlogget topplinje + kontomeny = fire lenker til /toppliste')
  for (const l of lenker) assert.equal(l.label, 'Toppliste')
  // Og modellen har nøyaktig ÉN definisjon av etiketten — ingen kopi kan drifte.
  const modell = les('lib/nav-model.ts')
  assert.equal((modell.match(/label: 'Toppliste'/g) ?? []).length, 1)
  assert.doesNotMatch(les('components/NavAuth.tsx'), />\s*Toppliste\s*</, 'NavAuth har en egen «Toppliste»-etikett utenom modellen')
})

test('bedriftens hjem bærer bedriftens navn — i topplinjen OG kontomenyen', () => {
  const meny = accountMenuGroups(NAV_MEDLEM).flat().filter(r => r.kind === 'link' && r.href === '/org/elkjop-nordic')
  assert.equal(meny.length, 1)
  assert.equal(meny[0].label, 'Elkjøp Nordic', 'kontomenyen viser navnet, ikke en fast etikett')
  assert.doesNotMatch(les('lib/nav-model.ts'), /label: 'Bedriften'/, '«Bedriften» som fast etikett er tilbake — to etiketter for samme mål')
  const topp = topLinks(NAV_MEDLEM).filter(l => l.href === '/org/elkjop-nordic')
  assert.equal(topp.length, 1)
  assert.equal(topp[0].label, 'Elkjøp Nordic', 'topplinjens slot viser bedriftens navn')
  // Panelet heter fortsatt «Bedriftspanel» og bor i kontomenyen, ikke i topplinjen.
  assert.equal(accountMenuGroups(NAV_MEDLEM).flat().filter(r => r.label === 'Bedriftspanel').length, 1)
  assert.equal(topLinks(NAV_MEDLEM).filter(l => l.label === 'Bedriftspanel').length, 0)
  // «Bedriftens toppliste» er sidens H1 og bunnlenkene — ikke lenger en nav-etikett.
  assert.doesNotMatch(les('lib/nav-model.ts'), /Bedriftens toppliste'/)
})

test('kontomenyen og topplinjen heter «Quizarkiv», ikke «Arkivet»', () => {
  const alle = [...topLinks(NAV_GJEST), ...topLinks(NAV_MEDLEM), ...accountMenuGroups(NAV_MEDLEM).flat()]
    .filter(l => 'href' in l && l.href === '/arkiv')
  assert.equal(alle.length, 3)
  for (const l of alle) assert.equal(l.label, 'Quizarkiv')
})

test('kontomerket for ikke-Premium heter «Gratis» — i nav og på profilen', () => {
  assert.match(les('components/NavAuth.tsx'), />\s*Gratis\s*<\/span>/)
  assert.match(les('app/profil/page.tsx'), />Gratis<\/span>/)
})

test('H1-ene står i bestemt form: Topplisten, Bedriftens toppliste, Quizarkivet, Mine ligaer', () => {
  assert.match(les('app/toppliste/page.tsx'), /Topp<em[^>]*>listen<\/em>/)
  assert.match(les('app/org/[slug]/page.tsx'), /Bedriftens <em[^>]*>toppliste<\/em>/)
  assert.match(les('app/arkiv/page.tsx'), /<h1[^>]*>Quizarkivet<\/h1>/)
  assert.match(les('app/liga/page.tsx'), /Mine <em[^>]*>ligaer<\/em>/)
})

test('én quiz sin liste heter Resultater der lenken peker på /leaderboard/<quizId>', () => {
  // Historikk-sidene lenker fra ett forsøk til den quizens resultatside.
  assert.match(les('app/historikk/page.tsx'), /\/leaderboard\/\$\{sisteForsok\.quiz_id\}[^>]*>\s*Resultater →/)
  assert.match(les('app/historikk/[attemptId]/page.tsx'), /\/leaderboard\/\$\{detail\.quiz_id\}[^>]*>\s*Resultater →/)
  // «Siste quiz»-raden i sesongtopplisten lenker til én quiz.
  assert.match(les('components/SeasonLeaderboard.tsx'), /Resultater →/)
})

test('resultatsidens bunnlenker: Toppliste / Bedriftens toppliste / Ligaens toppliste', () => {
  const side = les('app/leaderboard/[id]/page.tsx')
  assert.match(side, /Se bedriftens toppliste →/)
  assert.match(side, /Ligaens toppliste →/)
  assert.match(side, /href=\{`\/toppliste\$\{[^`]*`\}[^>]*>\s*Se topplisten →/)
  assert.match(side, /href="\/toppliste"[^>]*>\s*Toppliste →/)
})

test('forsidens quizkort-knapp har ETT mål: Se resultatene til forrige quiz', () => {
  // 7. september 2026: knappen pekte til /org/<slug> for medlem av nøyaktig én
  // bedrift, ellers til forrige quiz — to destinasjoner bak én knapp, og på en
  // KOMMENDE quiz sa den «Bedriftens toppliste» om noe helt annet enn kortet.
  // Bedriftsmålet finnes allerede i OrgCard rett under. Nå: ett mål, én
  // etikett, i både kommende- og ingen-tilstanden.
  const forside = les('app/page.tsx')
  const knapper = forside.match(/\{lastClosedQuizId && \(\s*<div className="qk-card-actions"[^>]*>\s*<Link href=\{`\/leaderboard\/\$\{lastClosedQuizId\}`\} className="qk-btn-primary">\s*Se resultatene\s*<\/Link>/g) ?? []
  assert.equal(knapper.length, 2, 'kommende-quiz-kortet og ingen-quiz-kortet skal begge ha «Se resultatene» til forrige quiz, gatet på lastClosedQuizId')
  // Det gamle todelte målet skal ikke komme tilbake.
  assert.ok(!forside.includes('singleOrgToplistHref'), 'singleOrgToplistHref er tilbake — knappen har to mål igjen')
  assert.ok(!/qk-btn-primary">\s*\{[^}]*'Bedriftens toppliste'/.test(forside), 'quizkortets knapp sier «Bedriftens toppliste» igjen — det målet bor i OrgCard')
  // Bedriftsmålet bor i OrgCard, som forsiden rendrer.
  assert.match(les('components/OrgCard.tsx'), />\s*Se bedriftens toppliste →\s*</, 'OrgCard har mistet lenken til bedriftens toppliste')
  assert.match(forside, /<OrgCard \/>/)
})

// ── De utgåtte ordene finnes ikke lenger som etiketter ──────────────────────

/** Ord som var i bruk fram til 6. september 2026 og som ikke skal komme tilbake. */
const UTGAATT: ReadonlyArray<{ re: RegExp; ble: string }> = [
  { re: /sesong-?toppliste/i, ble: 'Toppliste' },
  { re: /Nasjonal toppliste/, ble: 'Toppliste' },
  { re: /den åpne topplisten/, ble: 'topplisten' },
  { re: /Global konkurranse/, ble: 'topplisten' },
  { re: /\bMin bedrift\b/, ble: 'Bedriftens toppliste' },
  { re: /bedriftstoppliste/i, ble: 'Bedriftens toppliste' },
  { re: /bedrifts-toppliste/i, ble: 'bedriftens toppliste' },
  { re: /liga-toppliste/i, ble: 'Ligaens toppliste' },
  { re: /Se leaderboard/, ble: 'Resultater' },
  { re: /Se ukens resultater/, ble: 'Se resultatene' },
  { re: /Se full toppliste/, ble: 'Se resultatene / Se bedriftens toppliste' },
  { re: /Se toppliste →/, ble: 'Resultater →' },
  { re: /full toppliste/, ble: 'alle resultatene' },
  { re: /på leaderboard\b/, ble: 'på topplisten / i resultatene' },
  { re: /leaderboard for \$?\{/, ble: 'resultatene for' },
  { re: /Standardkonto/, ble: 'Gratis' },
  { re: />\s*Arkivet\s*</, ble: 'Quizarkiv' },
  { re: />\s*Arkiv\s*</, ble: 'Quizarkiv' },
  { re: /Til arkivet/, ble: 'Til quizarkivet' },
  { re: /fra arkivet/, ble: 'fra quizarkivet' },
  { re: /til arkivet</, ble: 'til quizarkivet' },
  { re: /'Arkivet — /, ble: "'Quizarkivet — " },
]

/** Juridiske sider — «leaderboard» står der etter egen beslutning. */
const UNNTATT = new Set(['app/vilkar/page.tsx', 'app/personvern/page.tsx'])

/**
 * Admin-badgen «Arkiv» på arkivkopi-rader er en STATUS, ikke navigasjon, og
 * gruppetittelen «Arkivkopier» er admins ord for kopiene. Begge står med vilje.
 */
const ADMIN_STATUS_UNNTAK = new Set(['app/admin/page.tsx', 'app/admin/quizzes/page.tsx'])

test('ingen utgått etikett står igjen i app/ eller components/', () => {
  const filer = [...tsxFiler('app'), ...tsxFiler('components')].filter(f => !UNNTATT.has(f))
  const funn: string[] = []
  for (const fil of filer) {
    const linjer = les(fil).split('\n')
    linjer.forEach((linje, i) => {
      for (const { re, ble } of UTGAATT) {
        if (re.source === />\s*Arkiv\s*</.source && ADMIN_STATUS_UNNTAK.has(fil)) continue
        if (re.test(linje)) funn.push(`${fil}:${i + 1}  /${re.source}/  → skal være «${ble}»:  ${linje.trim()}`)
      }
    })
  }
  assert.deepEqual(funn, [], `utgåtte etiketter funnet:\n${funn.join('\n')}`)
})

test('de juridiske sidene står FORTSATT med «leaderboard» — flyttes de, skal unntaket bort', () => {
  // Unntaket over er en beslutning, ikke en glipp. Blir sidene skrevet om
  // separat, skal denne testen minne om å fjerne unntaket, så vakten dekker
  // dem også.
  for (const fil of UNNTATT) {
    assert.match(les(fil), /leaderboard/, `${fil} sier ikke lenger «leaderboard» — fjern fila fra UNNTATT`)
  }
})

// ── E-postmalene bruker SAMME ord som appen (6. september 2026) ─────────────
//
// Navnerunden 76c0c8a byttet ordbruken i app/ og components/, men lot
// lib/email-templates.ts stå — e-post var utenfor den bestillingen. Resultatet
// var at e-posten og appen sa ULIKE ting om samme flate: malene lovet
// «sesongtoppliste», «Sesong-leaderboard» og «nøyaktig plassering på
// leaderboardet» om funksjoner appen nå kaller «topplisten» og «resultatene».
// En bruker som klikket seg fra e-posten inn i appen fant ikke ordet igjen.
//
// Ingen av de utgåtte ordene sto i en EMNELINJE — emnene settes hos kallerne
// (webhook, cron-rutene), og ingen av dem nevner de berørte flatene. Det er
// verdt å vite fordi emnelinja er det eneste folk ser i innboksen; her var
// skaden begrenset til brødteksten.
//
// MUTASJONSBEVIS:
//   • En mal skriver «Sesong-leaderboard» igjen → fraværstesten ryker med
//     linjenummer.
//   • Premium-punktlistene mister «Nøyaktig plassering i resultatene» eller
//     «Hele topplisten» → nærværstesten ryker for den malen.
const EPOST = 'lib/email-templates.ts'

/**
 * Kilden uten JS-kommentarer OG uten HTML-kommentarer. Malene er HTML i
 * template-literaler, og `<!-- … -->` der forklarer historikk i prosa — blant
 * annet en fjernet CTA som pekte på /toppliste. Uten strippingen ville
 * fraværstesten kunne bli rød av en kommentar som beskriver fortiden korrekt.
 */
function lesEpost(): string {
  return renKode(readFileSync(EPOST, 'utf8')).replace(/<!--[\s\S]*?-->/g, '')
}

/** Utgåtte ord i e-postmalene, med HTML-entitetsvariantene malene faktisk bruker. */
const UTGAATT_EPOST: ReadonlyArray<{ re: RegExp; ble: string }> = [
  { re: /sesong-?toppliste/i, ble: 'topplisten / Hele topplisten' },
  { re: /sesong-?leaderboard/i, ble: 'Hele topplisten' },
  { re: /leaderboard/i, ble: 'topplisten / resultatene' },
  { re: /plassering på topplisten/i, ble: 'plassering i resultatene' },
  { re: /p&aring; topplisten/i, ble: 'i resultatene' },
  { re: /bedriftens egen toppliste/i, ble: 'bedriftens toppliste' },
  { re: /den åpne topplisten/i, ble: 'topplisten' },
  { re: /full toppliste/i, ble: 'hele topplisten' },
  { re: /\bMin bedrift\b/, ble: 'Bedriftens toppliste' },
  { re: /Standardkonto/, ble: 'Gratis' },
]

test('e-postmalene bruker ingen utgått etikett', () => {
  const linjer = lesEpost().split('\n')
  const funn: string[] = []
  linjer.forEach((linje, i) => {
    for (const { re, ble } of UTGAATT_EPOST) {
      if (re.test(linje)) funn.push(`${EPOST}:${i + 1}  /${re.source}/  → skal være «${ble}»:  ${linje.trim().slice(0, 120)}`)
    }
  })
  assert.deepEqual(funn, [], `utgåtte etiketter i e-postmalene:\n${funn.join('\n')}`)
})

test('Premium-punktlistene i e-post sier «i resultatene» og «Hele topplisten»', () => {
  // Tre maler har den samme fire-punkts Premium-lista: trialWelcomeEmail,
  // foundersWelcomeEmail og premiumWelcomeEmail. Punkt 1 er plassering på ÉN
  // quiz, punkt 4 er sesonglista — nøyaktig samme skille som appens
  // /premium-side gjør. Faller ett av dem tilbake, er e-post og app uenige igjen.
  const src = lesEpost()
  const plassering = src.match(/Nøyaktig plassering i resultatene/g) ?? []
  assert.equal(plassering.length, 3, 'tre maler skal ha punktet «Nøyaktig plassering i resultatene»')
  const toppliste = src.match(/Hele topplisten/g) ?? []
  assert.equal(toppliste.length, 3, 'to punktlister + premiumWelcomeEmails «med din eksakte plass»')
})

test('kvitteringen for verdikode og varselet om ny quiz følger ordbruken', () => {
  const src = lesEpost()
  // codeActivatedEmail — HTML-entiteter, så ordene må matches slik de står.
  assert.match(src, /n&oslash;yaktig plassering i resultatene, hele topplisten/)
  // quizOpenedEmail handler om ÉN quiz som nettopp åpnet → «resultatene».
  assert.match(src, /se hvor du havner i resultatene!/)
})
