// Kjøres med:  npm test
//
// Hvilken `next` de to DELTE lenkene sender med til innloggingen.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// En fremmed klikker en delt quizlenke fra Facebook. Hun er den eneste
// brukeren som møter leaderboard-siden og utfordringssiden uten sesjon.
// Begge steder manglet `next`:
//
//   • app/leaderboard/[id]/page.tsx monterte AuthModal helt uten `next`, mens
//     søsterflaten i app/quiz/[id]/page.tsx satte den. Google-runden og magic
//     link går via /auth/callback?next=… og landet derfor på forsiden — hun
//     mistet lista hun kom for.
//   • app/utfordring/page.tsx hadde <a href="/login"> uten ?next=. Siden leser
//     hele utfordringen (`fra`, `quiz`) ut av query-strengen, så retur til
//     forsiden mister ikke bare stedet, men selve utfordringen.
//
// Denne fila dekker BEGGE: den rene byggingen (unit) og at kallstedene
// faktisk bruker den (struktur). Den strukturelle halvdelen er nødvendig
// fordi npm test kjører uten jsdom — koblingen helper↔kallsted er ellers
// udekket, og en helper ingen kaller er nøyaktig den feilen som fantes.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • `next=` fjernes fra AuthModal i leaderboard → «leaderboard-modalen får
//     next» ryker.
//   • Målet byttes til '/' eller til quiz-siden → «next peker på leaderboard-
//     siden» ryker.
//   • Scope-parameterne droppes fra kallet → «kallet fører scope videre» ryker.
//   • href settes tilbake til "/login" → «utfordring-lenken bærer next» ryker.
//   • buildChallengeNext dropper `quiz` → «utfordringen overlever» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildLeaderboardNext, buildChallengeNext, loginHref } from './login-next'

/**
 * Kilden uten kommentarer. Blokkommentarer fjernes først; linjekommentarer
 * kun når linja BEGYNNER med `//`, slik at `//` inne i en streng ikke spiser
 * resten av linja. Samme form som lib/authmodal-portal.test.ts — og nødvendig
 * her: kommentarene ved begge kallstedene nevner både «next» og «/login» i
 * prosa, så en test mot rå kildetekst ville vært grønn av kommentaren alene.
 */
