// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: at «Quizarkiv» står i konto-menyen — ugatet, uten lås,
// uten gull — og at inngangen ikke kan forsvinne uten at noen tar stilling.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// Fram til 30. august 2026 hadde /arkiv tre innganger, og alle var dårlige:
// /historikk (Premium-only — kan aldri være noens FØRSTE møte), /quizer (uten
// desktop-navlenke) og resultatskjermen etter en arkivrunde (forutsetter at
// du allerede er der). En uinnlogget desktop-besøkende hadde null vei inn.
//
// 6. september 2026 fikk Quizarkiv i tillegg en fast slot i TOPPLINJEN (for
// alle, også gjest), og innholdet i menyene flyttet fra JSX til rene data i
// lib/nav-model.ts. Denne fila tester derfor MODELLEN for det den kan svare
// på (finnes lenken, hvor, med hvilken href, uten badge) og NavAuth.tsx kun
// for det som fortsatt er rendering (at en rad uten badge ikke får gull, og
// at radene faktisk kommer fra modellen). Forgjengeren regex-parset hele
// menyen og telte `href="/arkiv"` nøyaktig én gang i NavAuth — den tellingen
// er meningsløs nå som lenken med vilje står fire steder (gjest/innlogget ×
// topplinje/meny), og den lå uansett i kildeteksten, ikke i oppførselen.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • QUIZARKIV fjernes fra accountMenuGroups → «arkivlenken finnes i
//     kontomenyen for hver profil» ryker.
//   • Lenken flyttes til gruppe 2 (kontogruppen) → «står i gruppe 1, etter
//     Toppliste og før Ligaer» ryker.
//   • Lenken får `badge: 'premium'` → «bærer ingen Premium-lås» ryker.
//   • Lenken pakkes inn i profileLoaded-gaten → «vises før profilen har
//     landet» ryker.
//   • MenuRow gis gullfarge for vanlige rader → «menyrader uten badge bruker
//     ikke gull» ryker.
//   • Topplinjens Quizarkiv fjernes → «Quizarkiv står i topplinjen for gjest
//     og innlogget» ryker (den ugatede desktop-inngangen).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accountMenuGroups, topLinks, type AccountMenuInput, type NavOrg } from './nav-model'

const org: NavOrg = { orgId: 'o1', orgSlug: 'elkjop-nordic', orgName: 'Elkjøp Nordic', isAdmin: false, allowGlobalLeague: true }
const lukketOrg: NavOrg = { ...org, allowGlobalLeague: false }

function innlogget(over: Partial<AccountMenuInput> = {}): AccountMenuInput {
  return {
    loggedIn: true, activeQuizId: null, pathname: '/', myOrgs: [],
    profileLoaded: true, isPremium: false, hasStripeCustomer: false, hasUsedTrial: false,
    ...over,
  }
}

/** Profilene som skal ha lenken — alle innloggede, uansett Premium og org. */
const PROFILER: ReadonlyArray<[string, AccountMenuInput]> = [
  ['gratis uten org', innlogget()],
  ['Premium uten org', innlogget({ isPremium: true, hasStripeCustomer: true })],
  ['org-medlem', innlogget({ myOrgs: [org] })],
  ['org-admin', innlogget({ myOrgs: [{ ...org, isAdmin: true }] })],
  ['medlem i org som skjuler global liste', innlogget({ myOrgs: [lukketOrg] })],
  ['før profilen har landet', innlogget({ profileLoaded: false })],
]

for (const [navn, input] of PROFILER) {
  test(`arkivlenken finnes i kontomenyen (${navn}), i gruppe 1, etter Toppliste og før Ligaer`, () => {
    const grupper = accountMenuGroups(input)
    const g1 = grupper[0].map(r => r.label)
    const arkiv = g1.indexOf('Quizarkiv')
    assert.notEqual(arkiv, -1, `Quizarkiv mangler i gruppe 1 for ${navn}: ${g1.join(' · ')}`)
    assert.ok(arkiv < g1.indexOf('Ligaer'), 'Quizarkiv skal stå før Ligaer')
    if (g1.includes('Toppliste')) assert.ok(g1.indexOf('Toppliste') < arkiv, 'Quizarkiv skal stå etter Toppliste')
    // Ikke i noen annen gruppe — én inngang i menyen.
    assert.equal(grupper.flat().filter(r => r.label === 'Quizarkiv').length, 1)
  })
}

