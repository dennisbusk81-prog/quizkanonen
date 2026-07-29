// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// Dekker lib/standings-cache.ts (ren logikk) OG de faktiske Cache-Control-
// headerne app/api/quiz/[id]/standings/route.ts sender.
//
// MUTASJONSBEVIS, se test «MUTASJONSBEVIS» nederst: erstatt
// SHARED_CLOSED_S_MAXAGE med `immutable` eller et årelangt tak i
// standings-cache.ts, og invariant-testene ryker. Det er nettopp den
// endringen som ville gjort en fasit-korreksjon usynlig for alle som
// allerede hadde fått svaret cachet.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideStandingsCache,
  isQuizClosed,
  SHARED_CLOSED_S_MAXAGE,
  SHARED_OPEN_S_MAXAGE,
  PRIVATE_CLOSED_MAX_AGE,
} from './standings-cache'

// ── Klokka: relativ, ALDRI hardkodet ────────────────────────────────────────
// Fram til 29. juli 2026 sto disse som faste datoer, med `IMORGEN` satt til
// 2026-07-29T20:00:00Z. Kl. 20:00 den kvelden gikk konstanten forbi, og de to
// RUTE-testene nederst begynte å feile permanent: de går gjennom den ekte
// ruten, som leser systemklokka, så «i morgen» ble plutselig i fortiden og
// ruten svarte med den lange stengt-cachen i stedet for den korte åpne.
//
// De rene testene over var upåvirket — de sender inn `NOW` eksplisitt — så
// feilen så ut som en flake i én fil, men var en tidsbombe med fast dato.
//
// Alle bruk av NOW er relative (før/etter, eller offset-aritmetikk), så det å
// ankre den til den virkelige klokka endrer ingen assertion sin mening. Én dags
// margin i hver retning gjør at rute-testene, som bruker Date.now() inne i
// ruten, aldri kan komme på feil side av grensen.
const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.now()
const IGAR = new Date(NOW - DAY_MS).toISOString()
const IMORGEN = new Date(NOW + DAY_MS).toISOString()

// ── isQuizClosed ─────────────────────────────────────────────────────────────

test('isQuizClosed: closes_at i fortiden = stengt', () => {
  assert.equal(isQuizClosed(IGAR, NOW), true)
})

test('isQuizClosed: closes_at i framtiden = åpen', () => {
  assert.equal(isQuizClosed(IMORGEN, NOW), false)
})

test('isQuizClosed: null = åpen (quizen stenger aldri)', () => {
  assert.equal(isQuizClosed(null, NOW), false)
})

test('isQuizClosed: uparsebar dato = åpen (fail-safe, korteste cache)', () => {
  assert.equal(isQuizClosed('ikke-en-dato', NOW), false)
})

test('isQuizClosed: nøyaktig på stengetid regnes som ÅPEN', () => {
  // Samme grensesnitt som questions/route.ts og start-attempt/route.ts, som
  // begge avviser med `now > closesAt` — likhet er altså fortsatt innenfor.
  assert.equal(isQuizClosed(new Date(NOW).toISOString(), NOW), false)
})

// ── decideStandingsCache — de fire rutene i beslutningstabellen ──────────────

test('ÅPEN + delt svar: kort CDN-cache som speiler snapshot-TTL', () => {
  const cc = decideStandingsCache({ closesAt: IMORGEN, personalized: false, now: NOW })
  assert.equal(cc, `public, s-maxage=${SHARED_OPEN_S_MAXAGE}, max-age=0`)
  assert.equal(SHARED_OPEN_S_MAXAGE, 10, 'skal speile CACHE_TTL_MS i ranking-snapshot.ts')
})

test('ÅPEN + personlig svar: ingen lagring i det hele tatt', () => {
  const cc = decideStandingsCache({ closesAt: IMORGEN, personalized: true, now: NOW })
  assert.equal(cc, 'private, no-store')
})