function renKode(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

// ── buildLeaderboardNext ────────────────────────────────────────────────────

test('buildLeaderboardNext peker på leaderboard-siden for quizen', () => {
  assert.equal(buildLeaderboardNext('abc-123'), '/leaderboard/abc-123')
})

test('scope-parameterne følger med — de bestemmer hvilken liste siden viser', () => {
  assert.equal(
    buildLeaderboardNext('abc-123', { org: 'elkjop', league: 'kontoret', hist: true }),
    '/leaderboard/abc-123?org=elkjop&league=kontoret&hist=1',
  )
})

test('fraværende scope gir ingen tomme parametere', () => {
  // null/''/false skal ikke bli «?org=&league=&hist=» — en tom org-parameter
  // leses av siden som org-modus med tom slug, ikke som nasjonal visning.
  assert.equal(
    buildLeaderboardNext('abc-123', { org: null, league: '', hist: false }),
    '/leaderboard/abc-123',
  )
})

test('hist skrives som «1», ikke som «true»', () => {
  // Siden sjekker searchParams.get('hist') === '1'. «true» ville vært stille
  // ignorert: hun havner på «Siste quiz» i stedet for fanen hun kom fra.
  assert.equal(buildLeaderboardNext('q', { hist: true }), '/leaderboard/q?hist=1')
})

test('quiz-id-en enkodes, så den ikke kan bryte ut av sin egen sti', () => {
  assert.equal(buildLeaderboardNext('a/b'), '/leaderboard/a%2Fb')
})

// ── buildChallengeNext ──────────────────────────────────────────────────────

test('utfordringen overlever innloggingen — både fra og quiz bæres videre', () => {
  assert.equal(
    buildChallengeNext({ fra: 'Dennis', quiz: 'q-9' }),
    '/utfordring?fra=Dennis&quiz=q-9',
  )
})

test('navn med mellomrom og spesialtegn enkodes', () => {
  const ut = buildChallengeNext({ fra: 'Ada & Kari', quiz: 'q-9' })
  assert.ok(!ut.includes(' '), `mellomrom slapp ut i «${ut}»`)
  assert.equal(new URL(ut, 'https://x').searchParams.get('fra'), 'Ada & Kari')
})

test('uten utfordringsdata blir det ren /utfordring, ikke et tomt spørsmålstegn', () => {
  assert.equal(buildChallengeNext(), '/utfordring')
  assert.equal(buildChallengeNext({ fra: null, quiz: '' }), '/utfordring')
})

// ── loginHref ───────────────────────────────────────────────────────────────

test('loginHref enkoder hele stien, så query-en i next ikke lekker ut', () => {
  const ut = loginHref('/utfordring?fra=Dennis&quiz=q-9')
  assert.equal(ut, '/login?next=%2Futfordring%3Ffra%3DDennis%26quiz%3Dq-9')
  // Uten enkoding ville `&quiz=` blitt en parameter på /login, ikke en del av
  // next — og utfordringen forsvant på veien.
  assert.equal(
    new URL(ut, 'https://x').searchParams.get('next'),
    '/utfordring?fra=Dennis&quiz=q-9',
  )
})

// ── Kallstedene ─────────────────────────────────────────────────────────────

const LB_FIL = 'app/leaderboard/[id]/page.tsx'
const lbSrc = renKode(readFileSync(LB_FIL, 'utf8'))

test('leaderboard-modalen får next, og det peker på leaderboard-siden', () => {
  // Ankeret er selve prop-en på AuthModal, ikke ordet «next» et sted i fila:
  // fila har 2000+ linjer og nevner next-lignende ting flere steder.
  const treff = lbSrc.match(/next=\{buildLeaderboardNext\(/g) ?? []
  assert.equal(treff.length, 1, `${LB_FIL}: fant ${treff.length} next={buildLeaderboardNext(…)}, ventet 1`)
})

test('leaderboard-kallet fører scope videre — org, league og hist', () => {
  // Lazy fram til `)}` — objektliteralen inneholder sine egne krøllparenteser,
  // så en `[^}]*`-klasse ville stoppet midt i argumentet.
  const m = lbSrc.match(/next=\{buildLeaderboardNext\([\s\S]*?\)\}/)
  assert.ok(m, `${LB_FIL}: fant ikke next={buildLeaderboardNext(…)}`)
  const kall = m[0]
  assert.match(kall, /\bquizId\b/, `mangler quizId: ${kall}`)
  assert.match(kall, /org:\s*orgSlug/, `mangler org: ${kall}`)
  assert.match(kall, /league:\s*leagueSlug/, `mangler league: ${kall}`)
  assert.match(kall, /hist:\s*cameFromHistory/, `mangler hist: ${kall}`)
})

test('leaderboard importerer helperen — ellers bygger ikke fila', () => {
  assert.match(lbSrc, /^import \{ buildLeaderboardNext \} from '@\/lib\/login-next'$/m)
})

const UTF_FIL = 'app/utfordring/page.tsx'
const utfSrc = renKode(readFileSync(UTF_FIL, 'utf8'))

test('utfordring-lenken bærer next — ingen naken href="/login" igjen', () => {
  // Den bokstavelige strengen er nettopp feilen som fantes. Står den igjen
  // NOE sted i fila, er lenken enten uendret eller duplisert.
  assert.ok(
    !utfSrc.includes('href="/login"'),
    `${UTF_FIL}: naken href="/login" står fortsatt i koden`,
  )
  const treff = utfSrc.match(/href=\{loginTilbake\}/g) ?? []
  assert.equal(treff.length, 1, `${UTF_FIL}: fant ${treff.length} href={loginTilbake}, ventet 1`)
})

test('utfordring bygger next av de RÅ query-verdiene, ikke av fallbacken', () => {
  // `fra`-staten har allerede fått «En spiller» som fallback. Bygges next av
  // den, skriver vi et navn ingen har oppgitt inn i URL-en.
  const m = utfSrc.match(/setLoginTilbake\([^\n]*\)/)
  assert.ok(m, `${UTF_FIL}: fant ikke setLoginTilbake(…)`)
  assert.match(m[0], /loginHref\(/, m[0])
  assert.match(m[0], /buildChallengeNext\(/, m[0])
  // Argumentet må SLUTTE på params.get(…) — ikke bare begynne der. Et prefiks-
  // anker (`fra:\s*params\.get\('fra'\)`) matcher også
  // `params.get('fra') ?? 'En spiller'`, altså nettopp fallbacken denne testen
  // finnes for å utelukke. Skilletegnet etter er det som skiller de to.
  assert.match(m[0], /fra:\s*params\.get\('fra'\)\s*,/, m[0])
  assert.match(m[0], /quiz:\s*params\.get\('quiz'\)\s*\}/, m[0])
})

test('utfordring importerer begge helperne', () => {
  assert.match(utfSrc, /^import \{ buildChallengeNext, loginHref \} from '@\/lib\/login-next'$/m)
})
