// Kjøres med:  npm test
//
// STRUKTURELL SPERRE på den DELTE, CACHEDE forside-bundelen
// (computeSharedHomeData / getSharedHomeData i app/page.tsx).
//
// HVA SOM STÅR PÅ SPILL
// `unstable_cache` gjør resultatet til ÉN rad delt av alle besøkende, anonyme
// som innloggede. Havner en personalisert verdi i den, serveres én brukers
// data til alle andre til cachen ruller. Kommentaren over funksjonen kaller
// dette en «lekkasje-garanti» — denne fila er beviset for den, ikke
// resonnementet.
//
// Anledningen er konkret: 12. august 2026 fikk bundelen sitt første felt som
// GRENSER til brukerdata. `trialDays` (site_settings.founders_new_trial_days)
// er global og trygg, men den lever side om side med `has_used_trial` og
// eligibility-beslutningen — som begge er per bruker og hentes UTENFOR
// cachen, i den innloggede grenen. De to må ikke gli sammen.
//
// Hvorfor en kildetekst-test og ikke en verditest: computeSharedHomeData er
// ikke eksportert, den lever i en server-komponent med et titalls imports, og
// den vi vil sperre mot er WIRINGEN (hvilke felt som legges i cachen), ikke
// logikk som kan trekkes ut. Samme begrunnelse som
// lib/historikk-load-catch.test.ts.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger
// (alle kjørt 12. august 2026):
//   • Legg `hasUsedTrial` i retur-objektet → «bundelen bærer kun de globale
//     feltene» + «fingeravtrykket» ryker.
//   • Legg til et felt UTEN å bumpe cache-nøkkelen → «fingeravtrykket» ryker.
//     Dette er hele poenget: gamle v3-objekter mangler det nye feltet, og
//     `undefined` leses som «ingen verdi» helt til cachen tilfeldigvis ruller.
//   • Bruk `user.id` / `has_used_trial` / `isTrialEligible` inne i funksjonen
//     → «ingen brukerspesifikk kode» ryker.
//   • Gi funksjonen et parameter (f.eks. userId) → «ingen inngangsverdier»
//     ryker. Argumenter inngår i cache-nøkkelen, så et bruker-argument ville
//     laget én cache-rad per bruker — ikke en lekkasje, men heller ikke den
//     delte bundelen dette er.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const PAGE = readFileSync('app/page.tsx', 'utf8')

// ── Verktøy ────────────────────────────────────────────────────────────────
// Kommentarer fjernes FØR all matching. Uten det ville en utkommentert
// `// const x = profile.has_used_trial` fått «ingen brukerspesifikk kode» til å
// ryke uten grunn — og verre, en utkommentert linje kunne skjult et treff vi
// trodde vi hadde. Strippen har sin egen positive kontroll nederst.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// Klammebalansering fra funksjonens første `{`. Template-literalene i
// funksjonen (`${nowIso}`) er balanserte, så enkel telling holder her.
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

// Nøklene i det YTRE retur-objektet. Funksjonen har også indre returer
// (founders-IIFE-en returnerer `{ remaining, max }` og `null`), så vi tar den
// siste og slår fast at det faktisk er den rette.
function returnedKeys(body: string): string[] {
  const idx = body.lastIndexOf('return {')
  assert.notEqual(idx, -1, 'fant ingen retur av et objekt i computeSharedHomeData')
  const open = body.indexOf('{', idx)
  let depth = 0
  let close = -1
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++
    else if (body[i] === '}') { depth--; if (depth === 0) { close = i; break } }
  }
  assert.notEqual(close, -1, 'ubalansert retur-objekt')
  return body.slice(open + 1, close)
    .split(',')
    .map(part => part.split(':')[0].trim())
    .filter(Boolean)
    .sort()
}

const SRC = stripComments(PAGE)
const BODY = functionBody(SRC, 'async function computeSharedHomeData')
const KEYS = returnedKeys(BODY)

// ── Fasiten ────────────────────────────────────────────────────────────────
// Endrer du denne lista, MÅ du bumpe cache-nøkkelen i samme slengen — se
// «fingeravtrykket» under for hvorfor.
const GLOBALE_FELT = [
  'activeQuiz',
  'founders',
  'lastClosedQuiz',
  'lastQuizTop3',
  'monthlyStandings',
  'nextQuizAt',
  'participantCount',
  'trialDays',
  'upcomingQuiz',
]
// Fingeravtrykket regnes ut av det FAKTISKE feltsettet i koden, ikke av lista
// over. Derfor kan ikke koblingen omgås ved å oppdatere begge to: legger du
// til et felt, endres halen, og nøkkelen i app/page.tsx må skrives om.
const FELT_FINGERAVTRYKK = createHash('sha1').update(KEYS.join(',')).digest('hex').slice(0, 8)
const CACHE_NØKKEL = `home-shared-data-v3-${FELT_FINGERAVTRYKK}`

test('bundelen bærer kun de globale feltene — ingen brukerspesifikke', () => {
  assert.ok(KEYS.includes('activeQuiz'), 'plukket feil retur-objekt ut av funksjonen')
  assert.deepEqual(
    KEYS,
    GLOBALE_FELT,
    'computeSharedHomeData returnerer et annet feltsett enn det godkjente. ' +
    'Er det nye feltet utledet av en INNLOGGET bruker (profil, medlemskap, ' +
    'eligibility, plassering), hører det hjemme i den personaliserte grenen — ' +
    'ikke i en cache alle besøkende deler.',
  )
})

