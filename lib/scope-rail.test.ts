// Kjøres med:  npm test
//
// Scope-skinnen (7. september 2026): HVILKE valg den viser per brukertype, at
// den navigerer, og at alle fire flatene bruker den samme komponenten.
//
// To lag:
//   • scopeRailOptions — ren logikk, testet direkte med ekte kall.
//   • Koblingen på /toppliste, /org/[slug], /liga/[slug] og /leaderboard/[id]
//     — strukturelt, fordi npm test kjører uten jsdom.
//
// MUTASJONSBEVIS — hver test navngir endringen den feller:
//   • «minst to valg»-regelen fjernes → «uten bedrift: ingen skinne» ryker.
//   • Låst bedrift vises → «låst bedrift vises ikke» ryker.
//   • Aktivt segment merkes feil → «aktivt segment følger flaten» ryker.
//   • Segmentene blir knapper igjen → «skinnen navigerer» ryker.
//   • Gull i komponenten → «ingen gull» ryker.
//   • Ett kallsted rendrer egen skinne → «fire kallsteder, én komponent» ryker.
//   • Fanen på leaderboard heter «Alle» igjen → «fanen heter Alle deltakere» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MIN_SCOPE_OPTIONS, eligibleScopeOrgs, scopeRailOptions, type ScopeRailOrg } from './scope-rail'

const elkjop: ScopeRailOrg = { orgId: 'o1', orgSlug: 'elkjop-nordic', orgName: 'Elkjøp Nordic', subscriptionStatus: 'trialing' }
const nordisk: ScopeRailOrg = { orgId: 'o2', orgSlug: 'nordisk', orgName: 'Nordisk Kvalitetsbyggeri AS', subscriptionStatus: 'active' }
const laast: ScopeRailOrg = { ...elkjop, subscriptionStatus: 'locked' }
const hrefs = { global: '/toppliste', org: (o: ScopeRailOrg) => `/org/${o.orgSlug}` }
const labels = (o: ReadonlyArray<{ label: string }>) => o.map(x => x.label)

// ── Minst to valg ───────────────────────────────────────────────────────────

test('uten bedrift: ingen skinne på /toppliste og /org — ett valg er ingen bryter', () => {
  assert.equal(MIN_SCOPE_OPTIONS, 2)
  assert.deepEqual(scopeRailOptions({ current: { kind: 'global' }, myOrgs: [], hrefs }), [])
  assert.deepEqual(scopeRailOptions({ current: { kind: 'organization', orgSlug: 'x' }, myOrgs: [], hrefs }), [])
})

test('uten bedrift på ligasiden: to valg likevel (Alle + ligaen), skinnen vises', () => {
  const o = scopeRailOptions({ current: { kind: 'league', slug: 'fredagsgjengen', name: 'Fredagsgjengen' }, myOrgs: [], hrefs: { ...hrefs, league: '/liga/fredagsgjengen' } })
  assert.deepEqual(labels(o), ['Alle', 'Fredagsgjengen'])
  assert.equal(o[1].active, true)
  assert.equal(o[1].href, '/liga/fredagsgjengen')
})

test('én bedrift: Alle + bedriften, med bedriftens navn og lenke til /org/[slug]', () => {
  const o = scopeRailOptions({ current: { kind: 'global' }, myOrgs: [elkjop], hrefs })
  assert.deepEqual(labels(o), ['Alle', 'Elkjøp Nordic'])
  assert.deepEqual(o.map(x => x.href), ['/toppliste', '/org/elkjop-nordic'])
})

test('to bedrifter: begge kan velges, i medlemskapsrekkefølge', () => {
  const o = scopeRailOptions({ current: { kind: 'global' }, myOrgs: [elkjop, nordisk], hrefs })
  assert.deepEqual(labels(o), ['Alle', 'Elkjøp Nordic', 'Nordisk Kvalitetsbyggeri AS'])
})

// ── Låst bedrift ────────────────────────────────────────────────────────────

test('låst bedrift vises ikke — og med én låst bedrift forsvinner skinnen helt', () => {
  // Samme begrunnelse som OrgCard: lista er sperret, og lenken ville ført en
  // ansatt til en betalingsskjerm hun ikke kan bruke.
  assert.deepEqual(eligibleScopeOrgs([elkjop, laast, nordisk]).map(o => o.orgSlug), ['elkjop-nordic', 'nordisk'])
  assert.deepEqual(scopeRailOptions({ current: { kind: 'global' }, myOrgs: [laast], hrefs }), [])
  // Ulåst + låst: kun den ulåste står igjen.
  assert.deepEqual(labels(scopeRailOptions({ current: { kind: 'global' }, myOrgs: [laast, nordisk], hrefs })), ['Alle', 'Nordisk Kvalitetsbyggeri AS'])
  // trialing og active er IKKE låst (org-access.ts) — Elkjøp står som trialing i prod.
  assert.equal(eligibleScopeOrgs([elkjop, nordisk]).length, 2)
})

