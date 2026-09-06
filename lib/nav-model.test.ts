// Kjøres med:  npm test
//
// Innholdet i topplinjen, gjeste-hamburgeren og kontomenyen — per brukertype
// og innloggingsstatus. Dette er OPPFØRSELSTESTER mot lib/nav-model.ts, ikke
// regex mot NavAuth.tsx: modellen er rene funksjoner, så hver brukertype kan
// kalles direkte. Wiring-testen nederst binder NavAuth til modellen.
//
// ── MODELLEN (Dennis, 6. september 2026) ────────────────────────────────────
//   Topplinjen:  Spill · Toppliste · For bedrifter/bedriften · Quizarkiv
//   Kontomenyen: [Spill] Toppliste · Quizarkiv · Ligaer · Bedriften/For
//                bedrifter · Bedriftspanel / Min profil · Quizhistorikk ·
//                Abonnement / Slik fungerer det   (Logg ut rendres av NavAuth)
//   Hamburger:   kun gjest — topplinjens fire + Ligaer + Slik fungerer det
//
// MUTASJONSBEVIS — hver test navngir endringen den feller:
//   • Ligaer eller Slik fungerer det legges tilbake i topplinjen → «topplinjen
//     har nøyaktig fire slots» ryker for hver profil.
//   • Bedriftspanel legges i topplinjen → samme test ryker for admin.
//   • «Spill» rendres uten åpen quiz → «uten åpen quiz finnes ingen Spill» ryker.
//   • «Spill» rendres på quizens egen side → «Spill skjules på quizens egen
//     side» ryker.
//   • globalHidden-gaten fjernes → «globalHidden-medlem har ingen Toppliste» ryker.
//   • Utløpt kortløs trial sendes til portalen → «Abonnement per tilstand» ryker.
//   • Quizhistorikk mister Premium-badgen for gratis → samme test ryker.
//   • Gruppene slås sammen eller bytter rekkefølge → «kontomenyens grupper» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  accountMenuGroups, guestMenuLinks, isGlobalHidden, spillHref, topLinks,
  type AccountMenuInput, type NavInput, type NavOrg,
} from './nav-model'

const QUIZ = '11111111-1111-4111-8111-111111111111'

const elkjop: NavOrg = { orgId: 'o1', orgSlug: 'elkjop-nordic', orgName: 'Elkjøp Nordic', isAdmin: false, allowGlobalLeague: true }
const elkjopAdmin: NavOrg = { ...elkjop, isAdmin: true }
const nordisk: NavOrg = { orgId: 'o2', orgSlug: 'nordisk', orgName: 'Nordisk Kvalitetsbyggeri og Eiendomsforvaltning AS', isAdmin: true, allowGlobalLeague: true }
const lukket: NavOrg = { ...elkjop, allowGlobalLeague: false }

function gjest(over: Partial<NavInput> = {}): NavInput {
  return { loggedIn: false, activeQuizId: null, pathname: '/arkiv', myOrgs: [], ...over }
}
function innlogget(over: Partial<AccountMenuInput> = {}): AccountMenuInput {
  return {
    loggedIn: true, activeQuizId: null, pathname: '/arkiv', myOrgs: [],
    profileLoaded: true, isPremium: false, hasStripeCustomer: false, hasUsedTrial: false,
    ...over,
  }
}
const labels = (rows: ReadonlyArray<{ label: string }>) => rows.map(r => r.label)
const hrefs = (rows: ReadonlyArray<object>) => rows.map(r => (r as { href?: string }).href)

// ── Topplinjen ──────────────────────────────────────────────────────────────

const PROFILER: ReadonlyArray<[string, NavInput, string[]]> = [
  ['gjest',                  gjest(),                                          ['Toppliste', 'For bedrifter', 'Quizarkiv']],
  ['innlogget uten org',     innlogget(),                                      ['Toppliste', 'For bedrifter', 'Quizarkiv']],
  ['org-medlem',             innlogget({ myOrgs: [elkjop] }),                  ['Toppliste', 'Elkjøp Nordic', 'Quizarkiv']],
  ['org-admin',              innlogget({ myOrgs: [elkjopAdmin] }),             ['Toppliste', 'Elkjøp Nordic', 'Quizarkiv']],
  ['admin i to bedrifter',   innlogget({ myOrgs: [elkjopAdmin, nordisk] }),    ['Toppliste', 'Elkjøp Nordic', 'Quizarkiv']],
]

