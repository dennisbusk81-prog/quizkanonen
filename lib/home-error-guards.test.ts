// Kjøres med:  npm test
//
// STRUKTURELL SPERRE mot at forsiden igjen forkler en lesefeil som «ingen data»
// ([F-7], rettet 24. august 2026).
//
// HVA SOM STÅR PÅ SPILL
// computeSharedHomeData kjørte ni rå Supabase-spørringer uten å lese `error`.
// En feilet spørring ga `data: null`, `?? []` gjorde den til en tom liste, og
// forsiden skrev «Ingen quiz planlagt akkurat nå» — mens quizen var åpen. Og
// fordi bundelen ligger i `unstable_cache` (60 s) fikk ALLE som lastet forsiden
// det minuttet den samme usanne setningen. Forsiden er nettopp der folk lander
// når quizen åpner.
//
// Hvorfor en kildetekst-test: `computeSharedHomeData` er ikke eksportert, den
// lever i en server-komponent, og det vi vil sperre mot er WIRINGEN — at hver
// spørring faktisk leser `error`, og at de kritiske KASTER framfor å logge.
// Selve logikken er testet direkte i lib/home-query-guard.test.ts, og at et
// kast ikke kan caches i lib/home-cache-poisoning.test.ts. Samme begrunnelse
// som lib/home-shared-cache.test.ts.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger
// (alle kjørt 24. august 2026):
//   • Slett `assertHomeQuery('aktiv quiz', activeRes.error)` → «hver
//     supabaseAdmin-spørring leser error» ryker med «activeRes».
//   • Bytt `assertHomeQuery` mot `logHomeQuery` på activeRes → «de kritiske
//     kaster» ryker. Dette er den viktigste: logging alene ville degradert
//     tilbake til «ingen quiz», bare med et loggspor.
//   • Fjern `error: countError` fra founders-tellingen → «inline-oppslag
//     destrukturerer error» ryker.
//   • Fjern `sharedUnavailable ?`-grenen foran quiz-kortet i én av grenene →
//     «feiltilstanden står FØR ingen-quiz-grenen» ryker for den grenen.
//   • Fjern `.catch(` rundt getSharedHomeData() → «kalleren fanger» ryker.
//
// SØSKNENE (24. august 2026): tre andre steder i samme fil hadde samme
// feilklasse — den personaliserte Promise.all-en i Home(), computePageInsights
// og computeFounderStoryStats. De nye testene under er mutasjonsbevist samme
// dag, alle ti mutasjonene ble røde:
//   • Fjern lesevakten på `playedLogResult` → «hver rå spørring i den
//     PERSONALISERTE grenen» ryker.
//   • Bytt `logHomeQuery` mot `assertHomeQuery` på playedLogResult → «de
//     PERSONALISERTE vaktene LOGGER» ryker. Motsatt krav av det kritiske
//     kravet over, og grunnen er kallstedet: den personaliserte grenen ligger
//     utenfor både cache og `.catch`, og repoet har ingen app/error.tsx — et
//     kast der bytter ut HELE siden, ikke ett kort.
//   • Fjern `{playedStatusUnknown ? …}` fra CTA-kjeden (den eksakte
//     pre-fiks-koden) → «kan ikke gi «Spill ukens quiz»» ryker.
//   • Gate oppsalget på `!isPremium` igjen → «premium nedgraderes ikke» ryker.
//   • Fjern `!playedThisMonthUnknown` fra én av de to setningene → «kan ikke
//     påstå «du er ikke i gang denne måneden»» ryker.
//   • Slutt å lese `error` på insights-forsøkene → «computePageInsights leser
//     error» ryker.
//   • Gjør den ytre catch-en stum (`} catch {  return null`) → «ytre catch er
//     ikke stum» ryker.
//   • Gjeninnfør `?? 0` på quizzesCompleted, fjern `.catch(` på kallstedet,
//     eller behold cache-nøkkel v1 → «grunnleggertallene» ryker på hver av de
//     tre.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync('app/page.tsx', 'utf8')