// ── Aktivt segment ──────────────────────────────────────────────────────────

test('aktivt segment følger flaten: Alle på /toppliste, bedriften på /org, ligaen på /liga', () => {
  const paaToppliste = scopeRailOptions({ current: { kind: 'global' }, myOrgs: [elkjop], hrefs })
  assert.deepEqual(paaToppliste.map(x => x.active), [true, false])
  const paaOrg = scopeRailOptions({ current: { kind: 'organization', orgSlug: 'elkjop-nordic' }, myOrgs: [elkjop, nordisk], hrefs })
  assert.deepEqual(paaOrg.map(x => x.active), [false, true, false])
  const paaLiga = scopeRailOptions({ current: { kind: 'league', slug: 'l', name: 'Liga' }, myOrgs: [elkjop], hrefs: { ...hrefs, league: '/liga/l' } })
  assert.deepEqual(paaLiga.map(x => x.active), [false, false, true])
})

test('på /leaderboard/[id]: samme quiz, annet univers — lenkene bærer quiz-id og ?org=', () => {
  const q = 'quiz-1'
  const lb = { global: `/leaderboard/${q}`, org: (o: ScopeRailOrg) => `/leaderboard/${q}?org=${o.orgSlug}` }
  const o = scopeRailOptions({ current: { kind: 'organization', orgSlug: 'elkjop-nordic' }, myOrgs: [elkjop], hrefs: lb })
  assert.deepEqual(o.map(x => x.href), ['/leaderboard/quiz-1', '/leaderboard/quiz-1?org=elkjop-nordic'])
  assert.deepEqual(o.map(x => x.active), [false, true])
})

// ── Komponenten og kallstedene ──────────────────────────────────────────────

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const KOMPONENT = 'components/ScopeRail.tsx'
const KALLSTEDER = ['app/toppliste/page.tsx', 'app/org/[slug]/page.tsx', 'app/liga/[slug]/page.tsx', 'app/leaderboard/[id]/page.tsx'] as const

test('skinnen navigerer: segmentene er lenker med href, ikke knapper', () => {
  const k = aktivKode(KOMPONENT)
  assert.match(k, /<a\s[\s\S]*?href=\{o\.href\}/, 'segmentet er ikke en lenke med href')
  assert.ok(!/<button/.test(k), 'skinnen har fått knapper — den skal navigere, ikke bytte på stedet')
  assert.match(k, /aria-current=\{o\.active \? 'page' : 'false'\}/, 'aktivt segment merkes ikke med aria-current')
  assert.match(k, /if \(options\.length === 0\) return null/, 'komponenten rendrer noe selv med tom liste')
})

test('samme utseende overalt: ramme #2a2d38, aktivt fylt #21242e, inaktivt #918f8a, ingen gull', () => {
  const k = aktivKode(KOMPONENT)
  assert.match(k, /border: '1px solid #2a2d38'/)
  assert.match(k, /background: aktiv \? '#21242e' : 'transparent'/)
  assert.match(k, /color: aktiv \? '#ffffff' : '#918f8a'/)
  assert.ok(!/c9a84c|201,168,76/.test(k), 'skinnen bruker gull')
  assert.match(k, /<span id="qk-scope-label" style=\{labelStyle\}>Blant:<\/span>/, 'etiketten «Blant:» mangler')
  assert.match(k, /aria-labelledby="qk-scope-label"/, 'etiketten er ikke gruppens tilgjengelige navn')
})