for (const [navn, input, forventet] of PROFILER) {
  test(`topplinjen (${navn}): tre lenker uten quiz, fire med — aldri Ligaer, Slik fungerer det eller Bedriftspanel`, () => {
    assert.deepEqual(labels(topLinks(input)), forventet)
    const medQuiz = topLinks({ ...input, activeQuizId: QUIZ })
    assert.deepEqual(labels(medQuiz), ['Spill', ...forventet])
    assert.equal(medQuiz.length, 4, 'topplinjen har nøyaktig fire slots med åpen quiz')
    for (const forbudt of ['Ligaer', 'Slik fungerer det', 'Bedriftspanel', 'Bedriftens toppliste']) {
      assert.ok(!labels(medQuiz).includes(forbudt), `«${forbudt}» hører hjemme i kontomenyen, ikke i topplinjen`)
    }
  })
}

test('topplinjen: bedrifts-slotten peker på /org/[slug] (hjemmet), ikke på scope-bryteren', () => {
  const rad = topLinks(innlogget({ myOrgs: [elkjop] }))
  const org = rad.find(l => l.key.startsWith('org:'))
  assert.ok(org, 'ingen bedrifts-lenke for et org-medlem')
  assert.equal(org.href, '/org/elkjop-nordic')
  assert.equal(org.clamp, true, 'org-navnet er brukerskrevet og må klemmes')
  // Gjest og ikke-medlem får «For bedrifter» i samme slot.
  assert.equal(topLinks(gjest())[1].href, '/bedrift')
  assert.equal(topLinks(innlogget())[1].href, '/bedrift')
})

test('topplinjen: en gjest får aldri en bedrifts-lenke, selv om myOrgs skulle være satt', () => {
  // myOrgs kan stå igjen i context et øyeblikk etter utlogging.
  assert.deepEqual(labels(topLinks(gjest({ myOrgs: [elkjop] }))), ['Toppliste', 'For bedrifter', 'Quizarkiv'])
})

test('topplinjen: bare den FØRSTE bedriften får slotten — resten bor i kontomenyen', () => {
  const rad = topLinks(innlogget({ myOrgs: [elkjopAdmin, nordisk] }))
  assert.equal(rad.filter(l => l.key.startsWith('org:')).length, 1)
  const meny = accountMenuGroups(innlogget({ myOrgs: [elkjopAdmin, nordisk] }))[0]
  assert.deepEqual(hrefs(meny.filter(r => r.key.startsWith('org:'))), ['/org/elkjop-nordic', '/org/nordisk'])
})

// ── «Spill» ─────────────────────────────────────────────────────────────────

test('uten åpen quiz finnes ingen Spill — verken i topplinje, hamburger eller kontomeny', () => {
  assert.equal(spillHref(null, '/'), null)
  assert.ok(!labels(topLinks(gjest())).includes('Spill'))
  assert.ok(!labels(guestMenuLinks(gjest())).includes('Spill'))
  assert.ok(!labels(accountMenuGroups(innlogget()).flat()).includes('Spill'))
})

test('med åpen quiz står Spill FØRST alle tre stedene og peker på /quiz/<id>', () => {
  const href = `/quiz/${QUIZ}`
  assert.equal(spillHref(QUIZ, '/'), href)
  assert.equal(topLinks(gjest({ activeQuizId: QUIZ }))[0].href, href)
  assert.equal(guestMenuLinks(gjest({ activeQuizId: QUIZ }))[0].href, href)
  const g1 = accountMenuGroups(innlogget({ activeQuizId: QUIZ }))[0]
  assert.equal(g1[0].kind, 'link')
  assert.equal(g1[0].kind === 'link' ? g1[0].href : null, href)
})