// ── Verktøy ────────────────────────────────────────────────────────────────
// Kommentarer strippes FØR all matching. Uten det ville en utkommentert
// `// assertHomeQuery(...)` fått testene til å passere på død kode — memory-
// regelen «strukturtester trenger linje-anker». Strippen har egen selvtest.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature)
  assert.notEqual(start, -1, `fant ikke «${signature}» i app/page.tsx`)
  const open = src.indexOf('{', start + signature.length)
  assert.notEqual(open, -1, 'fant ingen kropp etter signaturen')
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error('ubalanserte klammer — klarte ikke isolere funksjonskroppen')
}

// Splitter en argumentliste/array på TOPPNIVÅ-komma. Må hoppe over komma inne i
// parenteser, klammer, hakeparenteser OG strenger — `.or(`a.is.null,b.gte.${x}`)`
// har et komma inne i en template-literal, og uten dette ville slot-tellingen
// blitt feil (og testen dermed målt feil spørring).
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { parts.push(list.slice(start, i)); start = i + 1 }
  }
  const rest = list.slice(start).trim()
  if (rest) parts.push(rest)
  return parts.map(p => p.trim()).filter(Boolean)
}

/**
 * Finner `const [a, b, c] = await Promise.all([...])` i en funksjonskropp og
 * parer hvert destrukturerte navn med sin slot. Returnerer kun de slotene som
 * er RÅ supabaseAdmin-spørringer — IIFE-slotene returnerer ferdige verdier og
 * har ingen `.error` å lese.
 *
 * `anker` velger HVILKEN destrukturering når kroppen har flere. Home() har to:
 * først `[founderStats, shared]` (ingen rå spørringer), så den personaliserte
 * `[profileResult, …]`. Uten ankeret målte helperen alltid den første, og den
 * personaliserte grenen — der [F-7]-søsknene bor — ville sett dekket ut mens
 * ingen test rørte den.
 */