test('de brukerspesifikke feltene er navngitt, så lista ikke bare er tom-sann', () => {
  // Ingen av disse skal noensinne stå i GLOBALE_FELT. Testen over ville
  // passert uansett hva lista inneholdt hvis den bare speilet koden — dette
  // er den uavhengige påstanden om hva som er forbudt.
  for (const forbudt of ['hasUsedTrial', 'has_used_trial', 'trialOffer', 'eligible', 'isPremium', 'displayName']) {
    assert.ok(
      !GLOBALE_FELT.includes(forbudt),
      `${forbudt} er per bruker og kan ikke ligge i den delte bundelen`,
    )
  }
})

test('fingeravtrykket: cache-nøkkelen er bundet til det faktiske feltsettet', () => {
  // Bufrede svar overlever skjemaendringer. Legges et felt til uten at
  // nøkkelen bumpes, serveres lagrede objekter fra forrige versjon videre —
  // uten feltet — og `undefined` leses som «ingen verdi», stille, helt til
  // cachen tilfeldigvis ruller.
  //
  // Halen er utledet av returen i koden, så dette er ikke to lister som skal
  // holdes i takt for hånd: endrer feltsettet seg, endres halen, og nøkkelen
  // i app/page.tsx MÅ skrives om. Ryker denne testen: kopier nøkkelen fra
  // feilmeldingen inn i unstable_cache-kallet.
  assert.ok(
    SRC.includes(`unstable_cache(computeSharedHomeData, ['${CACHE_NØKKEL}']`),
    `cache-nøkkelen matcher ikke feltsettet. Feltene er nå [${KEYS.join(', ')}], ` +
    `og nøkkelen i app/page.tsx skal da være '${CACHE_NØKKEL}'.`,
  )
})

test('ingen brukerspesifikk kode inne i funksjonen', () => {
  // Ikke bare hva som RETURNERES: leser funksjonen i det hele tatt noe
  // per-bruker, er den ikke lenger delbar, uansett hva den returnerer.
  const forbudt = [
    'has_used_trial',
    'isTrialEligible',
    'decideTrialOffer',
    'createSupabaseServer',
    'getSession',
    'cookies',
    'user.id',
  ]
  for (const token of forbudt) {
    assert.ok(
      !BODY.includes(token),
      `computeSharedHomeData bruker «${token}» — det er per bruker, og resultatet ` +
      'deles av alle besøkende gjennom unstable_cache',
    )
  }
})

test('POSITIV KONTROLL: de forbudte tokenene finnes andre steder i fila', () => {
  // Uten denne ville testen over passert like fint om noen døpte om feltet
  // eller slettet hele prøveperiode-koden — et fravær som ikke beviser noe.
  // Disse SKAL finnes, i den personaliserte grenen utenfor cachen.
  for (const token of ['has_used_trial', 'isTrialEligible', 'decideTrialOffer', 'createSupabaseServer']) {
    assert.ok(
      SRC.includes(token),
      `«${token}» finnes ikke i app/page.tsx i det hele tatt — da måler ` +
      '«ingen brukerspesifikk kode» ingenting. Er koden flyttet, flytt kontrollen med.',
    )
  }
  // …og de skal ligge UTENFOR den cachede funksjonen.
  const utenfor = SRC.replace(BODY, '')
  assert.ok(utenfor.includes('has_used_trial'), 'has_used_trial ligger ikke lenger i den personaliserte grenen')
  assert.ok(utenfor.includes('decideTrialOffer'), 'decideTrialOffer ligger ikke lenger i den personaliserte grenen')
})

test('ingen inngangsverdier — argumenter ville blitt del av cache-nøkkelen', () => {
  assert.ok(
    /async function computeSharedHomeData\(\s*\)/.test(SRC),
    'computeSharedHomeData har fått et parameter. unstable_cache tar argumentene ' +
    'inn i nøkkelen, så et bruker-argument ville gitt én cache-rad per bruker — ' +
    'ikke den delte bundelen dette skal være.',
  )
})

test('SELVTEST: kommentarstrippen fjerner utkommentert kode, men ikke aktiv', () => {
  // Memory-regelen «strukturtester trenger linje-anker»: en substring-test
  // passerer på utkommentert kode med mindre strippen faktisk virker.
  const prøve = [
    'const a = 1 // har_brukt_proveperiode i linjekommentar',
    '/* has_used_trial i blokk-kommentar */',
    'const aktiv = "has_used_trial"',
  ].join('\n')
  const strippet = stripComments(prøve)
  assert.ok(!strippet.includes('har_brukt_proveperiode'), 'linjekommentarer strippes ikke')
  assert.ok(!strippet.includes('blokk-kommentar'), 'blokk-kommentarer strippes ikke')
  assert.ok(strippet.includes('const aktiv = "has_used_trial"'), 'strippen spiser aktiv kode')
  // URL-er inneholder «//» og skal overleve.
  assert.ok(stripComments('const u = "https://x.no"').includes('https://x.no'), 'strippen spiser URL-er')
})