test('Spill skjules på quizens egen side — og bare der', () => {
  assert.equal(spillHref(QUIZ, `/quiz/${QUIZ}`), null)
  assert.equal(spillHref(QUIZ, `/leaderboard/${QUIZ}`), `/quiz/${QUIZ}`)
  assert.equal(spillHref(QUIZ, '/quiz/annen-id'), `/quiz/${QUIZ}`)
  assert.ok(!labels(topLinks(innlogget({ activeQuizId: QUIZ, pathname: `/quiz/${QUIZ}` }))).includes('Spill'))
  assert.ok(!labels(accountMenuGroups(innlogget({ activeQuizId: QUIZ, pathname: `/quiz/${QUIZ}` })).flat()).includes('Spill'))
})

// ── Gjestens hamburger ──────────────────────────────────────────────────────

test('gjestens hamburger: topplinjens fire + Ligaer + Slik fungerer det, i den rekkefølgen', () => {
  assert.deepEqual(labels(guestMenuLinks(gjest({ activeQuizId: QUIZ }))),
    ['Spill', 'Toppliste', 'For bedrifter', 'Quizarkiv', 'Ligaer', 'Slik fungerer det'])
  assert.deepEqual(hrefs(guestMenuLinks(gjest())),
    ['/toppliste', '/bedrift', '/arkiv', '/liga', '/slik-fungerer-det'])
})

// ── Kontomenyen ─────────────────────────────────────────────────────────────

test('kontomenyens grupper: navigasjon / konto / hjelp — for hver profil', () => {
  const tilfeller: ReadonlyArray<[string, AccountMenuInput, string[]]> = [
    ['innlogget uten org',   innlogget(),                                   ['Toppliste', 'Quizarkiv', 'Ligaer', 'For bedrifter']],
    ['org-medlem',           innlogget({ myOrgs: [elkjop] }),               ['Toppliste', 'Quizarkiv', 'Ligaer', 'Elkjøp Nordic']],
    ['org-admin',            innlogget({ myOrgs: [elkjopAdmin] }),          ['Toppliste', 'Quizarkiv', 'Ligaer', 'Elkjøp Nordic', 'Bedriftspanel']],
    ['admin i to bedrifter', innlogget({ myOrgs: [elkjopAdmin, nordisk] }), ['Toppliste', 'Quizarkiv', 'Ligaer', 'Elkjøp Nordic', nordisk.orgName, 'Elkjøp Nordic', nordisk.orgName]],
  ]
  for (const [navn, input, g1] of tilfeller) {
    const grupper = accountMenuGroups(input)
    assert.equal(grupper.length, 3, `${navn}: tre grupper`)
    assert.deepEqual(labels(grupper[0]), g1, `${navn}: gruppe 1`)
    assert.deepEqual(labels(grupper[1]), ['Min profil', 'Quizhistorikk', 'Abonnement'], `${navn}: gruppe 2`)
    assert.deepEqual(labels(grupper[2]), ['Slik fungerer det'], `${navn}: gruppe 3`)
  }
})

test('kontomenyen: bedriftens navn og Bedriftspanel peker på hjemmet og panelet, org-navn klemmes', () => {
  const g1 = accountMenuGroups(innlogget({ myOrgs: [elkjopAdmin] }))[0]
  const bedriften = g1.find(r => r.key === 'org:elkjop-nordic')
  const panel = g1.find(r => r.label === 'Bedriftspanel')
  assert.ok(bedriften && bedriften.kind === 'link' && bedriften.href === '/org/elkjop-nordic')
  assert.equal(bedriften.label, 'Elkjøp Nordic', 'kontomenyen viser bedriftens navn — samme etikett som topplinjen')
  assert.ok(bedriften.clamp === true, 'org-navnet er brukerskrevet og må klemmes, også med én bedrift')
  assert.ok(panel && panel.kind === 'link' && panel.href === '/org/elkjop-nordic/admin')
  assert.ok(!('clamp' in panel && panel.clamp), 'faste etiketter klemmes ikke')
  const to = accountMenuGroups(innlogget({ myOrgs: [elkjopAdmin, nordisk] }))[0]
  for (const rad of to.filter(r => r.label === nordisk.orgName)) {
    assert.ok(rad.kind === 'link' && rad.clamp === true, 'org-navn i kontomenyen må klemmes')
  }
})