test('STENGT + delt svar: lengre CDN-cache, men fortsatt tidsbegrenset', () => {
  const cc = decideStandingsCache({ closesAt: IGAR, personalized: false, now: NOW })
  assert.equal(cc, `public, s-maxage=${SHARED_CLOSED_S_MAXAGE}, max-age=0`)
})

test('STENGT + personlig svar: kun spillerens egen nettleser, kort', () => {
  const cc = decideStandingsCache({ closesAt: IGAR, personalized: true, now: NOW })
  assert.equal(cc, `private, max-age=${PRIVATE_CLOSED_MAX_AGE}`)
})

// ── Invarianter som beskytter mot stille utdaterthet ─────────────────────────

test('INVARIANT: et personlig svar blir aldri public', () => {
  for (const closesAt of [IGAR, IMORGEN, null]) {
    const cc = decideStandingsCache({ closesAt, personalized: true, now: NOW })
    assert.ok(cc.startsWith('private'), `personlig svar var ikke private: ${cc}`)
    assert.ok(!cc.includes('public'), `personlig svar var public: ${cc}`)
    assert.ok(!cc.includes('s-maxage'), `personlig svar hadde delt cache: ${cc}`)
  }
})

test('INVARIANT: nettleseren cacher aldri et DELT svar (kun CDN-en)', () => {
  for (const closesAt of [IGAR, IMORGEN, null]) {
    const cc = decideStandingsCache({ closesAt, personalized: false, now: NOW })
    assert.match(cc, /max-age=0(,|$)/, `delt svar lot nettleseren cache: ${cc}`)
  }
})

test('MUTASJONSBEVIS: en stengt quiz får ALDRI immutable eller ubegrenset cache', () => {
  // Dette er den faktiske garantien for at en fasit-korreksjon slår gjennom.
  //
  // revalidateTag kan IKKE brukes her: den invaliderer Next.js sin Data Cache
  // (unstable_cache / tagged fetch), ikke svar som ligger i CDN/nettleser fordi
  // vi sendte Cache-Control. Kallet i correct-answer/route.ts gjelder forsidens
  // unstable_cache('home-shared-data') — en annen cache-type.
  //
  // Når vi ikke kan purge, er tidsgrensen hele forsvaret. Derfor håndheves den
  // her i stedet: sett `immutable` eller et årelangt tak i standings-cache.ts,
  // og denne testen feiler.
  for (const personalized of [true, false]) {
    const cc = decideStandingsCache({ closesAt: IGAR, personalized, now: NOW })

    assert.ok(!cc.includes('immutable'), `stengt quiz fikk immutable: ${cc}`)

    const alle = [...cc.matchAll(/max-age=(\d+)/g)].map(m => Number(m[1]))
    assert.ok(alle.length > 0, `fant ingen tidsgrense å håndheve i: ${cc}`)
    for (const sek of alle) {
      assert.ok(
        sek <= 300,
        `cache-vinduet er for langt (${sek}s) — en fasit-korreksjon ville blitt ` +
        `usynlig så lenge, og det finnes ingen purge-mekanisme for Cache-Control`,
      )
    }
  }
})

test('en fasit-korreksjon slår gjennom fordi vinduet utløper av seg selv', () => {
  // Simulerer tidslinjen: svar caches, admin retter fasiten, cachen utløper.
  const cachetKl = NOW
  const cc = decideStandingsCache({ closesAt: IGAR, personalized: false, now: cachetKl })
  const vindu = Number(/s-maxage=(\d+)/.exec(cc)![1]) * 1000

  const korrigertKl = cachetKl + 5_000 // admin retter 5 sekunder etter
  const ferskIgjenKl = cachetKl + vindu

  assert.ok(
    ferskIgjenKl > korrigertKl,
    'sanity: korreksjonen skjer mens svaret fortsatt er cachet',
  )
  assert.ok(
    ferskIgjenKl - korrigertKl <= SHARED_CLOSED_S_MAXAGE * 1000,
    'korreksjonen må være synlig innen ett cache-vindu',
  )
})

// ── Ruten: faktiske headere på et ekte Response-objekt ───────────────────────

