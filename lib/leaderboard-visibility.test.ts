// Kjøres med:  npm test  (eller smalt: --test lib/leaderboard-visibility.test.ts)
//
// decideHiddenUntilClosed — den DELTE «skjult til quizen stenger»-beslutningen
// for klient (app/leaderboard/[id]/page.tsx) og server
// (app/api/leaderboard/[id]/route.ts). B1/B5 i NONNULL-sveipet 26. august 2026.
// At begge kallstedene faktisk bruker funksjonen, felles av
// lib/nonnull-quiz-date-sites.test.ts — her felles selve logikken.
//
// MUTASJONSBEVIS:
//   • Fjernes `closesAt === null`-grenen → «NULL låser aldri ute for alltid»
//     ryker (isQuizClosed(null) = åpen → skjult permanent, nøyaktig B5).
//   • Byttes til klientens gamle epoch-tolkning (NULL ∼ stengt 1970 → vis) på
//     EN av sidene → strukturtestene i nonnull-quiz-date-sites ryker, for
//     logikken bor kun her.
//   • Fjernes premium-unntaket → «egen rad løfter skjulingen» ryker.
//   • Fjernes flagg-sjekken → «uten flagg skjules ingenting» ryker.
//   • Snus isQuizClosed-grenen → «stengt quiz skjules ikke» ryker.
//
// FIXTUR-REGEL: ekte, ULIKE datoer — aldri epoch; en epoch-fixtur ville skjult
// nøyaktig new Date(null)-fella dette sveipet jakter på.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideHiddenUntilClosed } from './leaderboard-visibility'

const NOW = new Date('2026-08-26T12:00:00Z').getTime()
const CLOSES_FRAMTID = '2026-08-28T22:00:00Z'
const CLOSES_FORTID = '2026-08-23T20:30:00Z'

function inndata(overstyr: Partial<Parameters<typeof decideHiddenUntilClosed>[0]> = {}) {
  return {
    hideUntilClosed: true,
    closesAt: CLOSES_FRAMTID as string | null,
    premiumViewerHasOwnRow: false,
    now: NOW,
    ...overstyr,
  }
}

// ── Ekte datoer: uendret oppførsel fra før sveipet ──────────────────────────

test('flagget + åpen quiz (ekte framtidsdato) = skjult', () => {
  assert.equal(decideHiddenUntilClosed(inndata()), true)
})

test('flagget + stengt quiz (ekte fortidsdato) = ikke skjult', () => {
  assert.equal(decideHiddenUntilClosed(inndata({ closesAt: CLOSES_FORTID })), false)
})

test('uten flagg skjules ingenting, uansett dato', () => {
  assert.equal(decideHiddenUntilClosed(inndata({ hideUntilClosed: false })), false)
  assert.equal(decideHiddenUntilClosed(inndata({ hideUntilClosed: false, closesAt: null })), false)
})

test('Premium med egen rad løfter skjulingen på en åpen quiz', () => {
  assert.equal(decideHiddenUntilClosed(inndata({ premiumViewerHasOwnRow: true })), false)
})

// ── B5: NULL = stenger aldri → aldri skjult for alltid ──────────────────────

test('NULL closes_at låser aldri stillingen ute for alltid', () => {
  // «Til quizen stenger» kan aldri inntreffe når quizen aldri stenger — da er
  // permanent skjuling ikke et utfall flagget skal kunne gi (Dennis-beslutning
  // 26. august 2026: arkivkopier skal uansett ikke arve flagget).
  assert.equal(decideHiddenUntilClosed(inndata({ closesAt: null })), false)
})

test('NULL closes_at: utfallet avhenger ikke av premium-unntaket', () => {
  // Skjulingen er alt løftet av NULL-standpunktet — ikke av hvem som spør.
  assert.equal(
    decideHiddenUntilClosed(inndata({ closesAt: null, premiumViewerHasOwnRow: true })),
    false
  )
})

// ── B1-pariteten på logikknivå ──────────────────────────────────────────────

test('samme inndata gir samme svar — funksjonen er deterministisk over feltene', () => {
  // Klient og server bygger inndata fra samme quiz-rad (closes_at +
  // hide_leaderboard_until_closed). Kaller de samme funksjon med samme felt,
  // kan de ikke konkludere ulikt — med og uten datoer.
  for (const closesAt of [CLOSES_FRAMTID, CLOSES_FORTID, null]) {
    const klient = decideHiddenUntilClosed(inndata({ closesAt }))
    const server = decideHiddenUntilClosed(inndata({ closesAt }))
    assert.equal(klient, server)
  }
})