test('globalHidden-medlem har ingen Toppliste — topplinje og kontomeny er enige', () => {
  assert.equal(isGlobalHidden([lukket]), true)
  assert.equal(isGlobalHidden([elkjop]), false)
  assert.equal(isGlobalHidden([]), false)
  assert.deepEqual(labels(topLinks(innlogget({ myOrgs: [lukket] }))), ['Elkjøp Nordic', 'Quizarkiv'])
  assert.ok(!labels(accountMenuGroups(innlogget({ myOrgs: [lukket] })).flat()).includes('Toppliste'))
  // En gjest rammes ikke av en org-policy hun ikke er medlem av.
  assert.ok(labels(topLinks(gjest({ myOrgs: [lukket] }))).includes('Toppliste'))
})

test('før profilen har landet: Quizarkiv vises, Quizhistorikk og Abonnement holdes igjen', () => {
  const grupper = accountMenuGroups(innlogget({ profileLoaded: false }))
  assert.ok(labels(grupper[0]).includes('Quizarkiv'), 'arkivet trenger ingen profildata og skal vises med én gang')
  assert.deepEqual(labels(grupper[1]), ['Min profil'])
})

test('Quizarkiv i kontomenyen: ugatet, uten lås-badge, peker på /arkiv', () => {
  for (const isPremium of [false, true]) {
    const rad = accountMenuGroups(innlogget({ isPremium }))[0].find(r => r.label === 'Quizarkiv')
    assert.ok(rad && rad.kind === 'link')
    assert.equal(rad.href, '/arkiv')
    assert.equal(rad.badge, undefined, 'arkivlisten er ugatet — låsen står på radene inne på siden')
  }
})

test('Quizhistorikk: Premium → /historikk uten badge, gratis → /premium med badge', () => {
  const premium = accountMenuGroups(innlogget({ isPremium: true }))[1].find(r => r.label === 'Quizhistorikk')
  const gratis = accountMenuGroups(innlogget({ isPremium: false }))[1].find(r => r.label === 'Quizhistorikk')
  assert.ok(premium && premium.kind === 'link' && premium.href === '/historikk' && premium.badge === undefined)
  assert.ok(gratis && gratis.kind === 'link' && gratis.href === '/premium' && gratis.badge === 'premium')
})

test('Abonnement per tilstand: portal-knapp bare når det finnes noe å administrere', () => {
  const rad = (over: Partial<AccountMenuInput>) =>
    accountMenuGroups(innlogget(over))[1].find(r => r.label === 'Abonnement')
  const gratis = rad({})
  assert.ok(gratis && gratis.kind === 'link' && gratis.href === '/premium', 'gratis uten Stripe → /premium')
  const kode = rad({ isPremium: true })
  assert.ok(kode && kode.kind === 'link' && kode.href === '/profil#abonnement', 'Premium uten Stripe → profilkortet')
  const utloept = rad({ hasStripeCustomer: true, hasUsedTrial: true })
  assert.ok(utloept && utloept.kind === 'link' && utloept.href === '/premium', 'utløpt kortløs trial → /premium, IKKE portalen')
  const betalende = rad({ isPremium: true, hasStripeCustomer: true })
  assert.ok(betalende && betalende.kind === 'portal', 'betalende → portal')
  const avvistKort = rad({ hasStripeCustomer: true })
  assert.ok(avvistKort && avvistKort.kind === 'portal', 'avvist kort → portal (der oppdateres kortet)')
})

// ── Wiring: NavAuth rendrer modellen, ikke en egen liste ───────────────────

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