test('fire kallsteder, én komponent — og ingen egen skinne noe sted', () => {
  for (const fil of KALLSTEDER) {
    const src = aktivKode(fil)
    assert.match(src, /import ScopeRail from '@\/components\/ScopeRail'/, `${fil} importerer ikke ScopeRail`)
    assert.match(src, /import \{ scopeRailOptions \} from '@\/lib\/scope-rail'/, `${fil} henter ikke valgene fra lib/scope-rail`)
    assert.equal((src.match(/<ScopeRail options=\{/g) ?? []).length, 1, `${fil} rendrer ikke nøyaktig én ScopeRail`)
    assert.ok(!src.includes('qk-scope-tab'), `${fil} har en egen skinne-implementasjon ved siden av komponenten`)
    assert.ok(!src.includes('scopeRailStyle'), `${fil} har egne skinnestiler`)
  }
})

test('hvert kallsted sender riktig «current» og riktige lenker', () => {
  const t = aktivKode('app/toppliste/page.tsx')
  assert.match(t, /current: \{ kind: 'global' \}/, '/toppliste er ikke «Alle»')
  assert.match(t, /global: '\/toppliste', org: o => `\/org\/\$\{o\.orgSlug\}`/, '/toppliste lenker ikke til /org/[slug]')
  const o = aktivKode('app/org/[slug]/page.tsx')
  assert.match(o, /current: \{ kind: 'organization', orgSlug: slug \}/, '/org/[slug] merker ikke sin egen bedrift som aktiv')
  assert.match(o, /global: '\/toppliste'/, '/org/[slug] lenker ikke «Alle» til /toppliste — veien tilbake mangler')
  const l = aktivKode('app/liga/[slug]/page.tsx')
  assert.match(l, /current: \{ kind: 'league', slug, name: league\?\.name \?\? 'Ligaen' \}/, '/liga/[slug] merker ikke ligaen som aktiv')
  assert.match(l, /league: `\/liga\/\$\{slug\}`/)
  const lb = aktivKode('app/leaderboard/[id]/page.tsx')
  assert.match(lb, /global: `\/leaderboard\/\$\{quizId\}`/, 'leaderboard: «Alle» peker ikke på samme quiz uten scope')
  assert.match(lb, /org: o => `\/leaderboard\/\$\{quizId\}\?org=\$\{encodeURIComponent\(o\.orgSlug\)\}`/, 'leaderboard: bedriften peker ikke på samme quiz med ?org=')
  assert.match(lb, /leagueSlug \? \{ kind: 'league', slug: leagueSlug, name: leagueName \?\? 'Ligaen' \} : orgSlug \? \{ kind: 'organization', orgSlug \} : \{ kind: 'global' \}/)
})

test('leaderboard: ligaens navn hentes fra /api/leagues-svaret som alt lastes — ikke fra en ny rute', () => {
  // 7. september 2026: «Ligaen» som fast etikett mens bedriften fikk navnet
  // sitt var inkonsekvent på samme skinne. Navnet finnes i lista
  // loadLeagueFriends henter for «Blant venner»; slås opp på slug.
  const lb = aktivKode('app/leaderboard/[id]/page.tsx')
  assert.match(lb, /const \[leagueName, setLeagueName\] = useState<string \| null>\(null\)/, 'leagueName-tilstanden mangler')
  assert.match(lb, /if \(leagueSlug\) setLeagueName\(leagues\.find\(l => l\.slug === leagueSlug\)\?\.name \?\? null\)/, 'navnet slås ikke opp på slug i /api/leagues-svaret')
  assert.ok(!lb.includes("name: 'Ligaen' }"), 'skinnen bruker den faste etiketten igjen')
  // Ingen ny henting for navnet: /api/leagues kalles nøyaktig én gang i fila.
  assert.equal((lb.match(/fetch\('\/api\/leagues'/g) ?? []).length, 1)
})

test('leaderboard: fanen heter «Alle deltakere», skinnen beholder «Alle»', () => {
  // Dennis' valg 7. september 2026: skinnen er den overordnede avgjørelsen og
  // skal ha det korteste ordet. Fanen filtrerer inne i universet.
  const lb = aktivKode('app/leaderboard/[id]/page.tsx')
  assert.match(lb, /onClick=\{\(\) => setActiveTab\('alle'\)\}\s*>\s*Alle deltakere\s*<\/button>/, 'fanen heter ikke «Alle deltakere»')
  assert.ok(!/setActiveTab\('alle'\)\}\s*>\s*Alle\s*<\/button>/.test(lb), 'fanen heter «Alle» igjen — kolliderer med skinnen')
  const k = aktivKode(KOMPONENT)
  assert.ok(!k.includes('Alle deltakere'), 'skinnen skal si «Alle», ikke «Alle deltakere»')
  assert.match(aktivKode('lib/scope-rail.ts'), /label: 'Alle'/)
})

test('den énveis knappen i SeasonLeaderboard er borte — skinnen er veien til bedriften', () => {
  const sl = aktivKode('components/SeasonLeaderboard.tsx')
  assert.ok(!/internalHome &&\s*\(\s*<Link href=\{`\/org\//.test(sl), 'énveis-knappen «Se bedriftens toppliste →» er tilbake i det blokkerte kortet')
  assert.ok(!sl.includes('Se bedriftens toppliste &rarr;'), 'knappeteksten står fortsatt i SeasonLeaderboard')
})