const QUIZ_ID = '3053b3d1-0d4f-438e-a0fb-d5427dffce33'
const ATTEMPT_ID = '9f1c2b44-1c62-4f1d-9a1a-6f2b7c0d5e31'

const state: { closesAt: string | null; snapshotKaster: boolean } = {
  closesAt: IGAR,
  snapshotKaster: false,
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from(table: string) {
        const kjede = {
          select: () => kjede,
          eq: () => kjede,
          in: async () => ({ data: [], error: null }),
          maybeSingle: async () =>
            table === 'quizzes'
              ? { data: { closes_at: state.closesAt }, error: null }
              : { data: null, error: null },
        }
        return kjede
      },
    },
  },
})

mock.module('@/lib/ranking-snapshot', {
  namedExports: {
    // Stub: denne testen handler om cache-headere, ikke om rangeringsmatematikk
    // (den er dekket av ranking-snapshot.pagination.test.ts og ranking.ts).
    getOrBuildSnapshot: async () => {
      if (state.snapshotKaster) throw new Error('simulert DB-feil')
      return [
        { id: ATTEMPT_ID, user_id: null, player_name: 'Spiller', rank: 1, correct_answers: 12, total_time_ms: 40000, correct_streak: 3 },
        { id: 'b', user_id: null, player_name: 'Annen', rank: 2, correct_answers: 10, total_time_ms: 50000, correct_streak: 2 },
      ]
    },
    computePlacement: () => ({ rank: 1, total: 2, low: 1, high: 2, above: null, below: null }),
  },
})

const { GET } = await import('@/app/api/quiz/[id]/standings/route')

const kall = async (query: string) => {
  const res = await GET(
    new Request(`https://quizkanonen.no/api/quiz/${QUIZ_ID}/standings${query}`) as never,
    { params: Promise.resolve({ id: QUIZ_ID }) },
  )
  return res
}

test('ruten: stengt quiz uten spiller-parametere → delt CDN-cache', async () => {
  state.closesAt = IGAR
  state.snapshotKaster = false
  const res = await kall('')
  assert.equal(res.status, 200)
  assert.equal(
    res.headers.get('cache-control'),
    `public, s-maxage=${SHARED_CLOSED_S_MAXAGE}, max-age=0`,
  )
})

test('ruten: ÅPEN quiz uten spiller-parametere → kort CDN-cache', async () => {
  state.closesAt = IMORGEN
  state.snapshotKaster = false
  const res = await kall('')
  assert.equal(
    res.headers.get('cache-control'),
    `public, s-maxage=${SHARED_OPEN_S_MAXAGE}, max-age=0`,
  )
})

test('ruten: attemptId gjør svaret personlig, også på stengt quiz', async () => {
  state.closesAt = IGAR
  state.snapshotKaster = false
  const res = await kall(`?attemptId=${ATTEMPT_ID}&correct=12&time=40000`)
  assert.equal(res.headers.get('cache-control'), `private, max-age=${PRIVATE_CLOSED_MAX_AGE}`)
})

test('ruten: åpen quiz + attemptId → no-store', async () => {
  state.closesAt = IMORGEN
  state.snapshotKaster = false
  const res = await kall(`?attemptId=${ATTEMPT_ID}`)
  assert.equal(res.headers.get('cache-control'), 'private, no-store')
})

test('ruten: `?correct=0` alene teller som personlig', async () => {
  // Regresjonsvakt: en implementasjon som ser på den PARSEDE verdien i stedet
  // for om parameteren fantes, ville sett 0 (= defaulten) og delt svaret.
  state.closesAt = IGAR
  state.snapshotKaster = false
  const res = await kall('?correct=0')
  assert.equal(res.headers.get('cache-control'), `private, max-age=${PRIVATE_CLOSED_MAX_AGE}`)
})

test('ruten: et tomt nødsvar ved DB-feil caches ALDRI', async () => {
  state.closesAt = IGAR
  state.snapshotKaster = true
  const res = await kall('')
  const json = await res.json()
  assert.deepEqual(json, { top3: [], placement: null })
  assert.equal(res.headers.get('cache-control'), 'private, no-store')
})