test('NavAuth rendrer topplinje, hamburger og kontomeny fra lib/nav-model — ingen inline lenkeliste', () => {
  const nav = aktivKode('components/NavAuth.tsx')
  assert.match(nav, /import \{ accountMenuGroups, guestMenuLinks, topLinks[^}]*\} from '@\/lib\/nav-model'/)
  assert.match(nav, /topplinje\.map\(l => <TopLink key=\{l\.key\} link=\{l\} alwaysVisible=\{l\.key === 'spill'\} \/>\)/,
    'gjesten skal rendre topplinjen fra topLinks() med Spill fast synlig')
  assert.match(nav, /topplinje\.map\(l => <TopLink key=\{l\.key\} link=\{l\} \/>\)/,
    'innlogget skal rendre topplinjen fra topLinks()')
  // Spill-lenken skjules under 899 KUN når alwaysVisible ikke er satt.
  assert.match(nav, /className=\{alwaysVisible \? undefined : 'nav-hide-mobile'\} style=\{spillLinkStyle\}/,
    'TopLink holder ikke gjestens Spill synlig under 899')
  assert.match(nav, /guestMenuLinks\(navInput\)\.map\(/, 'gjeste-hamburgeren rendrer ikke guestMenuLinks()')
  assert.match(nav, /const grupper = accountMenuGroups\(\{ \.\.\.navInput, profileLoaded, isPremium, hasStripeCustomer, hasUsedTrial \}\)/,
    'kontomenyen rendrer ikke accountMenuGroups() med alle inputene')
  assert.match(nav, /grupper\.map\(\(gruppe, i\) => \(/, 'gruppene rendres ikke')
  assert.match(nav, /\{i > 0 && <div style=\{menuDivider\} \/>\}/, 'gruppene skilles ikke med tynne linjer')
  // Ingen hardkodede lenker til seksjonene i komponenten — alt går via modellen.
  for (const href of ['"/toppliste"', '"/liga"', '"/bedrift"', '"/arkiv"', '"/slik-fungerer-det"', '"/profil"', '"/historikk"', '"/premium"']) {
    assert.ok(!nav.includes(`href=${href}`), `NavAuth har en hardkodet lenke href=${href} utenom modellen`)
  }
})

test('NavAuth: hamburgeren finnes kun i gjeste-grenen, og wrapperen er skjult på desktop', () => {
  const nav = aktivKode('components/NavAuth.tsx')
  assert.equal((nav.match(/className="qk-nav-hamburger"/g) ?? []).length, 1, 'nøyaktig én hamburger-wrapper (gjest)')
  assert.match(nav, /\.qk-nav-hamburger \{ display: none; \}/, 'wrapperen er ikke display:none på desktop — den koster 8 px gap uten å gjøre noe')
  assert.match(nav, /@media \(max-width: 899px\) \{[\s\S]*?\.qk-nav-hamburger \{ display: block !important; \}/, 'wrapperen vises ikke under 899')
  // Hamburgeren står FØR «Logg inn» og «if (!isLoggedIn)»-grenen slutter før avataren.
  const hamburger = nav.indexOf('className="qk-nav-hamburger"')
  const gjesteGren = nav.indexOf('if (!isLoggedIn) {')
  const innloggetGren = nav.indexOf('const initial = getAvatarInitial(displayName)')
  assert.ok(gjesteGren < hamburger && hamburger < innloggetGren, 'hamburgeren ligger ikke inne i gjeste-grenen')
})

test('NavAuth: «Spill» kommer fra ActiveQuizProvider, ikke fra en prop eller /api/quiz/active', () => {
  const nav = aktivKode('components/NavAuth.tsx')
  assert.match(nav, /const activeQuizId = useActiveQuizId\(\)/)
  assert.match(nav, /export default function NavAuth\(\)/, 'NavAuth tar ikke lenger props — quizId kommer fra context')
  assert.ok(!nav.includes('/api/quiz/active'), 'NavAuth skal ikke lese /api/quiz/active — ruta mangler hvitelisten')
})
