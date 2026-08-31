// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: at app/leaderboard/[id]/page.tsx faktisk SPØR
// lib/league-affordance.ts, og at den ikke lenger holder ligastatusen i en
// boolean som kollapser «vet ikke» til «har ikke».
//
// Denne filen og lib/league-affordance.test.ts er to halvdeler av ett bevis:
//   • Oppførselstesten alene ville godtatt at siden sluttet å spørre.
//   • Denne alene ville godtatt at funksjonen svarte feil.
//
// Hvorfor kildetekst-test og ikke oppførselstest: npm test kjører kun
// lib/**/*.test.ts under Node sin egen runner, uten jsdom, og logikken bor i en
// 2000-linjers klientkomponent. Samme form som
// lib/archive-ranking-wiring.test.ts.
//
// MERK: fila har BOM før 'use client'. Alle sammenligninger går derfor på
// aktive linjer og substrenger, aldri på et linjestart-anker mot filstart.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • CTA-gaten settes tilbake til `!authLoading && session && !hasLeagues &&
//     !orgSlug` (buggen) → «CTA-en gates av showLeagueCta» ryker, og
//     «ingen boolean-ligastatus igjen» ryker.
//   • `leaguesState` gjøres om til `useState(false)` igjen → «ligastatusen er
//     Loaded<boolean>» ryker.
//   • `setLeaguesState({ ok: false })`-grenen fjernes, så feil og «null ligaer»
//     skrives likt → «feilsvaret skrives som uavklart» ryker.
//   • `fetchResult` byttes tilbake mot `if (leaguesRes.ok)` → «ligahentingen går
//     gjennom fetchResult» ryker.
//   • `decideLeagueAffordance(...)` kalles uten å bruke svaret → «kallet står i
//     tilordningsposisjon» ryker.
//   • Fanen kobles av funksjonen igjen (`showVennerTab = ... && hasLeagues`) →
//     «fanen leser samme avgjørelse som CTA-en» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PAGE = 'app/leaderboard/[id]/page.tsx'
const RAW = readFileSync(PAGE, 'utf8')
// BOM-en er del av fila, ikke av koden — fjern den før noe som helst leses.
const SRC = RAW.charCodeAt(0) === 0xfeff ? RAW.slice(1) : RAW

/** Kun linjer som faktisk kjører — en utkommentert vakt skal ikke telle. */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

const AKTIV = aktiveLinjer(SRC)

test('siden importerer decideLeagueAffordance', () => {
  assert.match(AKTIV, /import \{ decideLeagueAffordance \} from '@\/lib\/league-affordance'/)
})

test('kallet står i tilordningsposisjon — svaret kastes ikke', () => {
  assert.match(AKTIV, /const leagueAffordance = decideLeagueAffordance\(\{/)
})

test('ligastatusen er Loaded<boolean>, ikke en boolean', () => {
  assert.match(AKTIV, /useState<Loaded<boolean>>\(\{ ok: false \}\)/)
})

test('ingen boolean-ligastatus igjen i fila', () => {
  // `hasLeagues` var navnet på nøyaktig den kollapsen saken handlet om. Står
  // navnet fortsatt på en aktiv linje, er enten fiksen delvis eller en ny
  // kopi kommet til.
  assert.ok(!AKTIV.includes('hasLeagues'), 'hasLeagues lever fortsatt på en aktiv linje')
})

test('ligahentingen går gjennom fetchResult, ikke en rå res.ok-gren', () => {
  assert.match(AKTIV, /const leaguesLoaded = await fetchResult\(/)
  assert.ok(
    !AKTIV.includes('leaguesRes'),
    'den gamle rå-hentingen (leaguesRes) står fortsatt igjen',
  )
})

test('feilsvaret skrives som uavklart, ikke som «null ligaer»', () => {
  // Den ENE linjen hele saken står på: ok-grenen bærer en verdi, feil-grenen
  // bærer { ok: false } — de er ULIKE utfall, ikke samme false.
  assert.match(
    AKTIV,
    /setLeaguesState\(leaguesLoaded\.ok \? \{ ok: true, value: leaguesLoaded\.value\.length > 0 \} : \{ ok: false \}\)/,
  )
})

test('fanen leser samme avgjørelse som CTA-en', () => {
  assert.match(AKTIV, /const showVennerTab = leagueAffordance\.showFriendsTab/)
})

test('CTA-en gates av showLeagueCta', () => {
  // Gaten står som eneste betingelse foran oppsalget — ikke som ett ledd
  // ved siden av en gjenoppstått boolean.
  assert.match(AKTIV, /\{leagueAffordance\.showLeagueCta && \(/)
  const cta = 'Opprett en liga (Premium)'
  const i = AKTIV.indexOf(cta)
  assert.notEqual(i, -1, 'fant ikke CTA-teksten — er den omdøpt?')
  const foran = AKTIV.slice(0, i)
  const sisteGate = foran.lastIndexOf('leagueAffordance.showLeagueCta')
  assert.notEqual(sisteGate, -1, 'ingen showLeagueCta-gate foran CTA-teksten')
  // Ingen annen JSX-gren skal rekke å åpne mellom gaten og teksten.
  assert.ok(
    foran.slice(sisteGate).split('\n').length <= 6,
    'gaten står for langt fra CTA-teksten til å være dens betingelse',
  )
})