// ── decideHiddenLeaderboardView — hva en SKJULT stilling viser ───────────────
//
// REGRESJONEN som utløste funksjonen (28. august 2026): JSX-en i
// app/leaderboard/[id]/page.tsx sto som
//   `(!authLoading && !hasPlayed) ? <låseskjerm> : null`
// Betingelsen var skrevet for authLoading, men hasPlayed lå i samme ledd. En
// innlogget gratisbruker SOM HAR SPILT traff null-grenen og fikk tom luft.
//
// MUTASJONSBEVIS — fire mutasjoner kjørt 28. august 2026, hver med diff mot
// backup verifisert FØR resultatet ble tolket (en sed som bommer gir grønn
// suite som ser ut som «overlevd»). Baseline 13/13 grønn. Alle fire ble røde:
//   1. `return input.hasPlayed ? 'waiting' : 'locked'` → `return 'locked'`
//        → 2 røde: «regresjonen» + «tre utfall dekker fire inndata»
//   2. samme linje → `return input.hasPlayed ? 'nothing' : 'locked'`
//        (NØYAKTIG dagens feilform: har spilt ⇒ tom render)
//        → 2 røde: samme to
//   3. `if (input.authLoading) return 'nothing'` slettet
//        → 2 røde: «laster gir ingen tekst» + «tre utfall»
//   4. KALLSTEDET forbi gaten: i app/leaderboard/[id]/page.tsx byttes
//        `const hiddenView = decideHiddenLeaderboardView({ authLoading, hasPlayed })`
//        mot den gamle inline-formen `(!authLoading && !hasPlayed) ? 'locked' : 'nothing'`
//        → 1 rød: «kallstedet bruker gaten»
//
// Mutasjon 4 er den viktigste. Uten den kunne 1–3 vært grønne mens JSX-en
// beholdt den gamle formen — funksjonen til stede, men aldri i bruk. Det er
// nøyaktig hullet middleware-cookie-guard har og som er dokumentert som ærlig
// hull i CLAUDE.md; her er koblingen faktisk felt.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideHiddenLeaderboardView, osloClosingTime } from './leaderboard-visibility'

test('HAR spilt gir en egen ventetilstand — aldri tom render (regresjonen)', () => {
  // Dette er brukeren som fikk ingenting: innlogget, ikke Premium, har spilt,
  // stillingen skjult til stengetid.
  const view = decideHiddenLeaderboardView({ authLoading: false, hasPlayed: true })
  assert.equal(view, 'waiting')
  // Poenget er ikke hvilken streng det ble, men at det IKKE ble tomt. Skulle
  // utfallsnavnene endres senere, skal denne fortsatt felle en tom render.
  assert.notEqual(view, 'nothing', 'gratisbruker som har spilt får tom skjerm igjen')
})

test('har IKKE spilt gir låseskjermen — uendret oppførsel', () => {
  assert.equal(decideHiddenLeaderboardView({ authLoading: false, hasPlayed: false }), 'locked')
})

test('mens auth laster vises ingenting — uendret, dette er den ekte lastetilstanden', () => {
  // Begge hasPlayed-verdiene: authLoading skal vinne alene. Var det leddet
  // fortsatt sammenvevd med hasPlayed, ville én av de to falt gjennom.
  assert.equal(decideHiddenLeaderboardView({ authLoading: true, hasPlayed: true }), 'nothing')
  assert.equal(decideHiddenLeaderboardView({ authLoading: true, hasPlayed: false }), 'nothing')
})

test('de tre utfallene er gjensidig utelukkende og dekker alle fire inndata', () => {
  // Uten dette kunne en framtidig fjerde gren gjeninnføre et hull uten at
  // noen av testene over merket det: de spør hver sin celle, ikke tabellen.
  const sett = new Set<string>()
  for (const authLoading of [true, false]) {
    for (const hasPlayed of [true, false]) {
      sett.add(decideHiddenLeaderboardView({ authLoading, hasPlayed }))
    }
  }
  assert.deepEqual([...sett].sort(), ['locked', 'nothing', 'waiting'])
})

test('osloClosingTime: norsk klokkeslett, og NULL/ugyldig gir null — ikke epoch', () => {
  // 20:00Z i august = sommertid i Oslo = 22:00. Bruker dagens faktiske
  // stengetid som fixtur, så testen felles hvis tidssonen faller bort.
  assert.equal(osloClosingTime('2026-08-28T20:00:00+00:00'), '22:00')
  // Den som gjør regelen nødvendig: new Date(null) er epoch, ikke ugyldig, og
  // ville gitt «01:00» uten å feile.
  assert.equal(osloClosingTime(null), null)
  assert.equal(osloClosingTime('ikke en dato'), null)
})

// ── Kallstedet, ikke bare logikken ──────────────────────────────────────────
// Uten denne kan hele gaten over være grønn mens JSX-en beholder den gamle
// inline-formen — funksjonen ville da vært til stede uten å være i bruk.
// Ankrene står på LINJESTART etter kommentarstripping, så en utkommentert
// rest ikke kan oppfylle dem.
test('kallstedet bruker gaten, og ventegrenen finnes i JSX-en', () => {
  const kode = readFileSync(
    join(process.cwd(), 'app/leaderboard/[id]/page.tsx'), 'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\n \t])\/\/[^\n]*/g, '$1')

  assert.match(
    kode,
    /^\s*const hiddenView = decideHiddenLeaderboardView\(\{ authLoading, hasPlayed \}\)/m,
    'JSX-en regner ikke lenger skjul-visningen via den delte gaten',
  )
  // Ventegrenen må faktisk RENDRE noe. Ankeret er teksten som bærer de tre
  // tingene brukeren skal få vite, ikke bare navnet 'waiting'.
  assert.match(kode, /Resultatet ditt er registrert/,
    'ventetilstandens overskrift er borte')
  assert.match(kode, /Den publiseres for alle når quizen stenger kl\. \$\{stengetid\}/,
    'ventetilstanden sier ikke lenger NÅR listen publiseres')
  assert.match(kode, /href="\/premium"/,
    'ventetilstanden peker ikke lenger på Premium')
  // Den gamle feilformen skal ikke kunne stå igjen ved siden av den nye.
  assert.doesNotMatch(
    kode,
    /\(!authLoading && !hasPlayed\) \?/,
    'den sammenvevde authLoading/hasPlayed-betingelsen er tilbake',
  )
})