test('arkivlenken peker på /arkiv og bærer ingen Premium-lås', () => {
  // Arkivet er IKKE låst: /arkiv-listen er ugatet med vilje, og en
  // gratisbruker ser hele listen med Premium-piller der «Spill» ville stått,
  // pluss et forklaringskort. Det er selve konverteringsflaten. En lås i
  // menyen ville sagt at siden er stengt, og ført gratisbrukeren bort fra
  // den. Låsen hører hjemme på RADENE inne på siden, ikke på inngangen.
  for (const isPremium of [false, true]) {
    const rad = accountMenuGroups(innlogget({ isPremium }))[0].find(r => r.label === 'Quizarkiv')
    assert.ok(rad && rad.kind === 'link', 'arkivlenken er ikke en vanlig lenke')
    assert.equal(rad.href, '/arkiv')
    assert.equal(rad.badge, undefined, 'arkivlenken har fått en Premium-markering — arkivlisten er ugatet')
  }
})

test('arkivlenken vises før profilen har landet — den trenger ingen profildata', () => {
  // Gaten på profileLoaded finnes for å hindre at en Premium-bruker ser LÅST
  // variant av Quizhistorikk i blaffet før profilen har landet. Arkivlenken
  // har ingen låst variant, så den skal vises med én gang.
  const grupper = accountMenuGroups(innlogget({ profileLoaded: false }))
  assert.ok(grupper[0].some(r => r.label === 'Quizarkiv'))
  assert.ok(!grupper[1].some(r => r.label === 'Quizhistorikk'), 'Quizhistorikk skal holdes igjen til profilen har landet')
})

test('Quizarkiv står i topplinjen for gjest og innlogget — den ugatede desktop-inngangen', () => {
  const gjest = topLinks({ loggedIn: false, activeQuizId: null, pathname: '/', myOrgs: [] })
  const bruker = topLinks({ loggedIn: true, activeQuizId: null, pathname: '/', myOrgs: [org] })
  for (const rad of [gjest, bruker]) {
    const arkiv = rad.find(l => l.href === '/arkiv')
    assert.ok(arkiv, 'Quizarkiv mangler i topplinjen')
    assert.equal(arkiv.label, 'Quizarkiv')
    assert.equal(rad[rad.length - 1], arkiv, 'Quizarkiv er siste slot i topplinjen')
  }
})

// ── Rendering: radene kommer fra modellen, og en rad uten badge får ikke gull ─

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

test('NavAuth: menyrader uten badge bruker ikke gull — MenuRow er den ene radrendereren', () => {
  const nav = aktivKode('components/NavAuth.tsx')
  const start = nav.indexOf('function MenuRow(')
  assert.notEqual(start, -1, 'MenuRow er borte — hvem rendrer menyradene?')
  const slutt = nav.indexOf('\nexport default function NavAuth', start)
  const menuRow = nav.slice(start, slutt)
  assert.match(menuRow, /style=\{menuItem\}/, 'MenuRow bruker ikke den delte menuItem-stilen (brødtekstfargen)')
  assert.match(menuRow, /link\.badge === 'premium' && <span style=\{premiumBadge\}>Premium<\/span>/,
    'Premium-badgen rendres ikke lenger KUN når modellen setter badge')
  assert.doesNotMatch(menuRow, /c9a84c|201,168,76/, 'MenuRow har gull inline — da får hver rad det, arkivlenken inkludert')
  assert.match(nav, /const menuItem: React\.CSSProperties = \{[^}]*color: '#e8e4dd'/, 'menuItem har ikke brødtekstfargen')
  // Kontomenyens rader går gjennom MenuRow via renderRow — ikke en egen liste.
  assert.match(nav, /return <MenuRow key=\{row\.key\} link=\{row\} onClick=\{\(\) => setDropdownOpen\(false\)\} \/>/)
})