function rawQuerySlots(body: string, anker?: string): { name: string; slot: string }[] {
  const alle = [...body.matchAll(/const\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\[/g)]
  assert.ok(alle.length > 0, 'fant ingen «const [...] = await Promise.all([» i funksjonskroppen')
  const m = anker
    ? alle.find(x => x[1].split(',').map(s => s.trim()).includes(anker))
    : alle[0]
  assert.ok(m, `fant ingen Promise.all-destrukturering som inneholder «${anker}»`)
  const names = m[1].split(',').map(s => s.trim()).filter(Boolean)

  const arrayStart = m.index + m[0].length
  let depth = 1
  let quote: string | null = null
  let end = -1
  for (let i = arrayStart; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '[' || c === '(' || c === '{') depth++
    else if (c === ']' || c === ')' || c === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.notEqual(end, -1, 'ubalansert Promise.all-array')

  const slots = splitTopLevel(body.slice(arrayStart, end))
  assert.equal(
    slots.length, names.length,
    `${names.length} destrukturerte navn men ${slots.length} sloter — parsingen er ute av takt ` +
    'med koden, og testen måler da feil spørring',
  )
  return names
    .map((name, i) => ({ name, slot: slots[i] }))
    .filter(pair => pair.slot.startsWith('supabaseAdmin'))
}

const SRC = stripComments(PAGE)
const SHARED = functionBody(SRC, 'async function computeSharedHomeData')
const PARTICIPANTS = functionBody(SRC, 'async function countParticipants')
const HOME = functionBody(SRC, 'export default async function Home')
const INSIGHTS = functionBody(SRC, 'async function computePageInsights')
const FOUNDER = functionBody(SRC, 'async function computeFounderStoryStats')

/** Linjene i en kropp som nevner `needle` — brukt der labels inneholder
 *  parenteser og et `[^)]*`-regex derfor ville stoppet for tidlig. */
function linjerMed(body: string, needle: string): string[] {
  return body.split('\n').filter(l => l.includes(needle))
}

// Kritiske lesinger: de som bestemmer om forsiden i det hele tatt sier at det
// finnes en quiz. Feiler én av dem, er BÅDE «Ingen quiz planlagt» og
// «Kommende quiz» usanne påstander.
const KRITISKE = ['activeRes', 'upcomingRes']

test('hver rå supabaseAdmin-spørring i den delte bundelen leser sin error', () => {
  const slots = rawQuerySlots(SHARED)
  assert.ok(slots.length >= 4, `fant bare ${slots.length} rå spørringer — parsingen har mistet noe`)
  for (const { name } of slots) {
    assert.ok(
      SHARED.includes(`${name}.error`),
      `${name}.error leses aldri i computeSharedHomeData. En feilet spørring blir da ` +
      '«ingen data» — og siden bundelen caches i 60 s, blir den løgnen servert til alle ' +
      'som lander på forsiden det minuttet. Bruk assertHomeQuery (kritisk) eller ' +
      'logHomeQuery (kosmetisk) fra lib/home-query-guard.',
    )
  }
})

test('hver rå spørring i countParticipants leser sin error', () => {
  // Egen funksjon, samme feilklasse. Feiler excluded_members-oppslaget blir
  // settet tomt og deltakerantallet for HØYT — et tall vi ikke kan stå for,
  // uten et eneste tegn på at noe gikk galt.
  const slots = rawQuerySlots(PARTICIPANTS)
  assert.equal(slots.length, 2, 'countParticipants skal ha nøyaktig to rå spørringer')
  for (const { name } of slots) {
    assert.ok(
      PARTICIPANTS.includes(`${name}.error`),
      `${name}.error leses aldri i countParticipants`,
    )
  }
})

test('inline-oppslag inne i bundelen destrukturerer error', () => {
  // Founders-IIFE-en gjør `const { data, error } = await supabaseAdmin...` i
  // stedet for å ligge som en slot. Uten `error` i mønsteret ble `count` null
  // ved feil, `used` ble 0, og linja påsto «250 av 250 plasser igjen» — et
  // oppdiktet tall, ikke en manglende seksjon.
  const inline = [...SHARED.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+supabaseAdmin/g)]
  assert.ok(inline.length >= 2, `fant bare ${inline.length} inline-oppslag — forventet minst 2`)
  for (const m of inline) {
    assert.ok(
      /\berror\b/.test(m[1]),
      `et inline supabaseAdmin-oppslag destrukturerer ikke error: { ${m[1].trim()} }`,
    )
  }
})

test('de KRITISKE lesingene kaster — de logger ikke bare', () => {
  // Kjernen i kravet. logHomeQuery ville gitt et loggspor og deretter nøyaktig
  // den samme usanne setningen på skjermen.
  for (const navn of KRITISKE) {
    assert.ok(
      new RegExp(`assertHomeQuery\\([^)]*${navn}\\.error\\)`).test(SHARED),
      `${navn} er ikke vaktet med assertHomeQuery. Bare et kast kan hindre at ` +
      'forsiden sier «ingen quiz» når det finnes en — og bare et kast holdes ' +
      'utenfor unstable_cache.',
    )
  }
})

test('POSITIV KONTROLL: begge vaktene er faktisk i bruk i fila', () => {
  // Uten denne ville testene over passert like fint om lib/home-query-guard
  // ble omdøpt eller koblet fra — et fravær som ikke beviser noe.
  assert.ok(SRC.includes("from '@/lib/home-query-guard'"), 'vaktene importeres ikke lenger')
  assert.ok(SRC.includes('assertHomeQuery('), 'assertHomeQuery brukes ikke i app/page.tsx')
  assert.ok(SRC.includes('logHomeQuery('), 'logHomeQuery brukes ikke i app/page.tsx')
})

test('kalleren fanger kastet — forsiden faller ikke helt sammen', () => {
  assert.ok(
    /getSharedHomeData\(\)\s*\.catch\(/.test(HOME),
    'getSharedHomeData() fanges ikke i Home(). Uten fangsten treffer kastet ' +
    'global-error.tsx, og hele forsiden byttes ut — nav, lenker og alt annet ' +
    'innhold forsvinner sammen med quiz-kortet.',
  )
  assert.ok(
    /const\s+sharedUnavailable\s*=/.test(HOME),
    'sharedUnavailable utledes ikke lenger — da vet JSX-en ikke at bundelen mangler',
  )
})

test('feiltilstanden står FØR «ingen quiz»-grenen i BEGGE grenene', () => {
  // To grener (innlogget og gjest) rendrer hver sin quiz-kort-kjede, og begge
  // ender i en «Ingen quiz planlagt»-tekst. Feiltilstanden må derfor stå først
  // i BEGGE — å rette den ene og la den andre stå er nøyaktig feilen
  // arbeidsregelen «en feil har som regel søsken» advarer mot.
  const branches = [...HOME.matchAll(/\{sharedUnavailable \?\s*\(\s*<QuizStatusUnavailableCard \/>/g)]
  assert.equal(
    branches.length, 2,
    `fant ${branches.length} sharedUnavailable-grener, forventet 2 (innlogget + gjest). ` +
    'Mangler én, faller den grenen tilbake til «Ingen quiz planlagt» ved lesefeil.',
  )

  // …og hver av dem må ligge FØR sin «Ingen quiz»-tekst, ellers er den ikke nåbar.
  const ingenQuiz = [...HOME.matchAll(/Ingen quiz planlagt/g)].map(m => m.index as number)
  assert.equal(ingenQuiz.length, 2, 'forventet nøyaktig to «Ingen quiz planlagt»-tekster')
  for (let i = 0; i < 2; i++) {
    assert.ok(
      (branches[i].index as number) < ingenQuiz[i],
      'sharedUnavailable-grenen står ETTER «Ingen quiz planlagt» i ternær-kjeden — ' +
      'da nås den aldri, og setningen kan fortsatt bli usann',
    )
  }
})

// ══════════════════════════════════════════════════════════════════════════
// SØSKNENE (24. august 2026) — samme feilklasse, tre andre steder i fila
// ══════════════════════════════════════════════════════════════════════════

const PERSONALISERTE = [
  'profileResult',
  'leagueResult',
  'playedLogResult',
  'monthlyAttemptsResult',
  'orgMembershipResult',
]

test('hver rå spørring i den PERSONALISERTE grenen leser sin error', () => {
  const slots = rawQuerySlots(HOME, 'playedLogResult')
  assert.equal(
    slots.length, PERSONALISERTE.length,
    `fant ${slots.length} rå spørringer i den personaliserte Promise.all-en, forventet ${PERSONALISERTE.length}`,
  )
  for (const { name } of slots) {
    assert.ok(
      HOME.includes(`${name}.error`),
      `${name}.error leses aldri. En feilet spørring gir data: null, og null er ` +
      'ikke det samme som «tomt» — det er «vi vet ikke».',
    )
  }
})

test('de PERSONALISERTE vaktene LOGGER — de kaster ikke', () => {
  // Speilbildet av «de KRITISKE lesingene kaster». Her er kravet det motsatte,
  // og grunnen er kallstedet: disse fem ligger rått i Home(), utenfor både
  // unstable_cache og et .catch, og repoet har ingen app/error.tsx. Et kast
  // herfra faller til app/global-error.tsx og bytter ut HELE forsiden — der
  // den delte bundelen bare mister ett kort.
  for (const navn of PERSONALISERTE) {
    const linjer = linjerMed(HOME, `${navn}.error`)
    assert.ok(linjer.length > 0, `${navn}.error leses ikke i det hele tatt`)
    assert.ok(
      linjer.some(l => l.includes('logHomeQuery(')),
      `${navn}.error leses, men ikke med logHomeQuery`,
    )
    assert.ok(
      !linjer.some(l => l.includes('assertHomeQuery(')),
      `${navn} er vaktet med assertHomeQuery. Et kast her feller HELE forsiden ` +
      '(ingen app/error.tsx finnes) — bruk logHomeQuery og en tredje tilstand i JSX-en.',
    )
  }
})

test('en lesefeil på spilt-status kan ikke gi «Spill ukens quiz»', () => {
  // Kravet fra bestillingen: en innlogget som HAR spilt skal aldri se
  // «Spill ukens quiz». Uten den tredje tilstanden ga en lesefeil tomme
  // attempt-rader ⇒ alreadyPlayed=false ⇒ nettopp den knappen, og hun ble
  // lokket inn i allerede-spilt-skjermen eller en 403.
  const iUkjent = HOME.indexOf('playedStatusUnknown ?')
  const iSpilt = HOME.indexOf('alreadyPlayed ?')
  const spillKnapper = [...HOME.matchAll(/Spill ukens quiz/g)].map(m => m.index as number)

  assert.notEqual(
    iUkjent, -1,
    'playedStatusUnknown-grenen finnes ikke i CTA-kjeden — en lesefeil faller da ' +
    'rett ned i «Spill ukens quiz»',
  )
  assert.notEqual(iSpilt, -1, 'alreadyPlayed-grenen finnes ikke lenger')
  assert.ok(
    iUkjent < iSpilt,
    'playedStatusUnknown står ETTER alreadyPlayed i ternær-kjeden — da nås den ' +
    'aldri, siden alreadyPlayed er false ved nettopp den feilen',
  )
  assert.equal(spillKnapper.length, 2, 'forventet to «Spill ukens quiz» (innlogget + gjest)')
  assert.ok(
    iUkjent < spillKnapper[0],
    'den innloggede «Spill ukens quiz» står FØR ukjent-grenen',
  )
})

test('en lesefeil kan ikke påstå «du er ikke i gang denne måneden»', () => {
  // playedThisMonth havner på skjermen nøyaktig to steder (Premium og ikke),
  // og count ble null ⇒ false ⇒ «Du er ikke i gang denne måneden ennå» til en
  // som spilte i går. Samme klasse som «250 av 250 plasser igjen».
  const gatet = [...HOME.matchAll(/userPoints === 0 && !playedThisMonthUnknown/g)]
  assert.equal(
    gatet.length, 2,
    `${gatet.length} av 2 playedThisMonth-setninger er gatet på !playedThisMonthUnknown`,
  )
  assert.ok(
    HOME.includes('playedThisMonthUnknown = logHomeQuery('),
    'playedThisMonthUnknown utledes ikke fra en lesevakt',
  )
})

test('premium nedgraderes ikke på en transient lesefeil', () => {
  // Regelen fra ProfileProvider, håndhevet på forsiden: en betalende kunde
  // skal aldri se «Oppgrader til Premium» fordi ett profiloppslag ikke landet.
  assert.ok(
    HOME.includes('premiumUnknown = logHomeQuery('),
    'premiumUnknown utledes ikke fra profileResult.error',
  )
  assert.ok(
    HOME.includes('const premiumLocked = !isPremium && !premiumUnknown'),
    'premiumLocked er ikke lenger «ikke Premium OG vi vet det»',
  )
  assert.ok(
    !HOME.includes('{!isPremium && ('),
    'en oppsalgs-blokk gates fortsatt på !isPremium alene. Ved ukjent profil ' +
    'påstår den da overfor en betalende kunde at hun ikke har betalt — bruk premiumLocked.',
  )
  // Låsen på Historikk-flisa er den samme påstanden i miniatyr.
  assert.ok(
    !/\{isPremium\s*\n\s*\? <span className="qkp-shortcut-arrow">/.test(HOME),
    'Historikk-flisas lås-merke henger fortsatt på isPremium alene',
  )
  const bruk = [...HOME.matchAll(/premiumLocked/g)].length
  assert.ok(bruk >= 6, `premiumLocked brukes bare ${bruk} steder — forventet minst 6`)
})

test('computePageInsights leser error på alle tre oppslagene', () => {
  const inline = [...INSIGHTS.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+supabaseAdmin/g)]
  assert.equal(inline.length, 3, `fant ${inline.length} supabaseAdmin-oppslag, forventet 3`)
  for (const m of inline) {
    assert.ok(
      /\berror\b/.test(m[1]),
      `et oppslag i computePageInsights destrukturerer ikke error: { ${m[1].trim()} }`,
    )
  }
  const vakter = [...INSIGHTS.matchAll(/if \(logHomeQuery\(/g)].length
  assert.equal(vakter, 3, `${vakter} av 3 oppslag er faktisk vaktet med logHomeQuery`)
})

test('computePageInsights sin ytre catch er ikke stum', () => {
  // Degraderingen var ærlig hele tiden (seksjonen skjules) — det var SPORET
  // som manglet. Den ytre grenen fanger uventede kast (RPC-fallbackene i
  // lib/attempt-answer-stats, fetchAllRows), altså ekte bugs.
  assert.ok(
    !/\}\s*catch\s*\{\s*return null/.test(INSIGHTS),
    'den ytre catch-en svelger fortsatt alt uten et spor',
  )
  assert.ok(INSIGHTS.includes('console.error('), 'catch-en logger ikke')
  assert.ok(
    INSIGHTS.includes('Sentry.captureException('),
    'catch-en rapporterer ikke til Sentry. Volumet er trygt: null caches i 60 s, ' +
    'så en vedvarende feil koster høyst én hendelse i minuttet per region.',
  )
})

test('grunnleggertallene: ingen oppdiktet 0, og ingen felt forside', () => {
  // To feilveier som endte på hver sin ytterlighet: quiz-tellingen diktet opp
  // «0+ Quizer gjennomført» (cachet i en TIME), mens countActivePlayersSince
  // kaster ved total feil og — ufanget — felte hele forsiden.
  assert.ok(
    /assertHomeQuery\([^)]*quizzesRes\.error\)/.test(FOUNDER),
    'quiz-tellingen leses ikke med assertHomeQuery — «0+ Quizer gjennomført» ' +
    'kan da stå som et faktum i en time',
  )
  assert.ok(
    !FOUNDER.includes('quizzesCompleted ?? 0'),
    'det gamle `?? 0`-fallbacket står igjen og gjør vakten virkningsløs',
  )
  assert.ok(
    /getFounderStoryStats\(\)\s*\.catch\(/.test(HOME),
    'getFounderStoryStats() fanges ikke i Home() — et kast bytter da ut HELE ' +
    'forsiden med global-error.tsx for to tillitstall',
  )
  assert.ok(
    HOME.includes('{founderStats && ('),
    'stat-raden gates ikke på founderStats — null ville rendret «undefined+»',
  )
  assert.ok(
    SRC.includes("'home-founder-story-stats-v2'"),
    'cache-nøkkelen er ikke bumpet. En lagret v1-verdi kan inneholde det ' +
    'oppdiktede 0-tallet, og Vercels data-cache overlever deploys.',
  )
})

test('SELVTEST: kommentarstrippen fjerner utkommentert kode, men ikke aktiv', () => {
  const prøve = [
    'const a = 1 // assertHomeQuery i linjekommentar',
    '/* assertHomeQuery i blokk-kommentar */',
    'assertHomeQuery("aktiv quiz", activeRes.error)',
  ].join('\n')
  const strippet = stripComments(prøve)
  assert.ok(!strippet.includes('linjekommentar'), 'linjekommentarer strippes ikke')
  assert.ok(!strippet.includes('blokk-kommentar'), 'blokk-kommentarer strippes ikke')
  assert.ok(strippet.includes('assertHomeQuery("aktiv quiz", activeRes.error)'), 'strippen spiser aktiv kode')
  assert.ok(stripComments('const u = "https://x.no"').includes('https://x.no'), 'strippen spiser URL-er')
})

test('SELVTEST: splitTopLevel lar seg ikke lure av komma inne i strenger', () => {
  // `.or(`closes_at.is.null,closes_at.gte.${nowIso}`)` er den ekte formen i
  // koden. Deles den feil, glir slot-tellingen ut av takt med navnene og
  // testene over ville målt feil spørring.
  const parts = splitTopLevel('supabaseAdmin.or(`a,b`).limit(1), (async () => { return [1, 2] })(), x')
  assert.equal(parts.length, 3, `splitTopLevel ga ${parts.length} deler, forventet 3`)
  assert.ok(parts[0].startsWith('supabaseAdmin'))
  assert.ok(parts[1].startsWith('(async'))
})
