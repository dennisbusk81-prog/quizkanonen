// Kjøres med:  npm test
//
// KRAVET DENNE FELLER: en transient lesefeil skal ikke låses i forsidens
// 60-sekunders-cache.
//
// Fram til 24. august 2026 kastet computeSharedHomeData aldri. En feilet
// spørring ga `data: null`, som ble til «ingen aktiv quiz», og `unstable_cache`
// skrev den nullbundelen som et helt ordinært vellykket svar. Alle som lastet
// forsiden det minuttet fikk «Ingen quiz planlagt akkurat nå» — mens quizen var
// åpen. Fiksen er at kritiske spørringer KASTER (lib/home-query-guard).
//
// At et kast ikke kan caches er en påstand om NEXT, ikke om vår kode. Derfor
// driver denne testen den EKTE `unstable_cache` fra next 16.2.1 med en
// instrumentert incremental-cache, i stedet for å gjenfortelle biblioteket i en
// attrapp. Samme prinsipp som lib/middleware-cookie-guard.test.ts, som kjører
// en ekte createServerClient.
//
// REVERIFISER VED HVER NEXT-OPPGRADERING. Testen hviler på interne detaljer:
// at `globalThis.__incrementalCache` er inngangen når det ikke finnes noen
// workStore, og at bakgrunnsrevalideringen skriver inne i `.then(...)`.
//
// MUTASJONSBEVIS (kjørt 24. august 2026): bytt `throw` mot `return { tom: true }`
// i kallbacken under, og «et kast skrives ALDRI til cachen» ryker med
// «cachen ble skrevet 1 gang» — altså nøyaktig forgiftningen fiksen fjerner.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'

// Next sin async-local-storage-modul kaster ved lasting hvis denne mangler
// (den faller ellers tilbake på en FakeAsyncLocalStorage som kaster i run()).
// Utenfor en Next-server finnes den ikke på globalThis av seg selv.
;(globalThis as unknown as { AsyncLocalStorage: unknown }).AsyncLocalStorage = AsyncLocalStorage

type FakeCache = {
  isOnDemandRevalidate: boolean
  generateCacheKey(key: string): Promise<string>
  get(): Promise<null>
  set(key: string): Promise<void>
}

function installFakeCache(): { writes: string[] } {
  const writes: string[] = []
  const fake: FakeCache = {
    isOnDemandRevalidate: false,
    async generateCacheKey(key: string) { return `k:${key.length}` },
    async get() { return null },          // alltid bom → callbacken kjøres
    async set(key: string) { writes.push(key) },
  }
  ;(globalThis as unknown as { __incrementalCache: FakeCache }).__incrementalCache = fake
  return { writes }
}

async function loadUnstableCache() {
  const mod = await import('next/dist/server/web/spec-extension/unstable-cache.js')
  return (mod as { unstable_cache: <T>(cb: () => Promise<T>, keys: string[], opts: { revalidate: number; tags: string[] }) => () => Promise<T> }).unstable_cache
}

test('POSITIV KONTROLL: et vellykket resultat SKRIVES til cachen', async () => {
  // Uten denne ville testen under passert selv om attrappen aldri ble kalt i
  // det hele tatt — et fravær som ikke beviser noe.
  const { writes } = installFakeCache()
  const unstable_cache = await loadUnstableCache()

  const cached = unstable_cache(async () => ({ activeQuiz: 'finnes' }), ['poison-ok'], { revalidate: 60, tags: ['t'] })
  const result = await cached()

  assert.deepEqual(result, { activeQuiz: 'finnes' })
  assert.equal(writes.length, 1, 'et vellykket svar skal skrives — ellers måler ikke testen under noe')
})

test('et kast skrives ALDRI til cachen', async () => {
  const { writes } = installFakeCache()
  const unstable_cache = await loadUnstableCache()

  const cached = unstable_cache(async () => {
    // Det computeSharedHomeData nå gjør når «aktiv quiz» ikke kan leses.
    throw new Error('forsidens delte bundel: «aktiv quiz» feilet — timeout')
  }, ['poison-throw'], { revalidate: 60, tags: ['t'] })

  await assert.rejects(cached(), /aktiv quiz/, 'kastet skal nå kalleren, ikke svelges av cachen')
  assert.equal(
    writes.length, 0,
    `cachen ble skrevet ${writes.length} gang(er) tross kast — en transient feil ` +
    'ville da blitt servert som «ingen quiz» til alle i 60 sekunder',
  )
})

test('kastet forgifter ikke NESTE kall heller', async () => {
  // Feiler ett kall og lykkes det neste, skal det neste gi ekte data — ikke en
  // lagret feiltilstand.
  const { writes } = installFakeCache()
  const unstable_cache = await loadUnstableCache()

  let førsteKall = true
  const cached = unstable_cache(async () => {
    if (førsteKall) { førsteKall = false; throw new Error('transient') }
    return { activeQuiz: 'åpen' }
  }, ['poison-recovery'], { revalidate: 60, tags: ['t'] })

  await assert.rejects(cached())
  assert.deepEqual(await cached(), { activeQuiz: 'åpen' })
  assert.equal(writes.length, 1, 'kun det vellykkede svaret skal ha blitt skrevet')
})

test('TRIPWIRE: bakgrunnsrevalideringen skriver fortsatt kun i .then()', () => {
  // Testene over dekker fersk-genereringsstien (ingen workStore). STALE-stien
  // — der en utløpt cache-rad revalideres i bakgrunnen mens den gamle serveres
  // — krever en workStore vi ikke kan bygge her. Den leses derfor i kilden:
  // skrivingen skal ligge inne i `.then(...)`, og feil skal ende i `.catch(...)`.
  // Flytter en framtidig Next-versjon skrivingen ut av then-grenen, kan en
  // feilet revalidering igjen overskrive en god cache-rad — og da må denne
  // fila leses på nytt.
  const src = readFileSync('node_modules/next/dist/server/web/spec-extension/unstable-cache.js', 'utf8')

  const thenIdx = src.indexOf('.then(async (result)=>{')
  assert.notEqual(thenIdx, -1, 'fant ikke then-grenen i unstable-cache.js — Next er oppgradert, les stale-stien på nytt')
  const catchIdx = src.indexOf('}).catch(', thenIdx)
  assert.notEqual(catchIdx, -1, 'fant ingen .catch() etter then-grenen')

  const thenBlock = src.slice(thenIdx, catchIdx)
  assert.ok(
    thenBlock.includes('cacheNewResult('),
    'skrivingen ligger ikke lenger inne i .then() — en feilet bakgrunnsrevalidering kan nå skrive',
  )

  // …og feilgrenen skal IKKE skrive.
  const catchBlock = src.slice(catchIdx, src.indexOf('});', catchIdx))
  assert.ok(
    !catchBlock.includes('cacheNewResult('),
    'catch-grenen skriver til cachen — da ville et kast blitt lagret likevel',
  )
})
